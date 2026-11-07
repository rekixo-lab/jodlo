package com.rekixo.jodlo

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
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
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.FailureKind
import com.rekixo.jodlo.core.network.NearbyPilotCity
import com.rekixo.jodlo.core.network.Language
import com.rekixo.jodlo.core.network.CustomerServiceCard
import com.rekixo.jodlo.core.network.PublicApprovedServiceDetail
import com.rekixo.jodlo.core.network.PublicListing
import com.rekixo.jodlo.core.network.RemoteCatalogRepository
import com.rekixo.jodlo.core.network.SavedPublicServices
import com.rekixo.jodlo.core.network.HiddenPublicServices
import com.rekixo.jodlo.ui.theme.JodloButton
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
    onBrowseCategories: () -> Unit,
    contactSession: InMemorySessionCoordinator?,
    city: NearbyPilotCity? = null,
    onBackToCityPicker: (() -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    var language by remember { mutableStateOf(Language.HI) }
    var listings by remember { mutableStateOf<List<PublicListing>>(emptyList()) }
    var nextCursor by remember { mutableStateOf<String?>(null) }
    var categoryNames by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var categoryFilter by remember(repository) { mutableStateOf<String?>(null) }
    var filterNames by remember(repository) {
        mutableStateOf<Map<String, String>>(emptyMap())
    }
    var selected by remember { mutableStateOf<PublicListing?>(null) }
    var verified by remember { mutableStateOf<PublicApprovedServiceDetail?>(null) }
    var detailFailure by remember { mutableStateOf<FailureKind?>(null) }
    var failure by remember { mutableStateOf(false) }
    var pageFailure by remember { mutableStateOf(false) }
    var continuationExpired by remember { mutableStateOf(false) }
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
        val filter = categoryFilter
        if (after == null) {
            listings = emptyList()
            nextCursor = null
            categoryNames = emptyMap()
            failure = false
        }
        pageFailure = false
        continuationExpired = false
        busy = true
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                try {
                    repository.localizedPublicListings(lang, after = after, categoryId = filter, city = city)
                } catch (cancelled: kotlin.coroutines.cancellation.CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)
                }
            }
            if (current != revision || language != lang || categoryFilter != filter) return@launch
            when (result) {
                is ApiOutcome.Failed -> {
                    busy = false
                    if (after == null) failure = true else pageFailure = true
                }
                is ApiOutcome.Ok -> {
                    val page = result.value.page
                    val rows = page.listings
                    val existing = listings.mapTo(mutableSetOf()) { it.id }
                    if (after != null && (rows.isEmpty() || rows.any { it.id in existing })) {
                        // An expired public anchor or a changed page cannot extend
                        // this view. Keep existing cards as references until refresh.
                        nextCursor = null
                        continuationExpired = true
                        busy = false
                        return@launch
                    }
                    listings = if (after == null) rows else listings + rows
                    nextCursor = page.nextCursor
                    categoryNames = categoryNames + result.value.categoryNames
                    if (filter == null) {
                        filterNames = (filterNames + result.value.categoryNames).entries
                            .take(24).associate { it.key to it.value }
                    }
                    busy = false
                }
            }
        }
    }
    fun inspect(row: PublicListing) {
        if (busy || row !in listings || categoryFilter?.let { it != row.categoryId } == true) return
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
                try { repository.reviewedServiceDetail(row.id, row.categoryId, lang, city) }
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

    fun changeScope(nextLanguage: Language, nextCategory: String?) {
        if (language == nextLanguage && categoryFilter == nextCategory) return
        leaveDetail()
        if (language != nextLanguage) filterNames = emptyMap()
        language = nextLanguage
        categoryFilter = nextCategory
        loadPage()
    }

    LaunchedEffect(repository) {
        leaveDetail()
        loadPage()
    }
    val selectedListing = selected
    BackHandler(enabled = selectedListing != null || onBackToCityPicker != null) {
        if (selectedListing != null) leaveDetail() else onBackToCityPicker?.invoke()
    }
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
        if (selectedListing == null) {
            if (city != null) item {
                Text(stringResource(R.string.nearby_city_results, stringResource(cityLabel(city))))
                onBackToCityPicker?.let { back ->
                    JodloTextAction(onClick = back) { Text(stringResource(R.string.nearby_choose_city)) }
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                    JodloChip(selected = language == Language.HI,
                        onClick = { if (language != Language.HI) changeScope(Language.HI, null) },
                        label = { Text(stringResource(R.string.language_hindi)) })
                    JodloChip(selected = language == Language.EN,
                        onClick = { if (language != Language.EN) changeScope(Language.EN, null) },
                        label = { Text(stringResource(R.string.language_english)) })
                }
            }
            if (filterNames.isNotEmpty()) item {
                Text(stringResource(R.string.feed_quick_filters),
                    style = MaterialTheme.typography.titleSmall)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                    item {
                        JodloChip(selected = categoryFilter == null, enabled = !busy,
                            onClick = { changeScope(language, null) },
                            label = { Text(stringResource(R.string.feed_all_categories)) })
                    }
                    items(filterNames.entries.toList(), key = { it.key }) { (id, name) ->
                        JodloChip(selected = categoryFilter == id, enabled = !busy,
                            onClick = { changeScope(language, id) }, label = { Text(name) })
                    }
                }
            }
            item {
                JodloTextAction(onClick = onBrowseCategories) {
                    Text(stringResource(R.string.home_browse_action))
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
            val visibleListings = hidden.visible(listings).filter {
                categoryFilter == null || it.categoryId == categoryFilter
            }
            if (visibleListings.isEmpty() && !busy && !failure) item {
                Text(stringResource(when {
                    listings.isNotEmpty() -> R.string.hidden_page_filtered
                    city != null -> R.string.nearby_city_empty
                    else -> R.string.feed_empty
                }))
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
            if (continuationExpired) item {
                Text(stringResource(R.string.feed_continuation_expired))
                JodloTextAction(onClick = { loadPage() }, enabled = !busy) {
                    Text(stringResource(R.string.feed_refresh))
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
            val safeCard = CustomerServiceCard.publicWhenChecked(selectedListing, language, verified)
            item {
                SafeServiceCard(safeCard ?: CustomerServiceCard.reference(
                    selectedListing, categoryNames[selectedListing.categoryId]))
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
                item { SafePublicProfileFacts(safeCard.profile, safeCard.city) }
                item { ApprovedServicePhoto(repository, safeCard) }
                item { ContactBlockControls(contactSession, safeCard.listing.id) }
                item { ReportServiceControls(contactSession, safeCard.listing.id) }
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
                    Text(stringResource(when {
                        detailFailure != FailureKind.NOT_FOUND -> R.string.request_failed
                        city != null -> R.string.nearby_service_unavailable
                        else -> R.string.listing_no_longer_public
                    }),
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
