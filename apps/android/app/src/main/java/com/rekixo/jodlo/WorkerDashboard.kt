package com.rekixo.jodlo

import androidx.activity.ComponentActivity
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.rekixo.jodlo.core.network.ApiOutcome
import com.rekixo.jodlo.core.network.FailureKind
import com.rekixo.jodlo.core.network.GuidedWorkerServiceActions
import com.rekixo.jodlo.core.network.HeadlessWorkerWriteScope
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.Language
import com.rekixo.jodlo.core.network.LoginState
import com.rekixo.jodlo.core.network.OwnListing
import com.rekixo.jodlo.core.network.PublicCategory
import com.rekixo.jodlo.core.network.RemoteCatalogRepository
import com.rekixo.jodlo.core.network.SessionResult
import com.rekixo.jodlo.core.network.WorkerState
import com.rekixo.jodlo.core.network.WorkerWriteCompletion
import com.rekixo.jodlo.core.network.WorkerWriteState
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloChip
import com.rekixo.jodlo.ui.theme.JodloSearchField
import com.rekixo.jodlo.ui.theme.JodloTextAction
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloSizes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class WorkerCatalogMode { BROWSE, SEARCH }
private enum class PublicPreview { UNCHECKED, VISIBLE, NOT_PUBLIC, FAILED }
private data class WorkerCategoryPage(val rows: List<PublicCategory>, val next: String?)

/**
 * Private worker screen uses the same account and existing headless session/write
 * guards as the API clients. No bearer, Google ID, phone, address or raw error
 * message is exposed in Compose state.
 *
 * Operations are single-flight and all blocking Core calls run on Dispatchers.IO.
 * A lost POST acknowledgement never triggers an implicit retry; the user must
 * acknowledge a NeedsReview state before another worker write is considered.
 */
@Composable
internal fun WorkerDashboard(
    activity: ComponentActivity,
    session: InMemorySessionCoordinator?,
    writes: HeadlessWorkerWriteScope?,
    catalog: RemoteCatalogRepository?,
) {
    val scope = rememberCoroutineScope()
    var login by remember(session) { mutableStateOf(session?.snapshot() ?: LoginState.SignedOut) }
    var busy by remember(session) { mutableStateOf(false) }
    var message by remember(session) { mutableIntStateOf(0) }
    var ownListings by remember(session) { mutableStateOf<List<OwnListing>>(emptyList()) }
    var ownerCursor by remember(session) { mutableStateOf<String?>(null) }
    var categoryRows by remember(session) { mutableStateOf<List<PublicCategory>>(emptyList()) }
    var categoryCursor by remember(session) { mutableStateOf<String?>(null) }
    var categoryPageGeneration by remember(session) { mutableIntStateOf(0) }
    var categoryLanguage by remember(session) { mutableStateOf(Language.HI) }
    var categoryInput by remember(session) { mutableStateOf("") }
    var categoryMode by remember(session) { mutableStateOf(WorkerCatalogMode.BROWSE) }
    var submittedCategoryQuery by remember(session) { mutableStateOf<String?>(null) }
    var categoryLoaded by remember(session) { mutableStateOf(false) }
    var categoryFailed by remember(session) { mutableStateOf(false) }
    var invalidCategoryQuery by remember(session) { mutableStateOf(false) }
    var guided by remember(session) { mutableStateOf(GuidedWorkerServiceActions()) }
    var selectedListing by remember(session) { mutableStateOf<String?>(null) }
    var publicPreview by remember(session) { mutableStateOf(PublicPreview.UNCHECKED) }
    var writeState by remember(session) {
        mutableStateOf(writes?.snapshot()?.state ?: WorkerWriteState.Idle)
    }

    val signedIn = login as? LoginState.SignedIn
    val uncertain = writeState is WorkerWriteState.NeedsReview
    val canWrite = signedIn?.worker == WorkerState.DRAFT && !busy && !uncertain

    fun clearCategoryResults() {
        categoryRows = emptyList()
        categoryCursor = null
        categoryPageGeneration += 1
        guided = guided.clearPublication()
        categoryLoaded = false
        categoryFailed = false
        invalidCategoryQuery = false
        submittedCategoryQuery = null
        categoryMode = WorkerCatalogMode.BROWSE
    }

    fun updateSession() {
        login = session?.snapshot() ?: LoginState.SignedOut
        writeState = writes?.snapshot()?.state ?: WorkerWriteState.Idle
        if (login is LoginState.SignedOut) {
            ownListings = emptyList()
            ownerCursor = null
            selectedListing = null
            publicPreview = PublicPreview.UNCHECKED
            guided = guided.reset()
            clearCategoryResults()
        }
    }

    fun checkedAction(action: () -> SessionResult<*>, successMessage: Int = 0) {
        if (busy || session == null) return
        busy = true
        message = 0
        scope.launch {
            val result = try {
                withContext(Dispatchers.IO) { action() }
            } catch (_: Exception) {
                null // Unknown outcome, never treat as confirmed.
            }
            busy = false
            updateSession()
            message = if (result is SessionResult.Success) successMessage
                else R.string.worker_operation_failed
        }
    }

    fun loadOwnPage(after: String? = null) {
        if (session == null || busy || uncertain ||
            (session.snapshot() as? LoginState.SignedIn)?.worker != WorkerState.DRAFT) return
        busy = true
        message = 0
        publicPreview = PublicPreview.UNCHECKED // Owner status is NOT a public read.
        guided = guided.cancelUnpublish()
        val accountMarker = session.accountExportSessionMarker()
        scope.launch {
            val reply = try {
                withContext(Dispatchers.IO) { session.pageMyListings(20, after) }
            } catch (_: Exception) { null }
            busy = false
            updateSession()
            if (accountMarker == null ||
                session.accountExportSessionMarker() != accountMarker) return@launch
            when (reply) {
                is SessionResult.Success -> {
                    ownListings = if (after == null) reply.value.listings
                        else (ownListings + reply.value.listings).distinctBy { it.id }
                    ownerCursor = reply.value.nextCursor
                }
                else -> message = R.string.worker_read_failed
            }
        }
    }

    /** Worker selects from ALL approved active Categories, not just Categories
     * with an existing published Listing. Search cursor is never used across
     * changed query/language/mode and only explicit selection enables Publish.
     */
    fun loadCategories(after: String? = null, searchQuery: String? = null) {
        if (catalog == null || busy || uncertain ||
            (session?.snapshot() as? LoginState.SignedIn)?.worker != WorkerState.DRAFT) return
        if (after != null && (!categoryLoaded || after != categoryCursor)) return
        val mode = if (after == null) {
            if (searchQuery == null) WorkerCatalogMode.BROWSE else WorkerCatalogMode.SEARCH
        } else categoryMode
        val query = if (after == null) searchQuery else submittedCategoryQuery
        if (mode == WorkerCatalogMode.SEARCH && (query == null ||
                query.codePointCount(0, query.length) !in 2..64 ||
                query.any { Character.isISOControl(it) })) {
            invalidCategoryQuery = true
            return
        }
        val language = categoryLanguage
        val accountMarker = session?.accountExportSessionMarker()
        val pageGeneration = ++categoryPageGeneration
        invalidCategoryQuery = false
        busy = true
        message = 0
        if (after == null) {
            categoryRows = emptyList()
            categoryCursor = null
            guided = guided.clearPublication()
            categoryLoaded = false
            categoryFailed = false
            categoryMode = mode
            submittedCategoryQuery = query
        }
        scope.launch {
            val page: WorkerCategoryPage? = try {
                withContext(Dispatchers.IO) {
                    if (mode == WorkerCatalogMode.BROWSE) {
                        when (val reply = catalog.browse(language, limit = 20, after = after)) {
                            is ApiOutcome.Ok -> WorkerCategoryPage(
                                reply.value.categories, reply.value.nextCursor)
                            else -> null
                        }
                    } else {
                        when (val reply = catalog.searchCursor(
                            query!!, language, limit = 20, after = after)) {
                            is ApiOutcome.Ok -> WorkerCategoryPage(
                                reply.value.categories, reply.value.nextCursor)
                            else -> null
                        }
                    }
                }
            } catch (_: Exception) { null }
            busy = false
            if (pageGeneration != categoryPageGeneration ||
                accountMarker == null ||
                session?.accountExportSessionMarker() != accountMarker) return@launch
            categoryLoaded = true
            if (page == null) {
                categoryFailed = true
            } else {
                categoryFailed = false
                categoryRows = if (after == null) page.rows
                    else (categoryRows + page.rows).distinctBy { it.id }
                categoryCursor = page.next
            }
        }
    }

    fun mutate(action: () -> WorkerWriteCompletion) {
        if (busy || !canWrite || writes == null) return
        busy = true
        message = 0
        scope.launch {
            try {
                withContext(Dispatchers.IO) { action() }
            } catch (_: Exception) {
                // Read the defensive write-scope state; do NOT replay a POST/DELETE.
            }
            updateSession()
            ownListings = emptyList()
            ownerCursor = null
            selectedListing = null
            guided = guided.reset()
            publicPreview = PublicPreview.UNCHECKED

            // Only after a CONFIRMED owner write, refresh the current
            // private Listing list through an existing read-only route.
            // An uncertain POST/DELETE is never retried or marked committed.
            if (writeState is WorkerWriteState.Confirmed &&
                login is LoginState.SignedIn && session != null) {
                val fresh = try {
                    withContext(Dispatchers.IO) { session.pageMyListings(20) }
                } catch (_: Exception) { null }
                if (fresh is SessionResult.Success) {
                    ownListings = fresh.value.listings
                    ownerCursor = fresh.value.nextCursor
                }
            }
            busy = false
            message = when (writeState) {
                is WorkerWriteState.Confirmed -> R.string.worker_write_confirmed
                is WorkerWriteState.NeedsReview -> R.string.worker_uncertain_write
                else -> R.string.worker_operation_failed
            }
        }
    }


    /** Fresh anonymous Customer projection for an explicitly selected owner's
     * Listing. Owner-visible status is not itself evidence of public visibility.
     * No Worker bearer, account ID, contact, or call consent enters this GET.
     */
    fun checkPublicPreview() {
        val chosen = ownListings.firstOrNull { it.id == selectedListing } ?: return
        if (busy || uncertain || catalog == null ||
            (session?.snapshot() as? LoginState.SignedIn)?.worker != WorkerState.DRAFT) return
        publicPreview = PublicPreview.UNCHECKED
        busy = true
        message = 0
        scope.launch {
            val reply = try {
                withContext(Dispatchers.IO) {
                    catalog.listingDetail(chosen.id, chosen.categoryId)
                }
            } catch (_: Exception) { null }
            busy = false
            // A late response must never become a badge for another selected row.
            if (selectedListing != chosen.id) return@launch
            publicPreview = when (reply) {
                is ApiOutcome.Ok -> PublicPreview.VISIBLE
                is ApiOutcome.Failed ->
                    if (reply.kind == FailureKind.NOT_FOUND) PublicPreview.NOT_PUBLIC
                    else PublicPreview.FAILED
                else -> PublicPreview.FAILED
            }
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(JodloSizes.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(JodloSizes.Gap),
    ) {
        item {
            Text(stringResource(R.string.worker_dashboard), style = MaterialTheme.typography.headlineMedium)
        }
        if (session == null || writes == null || catalog == null) {
            item { Text(stringResource(R.string.no_api_origin), color = MaterialTheme.colorScheme.error) }
        } else if (login is LoginState.SignedOut) {
            item { Text(stringResource(R.string.worker_login_explainer)) }
            if (BuildConfig.GOOGLE_WEB_CLIENT_ID.isBlank()) {
                item { Text(stringResource(R.string.google_setup_required)) }
            } else {
                item {
                    JodloButton(onClick = {
                        if (busy) return@JodloButton
                        busy = true
                        message = 0
                        scope.launch {
                            val result = try {
                                // Credential Manager owns the system dialog; never call
                                // it on an IO executor or retain its result in UI state.
                                val proof = obtainGoogleIdToken(activity, BuildConfig.GOOGLE_WEB_CLIENT_ID)
                                if (proof == null) null else withContext(Dispatchers.IO) {
                                    session.signInWithGoogleIdToken(proof)
                                }
                            } catch (_: Exception) { null }
                            busy = false
                            updateSession()
                            message = if (result is SessionResult.Success)
                                R.string.worker_login_success else R.string.worker_login_failed
                        }
                    }, enabled = !busy) {
                        Text(stringResource(R.string.google_sign_in))
                    }
                }
            }
        } else {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                    JodloTextAction(
                        onClick = {
                            if (busy) return@JodloTextAction
                            // Clear PRIVATE screen state before requesting remote logout.
                            ownListings = emptyList()
                            ownerCursor = null
                            guided = guided.reset()
                            selectedListing = null
                            publicPreview = PublicPreview.UNCHECKED
                            checkedAction({ session.logout() }, R.string.worker_logout_local)
                        },
                        enabled = !busy,
                    ) { Text(stringResource(R.string.worker_logout)) }
                    JodloTextAction(
                        onClick = { checkedAction({ session.checkWorker() }) },
                        enabled = !busy,
                    ) { Text(stringResource(R.string.worker_check_profile)) }
                }
            }
            when (signedIn?.worker) {
                WorkerState.UNKNOWN -> item { Text(stringResource(R.string.worker_check_first)) }
                WorkerState.NO_DRAFT -> item {
                    Text(stringResource(R.string.worker_opt_in_explainer))
                    JodloButton(
                        onClick = {
                            checkedAction({ session.optIn() }, R.string.worker_opt_in_confirmed)
                        },
                        enabled = !busy,
                    ) { Text(stringResource(R.string.worker_opt_in_action)) }
                }
                WorkerState.DRAFT -> {
                    item { Text(stringResource(R.string.worker_draft_status)) }
                    if (uncertain) {
                        item {
                            Text(
                                stringResource(R.string.worker_uncertain_write),
                                color = MaterialTheme.colorScheme.error,
                            )
                            JodloTextAction(onClick = {
                                if (busy) return@JodloTextAction
                                busy = true
                                scope.launch {
                                    try {
                                        withContext(Dispatchers.IO) { writes.recheckOwnListingsPage() }
                                    } catch (_: Exception) { /* no retry */ }
                                    busy = false
                                    writeState = writes.snapshot().state
                                    message = R.string.worker_recheck_not_proof
                                }
                            }) { Text(stringResource(R.string.worker_recheck_read_only)) }
                            JodloTextAction(onClick = {
                                if (writes.acknowledgeUncertainty()) {
                                    writeState = writes.snapshot().state
                                    message = R.string.worker_review_acknowledged
                                }
                            }) { Text(stringResource(R.string.worker_acknowledge_uncertainty)) }
                        }
                    } else {
                        item {
                            Text(stringResource(R.string.worker_my_listings), style = MaterialTheme.typography.titleMedium)
                            JodloTextAction(onClick = { loadOwnPage() }, enabled = !busy) {
                                Text(stringResource(R.string.worker_refresh_listings))
                            }
                        }
                        items(ownListings, key = { "own-" + it.id }) { listing ->
                            JodloCard(
                                onClick = {
                                    if (!busy) {
                                        selectedListing = listing.id
                                        guided = guided.cancelUnpublish()
                                        publicPreview = PublicPreview.UNCHECKED
                                    }
                                },
                                selected = selectedListing == listing.id,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(Modifier.padding(JodloSizes.CardPadding)) {
                                    Text(stringResource(R.string.listing_reference, listing.id))
                                    Text(stringResource(R.string.worker_listing_category, listing.categoryId))
                                    Text(stringResource(if (listing.visible)
                                        R.string.worker_visible else R.string.worker_not_visible))
                                    if (selectedListing == listing.id)
                                        Text(stringResource(R.string.worker_listing_selected))
                                }
                            }
                        }
                        if (ownerCursor != null) item {
                            JodloTextAction(onClick = { loadOwnPage(ownerCursor) }, enabled = !busy) {
                                Text(stringResource(R.string.worker_load_more))
                            }
                        }
                        if (selectedListing != null) item {
                            JodloCard(modifier = Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(JodloSizes.CardPadding),
                                    verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                                    Text(stringResource(R.string.worker_customer_preview_heading),
                                        style = MaterialTheme.typography.titleMedium)
                                    Text(stringResource(R.string.worker_customer_preview_explainer))
                                    JodloTextAction(
                                        onClick = { checkPublicPreview() },
                                        enabled = !busy,
                                    ) {
                                        Text(stringResource(R.string.worker_customer_preview_check))
                                    }
                                    when (publicPreview) {
                                        PublicPreview.VISIBLE -> Text(
                                            stringResource(R.string.worker_customer_preview_visible))
                                        PublicPreview.NOT_PUBLIC -> Text(
                                            stringResource(R.string.worker_customer_preview_not_public))
                                        PublicPreview.FAILED -> Text(
                                            stringResource(R.string.worker_customer_preview_failed),
                                            color = MaterialTheme.colorScheme.error)
                                        PublicPreview.UNCHECKED -> { /* Never claim visibility from owner state. */ }
                                    }
                                    JodloButton(
                                        onClick = {
                                            val id = selectedListing ?: return@JodloButton
                                            mutate { writes.unpublish(id) }
                                        },
                                        enabled = canWrite,
                                    ) { Text(stringResource(R.string.worker_unpublish_selected)) }
                                }
                            }
                        }
                        item {
                            Text(stringResource(R.string.worker_publish_category),
                                style = MaterialTheme.typography.titleMedium)
                            Text(stringResource(R.string.worker_publish_explainer))
                            Text(stringResource(R.string.worker_category_search_hint))
                            Row(horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                                JodloChip(
                                    selected = categoryLanguage == Language.HI,
                                    onClick = {
                                        if (categoryLanguage != Language.HI) {
                                            categoryLanguage = Language.HI
                                            clearCategoryResults()
                                        }
                                    },
                                    enabled = !busy,
                                    label = { Text(stringResource(R.string.language_hindi)) },
                                )
                                JodloChip(
                                    selected = categoryLanguage == Language.EN,
                                    onClick = {
                                        if (categoryLanguage != Language.EN) {
                                            categoryLanguage = Language.EN
                                            clearCategoryResults()
                                        }
                                    },
                                    enabled = !busy,
                                    label = { Text(stringResource(R.string.language_english)) },
                                )
                            }
                            JodloSearchField(
                                value = categoryInput,
                                onValueChange = { categoryInput = it; invalidCategoryQuery = false },
                                label = { Text(stringResource(R.string.search_label)) },
                                modifier = Modifier.fillMaxWidth(),
                            )
                            if (invalidCategoryQuery) {
                                Text(stringResource(R.string.search_validation),
                                    color = MaterialTheme.colorScheme.error)
                            }
                            JodloButton(
                                onClick = { loadCategories(searchQuery = categoryInput.trim()) },
                                enabled = !busy,
                            ) { Text(stringResource(R.string.search_action)) }
                            JodloTextAction(onClick = { loadCategories() }, enabled = !busy) {
                                Text(stringResource(R.string.worker_choose_category))
                            }
                            if (categoryMode == WorkerCatalogMode.SEARCH && categoryLoaded) {
                                Text(stringResource(R.string.search_query_caption,
                                    submittedCategoryQuery.orEmpty()))
                            }
                        }
                        if (categoryLoaded && categoryRows.isEmpty() && !categoryFailed) item {
                            Text(stringResource(if (categoryMode == WorkerCatalogMode.BROWSE)
                                R.string.worker_category_empty_browse else R.string.worker_category_empty))
                        }
                        if (categoryFailed) item {
                            Text(stringResource(R.string.worker_category_page_failed),
                                color = MaterialTheme.colorScheme.error)
                            JodloTextAction(onClick = {
                                loadCategories(
                                    after = categoryCursor,
                                    searchQuery = if (categoryMode == WorkerCatalogMode.SEARCH)
                                        submittedCategoryQuery else null,
                                )
                            }, enabled = !busy) {
                                Text(stringResource(R.string.retry_action))
                            }
                        }
                        items(categoryRows, key = { "cat-" + it.id }) { category ->
                            JodloCard(
                                onClick = {
                                    if (canWrite) guided = guided.chooseCategory(
                                        category, categoryRows, session?.accountExportSessionMarker())
                                },
                                selected = guided.selectedCategory?.id == category.id,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(Modifier.padding(JodloSizes.CardPadding)) {
                                    Text(category.name)
                                    if (guided.selectedCategory?.id == category.id)
                                        Text(stringResource(R.string.worker_category_selected))
                                }
                            }
                        }
                        if (categoryCursor != null) item {
                            JodloTextAction(onClick = { loadCategories(categoryCursor) }, enabled = !busy) {
                                Text(stringResource(R.string.worker_load_more))
                            }
                        }
                        if (guided.selectedCategory != null) item {
                            JodloCard(modifier = Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(JodloSizes.CardPadding),
                                    verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                                    val chosen = guided.selectedCategory!!
                                    Text(stringResource(R.string.guided_post_step),
                                        style = MaterialTheme.typography.titleMedium)
                                    Text(chosen.name, style = MaterialTheme.typography.titleMedium)
                                    if (!guided.publishReviewOpen) {
                                        Text(stringResource(R.string.guided_post_before_review))
                                        JodloButton(
                                            onClick = {
                                                guided = guided.reviewPublication(
                                                    session?.accountExportSessionMarker())
                                            },
                                            enabled = canWrite,
                                        ) { Text(stringResource(R.string.guided_post_review)) }
                                    } else {
                                        Text(stringResource(R.string.guided_post_review_notice))
                                        Text(stringResource(R.string.guided_post_public_data))
                                        Row(horizontalArrangement = Arrangement.spacedBy(
                                            JodloSizes.SmallGap)) {
                                            JodloTextAction(
                                                onClick = {
                                                    guided = guided.cancelPublicationReview()
                                                },
                                                enabled = canWrite,
                                            ) { Text(stringResource(R.string.guided_post_back)) }
                                            JodloButton(
                                                onClick = {
                                                    val id = guided.categoryConfirmedForPublish(
                                                        session?.accountExportSessionMarker(),
                                                        categoryRows,
                                                    ) ?: return@JodloButton
                                                    mutate { writes.publishExplicitCategory(id) }
                                                },
                                                enabled = canWrite &&
                                                    guided.categoryConfirmedForPublish(
                                                        session?.accountExportSessionMarker(),
                                                        categoryRows,
                                                    ) != null,
                                            ) { Text(stringResource(R.string.worker_publish_selected)) }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                null -> { /* Already covered by SignedOut branch. */ }
            }
        }
        if (busy) item { CircularProgressIndicator() }
        if (message != 0) item {
            Text(stringResource(message), color = MaterialTheme.colorScheme.secondary)
        }
        item {
            Text(stringResource(if (session != null && BuildConfig.GOOGLE_WEB_CLIENT_ID.isNotBlank())
                R.string.worker_configured_notice else R.string.worker_dev_notice),
                style = MaterialTheme.typography.labelSmall)
        }
    }
}
