package com.rekixo.jodlo.core.network

/** Protocol version, not a price or a client-side entitlement decision. */
const val PLAY_MINUTE_POLICY_VERSION = "jodlo-play-minutes-v1"

/** Fresh capability from the SAME signed-in account's settlement endpoint.
 * A catalog preview or verificationOnly binding cannot enable checkout. */
class PlaySettlementCapability(val accountBinding: String, val policyVersion: String) {
    override fun toString(): String = "PlaySettlementCapability(<private>)"
}

/** Only the server may confirm journal credit AND Google consumption.
 * Pending can already have a journal entry: do not add/subtract any minutes
 * locally or claim that Google has not charged the customer. */
sealed interface PlayPurchaseSettlement {
    data class Settled(val productId: String, val minutes: Int) : PlayPurchaseSettlement
    data object PendingReconciliation : PlayPurchaseSettlement
    data object NotEligible : PlayPurchaseSettlement
    data object ManualReview : PlayPurchaseSettlement
}

/** All transport calls are one-shot. A user may explicitly recover a receipt
 * after a lost reply; only the backend's idempotent journal decides whether
 * an existing purchase is settled. Android never consumes or acknowledges. */
class RemotePlaySettlementRepository(private val sender: RequestSender) {
    fun capability(session: String): ApiOutcome<PlaySettlementCapability> =
        performOnce(JodloRoutes.playSettlementCapability(session),
            sender::send, JodloReplyDecoder::playSettlementCapability)

    fun settle(session: String, purchaseToken: String, policyVersion: String):
        ApiOutcome<PlayPurchaseSettlement> =
        performOnce(JodloRoutes.settlePlayPurchase(session, purchaseToken, policyVersion),
            sender::send, JodloReplyDecoder::playPurchaseSettlement)
}

/** A server result must still describe the exact pack the customer chose. */
fun PlayPurchaseSettlement.matchesSelectedPack(pack: PlayMinutePack): Boolean =
    this !is PlayPurchaseSettlement.Settled ||
        (productId == pack.productId && minutes == pack.minutes)
