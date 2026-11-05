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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.ApiOutcome
import com.rekixo.jodlo.core.network.FailureKind
import com.rekixo.jodlo.core.network.Language
import com.rekixo.jodlo.core.network.CustomerServiceCard
import com.rekixo.jodlo.core.network.PublicApprovedServiceDetail
import com.rekixo.jodlo.core.network.PublicListing
import com.rekixo.jodlo.core.network.RemoteCatalogRepository
import com.rekixo.jodlo.core.network.SavedPublicServices
import com.rekixo.jodlo.core.network.HiddenPublicServices
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloChip
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** An opt-in all-Category view of actual current public services, not a
 * fabricated people feed. No account, GPS, phone, personal profile, live
 * presence, call permission or ratings. Every detail tap must recheck server
 * eligibility; device Save requires that fresh confirmed detail.
 *
 * This screen is available only when an actual HTTPS API is configured.
 * Local debug-only sample listings cannot accidentally enter Saved.
 */
@Composable
internal fun PublicServicesFeed(
    repository: RemoteCatalogRepository,
    saved: SavedPublicServices,
    onSaveToggle: (PublicListing) -> Boolean,
    hidden: HiddenPublicServices,
    onHide: (String) -> Boolean,
) {
    val scope = rememberCoroutineScope()
    var language by remember { mutableStateOf(Language.HI) }
    var listings by remember { mutableStateOf<List<PublicListing>>(emptyList()) }
    var nextCursor by remember { mutableStateOf<String?>(null) }
    var categoryNames by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var selected by remember { mutableStateOf<PublicListing?>(null) }
    var verified by remember { mutableStateOf<PublicApprovedServiceDetail?>(null) }
    var detailFailure by remember { mutableStateOf<FailureKind?>(null) }
    var failure by remember { mutableStateOf(false) }
    var pageFailure by remember { mutableStateOf(false) }
    var savingFailure by remember { mutableStateOf(false) }
    var hidingFailure by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var revision by remember { mutableIntStateOf(0) }

    fun leaveDetail() {
        revision++
        selected = null
        verified = null
        detailFailure = null
        savingFailure = false
        hidingFailure = false
        busy = false
    }
    fun loadPage(after: String? = null) {
        if (busy || selected != null) return
        if (after != null && after != nextCursor) return
        val current = ++revision
        val lang = language
        if (after == null) {
            listings = emptyList()
            nextCursor = null
            categoryNames = emptyMap()
            failure = false
        }
        pageFailure = false
        busy = true
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                try {
                    repository.allPublicListings(limit = 20, after = after)
                } catch (cancelled: kotlin.coroutines.cancellation.CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)
                }
            }
            if (current != revision) return@launch
            when (result) {
                is ApiOutcome.Failed -> {
                    busy = false
                    if (after == null) failure = true else pageFailure = true
                }
                is ApiOutcome.Ok -> {
                    val page = result.value
                    val rows = page.listings
                    val existing = listings.map { it.id }.toSet()
                    if ((after != null && rows.isEmpty()) ||
                        rows.map { it.id }.toSet().size != rows.size ||
                        (after != null && rows.any { it.id in existing })) {
                        listings = emptyList()
                        nextCursor = null
                        categoryNames = emptyMap()
                        failure = true
                        busy = false
                        return@launch
                    }
                    listings = if (after == null) rows else listings + rows
                    nextCursor = page.nextCursor
                    // Names come only from the existing explicitly PUBLIC,
                    // active-Category label endpoint. Failure never changes
                    // current listing status or invents a label.
                    val ids = rows.map { it.categoryId }.distinct()
                    if (ids.isNotEmpty()) {
                        val names = withContext(Dispatchers.IO) {
                            try { repository.approvedNames(ids, lang) }
                            catch (cancelled: kotlin.coroutines.cancellation.CancellationException) {
                                throw cancelled
                            } catch (_: Exception) {
                                ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)
                            }
                        }
                        if (current != revision) return@launch
                        if (names is ApiOutcome.Ok) {
                            categoryNames = categoryNames + names.value.associate { it.id to it.name }
                        }
                    }
                    busy = false
                }
            }
        }
    }
    fun inspect(row: PublicListing) {
        if (busy || row !in listings) return
        val current = ++revision
        val lang = language
        selected = row
        verified = null
        detailFailure = null
        savingFailure = false
        hidingFailure = false
        busy = true
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                try { repository.approvedServiceDetail(row.id, row.categoryId, lang) }
                catch (cancelled: kotlin.coroutines.cancellation.CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)
                }
            }
            if (current != revision) return@launch
            busy = false
            when (result) {
                is ApiOutcome.Ok -> verified = result.value
                is ApiOutcome.Failed -> detailFailure = result.kind
            }
        }
    }

    LaunchedEffect(repository, language) {
        // Opening this tab, or explicitly changing language, is the consented
        // read; there is no background polling or location collection.
        revision++
        selected = null
        busy = false
        loadPage()
    }
    BackHandler(enabled = selected != null) { leaveDetail() }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(JodloSizes.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(JodloSizes.Gap),
    ) {
        item {
            Text(stringResource(R.string.feed_heading),
                style = MaterialTheme.typography.headlineSmall)
        }
        item {
            Text(stringResource(R.string.feed_privacy_notice),
                style = MaterialTheme.typography.bodySmall)
        }
        if (selected == null) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                    JodloChip(selected = language == Language.HI,
                        onClick = { language = Language.HI },
                        label = { Text(stringResource(R.string.language_hindi)) })
                    JodloChip(selected = language == Language.EN,
                        onClick = { language = Language.EN },
                        label = { Text(stringResource(R.string.language_english)) })
                }
            }
            item {
                JodloTextAction(onClick = { loadPage() }, enabled = !busy) {
                    Text(stringResource(R.string.feed_refresh))
                }
            }
            if (failure) item {
                Text(stringResource(R.string.request_failed),
                    color = MaterialTheme.colorScheme.error)
            }
            val visibleListings = hidden.visible(listings)
            if (visibleListings.isEmpty() && !busy && !failure) item {
                Text(stringResource(if (listings.isEmpty()) R.string.feed_empty
                    else R.string.hidden_page_filtered))
            }
            items(visibleListings, key = { "all-public-" + it.id }) { listing ->
                SafeServiceCard(
                    card = CustomerServiceCard.reference(
                        listing, categoryNames[listing.categoryId]),
                    onClick = { inspect(listing) },
                )
            }
            if (nextCursor != null) item {
                JodloTextAction(onClick = { loadPage(nextCursor) }, enabled = !busy) {
                    Text(stringResource(R.string.customer_more_listings))
                }
            }
            if (pageFailure) item {
                Text(stringResource(R.string.customer_page_failed),
                    color = MaterialTheme.colorScheme.error)
                JodloTextAction(onClick = { loadPage(nextCursor) }, enabled = !busy) {
                    Text(stringResource(R.string.customer_retry_page))
                }
            }
        } else {
            item {
                JodloTextAction(onClick = { leaveDetail() }, enabled = !busy) {
                    Text(stringResource(R.string.feed_back))
                }
            }
            // Only exact public Service+Category+language matching this
            // selection can authorize a checked-public card or Save action.
            val safeCard = selected?.let {
                CustomerServiceCard.publicWhenChecked(it, language, verified)
            }
            item {
                SafeServiceCard(safeCard ?: CustomerServiceCard.reference(
                    selected!!, categoryNames[selected!!.categoryId]))
            }
            item {
                JodloTextAction(
                    onClick = {
                        val id = selected?.id ?: return@JodloTextAction
                        if (onHide(id)) leaveDetail()
                        else hidingFailure = true
                    }, enabled = !busy,
                ) { Text(stringResource(R.string.hidden_hide_here)) }
            }
            if (hidingFailure) item {
                Text(stringResource(R.string.hidden_storage_failed),
                    color = MaterialTheme.colorScheme.error)
            }
            if (safeCard != null) {
                item { SafePublicProfileFacts() }
                item {
                    JodloButton(onClick = {
                        savingFailure = !onSaveToggle(safeCard.listing)
                    },enabled = !busy) {
                        Text(stringResource(if (saved.contains(safeCard.listing))
                            R.string.saved_remove else R.string.saved_add))
                    }
                }
                if (savingFailure) item {
                    Text(stringResource(R.string.saved_storage_failed_or_limit),
                        color = MaterialTheme.colorScheme.error)
                }
            } else {
                if (detailFailure != null) item {
                    Text(stringResource(if (detailFailure == FailureKind.NOT_FOUND)
                        R.string.listing_no_longer_public else R.string.request_failed),
                        color = MaterialTheme.colorScheme.error)
                }
                item {
                    JodloTextAction(onClick = { selected?.let(::inspect) }, enabled = !busy) {
                        Text(stringResource(R.string.retry_action))
                    }
                }
            }
        }
        if (busy) item { CircularProgressIndicator() }
    }
}
