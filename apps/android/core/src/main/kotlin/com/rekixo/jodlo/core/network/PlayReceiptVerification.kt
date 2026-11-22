package com.rekixo.jodlo.core.network

/** A non-reversible server-issued billing identity, never raw account data.
 * Verification-only state is not authorization to open a Play checkout. */
data class PlayAccountBinding(val accountBinding: String, val verificationOnly: Boolean)

/** Never implies that a purchase is paid, settled, consumed or credited.
 * No raw receipt, purchase token, order ID or Google account data here. */
sealed interface PlayReceiptScreening {
    data object NotEligible : PlayReceiptScreening
    data class ScreenedPendingSettlement(
        val productId: String,
        val minutes: Int,
    ) : PlayReceiptScreening
}

/** Two one-shot server calls. A timeout on proof POST is UNKNOWN; the app
 * must never automatically replay it or add minutes locally. A future
 * background restore requires explicit account/session revalidation. */
class RemotePlayVerificationRepository(private val sender: RequestSender) {
    fun binding(session: String): ApiOutcome<PlayAccountBinding> =
        performOnce(JodloRoutes.playVerificationBinding(session),
            sender::send,JodloReplyDecoder::playAccountBinding)

    fun verify(session: String, purchaseToken: String): ApiOutcome<PlayReceiptScreening> =
        performOnce(JodloRoutes.verifyPlayReceipt(session,purchaseToken),
            sender::send,JodloReplyDecoder::playReceiptScreening)
}
