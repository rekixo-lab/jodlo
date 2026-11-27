package com.rekixo.jodlo

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.rekixo.jodlo.core.network.AccountPrivateReadMarker
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.FailureKind
import com.rekixo.jodlo.core.network.ManualPlayRestoreSelection
import com.rekixo.jodlo.core.network.PLAY_MINUTE_POLICY_VERSION
import com.rekixo.jodlo.core.network.PlayMinutePack
import com.rekixo.jodlo.core.network.PlayPurchaseSettlement
import com.rekixo.jodlo.core.network.PlaySettlementCapability
import com.rekixo.jodlo.core.network.SessionResult
import com.rekixo.jodlo.core.network.matchesSelectedPack
import com.rekixo.jodlo.core.network.selectManualPlayRestore
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

internal enum class PlayPurchaseNotice {
    READY, LOADING, CHECKING, OPENING, PENDING, CANCELED, PRICE_CHANGED,
    UNAVAILABLE, ACCOUNT_CHANGED, RECOVERY_AVAILABLE, NO_PURCHASE, MANUAL_REVIEW, SETTLING,
}

/** This state contains public SKUs and Google display prices only. */
internal data class PlayPurchaseView(
    val prices: Map<String, String> = emptyMap(),
    val busy: Boolean = false,
    val recoveryRequired: Boolean = false,
    val notice: PlayPurchaseNotice = PlayPurchaseNotice.READY,
)

/** One foreground BillingClient per owner/screen, sharing existing readers
 * and checkout engine. Never persists receipts, issues device credit, consumes
 * purchases, or automatically repeats a settlement POST. */
internal class JodloPlayPurchaseFlow(
    context: Context,
    private val session: InMemorySessionCoordinator,
    private val owner: AccountPrivateReadMarker,
    private val packs: List<PlayMinutePack>,
    private val publish: (PlayPurchaseView) -> Unit,
    private val settled: (PlayPurchaseSettlement?) -> Unit,
) : AutoCloseable {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val operation = AtomicLong(0)
    private val closed = AtomicBoolean(false)
    private val products = packs.map { it.productId }.toSet()
    private var view = PlayPurchaseView()
    private var resumeBinding: String? = null
    private var checkoutTimeout: Runnable? = null
    private val client = JodloPlayBillingReadOnlyClient(context, products) {
        // A callback by itself is never an entitlement. The checkout engine
        // handles its own active receipt; later pending completions need the
        // same owner's explicit recover action.
        main.post {
            if (sameOwner() && !view.busy && view.recoveryRequired)
                update(view.copy(notice = PlayPurchaseNotice.RECOVERY_AVAILABLE))
        }
    }

    private fun sameOwner(): Boolean = !closed.get() &&
        session.accountPrivateReadMarker() == owner

    private fun current(id: Long): Boolean = operation.get() == id && sameOwner()

    private fun update(next: PlayPurchaseView) {
        if (!closed.get()) { view = next; publish(next) }
    }

    private fun finish(id: Long, notice: PlayPurchaseNotice, recover: Boolean = view.recoveryRequired) {
        main.post {
            if (closed.get() || operation.get() != id) return@post
            update(view.copy(busy = false, recoveryRequired = recover,
                notice = if (sameOwner()) notice else PlayPurchaseNotice.ACCOUNT_CHANGED))
        }
    }

    private fun begin(notice: PlayPurchaseNotice): Long? {
        if (closed.get() || view.busy) return null
        if (!sameOwner()) {
            update(view.copy(busy = false, notice = PlayPurchaseNotice.ACCOUNT_CHANGED))
            return null
        }
        val id = operation.incrementAndGet()
        update(view.copy(busy = true, notice = notice))
        return id
    }

    /** Never authorize a Google charge with the read-only preview binding. */
    private fun ready(id: Long, action: (PlaySettlementCapability) -> Unit) {
        worker.execute {
            if (!current(id)) return@execute
            val result = try { session.playSettlementCapability(owner) } catch (_: Exception) { null }
            main.post {
                if (!current(id)) {
                    finish(id, PlayPurchaseNotice.ACCOUNT_CHANGED)
                    return@post
                }
                val capability = (result as? SessionResult.Success)?.value
                if (result is SessionResult.Failed && result.networkKind == FailureKind.CONFLICT) {
                    finish(id, PlayPurchaseNotice.MANUAL_REVIEW, recover = true)
                    return@post
                }
                if (capability == null || capability.policyVersion != BuildConfig.PLAY_POLICY_VERSION ||
                    capability.policyVersion != PLAY_MINUTE_POLICY_VERSION) {
                    finish(id, PlayPurchaseNotice.UNAVAILABLE)
                    return@post
                }
                val delivered = AtomicBoolean(false)
                val timeout = Runnable {
                    if (delivered.compareAndSet(false, true))
                        finish(id, PlayPurchaseNotice.UNAVAILABLE)
                }
                main.postDelayed(timeout, 20_000L)
                try {
                    client.connect { connected ->
                        if (!delivered.compareAndSet(false, true)) return@connect
                        main.removeCallbacks(timeout)
                        main.post connection@{
                            if (!current(id)) {
                                finish(id, PlayPurchaseNotice.ACCOUNT_CHANGED)
                            } else if (!connected) finish(id, PlayPurchaseNotice.UNAVAILABLE)
                            else {
                                resumeBinding = capability.accountBinding
                                action(capability)
                            }
                        }
                    }
                } catch (_: RuntimeException) {
                    delivered.set(true)
                    main.removeCallbacks(timeout)
                    finish(id, PlayPurchaseNotice.UNAVAILABLE)
                }
            }
        }
    }

    fun loadPrices() {
        if (view.recoveryRequired || !BuildConfig.PLAY_CHECKOUT_ENABLED) return
        val id = begin(PlayPurchaseNotice.LOADING) ?: return
        ready(id) {
            val delivered = AtomicBoolean(false)
            val timeout = Runnable {
                if (delivered.compareAndSet(false, true)) finish(id, PlayPurchaseNotice.UNAVAILABLE)
            }
            main.postDelayed(timeout, 20_000L)
            try {
                client.queryLocalizedOneTimePrices { response ->
                    if (!delivered.compareAndSet(false, true)) return@queryLocalizedOneTimePrices
                    main.removeCallbacks(timeout)
                    main.post {
                        if (!current(id)) return@post
                        val offers = (response as? JodloPlayBillingReadOnlyClient.ReadResult.Available)?.items
                        val prices = offers?.associate { it.productId to it.formattedPrice }.orEmpty()
                        update(view.copy(prices = prices, busy = false,
                            notice = if (prices.isEmpty()) PlayPurchaseNotice.UNAVAILABLE else PlayPurchaseNotice.READY))
                    }
                }
            } catch (_: RuntimeException) {
                delivered.set(true)
                main.removeCallbacks(timeout)
                finish(id, PlayPurchaseNotice.UNAVAILABLE)
            }
        }
    }

    fun buy(activity: Activity, pack: PlayMinutePack) {
        if (!BuildConfig.PLAY_CHECKOUT_ENABLED || view.recoveryRequired || pack !in packs) return
        val price = view.prices[pack.productId] ?: return
        val id = begin(PlayPurchaseNotice.CHECKING) ?: return
        ready(id) { capability ->
            // Timeout covers the fresh product/offer query, not time spent by
            // the customer inside Google's payment sheet.
            checkoutTimeout = Runnable {
                if (current(id) && view.busy) {
                    client.retireUncertainCheckout()
                    finish(id, PlayPurchaseNotice.UNAVAILABLE, recover = true)
                }
            }.also { main.postDelayed(it, 25_000L) }
            try {
                client.prepareAndLaunchOwnerBoundCheckout(activity, pack.productId, price,
                    capability.accountBinding, ownerIsCurrent = { current(id) }) { event ->
                    main.post {
                        if (!current(id)) {
                            (event as? JodloPlayCheckoutController.Event.VerifyWithCloudflare)?.proof?.discard()
                            finish(id, PlayPurchaseNotice.ACCOUNT_CHANGED)
                            return@post
                        }
                        checkoutTimeout?.let(main::removeCallbacks)
                        checkoutTimeout = null
                        when (event) {
                            JodloPlayCheckoutController.Event.Launched ->
                                update(view.copy(busy = false, recoveryRequired = true,
                                    notice = PlayPurchaseNotice.OPENING))
                            JodloPlayCheckoutController.Event.Pending ->
                                finish(id, PlayPurchaseNotice.PENDING, recover = true)
                            JodloPlayCheckoutController.Event.Canceled ->
                                finish(id, PlayPurchaseNotice.CANCELED, recover = false)
                            is JodloPlayCheckoutController.Event.PriceChanged -> {
                                update(view.copy(prices = view.prices + (pack.productId to event.latestGooglePrice),
                                    busy = false, recoveryRequired = false, notice = PlayPurchaseNotice.PRICE_CHANGED))
                            }
                            is JodloPlayCheckoutController.Event.VerifyWithCloudflare ->
                                submit(id, pack, capability, event.proof)
                            JodloPlayCheckoutController.Event.RestoreManually ->
                                finish(id, PlayPurchaseNotice.RECOVERY_AVAILABLE, recover = true)
                            else -> finish(id, PlayPurchaseNotice.UNAVAILABLE)
                        }
                    }
                }
            } catch (_: RuntimeException) {
                checkoutTimeout?.let(main::removeCallbacks)
                checkoutTimeout = null
                client.retireUncertainCheckout()
                finish(id, PlayPurchaseNotice.UNAVAILABLE, recover = true)
            }
        }
    }

    fun recover(pack: PlayMinutePack) {
        if (!BuildConfig.PLAY_CHECKOUT_ENABLED || pack !in packs) return
        val id = begin(PlayPurchaseNotice.CHECKING) ?: return
        client.retireUncertainCheckout()
        ready(id) { capability ->
            val delivered = AtomicBoolean(false)
            val timeout = Runnable {
                if (delivered.compareAndSet(false, true))
                    finish(id, PlayPurchaseNotice.UNAVAILABLE, recover = true)
            }
            main.postDelayed(timeout, 20_000L)
            try {
                client.queryOwnerBoundRecovery(capability.accountBinding) { response ->
                    if (!delivered.compareAndSet(false, true)) {
                        (response as? JodloPlayBillingReadOnlyClient.RecoveryRead.Available)?.proofs?.forEach { it.discard() }
                        return@queryOwnerBoundRecovery
                    }
                    main.removeCallbacks(timeout)
                    main.post {
                        val recovered = response as? JodloPlayBillingReadOnlyClient.RecoveryRead.Available
                        val proofs = recovered?.proofs
                        if (!current(id)) {
                            proofs?.forEach { it.discard() }
                            finish(id, PlayPurchaseNotice.ACCOUNT_CHANGED)
                            return@post
                        }
                        if (proofs == null) {
                            finish(id, PlayPurchaseNotice.UNAVAILABLE, recover = true)
                            return@post
                        }
                        when (val selected = selectManualPlayRestore(products, pack.productId,
                            capability.accountBinding, proofs.map { it.productId })) {
                            ManualPlayRestoreSelection.Missing -> {
                                proofs.forEach { it.discard() }
                                val pending = recovered?.pendingProducts?.contains(pack.productId) == true
                                finish(id, if (pending) PlayPurchaseNotice.PENDING else PlayPurchaseNotice.NO_PURCHASE,
                                    recover = pending)
                            }
                            ManualPlayRestoreSelection.Ambiguous -> {
                                proofs.forEach { it.discard() }
                                finish(id, PlayPurchaseNotice.MANUAL_REVIEW, recover = true)
                            }
                            is ManualPlayRestoreSelection.Single -> {
                                proofs.forEachIndexed { index, proof -> if (index != selected.index) proof.discard() }
                                submit(id, pack, capability, proofs[selected.index])
                            }
                        }
                    }
                }
            } catch (_: RuntimeException) {
                delivered.set(true)
                main.removeCallbacks(timeout)
                finish(id, PlayPurchaseNotice.UNAVAILABLE, recover = true)
            }
        }
    }

    private fun submit(id: Long, pack: PlayMinutePack, capability: PlaySettlementCapability,
        proof: JodloPlayBillingReadOnlyClient.OwnerBoundUnverifiedProof) {
        if (!current(id) || proof.productId != pack.productId) {
            proof.discard()
            finish(id, PlayPurchaseNotice.ACCOUNT_CHANGED)
            return
        }
        update(view.copy(busy = true, recoveryRequired = true, notice = PlayPurchaseNotice.SETTLING))
        worker.execute {
            if (!current(id)) { proof.discard(); return@execute }
            var result: SessionResult<PlayPurchaseSettlement>? = null
            try {
                proof.submitOnceToServer { token ->
                    if (current(id)) result = session.settleOwnedPlayPurchase(owner, token, capability.policyVersion)
                }
            } catch (_: Exception) { /* The server may have committed; never replay. */ }
            main.post {
                if (closed.get() || operation.get() != id) return@post
                val now = session.accountPrivateReadMarker()
                if (now != owner.copy(writeRevision = owner.writeRevision + 1)) {
                    finish(id, PlayPurchaseNotice.ACCOUNT_CHANGED)
                    return@post
                }
                val outcome = (result as? SessionResult.Success)?.value
                    ?.takeIf { it.matchesSelectedPack(pack) }
                // Parent discards the prior balance and performs ONE fresh
                // same-owner GET, including pending/uncertain outcomes.
                settled(outcome)
            }
        }
    }

    /** Google's recommended foreground owned-purchase query is READ-ONLY.
     * It may surface a pending->purchased update; settlement still requires
     * the original callback or an explicit recover tap, never an auto retry. */
    fun resumed() {
        val binding = resumeBinding ?: return
        if (!sameOwner() || view.busy || !view.recoveryRequired) return
        val id = operation.get()
        try {
            client.queryOwnerBoundPurchaseStates(binding) { response ->
                main.post {
                    if (!current(id) || view.busy || !view.recoveryRequired) return@post
                    val purchases = (response as? JodloPlayBillingReadOnlyClient.ReadResult.Available)?.items
                    val pending = purchases?.any {
                        it.state == JodloPlayBillingReadOnlyClient.PurchaseState.PENDING
                    } == true
                    update(view.copy(notice = if (pending) PlayPurchaseNotice.PENDING
                        else PlayPurchaseNotice.RECOVERY_AVAILABLE))
                }
            }
        } catch (_: RuntimeException) { /* Explicit recover remains available. */ }
    }

    override fun close() {
        if (closed.compareAndSet(false, true)) {
            operation.incrementAndGet()
            resumeBinding = null
            main.removeCallbacksAndMessages(null)
            client.invalidateCheckoutForAccountChange()
            client.close()
            worker.shutdownNow()
        }
    }
}
