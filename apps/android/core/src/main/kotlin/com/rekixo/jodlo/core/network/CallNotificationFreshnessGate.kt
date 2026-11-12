package com.rekixo.jodlo.core.network

/**
 * Process-local ordering for the ONE Android incoming-call notification slot.
 *
 * FCM is asynchronous: a late, older generic push must never replace a newer
 * call's PendingIntent. A repeat generic push must not downgrade a previously
 * server-verified notice. Nothing here trusts or authenticates a push: callers
 * still require a current owner-bound server GET/ACK before accepting a call.
 *
 * Holds opaque IDs briefly in memory only; no durable storage or logs.
 */
class CallNotificationFreshnessGate {
    private data class Displayed(
        val invitationId: String,
        val expiresAtMs: Long,
        val serverVerified: Boolean,
    )

    private var displayed: Displayed? = null
    // Only until NotificationManager confirms the corresponding post.
    // A failed replacement must not discard a previously verified alert.
    private var replacedByUnposted: Displayed? = null

    @Synchronized
    fun accept(wakeup: IncomingCallWakeup, verified: Boolean, nowMs: Long): Boolean {
        if (wakeup.remainingMs(nowMs) == 0L) return false
        val previous = displayed?.takeIf { it.expiresAtMs > nowMs }
        if (previous != null) {
            if (previous.invitationId == wakeup.invitationId) {
                // The server fixes a ring deadline once per invitation. A
                // differently timed FCM copy must never reset the PendingIntent
                // or downgrade an already server-verified notification.
                if (previous.expiresAtMs != wakeup.expiresAtMs ||
                    previous.serverVerified || !verified) return false
                // The ONLY same-call update: generic -> server-verified.
            } else {
                // Two different invitations can share the single Android
                // notification slot, but an unverified FCM event cannot
                // displace a still-live, server-confirmed ring even if its
                // claimed deadline is later. A fresh authenticated ACK may.
                if (wakeup.expiresAtMs <= previous.expiresAtMs ||
                    (previous.serverVerified && !verified)) return false
            }
        }
        replacedByUnposted = displayed
        displayed = Displayed(wakeup.invitationId, wakeup.expiresAtMs, verified)
        return true
    }

    /** NotificationManager.notify completed without throwing. Discard the
     * rollback snapshot. Caller serializes accept/post/failure under one
     * notification monitor; this is not proof of on-device delivery.
     */
    @Synchronized
    fun notificationPosted(wakeup: IncomingCallWakeup, verified: Boolean) {
        if (displayed == Displayed(wakeup.invitationId, wakeup.expiresAtMs, verified)) {
            replacedByUnposted = null
        }
    }

    /** OS failed before confirming the replacement: preserve the old
     * verified notification's priority, not an empty/stale gate.
     */
    @Synchronized
    fun notificationPostFailed(wakeup: IncomingCallWakeup, verified: Boolean) {
        if (displayed == Displayed(wakeup.invitationId, wakeup.expiresAtMs, verified)) {
            displayed = replacedByUnposted
            replacedByUnposted = null
        }
    }

    @Synchronized
    fun clear() {
        displayed = null
        replacedByUnposted = null
    }

    override fun toString() = "CallNotificationFreshnessGate(<redacted>)"
}
