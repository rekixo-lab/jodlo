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
import com.rekixo.jodlo.core.network.HierarchyItem
import com.rekixo.jodlo.core.network.HierarchyLevel
import com.rekixo.jodlo.core.network.Language
import com.rekixo.jodlo.core.network.PublicCategory
import com.rekixo.jodlo.core.network.RemoteCatalogRepository
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloChip
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val HIERARCHY_PAGE_SIZE = 20

/** Real, public-only, *opt-in* drill-down:
 * approved Group -> approved Family -> current approved Category.
 * No historical Category is activated, no inferred Worker, no GPS/account,
 * and original flat Search/Feed remain available as an explicit fallback.
 */
@Composable
internal fun CustomerHierarchy(
    repository: RemoteCatalogRepository?,
    openCategory: (PublicCategory, Language) -> Unit,
    openBrowse: () -> Unit,
    openHome: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var language by remember { mutableStateOf(Language.HI) }
    var availableOnly by remember { mutableStateOf(false) }
    var level by remember { mutableStateOf(HierarchyLevel.GROUPS) }
    var group by remember { mutableStateOf<HierarchyItem?>(null) }
    var family by remember { mutableStateOf<HierarchyItem?>(null) }
    val parentId = when (level) {
        HierarchyLevel.GROUPS -> null
        HierarchyLevel.FAMILIES -> group?.id
        HierarchyLevel.CATEGORIES -> family?.id
    }
    var rows by remember { mutableStateOf(emptyList<HierarchyItem>()) }
    var cursor by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf<FailureKind?>(null) }
    var nextFailed by remember { mutableStateOf(false) }
    var revision by remember { mutableIntStateOf(0) }

    fun loadPage(after: String? = null) {
        val client = repository ?: return
        if (busy || (after != null && after != cursor) ||
            (level != HierarchyLevel.GROUPS && parentId == null)) return
        val callGeneration = ++revision
        val requestedLevel = level
        val requestedParent = parentId
        val requestedLanguage = language
        val requestedFilter = availableOnly
        busy = true
        if (after == null) {
            rows = emptyList()
            cursor = null
            failed = null
        }
        nextFailed = false
        scope.launch {
            val reply = withContext(Dispatchers.IO) {
                try {
                    client.hierarchy(requestedLevel, requestedParent,
                        requestedLanguage, requestedFilter, HIERARCHY_PAGE_SIZE, after)
                } catch (cancelled: kotlin.coroutines.cancellation.CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    ApiOutcome.Failed(FailureKind.BAD_RESPONSE, retryable = false)
                }
            }
            if (revision != callGeneration || requestedLevel != level ||
                requestedParent != parentId || requestedLanguage != language ||
                requestedFilter != availableOnly) return@launch
            busy = false
            when (reply) {
                is ApiOutcome.Failed -> {
                    if (after == null) failed = reply.kind else nextFailed = true
                }
                is ApiOutcome.Ok -> {
                    val page = reply.value
                    // In addition to strict repository validation, reject
                    // duplicates across manually loaded pages or stale UI.
                    val safe = (after == null || (rows.isNotEmpty() &&
                        page.items.all { item -> rows.none { it.id == item.id } &&
                            item.id > after })) &&
                        (page.nextCursor == null ||
                            (page.items.size == HIERARCHY_PAGE_SIZE &&
                                page.items.lastOrNull()?.id == page.nextCursor))
                    if (!safe) {
                        rows = emptyList()
                        cursor = null
                        failed = FailureKind.BAD_RESPONSE
                    } else {
                        rows = if (after == null) page.items else rows + page.items
                        cursor = page.nextCursor
                    }
                }
            }
        }
    }

    LaunchedEffect(repository, level, parentId, language, availableOnly) {
        // Every parent or language/filter change invalidates a previous page
        // and every in-flight result. Nothing is cached or stored on device.
        revision++
        busy = false
        rows = emptyList()
        cursor = null
        failed = null
        nextFailed = false
        if (repository != null) loadPage()
    }

    fun goBack() {
        when (level) {
            HierarchyLevel.GROUPS -> openHome()
            HierarchyLevel.FAMILIES -> {
                group = null
                family = null
                level = HierarchyLevel.GROUPS
            }
            HierarchyLevel.CATEGORIES -> {
                family = null
                level = HierarchyLevel.FAMILIES
            }
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            JodloSizes.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(JodloSizes.Gap),
    ) {
        item {
            Text(stringResource(R.string.hierarchy_heading),
                style = MaterialTheme.typography.headlineLarge)
            Text(stringResource(R.string.hierarchy_notice),
                style = MaterialTheme.typography.bodyMedium)
            if (level == HierarchyLevel.FAMILIES && group != null) {
                Text(group!!.name, style = MaterialTheme.typography.titleMedium)
            }
            if (level == HierarchyLevel.CATEGORIES && group != null && family != null) {
                Text(group!!.name + " / " + family!!.name,
                    style = MaterialTheme.typography.titleMedium)
            }
        }
        item {
            JodloTextAction(onClick = ::goBack, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.hierarchy_back))
            }
            JodloTextAction(onClick = openBrowse, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.hierarchy_flat_browse))
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                JodloChip(selected = language == Language.HI,
                    onClick = {
                        language = Language.HI
                        group = null; family = null; level = HierarchyLevel.GROUPS
                    },
                    label = { Text(stringResource(R.string.language_hindi)) })
                JodloChip(selected = language == Language.EN,
                    onClick = {
                        language = Language.EN
                        group = null; family = null; level = HierarchyLevel.GROUPS
                    },
                    label = { Text(stringResource(R.string.language_english)) })
            }
        }
        item {
            JodloChip(selected = availableOnly,
                onClick = {
                    availableOnly = !availableOnly
                    group = null; family = null; level = HierarchyLevel.GROUPS
                },
                label = { Text(stringResource(R.string.filter_published_services)) })
            JodloTextAction(onClick = { loadPage() }, enabled = !busy && repository != null) {
                Text(stringResource(R.string.hierarchy_refresh))
            }
        }
        item {
            val label = when (level) {
                HierarchyLevel.GROUPS -> R.string.hierarchy_groups
                HierarchyLevel.FAMILIES -> R.string.hierarchy_families
                HierarchyLevel.CATEGORIES -> R.string.hierarchy_categories
            }
            Text(stringResource(label), style = MaterialTheme.typography.titleLarge)
        }
        if (repository == null) item {
            Text(stringResource(R.string.home_no_live_api),
                style = MaterialTheme.typography.bodyMedium)
        }
        if (failed != null) item {
            Text(stringResource(
                if (failed == FailureKind.NOT_FOUND) R.string.hierarchy_unavailable
                else R.string.request_failed),
                color = MaterialTheme.colorScheme.error)
        }
        if (rows.isEmpty() && !busy && failed == null && repository != null) item {
            Text(stringResource(R.string.hierarchy_empty),
                style = MaterialTheme.typography.bodyMedium)
        }
        items(rows, key = { "hierarchy-${level.code}-${it.id}" }) { item ->
            JodloCard(
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    if (busy) return@JodloCard
                    when (level) {
                        HierarchyLevel.GROUPS -> {
                            group = item
                            family = null
                            level = HierarchyLevel.FAMILIES
                        }
                        HierarchyLevel.FAMILIES -> {
                            family = item
                            level = HierarchyLevel.CATEGORIES
                        }
                        HierarchyLevel.CATEGORIES -> {
                            val slug = item.slug
                            if (slug != null && group != null && family != null) {
                                openCategory(PublicCategory(item.id, slug, item.name), language)
                            }
                        }
                    }
                },
            ) {
                Column(
                    modifier = Modifier.padding(JodloSizes.CardPadding),
                    verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
                ) {
                    Text(item.name, style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(if (level == HierarchyLevel.CATEGORIES)
                        R.string.home_open_category else R.string.hierarchy_open_next),
                        style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        if (cursor != null) item {
            JodloTextAction(onClick = { loadPage(cursor) }, enabled = !busy) {
                Text(stringResource(R.string.customer_more_categories))
            }
        }
        if (nextFailed) item {
            Text(stringResource(R.string.customer_page_failed),
                color = MaterialTheme.colorScheme.error)
            JodloTextAction(onClick = { loadPage(cursor) }, enabled = !busy) {
                Text(stringResource(R.string.customer_retry_page))
            }
        }
        if (busy) item { CircularProgressIndicator() }
    }
}
