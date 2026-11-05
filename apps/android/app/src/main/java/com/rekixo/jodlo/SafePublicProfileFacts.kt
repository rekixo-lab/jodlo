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
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloSizes

/** Reused only beside a strictly checked public Service detail.
 * The backend has NO approved Worker profile, service-area, price or call
 * availability DTO today. These sentences are disclosures, not null-field
 * data and never an implicit permission to contact a person.
 */
@Composable
internal fun SafePublicProfileFacts() {
    JodloCard(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(JodloSizes.CardPadding),
            verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
        ) {
            Text(stringResource(R.string.service_profile_heading),
                style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.service_profile_identity),
                style = MaterialTheme.typography.bodySmall)
            Text(stringResource(R.string.service_profile_area),
                style = MaterialTheme.typography.bodySmall)
            Text(stringResource(R.string.service_profile_rates_calls),
                style = MaterialTheme.typography.bodySmall)
        }
    }
}
