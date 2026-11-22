package com.rekixo.jodlo

import android.content.Context
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams

/**
 * Google Play Billing 9 read-only, opted-in native source.
 *
 * This is a PREPARATORY adapter, not a checkout or entitlement engine.
 * It intentionally exposes neither the raw Play token nor order ID, cannot
 * launchBillingFlow, acknowledge/consume a purchase or grant any minutes.
 * PURCHASED is still NOT a server-verified JODLO entitlement.
 *
 * Not referenced by the app. The main Android build does not compile this
 * file unless -PjodloEnablePlayBilling=true is explicitly passed.
 */
internal class JodloPlayBillingReadOnlyClient(
    context: Context,
    approvedProductIds: Set<String>,
    private val onUnverifiedPurchases: (List<UnverifiedPlayPurchase>) -> Unit,
) : AutoCloseable {
    internal enum class PurchaseState { PENDING, PURCHASED, OTHER }

    internal data class UnverifiedPlayPurchase(
        val productIds: List<String>,
        val state: PurchaseState,
        val acknowledged: Boolean,
    )

    /** Immutable, trusted SKU snapshot; invalid/empty configurations fail closed. */
    private val approvedIds = approvedProductIds.toSet().takeIf { ids ->
        ids.isNotEmpty() && ids.size <= 16 && ids.all { VALID_PRODUCT_ID.matches(it) }
    } ?: emptySet()

    internal sealed interface ReadResult<out T> {
        data class Available<T>(val items: List<T>) : ReadResult<T>
        data object Unavailable : ReadResult<Nothing>
    }

    private var closed = false
    private val listener = PurchasesUpdatedListener { result, purchases ->
        if (!closed && approvedIds.isNotEmpty() &&
            result.responseCode == BillingClient.BillingResponseCode.OK &&
            purchases != null
        ) {
            onUnverifiedPurchases(purchases.mapNotNull(::unverified))
        }
    }

    private val client = BillingClient.newBuilder(context.applicationContext)
        .setListener(listener)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()
        )
        .enableAutoServiceReconnection()
        .build()

    private fun unverified(purchase: Purchase): UnverifiedPlayPurchase? {
        // Reject multi-product purchases instead of silently discarding
        // an unapproved SKU from a mixed transaction.
        val ids = purchase.products
        if (approvedIds.isEmpty() || ids.size != 1 || ids.single() !in approvedIds) return null
        val state = when (purchase.purchaseState) {
            Purchase.PurchaseState.PENDING -> PurchaseState.PENDING
            Purchase.PurchaseState.PURCHASED -> PurchaseState.PURCHASED
            else -> PurchaseState.OTHER
        }
        return UnverifiedPlayPurchase(ids, state, purchase.isAcknowledged)
    }

    fun connect(onReady: (Boolean) -> Unit) {
        if (closed) {
            onReady(false)
            return
        }
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (!closed) {
                    onReady(result.responseCode == BillingClient.BillingResponseCode.OK)
                }
            }

            // Billing Library 9 automatically reconnects. Never start a
            // second connection/retry purchase from this callback.
            override fun onBillingServiceDisconnected() = Unit
        })
    }

    /** Google's localized, formatted money text is the sole display-price
     * source. Never use legacy Finworkar prices or infer INR on the device.
     * No backend SKU configuration means no Play query, offer or CTA. */
    internal data class LocalizedPlayOffer(
        val productId: String,
        val formattedPrice: String,
    )

    /** Shared one-time-product details query for both IDs and Play prices.
     * Requery rather than caching stale ProductDetails or offer tokens. */
    private fun queryApprovedProductDetails(
        callback: (ReadResult<ProductDetails>) -> Unit,
    ) {
        if (closed || !client.isReady || approvedIds.isEmpty()) {
            callback(ReadResult.Unavailable)
            return
        }
        val products = approvedIds.sorted().map { id ->
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(id)
                .setProductType(BillingClient.ProductType.INAPP)
                .build()
        }
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(products)
            .build()
        client.queryProductDetailsAsync(params) { result, details ->
            if (closed) return@queryProductDetailsAsync
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                callback(ReadResult.Unavailable)
            } else {
                callback(ReadResult.Available(details.productDetailsList
                    .filter { it.productType == BillingClient.ProductType.INAPP &&
                        it.productId in approvedIds
                    }.distinctBy { it.productId }))
            }
        }
    }

    fun queryApprovedOneTimeProductIds(
        callback: (ReadResult<String>) -> Unit,
    ) {
        queryApprovedProductDetails { result ->
            when (result) {
                is ReadResult.Available ->
                    callback(ReadResult.Available(result.items.map { it.productId }))
                ReadResult.Unavailable -> callback(ReadResult.Unavailable)
            }
        }
    }

    /** This preview MAY display a price supplied by the real Google Play
     * ProductDetails API. Multiple/unsupported offers are not silently
     * priced or selected. Nothing here initiates a purchase or grants credit.
     * On a Play failure return Unavailable, never fabricated zero cost. */
    fun queryLocalizedOneTimePrices(
        callback: (ReadResult<LocalizedPlayOffer>) -> Unit,
    ) {
        queryApprovedProductDetails { result ->
            when (result) {
                is ReadResult.Available -> callback(ReadResult.Available(
                    result.items.mapNotNull { product ->
                        val offer = product.oneTimePurchaseOfferDetailsList?.singleOrNull()
                        val price = offer?.formattedPrice
                        if (price.isNullOrBlank() || price.length > 64 ||
                            price.any { Character.isISOControl(it) }
                        ) null else LocalizedPlayOffer(product.productId, price)
                    }
                ))
                ReadResult.Unavailable -> callback(ReadResult.Unavailable)
            }
        }
    }

    /** Only a read of Play-owned existing purchases. No restore/grant
     * transition is ever made here: the backend must verify ownership,
     * PURCHASED, void/refund history and actual configured SKU first.
     */
    fun queryExistingOneTimePurchases(
        callback: (ReadResult<UnverifiedPlayPurchase>) -> Unit,
    ) {
        // An absent approved SKU set means no Play query and no disclosure
        // of purchases belonging to other apps/products.
        if (closed || !client.isReady || approvedIds.isEmpty()) {
            callback(ReadResult.Unavailable)
            return
        }
        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.INAPP)
            .build()
        client.queryPurchasesAsync(params) { result, purchases ->
            if (closed) return@queryPurchasesAsync
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                callback(ReadResult.Unavailable)
            } else {
                // Available(empty) is a confirmed empty Play result;
                // unavailable service is never presented as 'none'.
                callback(ReadResult.Available(purchases.mapNotNull(::unverified)))
            }
        }
    }

    override fun close() {
        if (!closed) {
            closed = true
            client.endConnection()
        }
    }

    private companion object {
        val VALID_PRODUCT_ID = Regex("^[a-z][a-z0-9._]{2,99}$")
    }
}
