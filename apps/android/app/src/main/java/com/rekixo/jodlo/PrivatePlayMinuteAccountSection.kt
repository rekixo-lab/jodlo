package com.rekixo.jodlo

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.AccountPrivateReadMarker
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.PrivatePlayMinuteAccountSnapshot
import com.rekixo.jodlo.core.network.SessionResult
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Account -> Purchase status. One explicit Cloudflare GET on tap only:
 * absolutely no payment UI, BillingClient checkout, hardcoded Google price,
 * local balance mutation, automatic retries, or public account identifier.
 *
 * This is not a transaction screen or entitlement proof. The backend route
 * is default-OFF until separately configured and its packs are not for sale.
 */
@Composable
internal fun PrivatePlayMinuteAccountSection(
    session: InMemorySessionCoordinator,
    accountBusy: Boolean,
) {
    val scope = rememberCoroutineScope()
    val marker = session.accountPrivateReadMarker()
    var snapshot by remember(session,marker) {
        mutableStateOf<PrivatePlayMinuteAccountSnapshot?>(null)
    }
    var loading by remember(session,marker) { mutableStateOf(false) }
    var unavailable by remember(session,marker) { mutableStateOf(false) }
    val current = snapshot?.forCurrent(marker)

    fun refresh(owner: AccountPrivateReadMarker) {
        if (loading || accountBusy || session.accountPrivateReadMarker() != owner) return
        // Hide old balance immediately, even if a later network response fails.
        snapshot = null
        unavailable = false
        loading = true
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    session.playAccountOverview(owner)
                }
                val now = session.accountPrivateReadMarker()
                if (now == owner) {
                    snapshot = PrivatePlayMinuteAccountSnapshot.confirmed(owner,now,result)
                    unavailable = result !is SessionResult.Success
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (session.accountPrivateReadMarker() == owner) unavailable = true
            } finally {
                loading = false
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
        Text(stringResource(R.string.navigation_billing_off),
            style = MaterialTheme.typography.bodySmall)
        Text(stringResource(R.string.play_overview_readonly_notice),
            style = MaterialTheme.typography.bodySmall)
        JodloTextAction(
            onClick = { marker?.let(::refresh) },
            enabled = !accountBusy && !loading && marker != null,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(stringResource(R.string.play_overview_refresh))
        }
        if (loading) Text(stringResource(R.string.play_overview_loading))
        if (unavailable || marker == null)
            Text(stringResource(R.string.navigation_purchase_unavailable),
                color = MaterialTheme.colorScheme.error)
        if (current != null) {
            JodloCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(JodloSizes.CardPadding),
                    verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                    // Render exact D1 ledger seconds, not a locally inferred
                    // purchase from Google or a rounded/guessed minute count.
                    Text(stringResource(R.string.play_overview_balance,
                        current.availableSeconds / 60,
                        current.availableSeconds % 60),
                        style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.play_overview_balance_notice),
                        style = MaterialTheme.typography.bodySmall)
                }
            }
            Text(stringResource(R.string.play_overview_packs_title),
                style = MaterialTheme.typography.titleMedium)
            for (pack in current.catalog.packs) {
                JodloCard(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(JodloSizes.CardPadding),
                        verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                        Text(stringResource(R.string.play_overview_pack,pack.minutes))
                        // No price until owner sets Play Console SKUs and
                        // Google Play provides the actual localized amount.
                        Text(stringResource(R.string.play_overview_price_pending),
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            // Build-time no-op in the default APK. The optional Play source
            // implements a read-only manual diagnostic with its OWN debug
            // build gate; this account screen never handles receipt tokens.
            if (marker != null) {
                PlayRestoreAccountDiagnostic(session,marker,current.catalog,accountBusy)
            }
        }
    }
}
