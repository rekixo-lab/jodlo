package com.rekixo.jodlo.core.network

/**
 * A JODLO minute-pack preview contains only a server-authorized product ID
 * and a minute quantity. Money, store availability and formatted prices MUST
 * come from Google Play's live ProductDetails, not from Finworkar or JODLO API.
 *
 * This is not a purchase offer or entitlement. The server returns
 * purchasable=false until an independently reviewed checkout is activated.
 */
data class PlayMinutePack(val productId: String, val minutes: Int)
data class PlayMinutePackCatalog(
    val packs: List<PlayMinutePack>,
    val priceSource: String,
    val purchasable: Boolean,
)

/** One-shot, authenticated read; never caches another account's packs,
 * retries an uncertain request, mints credit, or interprets product prices. */
class RemotePlayMinutePackRepository(private val sender: RequestSender) {
    fun read(session: String): ApiOutcome<PlayMinutePackCatalog> =
        performOnce(JodloRoutes.playMinutePacks(session),
            sender::send, JodloReplyDecoder::playMinutePacks)
}
