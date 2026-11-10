package com.rekixo.jodlo.core.network

enum class CallAction(val wire: String) {
    ACK("ack"), ACCEPT("accept"), DECLINE("decline"), CANCEL("cancel"), HANGUP("hangup"),
}

enum class CallRole(val wire: String) {
    CALLER("caller"), RECEIVER("receiver"),
}

enum class CallPhase(val wire: String) {
    PENDING("pending"), RINGING("ringing"), ACCEPTED("accepted"), DECLINED("declined"),
    CANCELLED("cancelled"), ENDED("ended"), MISSED("missed"),
}

data class CallInvitation(val id: String, val ringDeadlineMs: Long)

data class CallSignal(val role: CallRole, val phase: CallPhase, val ringDeadlineMs: Long)

/**
 * Caller/Worker termination is confirmed only by an authenticated, matching
 * server-side terminal phase. A failed HTTP request may already have committed;
 * the UI must leave the audio locally closed, explicitly reconcile the
 * current call, and never silently claim the other party stopped ringing.
 */
object CallEndProtocol {
    fun isConfirmed(expectedRole: CallRole, signal: CallSignal): Boolean =
        signal.role == expectedRole && signal.phase in setOf(
            CallPhase.DECLINED, CallPhase.CANCELLED, CallPhase.ENDED, CallPhase.MISSED,
        )

    fun actionToEnd(role: CallRole, phase: CallPhase): CallAction? = when (phase) {
        CallPhase.ACCEPTED -> CallAction.HANGUP
        CallPhase.RINGING, CallPhase.PENDING ->
            if (role == CallRole.RECEIVER) CallAction.DECLINE else CallAction.CANCEL
        else -> null
    }
}

class CallAudioGrant internal constructor(
    val appId: String,
    val channel: String,
    val uid: Int,
    val token: String,
    val expiresInSeconds: Int,
) {
    override fun toString(): String = "CallAudioGrant(<redacted>)"
}

enum class CallHistoryOutcome(val wire: String) {
    ENDED("ended"), DECLINED("declined"), BUSY("busy"), CANCELLED("cancelled"),
    MISSED("missed"), FAILED("failed"),
}

data class CallHistoryEntry(
    val id: String,
    val incoming: Boolean,
    val outcome: CallHistoryOutcome,
    val endedAtSeconds: Long,
)

data class CallHistoryPage(val items: List<CallHistoryEntry>, val nextCursor: String?)

/**
 * An explicit Account Call History pagination transition, not an implicit
 * background refresh. Keep all already reviewed rows while adding an older
 * page, but refuse an out-of-sequence, duplicated, or reordered response.
 *
 * This is memory-only private UI data. A caller must additionally check the
 * account's current session/write marker before installing the result.
 */
object CallHistoryTimeline {
    fun merge(previous: CallHistoryPage?, requestedCursor: String?, incoming: CallHistoryPage): CallHistoryPage? {
        if (incoming.items.size > 25 || (incoming.nextCursor != null &&
                (incoming.items.size != 25 || incoming.items.lastOrNull()?.id != incoming.nextCursor))) {
            return null
        }
        val earlier = if (requestedCursor == null) {
            emptyList()
        } else {
            if (previous == null || previous.nextCursor != requestedCursor || previous.items.isEmpty() ||
                incoming.items.isEmpty()) return null
            previous.items
        }
        val combined = earlier + incoming.items
        val ids = HashSet<String>()
        combined.forEachIndexed { index, item ->
            if (!ids.add(item.id)) return null
            if (index > 0) {
                val newer = combined[index - 1]
                if (newer.endedAtSeconds < item.endedAtSeconds ||
                    (newer.endedAtSeconds == item.endedAtSeconds && newer.id <= item.id)) {
                    return null
                }
            }
        }
        return CallHistoryPage(combined, incoming.nextCursor)
    }
}
