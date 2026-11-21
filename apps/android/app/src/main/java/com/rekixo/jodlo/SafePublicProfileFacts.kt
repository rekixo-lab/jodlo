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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.NearbyPilotCity
import com.rekixo.jodlo.core.network.ServiceProfile
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import com.rekixo.jodlo.ui.theme.JodloAppBar
import com.rekixo.jodlo.ui.theme.JodloPalette
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** Review covers publication of the supplied text, not the worker's credentials. */
@Composable
internal fun SafePublicProfileFacts(profile: ServiceProfile?, city: NearbyPilotCity?) {
    JodloCard(modifier = Modifier.fillMaxWidth(), selected = profile != null) {
        Column(
            modifier = Modifier.padding(JodloSizes.CardPadding),
            verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
        ) {
            if (profile == null) {
                Text(stringResource(R.string.service_profile_heading),
                    style = MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.service_profile_identity),
                    style = MaterialTheme.typography.bodySmall)
            } else {
                Text(profile.displayName, style = MaterialTheme.typography.headlineLarge)
                Text(profile.description)
                profile.experienceYears?.let {
                    Text(stringResource(R.string.service_details_experience_public, it))
                }
                profile.visitRateInr?.let {
                    Text(stringResource(R.string.service_details_rate_public, it),
                        style = MaterialTheme.typography.titleMedium)
                }
                Text(stringResource(R.string.service_details_review_disclaimer),
                    style = MaterialTheme.typography.bodySmall)
            }
            if (city != null) {
                Text(stringResource(R.string.service_details_city_public, stringResource(cityLabel(city))))
            }
        }
    }
}

@Composable
internal fun ServiceSafetyPanel(listingId: String, revision: Int, content: @Composable () -> Unit) {
    var open by remember(listingId, revision) { mutableStateOf(false) }
    JodloTextAction(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.navigation_service_safety))
    }
    if (open) ServiceDetailView(stringResource(R.string.navigation_service_safety), close = { open = false }) {
        content()
    }
}

@Composable
internal fun ServiceDetailView(title: String, close: () -> Unit, content: @Composable () -> Unit) {
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(JodloPalette.Canvas).safeDrawingPadding()) {
            JodloAppBar(title, onBack = close)
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(JodloSizes.ScreenPadding),
                verticalArrangement = Arrangement.spacedBy(JodloSizes.Gap),
            ) {
                content()
            }
        }
    }
}
