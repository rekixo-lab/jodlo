package com.rekixo.jodlo

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.rememberScrollState
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
import com.rekixo.jodlo.core.network.NearbyPilotCity
import com.rekixo.jodlo.core.network.OwnServiceArea
import com.rekixo.jodlo.core.network.SessionResult
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloChip
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal fun cityLabel(city: NearbyPilotCity): Int = when (city) {
    NearbyPilotCity.BILASPUR -> R.string.nearby_city_bilaspur
    NearbyPilotCity.RAIPUR -> R.string.nearby_city_raipur
}

@Composable
internal fun WorkerServiceAreaEditor(
    session: InMemorySessionCoordinator?, listingId: String, enabled: Boolean,
    onWriteFinished: (Boolean) -> Unit,
) {
    if (session == null) return
    val scope = rememberCoroutineScope()
    // A sign-in change must discard previous account's cached editor data.
    val sessionEpoch = session.accountExportSessionMarker()
    var loaded by remember(session, listingId, sessionEpoch) {
        mutableStateOf<Pair<AccountPrivateReadMarker, OwnServiceArea>?>(null)
    }
    var proposed by remember(session, listingId, sessionEpoch) { mutableStateOf<NearbyPilotCity?>(null) }
    var busy by remember(session, listingId, sessionEpoch) { mutableStateOf(false) }
    var failed by remember(session, listingId, sessionEpoch) { mutableStateOf(false) }
    val owner = session.accountPrivateReadMarker()
    val area = loaded?.takeIf { it.first == owner }?.second

    fun request(save: Boolean) {
        val captured = session.accountPrivateReadMarker() ?: return
        val previous = loaded?.takeIf { it.first == captured }?.second
        val city = proposed
        if (!enabled || busy ||
            (save && (previous == null || previous.city == city || previous.revision >= Int.MAX_VALUE))) return
        loaded = null
        busy = true
        failed = false
        scope.launch {
            var confirmed = false
            try {
                val result = withContext(Dispatchers.IO) {
                    if (save && previous != null) {
                        session.changeServiceArea(captured, listingId, city, previous.revision)
                    } else session.ownServiceArea(captured, listingId)
                }
                val expected = if (save) captured.copy(writeRevision = captured.writeRevision + 1) else captured
                if (result is SessionResult.Success && session.accountPrivateReadMarker() == expected) {
                    confirmed = true
                    loaded = expected to result.value
                    proposed = result.value.city
                } else failed = true
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                failed = true
            } finally {
                busy = false
            }
            if (save && session.accountExportSessionMarker() == captured.sessionGeneration) {
                onWriteFinished(confirmed)
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
        JodloTextAction(onClick = { request(false) }, enabled = enabled && !busy && owner != null) {
            Text(stringResource(R.string.worker_area_load))
        }
        if (area != null) {
            Text(stringResource(R.string.worker_area_consent), style = MaterialTheme.typography.bodySmall)
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
            ) {
                JodloChip(selected = proposed == null, enabled = enabled && !busy,
                    onClick = { proposed = null }, label = { Text(stringResource(R.string.worker_area_none)) })
                NearbyPilotCity.entries.forEach { city ->
                    JodloChip(selected = proposed == city, enabled = enabled && !busy,
                        onClick = { proposed = city }, label = { Text(stringResource(cityLabel(city))) })
                }
            }
            JodloButton(onClick = { request(true) },
                enabled = enabled && !busy && proposed != area.city && area.revision < Int.MAX_VALUE) {
                Text(stringResource(R.string.worker_area_confirm))
            }
        }
        if (failed) {
            Text(stringResource(R.string.worker_area_failed), color = MaterialTheme.colorScheme.error)
        }
    }
}
