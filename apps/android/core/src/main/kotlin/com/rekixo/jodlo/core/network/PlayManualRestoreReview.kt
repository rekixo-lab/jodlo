package com.rekixo.jodlo.core.network

/** Exactly one user-selected product may be screened per manual check.
 * This is not an entitlement, and a SKU is not proof that a purchase exists.
 * An ambiguous owned Play query MUST NOT guess which token to submit. */
sealed interface ManualPlayRestoreSelection {
    data object Missing : ManualPlayRestoreSelection
    data object Ambiguous : ManualPlayRestoreSelection
    data class Single(val index: Int) : ManualPlayRestoreSelection
}

fun selectManualPlayRestore(
    approvedProducts: Set<String>,
    selectedProductId: String,
    accountBinding: String,
    productsFromOwnedProofs: List<String>,
): ManualPlayRestoreSelection {
    if (approvedProducts.size !in 1..16 ||
        selectedProductId !in approvedProducts ||
        !validJodloPlayAccountBinding(accountBinding) ||
        productsFromOwnedProofs.size > 16 ||
        productsFromOwnedProofs.any { it !in approvedProducts })
        return ManualPlayRestoreSelection.Ambiguous
    val matches = productsFromOwnedProofs.indices.filter {
        productsFromOwnedProofs[it] == selectedProductId
    }
    return when (matches.size) {
        0 -> ManualPlayRestoreSelection.Missing
        1 -> ManualPlayRestoreSelection.Single(matches.single())
        else -> ManualPlayRestoreSelection.Ambiguous
    }
}

/** No UI should call a screening result "paid", "restored", or "credited".
 * The backend remains verification-only until an independently approved
 * settlement, acknowledgement, consuming and refund policy exists. */
sealed interface ManualPlayRestoreStatus {
    data object Disabled : ManualPlayRestoreStatus
    data object Busy : ManualPlayRestoreStatus
    data object AccountChanged : ManualPlayRestoreStatus
    data object Unavailable : ManualPlayRestoreStatus
    data object NoMatchingPurchase : ManualPlayRestoreStatus
    data object NeedsIndividualReview : ManualPlayRestoreStatus
    data object NotEligible : ManualPlayRestoreStatus
    data class ScreenedPendingSettlement(
        val productId: String,
        val minutes: Int,
    ) : ManualPlayRestoreStatus
}

/** A Google 'PURCHASED' client callback is *not* a successful restore.
 * Even after a server receipt screen, only the exact SKU selected by the
 * same signed-in customer may become this nonprivileged diagnostic state. */
fun summarizeManualPlayScreening(
    selectedProductId: String,
    result: SessionResult<PlayReceiptScreening>,
): ManualPlayRestoreStatus = when (result) {
    is SessionResult.Failed -> when (result.reason) {
        SessionFailure.REPLACED, SessionFailure.EXPIRED, SessionFailure.SIGNED_OUT,
        SessionFailure.STALE_RESULT -> ManualPlayRestoreStatus.AccountChanged
        else -> ManualPlayRestoreStatus.Unavailable
    }
    is SessionResult.Success -> when (val screen = result.value) {
        PlayReceiptScreening.NotEligible -> ManualPlayRestoreStatus.NotEligible
        is PlayReceiptScreening.ScreenedPendingSettlement ->
            if (screen.productId == selectedProductId &&
                screen.minutes in 1..500 &&
                selectedProductId == "jodlo.minutes" + screen.minutes
            ) ManualPlayRestoreStatus.ScreenedPendingSettlement(
                selectedProductId,screen.minutes,
            ) else ManualPlayRestoreStatus.Unavailable
    }
}
