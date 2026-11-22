package com.rekixo.jodlo

import android.os.Handler
import android.os.Looper
import com.rekixo.jodlo.core.network.AccountPrivateReadMarker
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.ManualPlayRestoreSelection
import com.rekixo.jodlo.core.network.ManualPlayRestoreStatus
import com.rekixo.jodlo.core.network.PlayAccountBinding
import com.rekixo.jodlo.core.network.PlayReceiptScreening
import com.rekixo.jodlo.core.network.SessionResult
import com.rekixo.jodlo.core.network.selectManualPlayRestore
import com.rekixo.jodlo.core.network.summarizeManualPlayScreening
import com.rekixo.jodlo.core.network.validJodloPlayAccountBinding
import java.util.concurrent.ExecutorService
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Explicit, ONE-SKU, ONE-TAP verification-only manual purchase check.
 *
 * The default/release app cannot call this path: source-set + independent
 * PLAY_RESTORE_ENABLED + current D1 session + backend feature gates.
 * Google Play is queried ONLY after Cloudflare provides an opaque binding.
 *
 * Never retries a possibly completed POST, caches a raw token, writes credit,
 * calls a Play consume/acknowledge method, or treats PURCHASED as a grant.
 * No new BillingClient: the parent delegates the existing queryPurchasesAsync.
 */
internal class JodloPlayManualRestore(
    approved: Set<String>,
    private val queryOwned:
        (String, (JodloPlayBillingReadOnlyClient.ReadResult<
            JodloPlayBillingReadOnlyClient.OwnerBoundUnverifiedProof>) -> Unit) -> Unit,
    private val io: ExecutorService,
    private val main: Handler = Handler(Looper.getMainLooper()),
) {
    private val approvedIds = approved.toSet()
    private val lock = Any()
    private var busy = false
    private var retired = false

    /** A sign-out destroys this controller. A new login needs a new adapter,
     * not a reused BillingClient/restore operation from the previous owner. */
    fun invalidateSession() = synchronized(lock) {
        retired = true
    }

    private fun stillCurrent(
        session: InMemorySessionCoordinator, marker: AccountPrivateReadMarker,
    ): Boolean = synchronized(lock) {
        !retired && session.accountPrivateReadMarker() == marker
    }

    fun inspectOneExplicitPurchase(
        session: InMemorySessionCoordinator,
        marker: AccountPrivateReadMarker,
        productId: String,
        onStatus: (ManualPlayRestoreStatus) -> Unit,
    ) {
        if (!BuildConfig.PLAY_RESTORE_ENABLED) {
            onStatus(ManualPlayRestoreStatus.Disabled)
            return
        }
        if (productId !in approvedIds || !stillCurrent(session,marker)) {
            onStatus(ManualPlayRestoreStatus.AccountChanged)
            return
        }
        val reserved = synchronized(lock) {
            if (retired || busy) false else {
                busy = true
                true
            }
        }
        if (!reserved) {
            onStatus(ManualPlayRestoreStatus.Busy)
            return
        }
        val completed = AtomicBoolean(false)
        fun finish(status: ManualPlayRestoreStatus) {
            // A duplicate SDK callback must never complete the same restore
            // twice or deliver one owner's result to another user.
            if (!completed.compareAndSet(false,true)) return
            main.post {
                synchronized(lock) { busy = false }
                val safe = if (stillCurrent(session,marker)) status
                    else ManualPlayRestoreStatus.AccountChanged
                onStatus(safe)
            }
        }
        fun submitWork(work: () -> Unit) {
            try {
                io.execute {
                    if (!stillCurrent(session,marker)) {
                        finish(ManualPlayRestoreStatus.AccountChanged)
                        return@execute
                    }
                    try {
                        work()
                    } catch (_: Exception) {
                        finish(ManualPlayRestoreStatus.Unavailable)
                    }
                }
            } catch (_: RuntimeException) {
                finish(ManualPlayRestoreStatus.Unavailable)
            }
        }

        // Never ask Play for purchases before the current Cloudflare account
        // has supplied its non-reversible, verification-only binding.
        submitWork {
            when (val bound = session.playVerificationBinding(marker)) {
                is SessionResult.Failed -> finish(ManualPlayRestoreStatus.Unavailable)
                is SessionResult.Success -> {
                    val identity: PlayAccountBinding = bound.value
                    if (!identity.verificationOnly ||
                        !validJodloPlayAccountBinding(identity.accountBinding)) {
                        finish(ManualPlayRestoreStatus.Unavailable)
                        return@submitWork
                    }
                    main.post {
                        if (!stillCurrent(session,marker)) {
                            finish(ManualPlayRestoreStatus.AccountChanged)
                            return@post
                        }
                        val queryHandled = AtomicBoolean(false)
                        try {
                            queryOwned(identity.accountBinding) { result ->
                                if (!queryHandled.compareAndSet(false,true)) return@queryOwned
                                if (!stillCurrent(session,marker)) {
                                    finish(ManualPlayRestoreStatus.AccountChanged)
                                    return@queryOwned
                                }
                                when (result) {
                                    JodloPlayBillingReadOnlyClient.ReadResult.Unavailable ->
                                        finish(ManualPlayRestoreStatus.Unavailable)
                                    is JodloPlayBillingReadOnlyClient.ReadResult.Available -> {
                                        val proofs = result.items
                                        when (val choice = selectManualPlayRestore(
                                            approvedIds, productId, identity.accountBinding,
                                            proofs.map { it.productId },
                                        )) {
                                            ManualPlayRestoreSelection.Missing ->
                                                finish(ManualPlayRestoreStatus.NoMatchingPurchase)
                                            ManualPlayRestoreSelection.Ambiguous ->
                                                finish(ManualPlayRestoreStatus.NeedsIndividualReview)
                                            is ManualPlayRestoreSelection.Single -> {
                                                val proof = proofs[choice.index]
                                                submitWork {
                                                    var screened: SessionResult<PlayReceiptScreening>? = null
                                                    // The raw token is released BEFORE a
                                                    // one-shot, owner-fenced Cloudflare POST.
                                                    val sent = proof.submitOnceToServer { token ->
                                                        screened = session.screenOwnedPlayPurchase(marker,token)
                                                    }
                                                    finish(if (sent && screened != null)
                                                        summarizeManualPlayScreening(productId,screened!!)
                                                    else ManualPlayRestoreStatus.Unavailable)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (_: RuntimeException) {
                            finish(ManualPlayRestoreStatus.Unavailable)
                        }
                    }
                }
            }
        }
    }
}
