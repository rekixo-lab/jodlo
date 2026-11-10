package com.rekixo.jodlo.core.network

/**
 * A short-lived, UNVERIFIED FCM event reference. It is not a caller identity,
 * session, invitation ACK, or permission to join an RTC channel. Safe only
 * for a generic wake-up notice until the current signed-in owner performs a
 * fresh server-owned call GET. Never persist this value or a bearer.
 */
data class IncomingCallWakeup private constructor(
    val invitationId: String,
    val expiresAtMs: Long,
) {
    fun remainingMs(nowMs: Long): Long =
        if (nowMs < 0 || nowMs >= expiresAtMs) 0 else expiresAtMs - nowMs

    fun matchesAuthenticatedRing(signal: CallSignal, nowMs: Long): Boolean =
        remainingMs(nowMs) in 1..MAX_RING_WINDOW_MS &&
            signal.role == CallRole.RECEIVER &&
            signal.phase == CallPhase.RINGING &&
            signal.ringDeadlineMs == expiresAtMs

    companion object {
        const val MAX_RING_WINDOW_MS: Long = 90_000L
        private val OPAQUE_ID = Regex("[a-zA-Z0-9_-]{8,128}")

        fun fromPush(eventType: String?, id: String?, expires: String?, nowMs: Long): IncomingCallWakeup? {
            if (eventType != "call_ring") return null
            return fromIntent(id, expires?.toLongOrNull(), nowMs)
        }

        /** Android Activity intent extras are untrusted even if a prior
         * notification supplied them: MainActivity is exported for launch.
         */
        fun fromIntent(id: String?, expiresAtMs: Long?, nowMs: Long): IncomingCallWakeup? {
            if (nowMs < 0 || id == null || !OPAQUE_ID.matches(id) || expiresAtMs == null ||
                expiresAtMs <= nowMs || expiresAtMs - nowMs > MAX_RING_WINDOW_MS) return null
            return IncomingCallWakeup(id, expiresAtMs)
        }
    }
}
