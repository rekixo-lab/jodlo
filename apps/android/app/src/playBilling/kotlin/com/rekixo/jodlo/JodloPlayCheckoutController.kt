package com.rekixo.jodlo

import android.app.Activity
import android.os.Looper
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase

/**
 * Debug-only Play Billing 9.1 checkout preparation. The default Android APK,
 * all release-candidate variants and the app UI never activate this class.
 *
 * The only payment UI this can launch is Google's own BillingFlow. There is
 * no locally invented amount, offline fallback, credit, acknowledgement,
 * consume, order processing or on-device entitlement.
 *
 * The owner account binding must be read from the CURRENT signed-in JODLO
 * Cloudflare session. A fresh Google ProductDetails query immediately before
 * launch must match the EXACT Google-formatted price the user just saw.
 */
internal class JodloPlayCheckoutController(
    private val billing: BillingClient,
    approvedProductIds: Set<String>,
    private val queryFreshProducts:
        (callback: (JodloPlayBillingReadOnlyClient.ReadResult<ProductDetails>) -> Unit) -> Unit,
    private val ownerBoundProof:
        (purchase: Purchase, binding: String) ->
            JodloPlayBillingReadOnlyClient.OwnerBoundUnverifiedProof?,
) {
    sealed interface Event {
        data object Disabled : Event
        data object Unavailable : Event
        data object Busy : Event
        data class PriceChanged(val latestGooglePrice: String) : Event
        data object Launched : Event
        data object Canceled : Event
        data object Pending : Event
        data object RestoreManually : Event
        /** Still not settled or credited. Caller must recheck its LIVE JODLO
         * account/session before submitting this ephemeral proof exactly once. */
        data class VerifyWithCloudflare(
            val proof: JodloPlayBillingReadOnlyClient.OwnerBoundUnverifiedProof,
        ) : Event
    }

    private class Attempt(
        val productId: String,
        val binding: String,
        val displayedGooglePrice: String,
        val notify: (Event) -> Unit,
    )

    private val approved = approvedProductIds.toSet()
    private var active: Attempt? = null

    @Synchronized
    fun invalidateSession() {
        // Play UI cannot be forcibly canceled on sign-out. Its late callback
        // must not deliver a token to a new or logged-out JODLO session.
        active = null
    }

    @Synchronized
    private fun current(attempt: Attempt): Boolean = active === attempt

    private fun emit(attempt: Attempt, result: Event, finish: Boolean = true) {
        val notify = synchronized(this) {
            if (active !== attempt) null
            else {
                if (finish) active = null
                attempt.notify
            }
        }
        notify?.invoke(result)
    }

    fun prepareAndLaunch(
        activity: Activity,
        productId: String,
        displayedGooglePrice: String,
        currentServerBinding: String,
        onEvent: (Event) -> Unit,
    ) {
        if (!BuildConfig.PLAY_CHECKOUT_ENABLED) {
            onEvent(Event.Disabled)
            return
        }
        if (Looper.myLooper() != Looper.getMainLooper() ||
            activity.isFinishing || activity.isDestroyed ||
            !billing.isReady || productId !in approved ||
            !Regex("^[0-9a-f]{64}$").matches(currentServerBinding) ||
            !validGooglePrice(displayedGooglePrice)
        ) {
            onEvent(Event.Unavailable)
            return
        }
        val attempt = Attempt(productId,currentServerBinding,displayedGooglePrice,onEvent)
        val reserved = synchronized(this) {
            if (active != null) false else {
                active = attempt
                true
            }
        }
        if (!reserved) {
            onEvent(Event.Busy)
            return
        }

        // Re-query Google immediately on each explicit user tap. Neither a
        // stale ProductDetails object nor a previously cached offer is reused.
        try {
            queryFreshProducts { response ->
                if (!current(attempt)) return@queryFreshProducts
                val products = when (response) {
                    is JodloPlayBillingReadOnlyClient.ReadResult.Available ->
                        response.items
                    JodloPlayBillingReadOnlyClient.ReadResult.Unavailable -> null
                }
                val product = products?.filter { it.productId == productId &&
                    it.productType == BillingClient.ProductType.INAPP
                }?.singleOrNull()
                val offer = product?.oneTimePurchaseOfferDetailsList?.singleOrNull()
                val freshPrice = offer?.formattedPrice ?: ""
                val offerToken = offer?.offerToken
                if (product == null || !validGooglePrice(freshPrice) ||
                    offerToken.isNullOrBlank() || offerToken.length > 4096
                ) {
                    emit(attempt,Event.Unavailable)
                    return@queryFreshProducts
                }
                if (freshPrice != attempt.displayedGooglePrice) {
                    emit(attempt,Event.PriceChanged(freshPrice))
                    return@queryFreshProducts
                }
                activity.runOnUiThread {
                    if (!current(attempt)) return@runOnUiThread
                    if (!BuildConfig.PLAY_CHECKOUT_ENABLED || !billing.isReady ||
                        activity.isFinishing || activity.isDestroyed
                    ) {
                        emit(attempt,Event.Unavailable)
                        return@runOnUiThread
                    }
                    // Correct Play 9 one-time offer token and server-issued
                    // opaque account identity, not raw email/Google subject.
                    val details = BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(product)
                        .setOfferToken(offerToken)
                        .build()
                    val params = BillingFlowParams.newBuilder()
                        .setProductDetailsParamsList(listOf(details))
                        .setObfuscatedAccountId(attempt.binding)
                        .build()
                    val status = try {
                        billing.launchBillingFlow(activity,params).responseCode
                    } catch (_: RuntimeException) {
                        BillingClient.BillingResponseCode.ERROR
                    }
                    when (status) {
                        BillingClient.BillingResponseCode.OK ->
                            emit(attempt,Event.Launched,finish=false)
                        BillingClient.BillingResponseCode.USER_CANCELED ->
                            emit(attempt,Event.Canceled)
                        else -> emit(attempt,Event.Unavailable)
                    }
                }
            }
        } catch (_: RuntimeException) {
            emit(attempt,Event.Unavailable)
        }
    }

    /** The SINGLE BillingClient listener is shared with the existing native
     * read-only adapter. Purchase callbacks are not proof of entitlement.
     * Pending, canceled, foreign, unknown and replayed callbacks never credit.
     */
    fun onPurchaseUpdated(result: BillingResult, purchases: List<Purchase>?) {
        val attempt = synchronized(this) { active } ?: return
        when (result.responseCode) {
            BillingClient.BillingResponseCode.USER_CANCELED ->
                emit(attempt,Event.Canceled)
            BillingClient.BillingResponseCode.OK -> {
                val purchase = purchases?.singleOrNull()
                if (purchase?.products != listOf(attempt.productId)) {
                    emit(attempt,Event.RestoreManually)
                    return
                }
                when (purchase.purchaseState) {
                    Purchase.PurchaseState.PENDING -> emit(attempt,Event.Pending)
                    Purchase.PurchaseState.PURCHASED -> {
                        val proof = ownerBoundProof(purchase,attempt.binding)
                        emit(attempt,if(proof != null) Event.VerifyWithCloudflare(proof)
                            else Event.RestoreManually)
                    }
                    else -> emit(attempt,Event.RestoreManually)
                }
            }
            else -> emit(attempt,Event.RestoreManually)
        }
    }

    private fun validGooglePrice(price: String?): Boolean =
        !price.isNullOrBlank() && price.length <= 64 &&
            price.none { Character.isISOControl(it) }
}
