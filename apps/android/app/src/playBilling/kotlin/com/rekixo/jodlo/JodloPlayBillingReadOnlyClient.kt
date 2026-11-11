package com.rekixo.jodlo

import android.content.Context
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingResult
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
    private val onUnverifiedPurchases: (List<UnverifiedPlayPurchase>) -> Unit,
) : AutoCloseable {
    internal enum class PurchaseState { PENDING, PURCHASED, OTHER }

    internal data class UnverifiedPlayPurchase(
        val productIds: List<String>,
        val state: PurchaseState,
        val acknowledged: Boolean,
    )

    private var closed = false
    private val listener = PurchasesUpdatedListener { result, purchases ->
        if (!closed && result.responseCode == BillingClient.BillingResponseCode.OK &&
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
        val ids = purchase.products
            .filter { VALID_PRODUCT_ID.matches(it) }
            .distinct()
        if (ids.isEmpty() || ids.size > 16) return null
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

    /** No configured JODLO SKU IDs => no Play query and no suggested packs.
     * All product details come from Play only for server-approved IDs.
     * This method exposes IDs only; no fabricated prices or purchase CTA.
     */
    fun queryApprovedOneTimeProductIds(
        approvedProductIds: Set<String>,
        callback: (List<String>) -> Unit,
    ) {
        if (closed || !client.isReady || approvedProductIds.isEmpty() ||
            approvedProductIds.size > 16 ||
            approvedProductIds.any { !VALID_PRODUCT_ID.matches(it) }
        ) {
            callback(emptyList())
            return
        }
        val products = approvedProductIds.sorted().map { id ->
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(id)
                .setProductType(BillingClient.ProductType.INAPP)
                .build()
        }
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(products)
            .build()
        client.queryProductDetailsAsync(params) { result, details ->
            if (closed || result.responseCode != BillingClient.BillingResponseCode.OK) {
                callback(emptyList())
            } else {
                callback(details.productDetailsList
                    .filter { it.productType == BillingClient.ProductType.INAPP &&
                        it.productId in approvedProductIds
                    }
                    .map { it.productId }
                    .distinct())
            }
        }
    }

    /** Only a read of Play-owned existing purchases. No restore/grant
     * transition is ever made here: the backend must verify ownership,
     * PURCHASED, void/refund history and actual configured SKU first.
     */
    fun queryExistingOneTimePurchases(
        callback: (List<UnverifiedPlayPurchase>) -> Unit,
    ) {
        if (closed || !client.isReady) {
            callback(emptyList())
            return
        }
        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.INAPP)
            .build()
        client.queryPurchasesAsync(params) { result, purchases ->
            if (closed || result.responseCode != BillingClient.BillingResponseCode.OK) {
                callback(emptyList())
            } else {
                callback(purchases.mapNotNull(::unverified))
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
