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
