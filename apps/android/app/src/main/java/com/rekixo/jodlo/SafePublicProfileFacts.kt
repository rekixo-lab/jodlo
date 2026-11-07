package com.rekixo.jodlo

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.NearbyPilotCity
import com.rekixo.jodlo.core.network.ServiceProfile
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloSizes

/** Review covers publication of the supplied text, not the worker's credentials. */
@Composable
internal fun SafePublicProfileFacts(profile: ServiceProfile?, city: NearbyPilotCity?) {
    JodloCard(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(JodloSizes.CardPadding),
            verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
        ) {
            Text(stringResource(R.string.service_profile_heading),
                style = MaterialTheme.typography.titleMedium)
            if (profile == null) {
                Text(stringResource(R.string.service_profile_identity),
                    style = MaterialTheme.typography.bodySmall)
            } else {
                Text(profile.displayName, style = MaterialTheme.typography.titleMedium)
                Text(profile.description)
                profile.experienceYears?.let {
                    Text(stringResource(R.string.service_details_experience_public, it))
                }
                profile.visitRateInr?.let {
                    Text(stringResource(R.string.service_details_rate_public, it))
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
