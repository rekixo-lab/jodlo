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

    @Synchronized
    fun accept(wakeup: IncomingCallWakeup, verified: Boolean, nowMs: Long): Boolean {
        if (wakeup.remainingMs(nowMs) == 0L) return false
        val previous = displayed?.takeIf { it.expiresAtMs > nowMs }
        if (previous != null) {
            if (previous.invitationId == wakeup.invitationId &&
                previous.expiresAtMs == wakeup.expiresAtMs) {
                // Only the same call's promotion from generic to confirmed
                // is allowed. In particular, never downgrade a verified ring.
                if (previous.serverVerified || !verified) return false
            } else if (wakeup.expiresAtMs <= previous.expiresAtMs) {
                // Different but older/equal-expiry events must not replace
                // the newer single PendingIntent in the notification tray.
                return false
            }
        }
        displayed = Displayed(wakeup.invitationId, wakeup.expiresAtMs, verified)
        return true
    }

    @Synchronized
    fun clear() {
        displayed = null
    }

    override fun toString() = "CallNotificationFreshnessGate(<redacted>)"
}
