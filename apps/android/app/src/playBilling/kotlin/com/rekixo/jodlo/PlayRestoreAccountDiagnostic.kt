package com.rekixo.jodlo

import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.AccountPrivateReadMarker
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.ManualPlayRestoreStatus
import com.rekixo.jodlo.core.network.PlayMinutePackCatalog
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloChip
import com.rekixo.jodlo.ui.theme.JodloSizes
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Debug-only explicit restore diagnostic. Compiled ONLY in the opt-in Play SDK
 * source set. Never visible unless the independent restore gate is enabled.
 * Real app pricing, purchases, credits and settlement remain OFF.
 *
 * Query is deliberately initiated by ONE user tap, not lifecycle/resume.
 * No raw receipt, access token, Google order, account binding or Play price
 * enters Compose, logs, saved state or a persistent preference.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun PlayRestoreAccountDiagnostic(
    session: InMemorySessionCoordinator,
    owner: AccountPrivateReadMarker,
    catalog: PlayMinutePackCatalog,
    accountBusy: Boolean,
) {
    if (!BuildConfig.DEBUG || !BuildConfig.PLAY_RESTORE_ENABLED ||
        catalog.purchasable || catalog.priceSource != "google_play" ||
        catalog.packs.isEmpty()) return

    val context = LocalContext.current
    val approved = catalog.packs.map { it.productId }.toSet()
    val client = remember(context,session,owner,catalog) {
        JodloPlayBillingReadOnlyClient(
            context,approved, onUnverifiedPurchases = { /* No auto-restore. */ },
        )
    }
    val main = remember(client) { Handler(Looper.getMainLooper()) }
    val alive = remember(client) { AtomicBoolean(true) }
    var selected by remember(client) { mutableStateOf(catalog.packs.first().productId) }
    var checking by remember(client) { mutableStateOf(false) }
    var status by remember(client) { mutableStateOf<ManualPlayRestoreStatus?>(null) }

    DisposableEffect(client) {
        onDispose {
            // Retire all pending Play callbacks BEFORE a later session is
            // allowed to open this UI, even if the checkout sheet is open.
            alive.set(false)
            client.invalidateCheckoutForAccountChange()
            client.close()
        }
    }

    fun reviewSelectedPack() {
        if (checking || accountBusy || !alive.get() ||
            session.accountPrivateReadMarker() != owner ||
            selected !in approved) return
        val requestedSku = selected
        checking = true
        status = null
        val connectionHandled = AtomicBoolean(false)
        fun finish(result: ManualPlayRestoreStatus) {
            main.post {
                if (!alive.get()) return@post
                checking = false
                status = if (session.accountPrivateReadMarker() == owner)
                    result else ManualPlayRestoreStatus.AccountChanged
            }
        }
        try {
            client.connect { ready ->
                if (!connectionHandled.compareAndSet(false,true)) return@connect
                main.post {
                    if (!alive.get()) return@post
                    if (session.accountPrivateReadMarker() != owner) {
                        finish(ManualPlayRestoreStatus.AccountChanged)
                    } else if (!ready) {
                        finish(ManualPlayRestoreStatus.Unavailable)
                    } else {
                        try {
                            client.inspectOneOwnedPlayPurchaseManually(
                                session,owner,requestedSku,::finish,
                            )
                        } catch (_: RuntimeException) {
                            finish(ManualPlayRestoreStatus.Unavailable)
                        }
                    }
                }
            }
        } catch (_: RuntimeException) {
            finish(ManualPlayRestoreStatus.Unavailable)
        }
    }

    JodloCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(JodloSizes.CardPadding),
            verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
            Text(stringResource(R.string.play_restore_qa_title),
                style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.play_restore_qa_notice),
                style = MaterialTheme.typography.bodySmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
                verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                for (pack in catalog.packs) {
                    JodloChip(
                        selected = selected == pack.productId,
                        onClick = { if (!checking) {
                            selected = pack.productId
                            status = null
                        } },
                        enabled = !checking && !accountBusy,
                        label = { Text(stringResource(R.string.play_overview_pack,pack.minutes)) },
                    )
                }
            }
            JodloButton(
                onClick = ::reviewSelectedPack,
                modifier = Modifier.fillMaxWidth(),
                enabled = !checking && !accountBusy && alive.get() &&
                    session.accountPrivateReadMarker() == owner,
            ) {
                Text(stringResource(R.string.play_restore_qa_action))
            }
            if (checking) Text(stringResource(R.string.play_restore_qa_checking))
            val description = when (status) {
                null -> null
                ManualPlayRestoreStatus.Disabled -> R.string.play_restore_qa_disabled
                ManualPlayRestoreStatus.Busy -> R.string.play_restore_qa_busy
                ManualPlayRestoreStatus.AccountChanged -> R.string.play_restore_qa_actor_changed
                ManualPlayRestoreStatus.Unavailable -> R.string.play_restore_qa_unavailable
                ManualPlayRestoreStatus.NoMatchingPurchase -> R.string.play_restore_qa_none
                ManualPlayRestoreStatus.NeedsIndividualReview -> R.string.play_restore_qa_ambiguous
                ManualPlayRestoreStatus.NotEligible -> R.string.play_restore_qa_not_eligible
                is ManualPlayRestoreStatus.ScreenedPendingSettlement ->
                    R.string.play_restore_qa_pending_settlement
            }
            if (description != null) {
                Text(stringResource(description),style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
