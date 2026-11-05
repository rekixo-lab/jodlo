package com.rekixo.jodlo

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.HiddenPublicServices
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction

/** Explicit device-only hide/unhide management, NEVER server block/report.
 * No remote GET, Worker identity, account bearer or moderation action.
 */
@Composable
internal fun HiddenServicesDashboard(
    hidden: HiddenPublicServices,
    onUnhide: (String) -> Boolean,
    onClear: () -> Boolean,
    onHome: () -> Unit,
) {
    var confirmClear by remember { mutableStateOf(false) }
    var notice by remember { mutableIntStateOf(0) }
    BackHandler(onBack = onHome)
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            JodloSizes.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(JodloSizes.Gap),
    ) {
        item {
            Text(stringResource(R.string.hidden_heading),
                style = MaterialTheme.typography.headlineSmall)
            Text(stringResource(R.string.hidden_privacy_note),
                style = MaterialTheme.typography.bodySmall)
            Text(stringResource(R.string.hidden_count, hidden.ids.size,
                HiddenPublicServices.MAX_ENTRIES))
        }
        if (hidden.ids.isEmpty()) {
            item { Text(stringResource(R.string.hidden_empty)) }
        } else {
            items(hidden.ids, key = { "local-hidden-" + it }) { id ->
                JodloCard(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(JodloSizes.CardPadding),
                        verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
                    ) {
                        Text(stringResource(R.string.listing_reference, id),
                            style = MaterialTheme.typography.bodySmall)
                        JodloTextAction(onClick = {
                            notice = if (onUnhide(id)) R.string.hidden_restored
                                else R.string.hidden_storage_failed
                        }) {
                            Text(stringResource(R.string.hidden_unhide))
                        }
                    }
                }
            }
            item {
                if (!confirmClear) {
                    JodloTextAction(onClick = { confirmClear = true }) {
                        Text(stringResource(R.string.hidden_clear_start))
                    }
                } else {
                    Text(stringResource(R.string.hidden_clear_warning),
                        style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                        JodloTextAction(onClick = { confirmClear = false }) {
                            Text(stringResource(R.string.saved_cancel))
                        }
                        JodloButton(onClick = {
                            if (onClear()) {
                                confirmClear = false
                                notice = R.string.hidden_cleared
                            } else notice = R.string.hidden_storage_failed
                        }) {
                            Text(stringResource(R.string.hidden_clear_confirm))
                        }
                    }
                }
            }
        }
        if (notice != 0) item {
            Text(stringResource(notice), style = MaterialTheme.typography.bodySmall)
        }
        item {
            JodloButton(onClick = onHome, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.help_back_home))
            }
        }
    }
}
