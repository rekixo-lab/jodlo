package com.rekixo.jodlo

import android.content.Context
import android.content.ContextWrapper
import androidx.activity.ComponentActivity
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
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.rekixo.jodlo.core.network.AccountPrivateReadMarker
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.PLAY_MINUTE_POLICY_VERSION
import com.rekixo.jodlo.core.network.PlayMinutePackCatalog
import com.rekixo.jodlo.core.network.PlayPurchaseSettlement
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloChip
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction

private tailrec fun Context.purchaseActivity(): ComponentActivity? = when (this) {
    is ComponentActivity -> this
    is ContextWrapper -> if (baseContext === this) null else baseContext.purchaseActivity()
    else -> null
}

/** The price-free preview determines allowed SKUs only. Checkout separately
 * requires explicit build configuration AND a fresh server capability. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun PlayMinutePurchaseSection(
    session: InMemorySessionCoordinator,
    owner: AccountPrivateReadMarker,
    catalog: PlayMinutePackCatalog,
    accountBusy: Boolean,
    onSettlementAttemptFinished: (PlayPurchaseSettlement?) -> Unit,
) {
    if (!BuildConfig.PLAY_CHECKOUT_ENABLED ||
        BuildConfig.PLAY_POLICY_VERSION != PLAY_MINUTE_POLICY_VERSION ||
        catalog.purchasable || catalog.priceSource != "google_play" || catalog.packs.isEmpty()) return
    val context = LocalContext.current
    val activity = remember(context) { context.purchaseActivity() }
    val complete by rememberUpdatedState(onSettlementAttemptFinished)
    var view by remember(session, owner, catalog) { mutableStateOf(PlayPurchaseView()) }
    var selected by remember(session, owner, catalog) { mutableStateOf(catalog.packs.first()) }
    val flow = remember(context, session, owner, catalog) {
        JodloPlayPurchaseFlow(context, session, owner, catalog.packs,
            publish = { view = it }, settled = { complete(it) })
    }
    DisposableEffect(flow, activity) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) flow.resumed()
        }
        activity?.lifecycle?.addObserver(observer)
        onDispose {
            activity?.lifecycle?.removeObserver(observer)
            flow.close()
        }
    }
    val current = session.accountPrivateReadMarker() == owner
    val price = view.prices[selected.productId]
    val canAct = !accountBusy && !view.busy && current
    JodloCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(JodloSizes.CardPadding),
            verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
            Text(stringResource(R.string.play_purchase_title), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.play_purchase_intro), style = MaterialTheme.typography.bodySmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
                verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                for (pack in catalog.packs) JodloChip(
                    selected = selected == pack,
                    onClick = { selected = pack },
                    enabled = canAct && !view.recoveryRequired,
                    label = { Text(stringResource(R.string.play_overview_pack, pack.minutes)) },
                )
            }
            if (price != null) Text(stringResource(R.string.play_purchase_google_price, price),
                style = MaterialTheme.typography.titleMedium)
            else Text(stringResource(R.string.play_purchase_price_unavailable))
            JodloTextAction(onClick = flow::loadPrices,
                enabled = canAct && !view.recoveryRequired) {
                Text(stringResource(R.string.play_purchase_refresh_prices))
            }
            JodloButton(onClick = { activity?.let { flow.buy(it, selected) } },
                modifier = Modifier.fillMaxWidth(),
                enabled = canAct && price != null && activity != null && !view.recoveryRequired) {
                Text(stringResource(R.string.play_purchase_continue))
            }
            JodloTextAction(onClick = { flow.recover(selected) },
                modifier = Modifier.fillMaxWidth(), enabled = canAct) {
                Text(stringResource(R.string.play_purchase_recover))
            }
            val notice = when (view.notice) {
                PlayPurchaseNotice.READY -> R.string.play_purchase_ready
                PlayPurchaseNotice.LOADING -> R.string.play_purchase_loading
                PlayPurchaseNotice.CHECKING -> R.string.play_purchase_checking
                PlayPurchaseNotice.OPENING -> R.string.play_purchase_opened
                PlayPurchaseNotice.PENDING -> R.string.play_purchase_pending
                PlayPurchaseNotice.CANCELED -> R.string.play_purchase_canceled
                PlayPurchaseNotice.PRICE_CHANGED -> R.string.play_purchase_price_changed
                PlayPurchaseNotice.UNAVAILABLE -> R.string.play_purchase_unavailable
                PlayPurchaseNotice.ACCOUNT_CHANGED -> R.string.play_purchase_account_changed
                PlayPurchaseNotice.RECOVERY_AVAILABLE -> R.string.play_purchase_recovery_available
                PlayPurchaseNotice.NO_PURCHASE -> R.string.play_purchase_no_purchase
                PlayPurchaseNotice.MANUAL_REVIEW -> R.string.play_purchase_manual_review
                PlayPurchaseNotice.SETTLING -> R.string.play_purchase_settling
            }
            Text(stringResource(notice), style = MaterialTheme.typography.bodySmall)
        }
    }
}
