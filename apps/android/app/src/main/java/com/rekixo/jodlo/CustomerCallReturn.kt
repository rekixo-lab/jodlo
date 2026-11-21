package com.rekixo.jodlo

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.ApiOutcome
import com.rekixo.jodlo.core.network.CustomerServiceCard
import com.rekixo.jodlo.core.network.FailureKind
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.Language
import com.rekixo.jodlo.core.network.NearbyPilotCity
import com.rekixo.jodlo.core.network.PublicListing
import com.rekixo.jodlo.core.network.RemoteCatalogRepository
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** In-memory public reference only, never a Google token or permission to
 * contact. Process death, manual navigation and a new session drop it.
 * No saved-state Bundle, DataStore, network write or automatic call.
 */
internal data class CustomerCallReturn(
    val listing: PublicListing,
    val language: Language,
    val source: String,
    val city: NearbyPilotCity?,
)

/** A single shared post-login destination for Browse, Saved and city/global
 * Feed. Reuse existing checked Service, public profile, safety and call UI.
 * This screen NEVER treats the pre-login card as current public evidence.
 */
@Composable
internal fun CustomerCallReturnScreen(
    repository: RemoteCatalogRepository?,
    session: InMemorySessionCoordinator?,
    handoff: CustomerCallReturn,
    onCall: ((PublicListing, Language, NearbyPilotCity?) -> Unit)?,
    onBack: () -> Unit,
) {
    val ownerEpoch = remember(session, handoff) { session?.accountExportSessionMarker() }
    var revision by remember(handoff) { mutableIntStateOf(0) }
    var busy by remember(handoff) { mutableStateOf(false) }
    var checked by remember(handoff) { mutableStateOf<CustomerServiceCard?>(null) }
    var notPublic by remember(handoff) { mutableStateOf(false) }

    // One exact GET when this screen is opened; subsequent retries require a
    // visible user tap. Never auto-dial, auto-save or reuse pre-login evidence.
    LaunchedEffect(repository, session, handoff, revision) {
        busy = true
        checked = null
        notPublic = false
        if (repository == null || session == null || ownerEpoch == null) {
            busy = false
            return@LaunchedEffect
        }
        val result = withContext(Dispatchers.IO) {
            try {
                repository.reviewedServiceDetail(
                    handoff.listing.id, handoff.listing.categoryId, handoff.language, handoff.city,
                )
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)
            }
        }
        // A replaced or expired owner must not inherit a late result.
        if (session.accountExportSessionMarker() != ownerEpoch) {
            busy = false
            return@LaunchedEffect
        }
        when (result) {
            is ApiOutcome.Ok -> {
                checked = CustomerServiceCard.publicWhenChecked(
                    handoff.listing, handoff.language, result.value,
                )
                notPublic = checked == null
            }
            is ApiOutcome.Failed -> notPublic = result.kind == FailureKind.NOT_FOUND
        }
        busy = false
    }

    val card = checked?.takeIf {
        ownerEpoch != null && session?.accountExportSessionMarker() == ownerEpoch
    }
    BackHandler { onBack() }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .padding(JodloSizes.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(JodloSizes.Gap),
    ) {
        Text(stringResource(R.string.call_return_heading),
            style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.call_return_notice),
            style = MaterialTheme.typography.bodySmall)
        if (busy) CircularProgressIndicator()
        if (card != null) {
            SafeServiceCard(card)
            SafePublicProfileFacts(card.profile, card.city)
            ApprovedServicePhoto(repository, card, revision)
            ServiceCallButton(onCall, card.listing, handoff.language, session, handoff.city)
            ServiceSafetyPanel(card.listing.id, revision) {
                ContactBlockControls(session, card.listing.id)
                ReportServiceControls(session, card.listing.id)
            }
        } else if (!busy) {
            Text(
                stringResource(when {
                    ownerEpoch == null || session?.accountExportSessionMarker() != ownerEpoch ->
                        R.string.call_sign_in
                    notPublic -> R.string.listing_no_longer_public
                    else -> R.string.request_failed
                }),
                color = MaterialTheme.colorScheme.error,
            )
        }
        if (!busy && ownerEpoch != null &&
            session?.accountExportSessionMarker() == ownerEpoch) {
            JodloTextAction(onClick = { revision++ }) {
                Text(stringResource(R.string.service_details_refresh_now))
            }
        }
        JodloTextAction(onClick = onBack) {
            Text(stringResource(R.string.call_return_browse))
        }
    }
}
