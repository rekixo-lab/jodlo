package com.rekixo.jodlo

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
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
import com.rekixo.jodlo.core.network.NearbyPilotCity
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloChip
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction

/** Explicit, memory-only city choice. No device location is requested. */
@Composable
internal fun ManualNearbyDiscovery(
    onBrowseAll: () -> Unit,
    onSearchCity: (NearbyPilotCity) -> Unit,
    canSearch: Boolean,
    onHome: () -> Unit,
    selectedCity: NearbyPilotCity? = null,
) {
    var intent by remember(selectedCity) {
        mutableStateOf(selectedCity?.let { ManualNearbyIntent().choose(it) } ?: ManualNearbyIntent())
    }
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
            JodloChip(
                selected = intent.city == NearbyPilotCity.RAIPUR,
                onClick = { intent = intent.choose(NearbyPilotCity.RAIPUR) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.nearby_city_raipur)) },
            )
            JodloChip(
                selected = intent.city == NearbyPilotCity.BILASPUR,
                onClick = { intent = intent.choose(NearbyPilotCity.BILASPUR) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.nearby_city_bilaspur)) },
            )
            JodloChip(
                selected = intent.city == null,
                onClick = { intent = intent.clear() },
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.navigation_all_cities)) },
            )
        }
        item {
            JodloButton(
                onClick = { intent.city?.let(onSearchCity) ?: onBrowseAll() },
                modifier = Modifier.fillMaxWidth(),
                enabled = canSearch || intent.city == null,
            ) { Text(stringResource(R.string.nearby_search_city)) }
            Text(stringResource(R.string.nearby_city_disclosure),
                style = MaterialTheme.typography.bodySmall)
        }
        item {
            JodloTextAction(onClick = onHome) {
                Text(stringResource(R.string.nearby_back_home))
            }
        }
    }
}
