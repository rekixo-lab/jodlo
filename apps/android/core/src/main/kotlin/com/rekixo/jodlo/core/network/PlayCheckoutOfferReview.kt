package com.rekixo.jodlo.core.network

/** Pure, UI-agnostic checkout integrity policy reused by the optional native
 * Billing 9.1 flow and deterministic JVM tests. Nothing here starts payment.
 * A Play price must always be a freshly fetched, *formatted* Google string,
 * never a legacy INR number, computed discount or string built by JODLO. */
sealed interface PlayOfferReview {
    data object Unavailable : PlayOfferReview
    data class PriceChanged(val latestGooglePrice: String) : PlayOfferReview
    class Ready(val offerToken: String) : PlayOfferReview {
        override fun toString(): String = "PlayOfferReview.Ready(<redacted>)"
    }
}

fun validJodloPlayAccountBinding(value: String): Boolean =
    Regex("^[0-9a-f]{64}$").matches(value)

fun validGoogleFormattedPrice(value: String?): Boolean =
    !value.isNullOrBlank() && value.length <= 64 &&
        value.none { Character.isISOControl(it) }

/** Exact same SKU, exactly one offer, unchanged user-visible price, and an
 * opaque Play account binding issued by the server. Ready is ONLY permission
 * to ask Google to display checkout in an explicitly configured APK;
 * not evidence of settlement, credit, acknowledgment or consumption. */
fun reviewFreshGooglePlayOffer(
    approvedProducts: Set<String>,
    requestedProductId: String,
    serverAccountBinding: String,
    previouslyDisplayedGooglePrice: String,
    freshProductId: String?,
    freshFormattedGooglePrice: String?,
    freshOfferToken: String?,
): PlayOfferReview {
    if (approvedProducts.size !in 1..16 ||
        requestedProductId !in approvedProducts ||
        !validJodloPlayAccountBinding(serverAccountBinding) ||
        !validGoogleFormattedPrice(previouslyDisplayedGooglePrice) ||
        freshProductId != requestedProductId ||
        !validGoogleFormattedPrice(freshFormattedGooglePrice) ||
        freshOfferToken.isNullOrBlank() || freshOfferToken.length > 4096 ||
        freshOfferToken.any { Character.isISOControl(it) })
        return PlayOfferReview.Unavailable
    if (freshFormattedGooglePrice != previouslyDisplayedGooglePrice)
        return PlayOfferReview.PriceChanged(freshFormattedGooglePrice!!)
    return PlayOfferReview.Ready(freshOfferToken)
}
