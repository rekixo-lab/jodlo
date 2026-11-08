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
import com.rekixo.jodlo.core.network.CallAction
import com.rekixo.jodlo.core.network.CallPhase
import com.rekixo.jodlo.core.network.CallRole
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.SessionResult
import java.util.concurrent.Executors

internal object CallNotifications {
    private const val CHANNEL = "incoming_calls"
    private const val NOTICE = 1
    private val work = Executors.newSingleThreadExecutor()
    @Volatile private var coordinator: InMemorySessionCoordinator? = null

    fun attach(session: InMemorySessionCoordinator?) {
        coordinator = session
    }

    private fun manager(context: Context) = context.getSystemService(NotificationManager::class.java)

    fun preferenceChanged(context: Context, enabled: Boolean) {
        if (!enabled) manager(context).cancel(NOTICE)
        sync(context.applicationContext)
    }

    fun sync(context: Context, refreshedToken: String? = null) {
        work.execute {
            val session = coordinator ?: return@execute
            val owner = session.accountPrivateReadMarker() ?: return@execute
            val preference = session.callPreference(owner) as? SessionResult.Success ?: return@execute
            if (!preference.value.enabled) return@execute
            if (!manager(context).areNotificationsEnabled() ||
                manager(context).getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE
            ) {
                session.setCallDevice(owner, null)
                return@execute
            }
            if (refreshedToken != null) {
                session.setCallDevice(owner, refreshedToken)
            } else {
                FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                    work.execute { if (coordinator === session) session.setCallDevice(owner, token) }
                }
            }
        }
    }

    fun ring(context: Context, data: Map<String, String>) {
        if (data["eventType"] != "call_ring") return
        val id = data["eventId"] ?: return
        if (!CALL_INVITATION_ID.matches(id)) return
        val expiry = data["expiresAtMs"]?.toLongOrNull() ?: return
        if (expiry <= System.currentTimeMillis()) return
        val session = coordinator ?: return
        val owner = session.accountPrivateReadMarker() ?: return
        if (!manager(context).areNotificationsEnabled()) return
        val signal = (session.callSignal(owner, id, CallAction.ACK) as? SessionResult.Success)?.value ?: return
        val remaining = expiry - System.currentTimeMillis()
        if (signal.role != CallRole.RECEIVER || signal.phase != CallPhase.RINGING ||
            signal.ringDeadlineMs != expiry || remaining !in 1..90_000 ||
            coordinator !== session || session.accountPrivateReadMarker() != owner.copy(writeRevision = owner.writeRevision + 1)
        ) return

        val manager = manager(context)
        if (!manager.areNotificationsEnabled()) return
        manager.createNotificationChannel(NotificationChannel(
            CHANNEL, context.getString(R.string.call_notification_channel), NotificationManager.IMPORTANCE_HIGH,
        ))
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(INCOMING_CALL_EXTRA, id)
        }
        val open = PendingIntent.getActivity(context, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        manager.notify(NOTICE, Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setContentTitle(context.getString(R.string.call_notification_title))
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setCategory(Notification.CATEGORY_CALL)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setTimeoutAfter(remaining)
            .build())
    }
}

class CallMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) = CallNotifications.sync(applicationContext, token)
    override fun onMessageReceived(message: RemoteMessage) = CallNotifications.ring(applicationContext, message.data)
}
