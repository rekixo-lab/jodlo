package com.rekixo.jodlo

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
import com.rekixo.jodlo.core.network.HomeCategorySnapshot
import com.rekixo.jodlo.core.network.Language
import com.rekixo.jodlo.core.network.PublicCategory
import com.rekixo.jodlo.core.network.RemoteCatalogRepository
import com.rekixo.jodlo.ui.theme.JodloBrandHeading
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloChip
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val HOME_PAGE_SIZE = 10

/** A real, anonymous first-screen entry into the existing JODLO Customer
 * discovery, feed, Saved and account journeys. No created "featured workers",
 * not a GPS/verified-person/online-availability dashboard.
 *
 * Source for Category tiles is ONLY the current approved active Catalog GET.
 * Tapping an exact returned Category leads to a fresh anonymous public
 * Listing read in GuestDiscovery, never directly to contact or publication.
 */
@Composable
internal fun CustomerHome(
    repository: RemoteCatalogRepository?,
    openCategory: (PublicCategory, Language) -> Unit,
    openBrowse: () -> Unit,
    openHierarchy: () -> Unit,
    openServices: () -> Unit,
    openNearby: () -> Unit,
    openSaved: () -> Unit,
    openWorker: () -> Unit,
    openHelp: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var language by remember { mutableStateOf(Language.HI) }
    var publishedOnly by remember { mutableStateOf(false) }
    var page by remember { mutableStateOf(HomeCategorySnapshot.empty(language, publishedOnly)) }
    var busy by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var nextFailed by remember { mutableStateOf(false) }
    var revision by remember { mutableIntStateOf(0) }

    fun fetchPage(after: String? = null) {
        val client = repository ?: return
        if (busy || (after != null && after != page.nextCursor)) return
        val currentRevision = ++revision
        val chosenLanguage = language
        val chosenFilter = publishedOnly
        busy = true
        if (after == null) {
            page = HomeCategorySnapshot.empty(chosenLanguage, chosenFilter)
            failed = false
        }
        nextFailed = false
        scope.launch {
            val reply = withContext(Dispatchers.IO) {
                try {
                    client.browse(chosenLanguage, availableOnly = chosenFilter,
                        limit = HOME_PAGE_SIZE, after = after)
                } catch (cancelled: kotlin.coroutines.cancellation.CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    ApiOutcome.Failed(FailureKind.BAD_RESPONSE, retryable = false)
                }
            }
            if (revision != currentRevision) return@launch
            busy = false
            when (reply) {
                is ApiOutcome.Failed -> {
                    if (after == null) failed = true else nextFailed = true
                }
                is ApiOutcome.Ok -> {
                    val next = page.withVerifiedPage(
                        chosenLanguage, chosenFilter, after, reply.value.categories,
                        reply.value.nextCursor, HOME_PAGE_SIZE,
                    )
                    if (next == null) {
                        // A stale/overlapping server cursor is not a usable
                        // Category snapshot. Do not keep mislabelled tiles.
                        page = HomeCategorySnapshot.empty(chosenLanguage, chosenFilter)
                        failed = true
                    } else {
                        page = next
                    }
                }
            }
        }
    }

    // Every tab opening and filter/language change replaces old public
    // references; results from an earlier request cannot repaint this view.
    LaunchedEffect(repository, language, publishedOnly) {
        revision++
        busy = false
        page = HomeCategorySnapshot.empty(language, publishedOnly)
        failed = false
        nextFailed = false
        if (repository != null) fetchPage()
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            JodloSizes.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(JodloSizes.Gap),
    ) {
        item {
            JodloBrandHeading(stringResource(R.string.home_heading))
            Text(stringResource(R.string.home_intro),
                style = MaterialTheme.typography.bodyMedium)
        }
        item {
            JodloButton(onClick = openBrowse, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.home_browse_action))
            }
        }
        item {
            JodloTextAction(onClick = openHierarchy, enabled = repository != null,
                modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.home_hierarchy_action))
            }
        }
        item {
            JodloTextAction(onClick = openServices, enabled = repository != null,
                modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.home_services_action))
            }
        }
        item {
            JodloTextAction(onClick = openNearby, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.home_nearby_action))
            }
        }
        item {
            JodloTextAction(onClick = openSaved, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.home_saved_action))
            }
        }
        item {
            JodloTextAction(onClick = openWorker, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.home_worker_action))
            }
        }
        item {
            JodloTextAction(onClick = openHelp, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.help_home_action))
            }
        }
        item {
            Text(stringResource(R.string.home_category_heading),
                style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.home_category_notice),
                style = MaterialTheme.typography.bodySmall)
        }
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
        if (repository != null) {
            item {
                JodloChip(selected = publishedOnly,
                    onClick = { publishedOnly = !publishedOnly },
                    label = { Text(stringResource(R.string.filter_published_services)) })
            }
            item {
                JodloTextAction(onClick = { fetchPage() }, enabled = !busy) {
                    Text(stringResource(R.string.home_refresh))
                }
            }
            if (failed) item {
                Text(stringResource(R.string.request_failed),
                    color = MaterialTheme.colorScheme.error)
            }
            if (page.categories.isEmpty() && !busy && !failed) item {
                Text(stringResource(R.string.empty_catalog))
            }
            items(page.categories, key = { "home-category-" + it.id }) { category ->
                JodloCard(
                    onClick = {
                        val selected = page.select(language, publishedOnly, category)
                        if (!busy && selected != null) openCategory(selected, language)
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(
                        modifier = Modifier.padding(JodloSizes.CardPadding),
                        verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
                    ) {
                        Text(category.name,
                            style = MaterialTheme.typography.titleMedium)
                        Text(stringResource(R.string.home_open_category),
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            if (page.nextCursor != null) item {
                JodloTextAction(onClick = { fetchPage(page.nextCursor) }, enabled = !busy) {
                    Text(stringResource(R.string.customer_more_categories))
                }
            }
            if (nextFailed) item {
                Text(stringResource(R.string.customer_page_failed),
                    color = MaterialTheme.colorScheme.error)
                JodloTextAction(onClick = { fetchPage(page.nextCursor) }, enabled = !busy) {
                    Text(stringResource(R.string.customer_retry_page))
                }
            }
        } else {
            item {
                Text(stringResource(R.string.home_no_live_api),
                    style = MaterialTheme.typography.bodyMedium)
            }
        }
        if (busy) item { CircularProgressIndicator() }
    }
}
