package com.rekixo.jodlo

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.ManualNearbyIntent
import com.rekixo.jodlo.core.network.NearbyEvidence
import com.rekixo.jodlo.core.network.NearbyPilotCity
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloChip
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction

/** A deliberately manual, memory-only city choice.
 *
 * The actual marketplace API has no reviewed/public Worker service-area
 * evidence. No geolocation, city query, ranking, provider calls or fake
 * location-filtered listings happen here. General Browse remains distinct.
 */
@Composable
internal fun ManualNearbyDiscovery(
    onBrowseAll: () -> Unit,
    onHome: () -> Unit,
) {
    var intent by remember { mutableStateOf(ManualNearbyIntent()) }
    BackHandler(onBack = onHome)
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            JodloSizes.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(JodloSizes.Gap),
    ) {
        item {
            Text(stringResource(R.string.nearby_heading),
                style = MaterialTheme.typography.headlineLarge)
            Text(stringResource(R.string.nearby_privacy_notice),
                style = MaterialTheme.typography.bodyMedium)
        }
        item {
            Text(stringResource(R.string.nearby_choose_city),
                style = MaterialTheme.typography.titleMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                JodloChip(
                    selected = intent.city == NearbyPilotCity.BILASPUR,
                    onClick = { intent = intent.choose(NearbyPilotCity.BILASPUR) },
                    label = { Text(stringResource(R.string.nearby_city_bilaspur)) },
                )
                JodloChip(
                    selected = intent.city == NearbyPilotCity.RAIPUR,
                    onClick = { intent = intent.choose(NearbyPilotCity.RAIPUR) },
                    label = { Text(stringResource(R.string.nearby_city_raipur)) },
                )
            }
            if (intent.city != null) {
                JodloTextAction(onClick = { intent = intent.clear() }) {
                    Text(stringResource(R.string.nearby_clear_city))
                }
            }
        }
        item {
            JodloCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(JodloSizes.CardPadding),
                    verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
                ) {
                    when (intent.evidence) {
                        NearbyEvidence.NO_CITY_SELECTED ->
                            Text(stringResource(R.string.nearby_no_city))
                        NearbyEvidence.SERVICE_AREAS_NOT_APPROVED -> {
                            val city = if (intent.city == NearbyPilotCity.BILASPUR)
                                R.string.nearby_city_bilaspur
                            else R.string.nearby_city_raipur
                            Text(stringResource(R.string.nearby_selected,
                                stringResource(city)),
                                style = MaterialTheme.typography.titleMedium)
                            Text(stringResource(R.string.nearby_unverified),
                                style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    Text(stringResource(R.string.nearby_no_matching_claims),
                        style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        item {
            JodloButton(onClick = onBrowseAll, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.nearby_browse_all))
            }
            Text(stringResource(R.string.nearby_browse_unfiltered_notice),
                style = MaterialTheme.typography.bodySmall)
            JodloTextAction(onClick = onHome, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.nearby_back_home))
            }
        }
    }
}
