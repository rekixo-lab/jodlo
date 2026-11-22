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

/** Private, server-owned D1 ledger seconds and the canonical proposed packs.
 * This is NOT confirmation that any purchase was made or may be bought. */
data class PlayMinuteAccountOverview(
    val availableSeconds: Int,
    val revision: Int,
    val catalog: PlayMinutePackCatalog,
)

/** A successful read is always tied to the currently authenticated session.
 * Never persist it or use it to grant entitlement on the device. */
class PrivatePlayMinuteAccountSnapshot private constructor(
    private val owner: AccountPrivateReadMarker,
    private val overview: PlayMinuteAccountOverview,
) {
    fun forCurrent(current: AccountPrivateReadMarker?): PlayMinuteAccountOverview? =
        if (current == owner) overview else null

    override fun toString(): String = "PrivatePlayMinuteAccountSnapshot(<private>)"

    companion object {
        fun confirmed(
            requested: AccountPrivateReadMarker?,
            current: AccountPrivateReadMarker?,
            result: SessionResult<PlayMinuteAccountOverview>?,
        ): PrivatePlayMinuteAccountSnapshot? =
            if (requested == null || requested != current ||
                result !is SessionResult.Success) null
            else PrivatePlayMinuteAccountSnapshot(requested,result.value)
    }
}
