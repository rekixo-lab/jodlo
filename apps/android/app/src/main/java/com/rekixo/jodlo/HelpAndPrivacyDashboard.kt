package com.rekixo.jodlo

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction

/**
 * Bilingual guest-accessible HELP and honest data-rights navigation.
 *
 * Describes actually implemented local Saved, account export and sign-out
 * journeys, never pretending an unapproved erasure workflow, legal privacy
 * policy, live support channel or RTC provider has been deployed.
 * It performs NO network request or read of account data itself.
 */
@Composable
internal fun HelpAndPrivacyDashboard(
    onHome: () -> Unit,
    onBrowse: () -> Unit,
    onSaved: () -> Unit,
    onHidden: () -> Unit,
    onAccount: () -> Unit,
    onWorker: () -> Unit,
) {
    BackHandler(onBack = onHome)
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            JodloSizes.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(JodloSizes.Gap),
    ) {
        item {
            Text(stringResource(R.string.help_heading),
                style = MaterialTheme.typography.headlineLarge)
            Text(stringResource(R.string.help_intro),
                style = MaterialTheme.typography.bodyMedium)
        }
        item {
            JodloCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(JodloSizes.CardPadding),
                    verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
                ) {
                    Text(stringResource(R.string.help_guest_heading),
                        style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.help_guest_detail),
                        style = MaterialTheme.typography.bodySmall)
                    JodloTextAction(onClick = onBrowse) {
                        Text(stringResource(R.string.help_open_browse))
                    }
                }
            }
        }
        item {
            JodloCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(JodloSizes.CardPadding),
                    verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
                ) {
                    Text(stringResource(R.string.help_saved_heading),
                        style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.help_saved_detail),
                        style = MaterialTheme.typography.bodySmall)
                    JodloTextAction(onClick = onSaved) {
                        Text(stringResource(R.string.help_open_saved))
                    }
                }
            }
        }
        item {
            JodloCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(JodloSizes.CardPadding),
                    verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
                ) {
                    Text(stringResource(R.string.hidden_heading),
                        style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.hidden_privacy_note),
                        style = MaterialTheme.typography.bodySmall)
                    JodloTextAction(onClick = onHidden) {
                        Text(stringResource(R.string.hidden_manage))
                    }
                }
            }
        }
        item {
            JodloCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(JodloSizes.CardPadding),
                    verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
                ) {
                    Text(stringResource(R.string.help_account_heading),
                        style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.help_account_detail),
                        style = MaterialTheme.typography.bodySmall)
                    JodloTextAction(onClick = onAccount) {
                        Text(stringResource(R.string.help_open_account))
                    }
                }
            }
        }
        item {
            JodloCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(JodloSizes.CardPadding),
                    verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
                ) {
                    Text(stringResource(R.string.help_worker_heading),
                        style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.help_worker_detail),
                        style = MaterialTheme.typography.bodySmall)
                    JodloTextAction(onClick = onWorker) {
                        Text(stringResource(R.string.help_open_worker))
                    }
                }
            }
        }
        item {
            JodloCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(JodloSizes.CardPadding),
                    verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
                ) {
                    Text(stringResource(R.string.help_rights_heading),
                        style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.help_rights_detail),
                        style = MaterialTheme.typography.bodySmall)
                    Text(stringResource(R.string.help_policy_pending),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error)
                }
            }
        }
        item {
            JodloButton(onClick = onHome, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.help_back_home))
            }
        }
    }
}
