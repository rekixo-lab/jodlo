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
import com.rekixo.jodlo.core.network.CustomerServiceCard
import com.rekixo.jodlo.core.network.CustomerServiceCardEvidence
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloSizes

/** Shared Customer-facing content for Browse, all-public Feed and Saved.
 * Does not render Worker identity, rating, media, phone, location, rate or
 * call action: none are approved or present in the public Listing contract.
 * An exact read label is explicitly "when checked", not "online"/verified.
 */
@Composable
internal fun SafeServiceCardContents(
    card: CustomerServiceCard,
    modifier: Modifier = Modifier.padding(JodloSizes.CardPadding),
    compact: Boolean = false,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
    ) {
        Text(
            card.approvedCategoryName
                ?: stringResource(R.string.service_card_category_not_confirmed),
            style = MaterialTheme.typography.titleMedium,
        )
        if (!compact) {
            Text(
                stringResource(R.string.service_card_approved_category_notice),
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Text(
            stringResource(R.string.listing_reference, card.listing.id),
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            stringResource(
                if (card.evidence == CustomerServiceCardEvidence.PUBLIC_WHEN_CHECKED)
                    R.string.service_card_checked_time_only
                else R.string.service_card_must_recheck
            ),
            style = MaterialTheme.typography.bodySmall,
        )
        if (!compact && card.profile == null) {
            Text(
                stringResource(R.string.service_card_no_worker_claims),
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

/** Outlined card remains the application's existing native touch target.
 * The caller handles navigation, explicit fresh GET and Save separately.
 */
@Composable
internal fun SafeServiceCard(
    card: CustomerServiceCard,
    modifier: Modifier = Modifier.fillMaxWidth(),
    onClick: (() -> Unit)? = null,
) {
    JodloCard(modifier = modifier, onClick = onClick) {
        SafeServiceCardContents(card, compact = onClick != null)
    }
}
