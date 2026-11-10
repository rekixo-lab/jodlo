package com.rekixo.jodlo

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.rekixo.jodlo.core.network.AccountPrivateReadMarker
import com.rekixo.jodlo.core.network.CallAction
import com.rekixo.jodlo.core.network.CallDeviceRegistrationGate
import com.rekixo.jodlo.core.network.CallPhase
import com.rekixo.jodlo.core.network.CallRole
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.IncomingCallWakeup
import com.rekixo.jodlo.core.network.SessionResult
import java.util.concurrent.Executors

internal object CallNotifications {
    private const val CHANNEL = "incoming_calls"
    private const val NOTICE = 1
    private val work = Executors.newSingleThreadExecutor()
    @Volatile private var coordinator: InMemorySessionCoordinator? = null

    // The only cached push address is process-local, never disk-backed. Only
    // the single registration executor may inspect or mutate this gate.
    private val registered = CallDeviceRegistrationGate()

    fun attach(session: InMemorySessionCoordinator?) {
        val previous = coordinator
        coordinator = session
        if (previous !== session) work.execute { registered.clear() }
    }

    private fun manager(context: Context) = context.getSystemService(NotificationManager::class.java)

    private fun notificationsAllowed(context: Context): Boolean {
        val notices = manager(context)
        return notices.areNotificationsEnabled() &&
            notices.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
    }

    /** Local-only disclosure clear on account replacement, logout or erasure.
     * Session revocation / device row deletion remain server-owned. */
    fun clearLocal(context: Context) {
        manager(context).cancel(NOTICE)
        work.execute { registered.clear() }
    }

    fun preferenceChanged(context: Context, enabled: Boolean) {
        if (!enabled) manager(context).cancel(NOTICE)
        sync(context.applicationContext)
    }

    /** Remove the last *confirmed* device binding, without inventing a remote
     * status. If offline, keep local evidence and retry at the next explicit
     * preference/foreground sync; the D1 opt-out trigger also removes devices.
     */
    private fun unregisterIfNeeded(session: InMemorySessionCoordinator, owner: AccountPrivateReadMarker) {
        if (!registered.shouldUnregister(owner.sessionGeneration) ||
            coordinator !== session || session.accountPrivateReadMarker() != owner) return
        if (session.setCallDevice(owner, null) is SessionResult.Success) registered.clear()
    }

    /** Firebase getToken() is asynchronous: every callback must re-read fresh
     * consent, OS permission AND the current account, not trust a captured
     * permission/Worker preference from a prior foreground session.
     */
    private fun registerFresh(
        context: Context, session: InMemorySessionCoordinator, generation: Long, token: String,
    ) {
        if (coordinator !== session || session.accountExportSessionMarker() != generation ||
            !notificationsAllowed(context) || token.isBlank()) return
        val owner = session.accountPrivateReadMarker() ?: return
        if (owner.sessionGeneration != generation) return
        val consent = session.callPreference(owner) as? SessionResult.Success ?: return
        if (!consent.value.enabled || coordinator !== session ||
            session.accountPrivateReadMarker() != owner || !notificationsAllowed(context) ||
            !registered.shouldRegister(generation, token)) return
        val result = session.setCallDevice(owner, token)
        if (result is SessionResult.Success && result.value &&
            coordinator === session && session.accountExportSessionMarker() == generation) {
            registered.confirmed(generation, token)
        }
    }

    fun sync(context: Context, refreshedToken: String? = null) {
        val app = context.applicationContext
        work.execute {
            try {
                val session = coordinator
                val owner = session?.accountPrivateReadMarker()
                if (session == null || owner == null) {
                    // Even a locally revoked, remote-uncertain session must
                    // never leave a former owner's incoming-call notice shown.
                    manager(app).cancel(NOTICE)
                    registered.clear()
                    return@execute
                }
                if (!notificationsAllowed(app)) {
                    manager(app).cancel(NOTICE)
                    unregisterIfNeeded(session, owner)
                    return@execute
                }
                val preference = session.callPreference(owner) as? SessionResult.Success
                    ?: return@execute
                if (coordinator !== session || session.accountPrivateReadMarker() != owner) {
                    return@execute
                }
                if (!preference.value.enabled) {
                    manager(app).cancel(NOTICE)
                    unregisterIfNeeded(session, owner)
                    return@execute
                }
                if (refreshedToken != null) {
                    registerFresh(app, session, owner.sessionGeneration, refreshedToken)
                } else {
                    FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                        work.execute {
                            try {
                                registerFresh(app, session, owner.sessionGeneration, token)
                            } catch (_: Exception) {
                                // No user data or provider error may enter logs.
                            }
                        }
                    }
                }
            } catch (_: Exception) {
                // A transient provider/HTTPS failure cannot crash the app.
                // The next explicit foreground/permission sync can retry.
            }
        }
    }

    private fun showNotice(context: Context, wakeup: IncomingCallWakeup, verified: Boolean) {
        val remaining = wakeup.remainingMs(System.currentTimeMillis())
        if (remaining == 0L) return
        val manager = manager(context)
        if (!manager.areNotificationsEnabled()) return
        manager.createNotificationChannel(NotificationChannel(
            CHANNEL, context.getString(R.string.call_notification_channel), NotificationManager.IMPORTANCE_HIGH,
        ))
        if (!notificationsAllowed(context)) return
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(INCOMING_CALL_EXTRA, wakeup.invitationId)
            putExtra(INCOMING_CALL_EXPIRY_EXTRA, wakeup.expiresAtMs)
        }
        val open = PendingIntent.getActivity(context, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        manager.notify(NOTICE, Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setContentTitle(context.getString(if (verified)
                R.string.call_notification_title else R.string.call_wakeup_title))
            .setContentText(context.getString(if (verified)
                R.string.call_notification_title else R.string.call_wakeup_detail))
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setCategory(if (verified) Notification.CATEGORY_CALL else Notification.CATEGORY_MESSAGE)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setTimeoutAfter(remaining)
            .build())
    }

    fun ring(context: Context, data: Map<String, String>) {
        val wakeup = IncomingCallWakeup.fromPush(
            data["eventType"], data["eventId"], data["expiresAtMs"], System.currentTimeMillis(),
        ) ?: return
        if (!notificationsAllowed(context)) return
        val session = coordinator
        val owner = session?.accountPrivateReadMarker()
        if (session == null || owner == null) {
            // A restarted FCM service has no bearer. This generic prompt
            // cannot ACK or join anything; the user must explicitly sign in.
            showNotice(context, wakeup, verified = false)
            return
        }
        val signal = (session.callSignal(owner, wakeup.invitationId, CallAction.ACK)
            as? SessionResult.Success)?.value ?: return
        if (!wakeup.matchesAuthenticatedRing(signal, System.currentTimeMillis()) ||
            coordinator !== session ||
            session.accountPrivateReadMarker() != owner.copy(writeRevision = owner.writeRevision + 1)) return
        showNotice(context, wakeup, verified = true)
    }
}

class CallMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) = CallNotifications.sync(applicationContext, token)
    override fun onMessageReceived(message: RemoteMessage) = CallNotifications.ring(applicationContext, message.data)
}
