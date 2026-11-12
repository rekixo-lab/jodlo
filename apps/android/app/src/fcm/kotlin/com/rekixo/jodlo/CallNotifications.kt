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
import com.rekixo.jodlo.core.network.CallNotificationFreshnessGate
import com.rekixo.jodlo.core.network.CallPhase
import com.rekixo.jodlo.core.network.CallRole
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.IncomingCallWakeup
import com.rekixo.jodlo.core.network.SessionResult
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

internal object CallNotifications {
    private const val CHANNEL = "incoming_calls"
    private const val NOTICE = 1
    private val work = Executors.newSingleThreadExecutor()
    // Do not perform authenticated HTTPS ACK in FirebaseMessagingService's
    // short onMessageReceived callback. Keep a separate, bounded FIFO for
    // rings so slow server I/O cannot grow an unbounded push backlog or block
    // call-device registration/consent updates on the existing executor.
    private val ringWork = ThreadPoolExecutor(
        1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(2),
        { task -> Thread(task, "jodlo-fcm-ring-ack").apply { isDaemon = true } },
        ThreadPoolExecutor.AbortPolicy(),
    )
    @Volatile private var coordinator: InMemorySessionCoordinator? = null

    // The only cached push address is process-local, never disk-backed. Only
    // the single registration executor may inspect or mutate this gate.
    private val registered = CallDeviceRegistrationGate()
    private val noticeGate = CallNotificationFreshnessGate()
    // Uses the SAME monitor as showNotice: old callbacks cannot republish a
    // prior owner's alert after logout, erasure or explicit opt-out.
    private var suppressGenericNotice = false

    @Synchronized
    private fun cancelNotice(context: Context, suppressGeneric: Boolean) {
        if (suppressGeneric) suppressGenericNotice = true
        manager(context).cancel(NOTICE)
        noticeGate.clear()
    }

    @Synchronized
    private fun allowGenericAfterCurrentConsent(
        session: InMemorySessionCoordinator, owner: AccountPrivateReadMarker,
    ) {
        if (coordinator === session && session.accountPrivateReadMarker() == owner) {
            suppressGenericNotice = false
        }
    }

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
        cancelNotice(context, suppressGeneric = true)
        work.execute { registered.clear() }
    }

    fun preferenceChanged(context: Context, enabled: Boolean) {
        if (!enabled) {
            cancelNotice(context, suppressGeneric = true)
        }
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
                    // A fresh, unauthenticated process must still be able to
                    // receive the generic FCM wakeup later. Do not *create*
                    // opt-out state just because its memory session is empty.
                    // Any earlier explicit logout/erasure suppression remains.
                    cancelNotice(app, suppressGeneric = false)
                    registered.clear()
                    return@execute
                }
                if (!notificationsAllowed(app)) {
                    cancelNotice(app, suppressGeneric = true)
                    unregisterIfNeeded(session, owner)
                    return@execute
                }
                val preference = session.callPreference(owner) as? SessionResult.Success
                    ?: return@execute
                if (coordinator !== session || session.accountPrivateReadMarker() != owner) {
                    return@execute
                }
                if (!preference.value.enabled) {
                    cancelNotice(app, suppressGeneric = true)
                    unregisterIfNeeded(session, owner)
                    return@execute
                }
                // Only a current, freshly confirmed opted-in Worker may
                // lift process-local generic-notice suppression.
                allowGenericAfterCurrentConsent(session, owner)
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

    @Synchronized
    private fun showNotice(
        context: Context, wakeup: IncomingCallWakeup, verified: Boolean,
        expectedSession: InMemorySessionCoordinator?,
        expectedMarker: AccountPrivateReadMarker?,
    ) {
        // This monitor serializes the final owner check with cancelNotice().
        if (coordinator !== expectedSession) return
        if (verified) {
            if (expectedSession == null || expectedMarker == null ||
                expectedSession.accountPrivateReadMarker() != expectedMarker) return
        } else {
            if (suppressGenericNotice ||
                expectedSession?.accountPrivateReadMarker() != null) return
        }
        val remaining = wakeup.remainingMs(System.currentTimeMillis())
        if (remaining == 0L) return
        val manager = manager(context)
        if (!manager.areNotificationsEnabled()) return
        manager.createNotificationChannel(NotificationChannel(
            CHANNEL, context.getString(R.string.call_notification_channel), NotificationManager.IMPORTANCE_HIGH,
        ))
        if (!notificationsAllowed(context)) return
        // One visible notification ID. Per-call PendingIntent identity plus
        // this priority gate prevent stale/unverified events retargeting it.
        if (!noticeGate.accept(wakeup, verified, System.currentTimeMillis())) return
        try {
            // Include PendingIntent creation in the failure boundary: an
            // Android OS/runtime error before notify must not leave the
            // freshness gate believing this call was actually displayed.
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                // Android PendingIntent identity ignores extras. Distinguish
                // each call by action so a failed new NotificationManager
                // post cannot silently retarget the older visible alert.
                action = INCOMING_CALL_ACTION_PREFIX + wakeup.invitationId
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
            noticeGate.notificationPosted(wakeup, verified)
        } catch (failure: RuntimeException) {
            // Preserve the previous on-screen notification's verified status
            // after an OS failure. Different call IDs use different PendingIntent
            // identities, so the old tap target was never overwritten.
            noticeGate.notificationPostFailed(wakeup, verified)
            throw failure
        }
    }

    fun ring(context: Context, data: Map<String, String>) {
        // FirebaseMessagingService must not crash when Android permission is
        // withdrawn, the private ACK network fails, or the event is malformed.
        try {
            val wakeup = IncomingCallWakeup.fromPush(
                data["eventType"], data["eventId"], data["expiresAtMs"], System.currentTimeMillis(),
            ) ?: return
            if (!notificationsAllowed(context)) return
            val session = coordinator
            val owner = session?.accountPrivateReadMarker()
            if (session == null || owner == null) {
                // Process restart: no bearer. Only generic notification,
                // followed by explicit Google sign-in + server-owned GET.
                showNotice(context, wakeup, verified = false, session, expectedMarker = null)
                return
            }
            // A signed-in call requires server-owned ACK. Never make that
            // blocking HTTPS request on the Firebase callback thread.
            // A queue saturated by slow requests fails closed: no fake ring
            // and no implicit retry of the mutation.
            try {
                ringWork.execute {
                    try {
                        if (wakeup.remainingMs(System.currentTimeMillis()) == 0L ||
                            coordinator !== session ||
                            session.accountPrivateReadMarker() != owner ||
                            !notificationsAllowed(context)) return@execute
                        val signal = (session.callSignal(owner, wakeup.invitationId, CallAction.ACK)
                            as? SessionResult.Success)?.value ?: return@execute
                        if (!wakeup.matchesAuthenticatedRing(signal, System.currentTimeMillis()) ||
                            coordinator !== session ||
                            session.accountPrivateReadMarker() != owner.copy(writeRevision = owner.writeRevision + 1)) {
                            return@execute
                        }
                        showNotice(context, wakeup, verified = true, session,
                            expectedMarker = owner.copy(writeRevision = owner.writeRevision + 1))
                    } catch (_: Exception) {
                        // The server might have committed an ACK even when
                        // its reply is lost. Do not claim verified delivery.
                    }
                }
            } catch (_: RejectedExecutionException) {
                // Bounded queue full: fail closed instead of blocking FCM
                // callback or retaining unbounded old call events.
            }
        } catch (_: Exception) {
            // An outage or OS notification failure is never proof of a
            // verified call. Never log FCM tokens, identity or call IDs.
        }
    }
}

class CallMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) = CallNotifications.sync(applicationContext, token)
    override fun onMessageReceived(message: RemoteMessage) = CallNotifications.ring(applicationContext, message.data)
}
