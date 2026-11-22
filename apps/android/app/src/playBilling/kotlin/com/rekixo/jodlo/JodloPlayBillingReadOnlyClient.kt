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
 * Google Play Billing 9 single-connection, opt-in native source.
 *
 * Read-only catalog and existing-purchase preview remain the default.
 * An independent BUILD and SESSION gate can activate the private DEBUG
 * checkout controller (never built into default or release candidate).
 * The optional checkout delegates to this SAME BillingClient instance and
 * sends no paid entitlement. This adapter cannot acknowledge or consume.
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

    /** Ephemeral proof for the account-bound Cloudflare POST, never a grant.
     * Keep the Play token out of data-class toString, logs and UI surfaces.
     * Caller must use the SAME live JODLO session that fetched the binding. */
    internal class OwnerBoundUnverifiedProof internal constructor(
        val productId: String,
        initialSecretToken: String,
    ) {
        // Erase this object's only reference before invoking the caller:
        // an uncertain POST is never automatically replayed.
        private var secretToken: String? = initialSecretToken
        @Synchronized
        fun submitOnceToServer(send: (String) -> Unit): Boolean {
            val proof = secretToken ?: return false
            secretToken = null
            send(proof)
            return true
        }
        override fun toString(): String = "OwnerBoundUnverifiedProof(<redacted>)"
    }

    private fun ownerBoundProof(purchase: Purchase, binding: String): OwnerBoundUnverifiedProof? {
        val inspected = unverified(purchase) ?: return null
        if (inspected.state != PurchaseState.PURCHASED || inspected.acknowledged ||
            purchase.accountIdentifiers?.obfuscatedAccountId != binding ||
            !VALID_PURCHASE_TOKEN.matches(purchase.purchaseToken)) return null
        return OwnerBoundUnverifiedProof(inspected.productIds.single(),purchase.purchaseToken)
    }

    /** Immutable, trusted SKU snapshot; invalid/empty configurations fail closed. */
    private val approvedIds = approvedProductIds.toSet().takeIf { ids ->
        ids.isNotEmpty() && ids.size <= 16 && ids.all { VALID_PRODUCT_ID.matches(it) }
    } ?: emptySet()

    internal sealed interface ReadResult<out T> {
        data class Available<T>(val items: List<T>) : ReadResult<T>
        data object Unavailable : ReadResult<Nothing>
    }

    private var closed = false

    // Lazy: no second BillingClient, no Play checkout outside an explicit
    // debug build. Keeps the same product/receipt readers as the preview.
    private val checkout by lazy {
        JodloPlayCheckoutController(
            client, approvedIds, ::queryApprovedProductDetails, ::ownerBoundProof,
        )
    }
    private val listener = PurchasesUpdatedListener { result, purchases ->
        if (!closed) checkout.onPurchaseUpdated(result,purchases)
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

    /** One shared Play read for both the existing privacy-safe status UI
     * and explicit, session-bound proof handoff. No consume/ack/POST here. */
    private fun queryOneTimePurchases(
        callback: (ReadResult<Purchase>) -> Unit,
    ) {
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
            } else callback(ReadResult.Available(purchases))
        }
    }

    /** Read-only purchase status without revealing tokens or order IDs. */
    fun queryExistingOneTimePurchases(
        callback: (ReadResult<UnverifiedPlayPurchase>) -> Unit,
    ) {
        queryOneTimePurchases { result ->
            when (result) {
                is ReadResult.Available ->
                    callback(ReadResult.Available(result.items.mapNotNull(::unverified)))
                ReadResult.Unavailable -> callback(ReadResult.Unavailable)
            }
        }
    }

    /** Existing owned receipts may be submitted for Google verification, but
     * NOT for local credit. Valid binding is fetched from signed-in Cloudflare,
     * never computed from email, Google subject or an arbitrary client user ID.
     * Missing binding, foreign/PENDING/acknowledged or malformed tokens are
     * excluded. No automatic retry after an unknown POST response.
     */
    fun queryOwnerBoundUnverifiedProofs(
        accountBinding: String,
        callback: (ReadResult<OwnerBoundUnverifiedProof>) -> Unit,
    ) {
        if (!VALID_ACCOUNT_BINDING.matches(accountBinding)) {
            callback(ReadResult.Unavailable)
            return
        }
        queryOneTimePurchases { result ->
            when (result) {
                is ReadResult.Available ->
                    callback(ReadResult.Available(result.items.mapNotNull {
                        ownerBoundProof(it,accountBinding)
                    }))
                ReadResult.Unavailable -> callback(ReadResult.Unavailable)
            }
        }
    }

    /** Explicit review-on-tap, not wired to any app screen.
     * This is always disabled in the default/release build. The Cloudflare
     * verification-only binding cannot authorize credit or consume. */
    fun prepareAndLaunchOwnerBoundCheckout(
        activity: android.app.Activity,
        productId: String,
        displayedGooglePrice: String,
        currentServerBinding: String,
        onEvent: (JodloPlayCheckoutController.Event) -> Unit,
    ) {
        if (closed || !BuildConfig.PLAY_CHECKOUT_ENABLED) {
            onEvent(JodloPlayCheckoutController.Event.Disabled)
            return
        }
        checkout.prepareAndLaunch(
            activity,productId,displayedGooglePrice,currentServerBinding,onEvent,
        )
    }

    /** Call synchronously before replacing/logout of the live JODLO session.
     * Any later Play callback must require explicit fresh restore, not reuse
     * a different account's binding or token. */
    fun invalidateCheckoutForAccountChange() = checkout.invalidateSession()

    override fun close() {
        if (!closed) {
            closed = true
            checkout.invalidateSession()
            client.endConnection()
        }
    }

    private companion object {
        val VALID_PRODUCT_ID = Regex("^[a-z][a-z0-9._]{2,99}$")
        val VALID_ACCOUNT_BINDING = Regex("^[0-9a-f]{64}$")
        val VALID_PURCHASE_TOKEN = Regex("^[A-Za-z0-9._~+/=-]{20,4096}$")
    }
}
