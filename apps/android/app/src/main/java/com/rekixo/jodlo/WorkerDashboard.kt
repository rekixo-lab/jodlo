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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.unit.dp
import com.rekixo.jodlo.core.network.ApiOutcome
import com.rekixo.jodlo.core.network.AccountPrivateReadMarker
import com.rekixo.jodlo.core.network.ApprovedCategoryNameSnapshot
import com.rekixo.jodlo.core.network.FailureKind
import com.rekixo.jodlo.core.network.GuidedWorkerServiceActions
import com.rekixo.jodlo.core.network.GuidedWorkerCategoryEdit
import com.rekixo.jodlo.core.network.HeadlessWorkerWriteScope
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.Language
import com.rekixo.jodlo.core.network.LoginState
import com.rekixo.jodlo.core.network.OwnListing
import com.rekixo.jodlo.core.network.WorkerOwnerUiFence
import com.rekixo.jodlo.core.network.OwnServiceLocalFilter
import com.rekixo.jodlo.core.network.OwnServiceLocalGroup
import com.rekixo.jodlo.core.network.OwnPublicationStatus
import com.rekixo.jodlo.core.network.PublicCategory
import com.rekixo.jodlo.core.network.RemoteCatalogRepository
import com.rekixo.jodlo.core.network.SessionFailure
import com.rekixo.jodlo.core.network.SessionResult
import com.rekixo.jodlo.core.network.VersionedOwnListing
import com.rekixo.jodlo.core.network.WorkerCustomerServicePreview
import com.rekixo.jodlo.core.network.WorkerCustomerServicePreviewPhase
import com.rekixo.jodlo.core.network.WorkerState
import com.rekixo.jodlo.core.network.WorkerExactObservation
import com.rekixo.jodlo.core.network.WorkerVisibility
import com.rekixo.jodlo.core.network.WorkerWriteAction
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
    // Owner rows are strictly scoped to the session AND write revision at
    // their last verified private read. Other owners must never inherit them.
    var ownListings by remember(session) { mutableStateOf<List<OwnListing>>(emptyList()) }
    var ownerRowsMarker by remember(session) {
        mutableStateOf<AccountPrivateReadMarker?>(null)
    }
    var observedAccountEpoch by remember(session) {
        mutableStateOf(session?.accountExportSessionMarker())
    }
    val currentOwnerMarker = session?.accountPrivateReadMarker()
    val displayedOwnListings = WorkerOwnerUiFence.visibleRows(
        ownerRowsMarker, currentOwnerMarker, ownListings,
    )
    // Loaded owner-row view only; no owner IDs, query or filter sent to API.
    var ownListQuery by remember(session) { mutableStateOf("") }
    var ownListGroup by remember(session) { mutableStateOf(OwnServiceLocalGroup.ALL) }
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
    var categoryEdit by remember(session) { mutableStateOf(GuidedWorkerCategoryEdit()) }
    var selectedListing by remember(session) { mutableStateOf<String?>(null) }
    // One explicit current-owner GET for the selected existing Service.
    // Not a worker public profile, revision token, or proof of a prior write.
    var exactObserved by remember(session) { mutableStateOf<OwnListing?>(null) }
    var exactObservationRevision by remember(session) { mutableIntStateOf(0) }
    var publicationReview by remember(session) {
        mutableStateOf<Pair<AccountPrivateReadMarker, VersionedOwnListing>?>(null)
    }
    // Public approved Category names are fetched only on an explicit user tap.
    // Keep the private owner/account generation separate from public names.
    var approvedNames by remember(session) {
        mutableStateOf<ApprovedCategoryNameSnapshot?>(null)
    }
    var approvedNamesMarker by remember(session) {
        mutableStateOf<AccountPrivateReadMarker?>(null)
    }
    var namesBusy by remember(session) { mutableStateOf(false) }
    var namesFailed by remember(session) { mutableStateOf(false) }
    var namesRevision by remember(session) { mutableIntStateOf(0) }
    val ownerCategoryIds = displayedOwnListings.map { it.categoryId }.distinct()
        .take(ApprovedCategoryNameSnapshot.MAX_IDS)

    var publicPreview by remember(session) {
        mutableStateOf(WorkerCustomerServicePreview.unchecked())
    }
    var previewRevision by remember(session) { mutableIntStateOf(0) }

    LaunchedEffect(displayedOwnListings, ownerRowsMarker, categoryLanguage, session) {
        namesRevision++
        approvedNames = null
        approvedNamesMarker = null
        namesBusy = false
        namesFailed = false
        previewRevision++
        publicPreview = WorkerCustomerServicePreview.unchecked()
    }

    var writeState by remember(session) {
        mutableStateOf(writes?.snapshot()?.state ?: WorkerWriteState.Idle)
    }

    val signedIn = login as? LoginState.SignedIn
    val uncertain = writeState is WorkerWriteState.NeedsReview
    val accountEpochCurrent = observedAccountEpoch == session?.accountExportSessionMarker()
    val canWrite = signedIn?.worker == WorkerState.DRAFT &&
        (session?.snapshot() as? LoginState.SignedIn)?.worker == WorkerState.DRAFT &&
        accountEpochCurrent && !busy && !uncertain

    fun clearExactObservation() {
        exactObservationRevision++
        exactObserved = null
        publicationReview = null
    }

    fun clearApprovedNames() {
        namesRevision++
        approvedNames = null
        approvedNamesMarker = null
        namesBusy = false
        namesFailed = false
    }

    fun loadApprovedNames() {
        val reader=catalog ?: return
        val accountMarker=session?.accountPrivateReadMarker() ?: return
        val ids=ownerCategoryIds
        if(ids.isEmpty() || namesBusy || busy || uncertain) return
        val lang=categoryLanguage
        val generation=++namesRevision
        namesBusy=true
        namesFailed=false
        approvedNames=null
        approvedNamesMarker=null
        scope.launch {
            val result: ApiOutcome<List<PublicCategory>> = withContext(Dispatchers.IO) {
                try {
                    val gathered=mutableListOf<PublicCategory>()
                    var problem: ApiOutcome.Failed?=null
                    for(batch in ids.chunked(20)) {
                        when(val reply=reader.approvedNames(batch,lang)) {
                            is ApiOutcome.Ok -> gathered.addAll(reply.value)
                            is ApiOutcome.Failed -> {problem=reply;break}
                        }
                    }
                    problem ?: ApiOutcome.Ok(gathered)
                } catch (cancelled: kotlin.coroutines.cancellation.CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    ApiOutcome.Failed(FailureKind.BAD_RESPONSE,false)
                }
            }
            if(namesRevision!=generation ||
                session?.accountPrivateReadMarker()!=accountMarker) return@launch
            namesBusy=false
            when(result) {
                is ApiOutcome.Failed -> namesFailed=true
                is ApiOutcome.Ok -> {
                    approvedNames=ApprovedCategoryNameSnapshot.fromApprovedRows(ids,lang,result.value)
                    approvedNamesMarker=accountMarker
                    namesFailed=approvedNames==null
                }
            }
        }
    }

    fun nameForOwnCategory(categoryId:String): String? =
        if(approvedNamesMarker!=null &&
            approvedNamesMarker==session?.accountPrivateReadMarker())
            approvedNames?.approvedName(categoryId,categoryLanguage,ownerCategoryIds)
        else null

    fun clearCategoryResults() {
        clearExactObservation()
        categoryRows = emptyList()
        categoryCursor = null
        categoryPageGeneration += 1
        guided = guided.clearPublication().cancelResume()
        categoryEdit = categoryEdit.invalidateCategory()
        categoryLoaded = false
        categoryFailed = false
        invalidCategoryQuery = false
        submittedCategoryQuery = null
        categoryMode = WorkerCatalogMode.BROWSE
    }

    fun updateSession() {
        val nextEpoch=session?.accountExportSessionMarker()
        val changedActor=nextEpoch!=observedAccountEpoch
        observedAccountEpoch=nextEpoch
        login = session?.snapshot() ?: LoginState.SignedOut
        writeState = writes?.snapshot()?.state ?: WorkerWriteState.Idle
        val staleOwnerRows=ownerRowsMarker!=null &&
            ownerRowsMarker!=session?.accountPrivateReadMarker()
        if (changedActor || login is LoginState.SignedOut || staleOwnerRows) {
            ownListQuery = ""
            ownListGroup = OwnServiceLocalGroup.ALL
            ownListings = emptyList()
            ownerRowsMarker = null
            ownerCursor = null
            clearApprovedNames()
            clearExactObservation()
            selectedListing = null
            previewRevision++
            publicPreview = WorkerCustomerServicePreview.unchecked()
            guided = guided.reset()
            categoryEdit = categoryEdit.reset()
            clearCategoryResults()
        }
    }

    // Account changes on another screen, document-picker return or an
    // expired in-memory session cannot leave stale Worker data displayed.
    // ON_RESUME is local only; no background poll, HTTP or auto-write.
    val onResume by rememberUpdatedState(newValue = { updateSession() })
    DisposableEffect(activity, session) {
        val observer=LifecycleEventObserver { _, event ->
            if(event==Lifecycle.Event.ON_RESUME) onResume()
        }
        activity.lifecycle.addObserver(observer)
        onDispose { activity.lifecycle.removeObserver(observer) }
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
        if (session == null || busy || uncertain || !accountEpochCurrent ||
            (session.snapshot() as? LoginState.SignedIn)?.worker != WorkerState.DRAFT) return
        val accountMarker = session.accountPrivateReadMarker() ?: return
        if (after!=null && (after!=ownerCursor || ownerRowsMarker!=accountMarker)) return
        if (after==null) {
            ownListings=emptyList()
            ownerRowsMarker=null
            ownerCursor=null
            selectedListing=null
        }
        busy = true
        message = 0
        previewRevision++
        publicPreview = WorkerCustomerServicePreview.unchecked() // Owner status is NOT a public read.
        clearExactObservation()
        clearApprovedNames()
        guided = guided.cancelUnpublish().cancelResume()
        categoryEdit = categoryEdit.reset()
        scope.launch {
            val reply = try {
                withContext(Dispatchers.IO) { session.pageManagedOwnListings(20, after) }
            } catch (_: Exception) { null }
            busy = false
            updateSession()
            if (session.accountPrivateReadMarker() != accountMarker ||
                observedAccountEpoch != accountMarker.sessionGeneration) return@launch
            when (reply) {
                is SessionResult.Success -> {
                    ownListings = if (after == null) reply.value.listings
                        else (displayedOwnListings + reply.value.listings).distinctBy { it.id }
                    ownerRowsMarker=accountMarker
                    ownerCursor = reply.value.nextCursor
                    if(selectedListing != null &&
                        ownListings.none { it.id == selectedListing }) {
                        selectedListing = null
                    }
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
        val accountMarker = session?.accountPrivateReadMarker() ?: return
        val pageGeneration = ++categoryPageGeneration
        invalidCategoryQuery = false
        busy = true
        message = 0
        if (after == null) {
            categoryRows = emptyList()
            categoryCursor = null
            guided = guided.clearPublication().cancelResume()
            categoryEdit = categoryEdit.invalidateCategory()
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
                session?.accountPrivateReadMarker() != accountMarker) return@launch
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
            ownerRowsMarker = null
            ownerCursor = null
            clearApprovedNames()
            clearExactObservation()
            selectedListing = null
            guided = guided.reset()
            categoryEdit = categoryEdit.reset()
            previewRevision++
            publicPreview = WorkerCustomerServicePreview.unchecked()

            val rejected = writeState as? WorkerWriteState.Rejected
            val conflict = rejected?.networkKind == FailureKind.CONFLICT
            // Confirmed changes and definite conflicts can both leave the
            // previous owner page out of date. Refresh by read only.
            if ((writeState is WorkerWriteState.Confirmed || conflict) &&
                login is LoginState.SignedIn && session != null) {
                val freshMarker=session.accountPrivateReadMarker()
                val fresh = try {
                    withContext(Dispatchers.IO) { session.pageManagedOwnListings(20) }
                } catch (_: Exception) { null }
                if (fresh is SessionResult.Success && freshMarker!=null &&
                    freshMarker==session.accountPrivateReadMarker() &&
                    observedAccountEpoch==freshMarker.sessionGeneration) {
                    ownListings = fresh.value.listings
                    ownerRowsMarker = freshMarker
                    ownerCursor = fresh.value.nextCursor
                }
            }
            busy = false
            message = when (writeState) {
                is WorkerWriteState.Confirmed -> R.string.worker_write_confirmed
                is WorkerWriteState.NeedsReview -> R.string.worker_uncertain_write
                is WorkerWriteState.Rejected -> if (conflict) {
                    when (rejected?.action) {
                        is WorkerWriteAction.Publish -> R.string.worker_create_conflict
                        is WorkerWriteAction.Resume, is WorkerWriteAction.Unpublish ->
                            R.string.worker_publication_conflict
                        else -> R.string.worker_edit_conflict
                    }
                } else R.string.worker_operation_failed
                else -> R.string.worker_operation_failed
            }
        }
    }


    /** Read the selected owner's current revision before opening a review. */
    fun beginVersionedReview(publication: Boolean = false) {
        val active = session ?: return
        val original = displayedOwnListings.firstOrNull { it.id == selectedListing } ?: return
        val actor = active.accountExportSessionMarker() ?: return
        val readMarker = active.accountPrivateReadMarker() ?: return
        if(ownerRowsMarker != readMarker) return
        if (busy || uncertain ||
            (active.snapshot() as? LoginState.SignedIn)?.worker != WorkerState.DRAFT) return
        clearExactObservation()
        val requestRevision = exactObservationRevision
        categoryEdit = categoryEdit.reset()
        guided = guided.clearPublication().cancelUnpublish().cancelResume()
        val failedMessage = if (publication) R.string.worker_publication_revision_failed
            else R.string.worker_revision_failed
        previewRevision++
        publicPreview = WorkerCustomerServicePreview.unchecked()
        busy=true
        message=0
        scope.launch {
            val snapshot: SessionResult<VersionedOwnListing> =
                try {
                    withContext(Dispatchers.IO) {
                        active.exactVersionedOwnListing(original.id)
                    }
                } catch (cancelled:kotlin.coroutines.cancellation.CancellationException) {
                    throw cancelled
                } catch (_:Exception) {
                    SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.BAD_RESPONSE)
                }
            busy=false
            if (requestRevision != exactObservationRevision ||
                active.accountExportSessionMarker() != actor ||
                active.accountPrivateReadMarker()!=readMarker ||
                ownerRowsMarker!=readMarker ||
                (active.snapshot() as? LoginState.SignedIn)?.worker != WorkerState.DRAFT ||
                selectedListing != original.id ||
                ownListings.firstOrNull { it.id == original.id } != original ||
                writes?.snapshot()?.state is WorkerWriteState.NeedsReview) return@launch
            when(snapshot) {
                is SessionResult.Success -> {
                    val row=snapshot.value.row
                    if(row.id!=original.id) {
                        message = failedMessage
                    } else if(row!=original) {
                        // Another device may have changed Category/status.
                        // Update only the selected local row and REQUIRE the
                        // Worker to begin a NEW review from the fresh state.
                        ownListings=ownListings.map { if(it.id==row.id) row else it }
                        message=R.string.worker_revision_changed
                    } else if (publication) {
                        if (snapshot.value.revision !in 0..2147483646L) {
                            message = failedMessage
                        } else {
                            publicationReview = readMarker to snapshot.value
                            guided = when (row.publicationStatus) {
                                OwnPublicationStatus.PUBLISHED -> guided.reviewUnpublish(row, ownListings, actor)
                                OwnPublicationStatus.UNPUBLISHED -> guided.beginResume(row, ownListings, actor)
                                null -> guided
                            }
                        }
                    } else {
                        categoryEdit=categoryEdit.beginVersioned(
                            snapshot.value,ownListings,actor)
                        message=R.string.worker_revision_ready
                    }
                }
                is SessionResult.Failed -> {
                    if(snapshot.networkKind==FailureKind.NOT_FOUND) {
                        ownListings=ownListings.filterNot { it.id==original.id }
                        selectedListing=null
                        message=R.string.worker_exact_missing
                    } else message = failedMessage
                }
            }
        }
    }

    fun confirmedPublication(row: OwnListing): Pair<AccountPrivateReadMarker, VersionedOwnListing>? =
        publicationReview?.takeIf { (marker, review) ->
            canWrite && review.row == row && row.id == selectedListing &&
                row in displayedOwnListings && marker == session?.accountPrivateReadMarker()
        }

    /** One user-requested authenticated status read of EXACTLY the selected
     * owner Service. Replaces a stale local row only after session/selection
     * checks. Never calls a mutation or assumes a previous write committed.
     * A preexisting server without the opt-in endpoint remains an honest
     * read failure; the original owner-page/editor controls still exist.
     */
    fun refreshSelectedService() {
        val liveSession = session ?: return
        val chosen = displayedOwnListings.firstOrNull { it.id == selectedListing } ?: return
        val actor = liveSession.accountPrivateReadMarker() ?: return
        if(ownerRowsMarker != actor) return
        if (busy || uncertain ||
            (liveSession.snapshot() as? LoginState.SignedIn)?.worker != WorkerState.DRAFT) return
        clearExactObservation()
        val callRevision = exactObservationRevision
        guided = guided.cancelUnpublish().cancelResume()
        categoryEdit = categoryEdit.reset()
        previewRevision++
        publicPreview = WorkerCustomerServicePreview.unchecked()
        busy = true
        message = 0
        scope.launch {
            val result: SessionResult<OwnListing> = try {
                withContext(Dispatchers.IO) {
                    liveSession.exactManagedOwnListing(chosen.id)
                }
            } catch (cancelled: kotlin.coroutines.cancellation.CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.BAD_RESPONSE)
            }
            busy = false
            if (exactObservationRevision != callRevision ||
                liveSession.accountPrivateReadMarker() != actor ||
                ownerRowsMarker!=actor ||
                (liveSession.snapshot() as? LoginState.SignedIn)?.worker != WorkerState.DRAFT ||
                selectedListing != chosen.id ||
                ownListings.firstOrNull { it.id == chosen.id } != chosen ||
                writes?.snapshot()?.state is WorkerWriteState.NeedsReview) return@launch
            when (result) {
                is SessionResult.Success -> {
                    if (result.value.id != chosen.id) {
                        message = R.string.worker_exact_failed
                    } else {
                        ownListings = ownListings.map {
                            if (it.id == chosen.id) result.value else it
                        }
                        exactObserved = result.value
                        message = if (chosen == result.value)
                            R.string.worker_exact_current else R.string.worker_exact_changed
                    }
                }
                is SessionResult.Failed -> {
                    if (result.networkKind == FailureKind.NOT_FOUND) {
                        ownListings = ownListings.filterNot { it.id == chosen.id }
                        selectedListing = null
                        message = R.string.worker_exact_missing
                    } else message = R.string.worker_exact_failed
                }
            }
        }
    }

    /** Fresh anonymous Customer Service detail, identical to Customer's
     * approved-category data. A stale owner/login/language/list change
     * can never certify an older public view.
     */
    fun checkPublicPreview() {
        val chosen=displayedOwnListings.firstOrNull { it.id==selectedListing } ?: return
        val activeSession=session ?: return
        val actor=activeSession.accountPrivateReadMarker() ?: return
        if(ownerRowsMarker!=actor) return
        val reader=catalog ?: return
        if(busy || uncertain ||
            (activeSession.snapshot() as? LoginState.SignedIn)?.worker!=WorkerState.DRAFT) return
        val lang=categoryLanguage
        val generation=++previewRevision
        publicPreview=WorkerCustomerServicePreview.unchecked()
        busy=true
        message=0
        scope.launch {
            val reply:ApiOutcome<com.rekixo.jodlo.core.network.PublicApprovedServiceDetail> =
                try {
                    withContext(Dispatchers.IO) {
                        reader.approvedServiceDetail(chosen.id,chosen.categoryId,lang)
                    }
                } catch (cancelled:kotlin.coroutines.cancellation.CancellationException) {
                    throw cancelled
                } catch (_:Exception) {
                    ApiOutcome.Failed(FailureKind.BAD_RESPONSE,false)
                }
            busy=false
            if(generation!=previewRevision ||
                activeSession.accountPrivateReadMarker()!=actor ||
                ownerRowsMarker!=actor ||
                (activeSession.snapshot() as? LoginState.SignedIn)?.worker!=WorkerState.DRAFT ||
                selectedListing!=chosen.id || categoryLanguage!=lang ||
                ownListings.firstOrNull{it.id==chosen.id}!=chosen) return@launch
            publicPreview=WorkerCustomerServicePreview.fromPublicRead(chosen,lang,reply)
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
        } else if (login is LoginState.SignedOut ||
            session.snapshot() is LoginState.SignedOut) {
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
        } else if (!accountEpochCurrent) {
            item {
                Text(stringResource(R.string.worker_private_session_changed),
                    color=MaterialTheme.colorScheme.error)
                JodloTextAction(onClick={updateSession()},enabled=!busy) {
                    Text(stringResource(R.string.worker_refresh_account_session))
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
                            categoryEdit = categoryEdit.reset()
                            selectedListing = null
                            previewRevision++
                            publicPreview = WorkerCustomerServicePreview.unchecked()
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
                            val review = writeState as WorkerWriteState.NeedsReview
                            Text(
                                stringResource(R.string.worker_uncertain_write),
                                color = MaterialTheme.colorScheme.error,
                            )
                            val actionLabel = when(review.action) {
                                is WorkerWriteAction.Publish -> R.string.worker_uncertain_action_publish
                                is WorkerWriteAction.Unpublish -> R.string.worker_uncertain_action_pause
                                is WorkerWriteAction.Resume -> R.string.worker_uncertain_action_resume
                                is WorkerWriteAction.EditCategory,
                                is WorkerWriteAction.VersionedCategoryEdit ->
                                    R.string.worker_uncertain_action_edit
                            }
                            Text(stringResource(R.string.worker_uncertain_action, stringResource(actionLabel)))
                            // Exact owner status is PRIVATE and independent of the
                            // lost write acknowledgement. Never infer causality.
                            when(val exact = review.exactObservation) {
                                is WorkerExactObservation.Current -> {
                                    Text(stringResource(R.string.worker_uncertain_exact_category,
                                        exact.categoryId))
                                    Text(stringResource(when(exact.publicationStatus) {
                                        OwnPublicationStatus.PUBLISHED ->
                                            R.string.worker_management_published
                                        OwnPublicationStatus.UNPUBLISHED ->
                                            R.string.worker_management_paused
                                        null -> R.string.worker_management_unknown
                                    }))
                                    Text(stringResource(if(exact.visible)
                                        R.string.worker_visible else R.string.worker_not_visible))
                                }
                                WorkerExactObservation.NotFound ->
                                    Text(stringResource(R.string.worker_uncertain_exact_missing))
                                null -> { /* Not checked yet, or failed to check. */ }
                            }
                            if (review.readFailure != null) {
                                Text(stringResource(R.string.worker_uncertain_read_failed),
                                    color = MaterialTheme.colorScheme.error)
                            }
                            if (review.pagedPagesChecked > 0) {
                                Text(stringResource(R.string.worker_uncertain_pages_checked,
                                    review.pagedPagesChecked))
                                val observation = when(review.observation) {
                                    WorkerVisibility.VISIBLE -> R.string.worker_uncertain_page_visible
                                    WorkerVisibility.NOT_VISIBLE ->
                                        R.string.worker_uncertain_page_not_visible
                                    WorkerVisibility.NOT_IN_FIRST_100,
                                    WorkerVisibility.NOT_OBSERVED_IN_PAGED_SCAN ->
                                        R.string.worker_uncertain_page_not_observed
                                    null -> R.string.worker_uncertain_read_failed
                                }
                                Text(stringResource(observation))
                                Text(stringResource(if(review.pagedScanComplete)
                                    R.string.worker_uncertain_scan_ended
                                    else R.string.worker_uncertain_scan_more))
                            }
                            Text(stringResource(R.string.worker_recheck_not_proof),
                                style = MaterialTheme.typography.bodySmall)
                            if (review.action.supportsExactRead()) {
                                JodloTextAction(onClick = {
                                    if (busy) return@JodloTextAction
                                    busy = true
                                    scope.launch {
                                        try {
                                            withContext(Dispatchers.IO) {
                                                writes.recheckUncertainListingExactly()
                                            }
                                        } catch (_: Exception) { /* no write retry */ }
                                        writeState = writes.snapshot().state
                                        busy = false
                                        message = R.string.worker_recheck_not_proof
                                    }
                                }, enabled = !busy) {
                                    Text(stringResource(R.string.worker_uncertain_exact_check))
                                }
                            }
                            JodloTextAction(onClick = {
                                if (busy) return@JodloTextAction
                                busy = true
                                scope.launch {
                                    try {
                                        withContext(Dispatchers.IO) { writes.recheckOwnListingsPage() }
                                    } catch (_: Exception) { /* no retry */ }
                                    writeState = writes.snapshot().state
                                    busy = false
                                    message = R.string.worker_recheck_not_proof
                                }
                            }, enabled = !busy) {
                                Text(stringResource(R.string.worker_recheck_read_only))
                            }
                            JodloTextAction(onClick = {
                                if (writes.acknowledgeUncertainty()) {
                                    writeState = writes.snapshot().state
                                    message = R.string.worker_review_acknowledged
                                }
                            }, enabled = !busy) {
                                Text(stringResource(R.string.worker_acknowledge_uncertainty))
                            }
                        }
                    } else {
                        // A status filter is a snapshot of loaded PRIVATE owner
                        // rows only. It must not hide the selected management
                        // controls nor imply current Customer public visibility.
                        val localOwn = OwnServiceLocalFilter.apply(
                            displayedOwnListings, ownListQuery, ownListGroup,
                        ) { categoryId -> nameForOwnCategory(categoryId) }
                        item {
                            Text(stringResource(R.string.worker_my_listings), style = MaterialTheme.typography.titleMedium)
                            Text(stringResource(R.string.worker_management_private_notice),
                                style = MaterialTheme.typography.bodySmall)
                            JodloTextAction(onClick = { loadOwnPage() }, enabled = !busy) {
                                Text(stringResource(R.string.worker_refresh_listings))
                            }
                            if (displayedOwnListings.isNotEmpty()) {
                                JodloSearchField(
                                    value=ownListQuery,
                                    onValueChange={
                                        if (it.codePointCount(0,it.length)<=64) ownListQuery=it
                                    },
                                    label={Text(stringResource(R.string.worker_own_find))},
                                    modifier=Modifier.fillMaxWidth(),
                                )
                                // Keep full-width touch targets: Hindi status labels
                                // must not be clipped by a narrow two-chip row.
                                Column(verticalArrangement=Arrangement.spacedBy(JodloSizes.SmallGap)) {
                                    JodloChip(selected=ownListGroup==OwnServiceLocalGroup.ALL,
                                        onClick={ownListGroup=OwnServiceLocalGroup.ALL},
                                        modifier=Modifier.fillMaxWidth(),
                                        label={Text(stringResource(R.string.worker_own_all))})
                                    JodloChip(
                                        selected=ownListGroup==OwnServiceLocalGroup.OWNER_READ_VISIBLE,
                                        onClick={ownListGroup=OwnServiceLocalGroup.OWNER_READ_VISIBLE},
                                        modifier=Modifier.fillMaxWidth(),
                                        label={Text(stringResource(R.string.worker_own_owner_visible))})
                                    JodloChip(selected=ownListGroup==OwnServiceLocalGroup.PAUSED,
                                        onClick={ownListGroup=OwnServiceLocalGroup.PAUSED},
                                        modifier=Modifier.fillMaxWidth(),
                                        label={Text(stringResource(R.string.worker_own_paused))})
                                    JodloChip(
                                        selected=ownListGroup==OwnServiceLocalGroup.PUBLISHED_NOT_VISIBLE,
                                        onClick={ownListGroup=OwnServiceLocalGroup.PUBLISHED_NOT_VISIBLE},
                                        modifier=Modifier.fillMaxWidth(),
                                        label={Text(stringResource(R.string.worker_own_published_hidden))})
                                }
                                Text(stringResource(R.string.worker_own_local_count,
                                    localOwn.size,displayedOwnListings.size),
                                    style=MaterialTheme.typography.bodySmall)
                                Text(stringResource(R.string.worker_own_local_scope),
                                    style=MaterialTheme.typography.bodySmall)
                                if(ownerCursor!=null)
                                    Text(stringResource(R.string.worker_own_load_more_scope),
                                        style=MaterialTheme.typography.bodySmall)
                                if(localOwn.isEmpty())
                                    Text(stringResource(R.string.worker_own_local_empty),
                                        style=MaterialTheme.typography.bodySmall)
                                JodloTextAction(onClick = { loadApprovedNames() },
                                    enabled = !busy && !namesBusy) {
                                    Text(stringResource(R.string.category_label_lookup_action))
                                }
                                Text(stringResource(R.string.category_label_lookup_privacy),
                                    style = MaterialTheme.typography.bodySmall)
                                if (ownerCategoryIds.size <
                                    displayedOwnListings.map { it.categoryId }.distinct().size) {
                                    Text(stringResource(R.string.category_label_lookup_limited),
                                        style = MaterialTheme.typography.bodySmall)
                                }
                                if (namesBusy) CircularProgressIndicator()
                                if (namesFailed) Text(
                                    stringResource(R.string.category_label_lookup_failed),
                                    color=MaterialTheme.colorScheme.error)
                            }
                        }
                        items(localOwn, key = { "own-" + it.id }) { listing ->
                            JodloCard(
                                onClick = {
                                    if (!busy) {
                                        selectedListing = listing.id
                                        clearExactObservation()
                                        guided = guided.cancelUnpublish().cancelResume()
                                        categoryEdit = categoryEdit.reset()
                                        previewRevision++
                                        publicPreview = WorkerCustomerServicePreview.unchecked()
                                    }
                                },
                                selected = selectedListing == listing.id,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(Modifier.padding(JodloSizes.CardPadding)) {
                                    val approvedName=nameForOwnCategory(listing.categoryId)
                                    if(approvedName!=null) Text(approvedName,
                                        style=MaterialTheme.typography.titleMedium)
                                    Text(stringResource(R.string.listing_reference, listing.id))
                                    Text(stringResource(R.string.worker_listing_category, listing.categoryId))
                                    Text(stringResource(when(listing.publicationStatus) {
                                        OwnPublicationStatus.PUBLISHED ->
                                            R.string.worker_management_published
                                        OwnPublicationStatus.UNPUBLISHED ->
                                            R.string.worker_management_paused
                                        null -> R.string.worker_management_unknown
                                    }))
                                    Text(stringResource(if (listing.visible)
                                        R.string.worker_visible else R.string.worker_not_visible))
                                    if (listing.publicationStatus == OwnPublicationStatus.PUBLISHED &&
                                        !listing.visible) {
                                        Text(stringResource(R.string.worker_management_not_public),
                                            color = MaterialTheme.colorScheme.error)
                                    }
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
                        if (selectedListing != null && displayedOwnListings.any {
                            it.id == selectedListing
                        }) item {
                            JodloCard(modifier = Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(JodloSizes.CardPadding),
                                    verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                                    Text(stringResource(R.string.worker_customer_preview_heading),
                                        style = MaterialTheme.typography.titleMedium)
                                    Text(stringResource(R.string.worker_customer_preview_explainer))
                                    Row(horizontalArrangement=Arrangement.spacedBy(JodloSizes.SmallGap)) {
                                        JodloChip(
                                            selected=categoryLanguage==Language.HI,
                                            onClick={
                                                if(categoryLanguage!=Language.HI) {
                                                    categoryLanguage=Language.HI
                                                    clearCategoryResults()
                                                }
                                            },
                                            enabled=!busy,
                                            label={Text(stringResource(R.string.language_hindi))},
                                        )
                                        JodloChip(
                                            selected=categoryLanguage==Language.EN,
                                            onClick={
                                                if(categoryLanguage!=Language.EN) {
                                                    categoryLanguage=Language.EN
                                                    clearCategoryResults()
                                                }
                                            },
                                            enabled=!busy,
                                            label={Text(stringResource(R.string.language_english))},
                                        )
                                    }
                                    JodloTextAction(
                                        onClick = { refreshSelectedService() },
                                        enabled = !busy,
                                    ) {
                                        Text(stringResource(R.string.worker_exact_read_action))
                                    }
                                    if (exactObserved?.id == selectedListing) {
                                        Text(stringResource(R.string.worker_exact_notice),
                                            style = MaterialTheme.typography.bodySmall)
                                    }
                                    JodloTextAction(
                                        onClick = { checkPublicPreview() },
                                        enabled = !busy,
                                    ) {
                                        Text(stringResource(R.string.worker_customer_preview_check))
                                    }
                                    when(publicPreview.phase) {
                                        WorkerCustomerServicePreviewPhase.PUBLIC_WHEN_CHECKED -> {
                                            Text(publicPreview.approvedCategoryName.orEmpty(),
                                                style=MaterialTheme.typography.titleMedium)
                                            Text(stringResource(
                                                R.string.worker_customer_preview_approved_label))
                                            val row=displayedOwnListings.firstOrNull{it.id==selectedListing}
                                            if(row!=null){
                                                Text(stringResource(R.string.listing_reference,row.id))
                                                Text(stringResource(R.string.worker_listing_category,row.categoryId))
                                            }
                                            Text(stringResource(R.string.worker_customer_preview_visible))
                                            Text(stringResource(R.string.listing_detail_private_notice),
                                                style=MaterialTheme.typography.bodySmall)
                                        }
                                        WorkerCustomerServicePreviewPhase.NOT_PUBLIC_WHEN_CHECKED ->
                                            Text(stringResource(R.string.worker_customer_preview_not_public))
                                        WorkerCustomerServicePreviewPhase.CANNOT_CONFIRM ->
                                            Text(stringResource(R.string.worker_customer_preview_failed),
                                                color=MaterialTheme.colorScheme.error)
                                        WorkerCustomerServicePreviewPhase.UNCHECKED -> {
                                            /* Owner status never certifies Customer visibility. */
                                        }
                                    }
                                    JodloTextAction(
                                        onClick = {
                                            beginVersionedReview()
                                        },
                                        enabled = canWrite,
                                    ) { Text(stringResource(R.string.worker_edit_category)) }
                                    // 'visible=false' means only that the
                                    // current owner page cannot certify
                                    // public eligibility. It may be paused,
                                    // moderated or attached to inactive work.
                                    // Reactivation is never inferred here:
                                    // only an exact paused CAS on the server
                                    // can succeed.
                                    val currentOwnRow = displayedOwnListings.firstOrNull {
                                        it.id == selectedListing
                                    }
                                    if (currentOwnRow != null) {
                                        WorkerServiceAreaEditor(session, currentOwnRow.id, enabled = canWrite) { confirmed ->
                                            loadOwnPage()
                                            message = if (confirmed) R.string.worker_area_saved else R.string.worker_area_failed
                                        }
                                        WorkerServiceDetailsEditor(session, currentOwnRow.id, enabled = canWrite) { notice ->
                                            loadOwnPage()
                                            message = notice
                                        }
                                        WorkerServicePhotoEditor(activity, session, currentOwnRow.id, enabled = canWrite) { notice ->
                                            loadOwnPage()
                                            message = notice
                                        }
                                        WorkerServiceAppealControls(session, currentOwnRow.id, enabled = canWrite) { confirmed ->
                                            loadOwnPage()
                                            message = if (confirmed) R.string.case_worker_appealed else R.string.case_request_failed
                                        }
                                    }
                                    if (currentOwnRow?.publicationStatus == OwnPublicationStatus.PUBLISHED) {
                                        if (guided.pendingUnpublishId != selectedListing) {
                                            JodloTextAction(
                                                onClick = {
                                                    beginVersionedReview(publication = true)
                                                }, enabled = canWrite,
                                            ) {
                                                Text(stringResource(R.string.guided_unpublish_review))
                                            }
                                        } else {
                                            Text(stringResource(R.string.guided_unpublish_warning),
                                                color = MaterialTheme.colorScheme.error)
                                            Row(horizontalArrangement = Arrangement.spacedBy(
                                                JodloSizes.SmallGap)) {
                                                JodloTextAction(onClick = {
                                                    publicationReview = null
                                                    guided = guided.cancelUnpublish()
                                                }, enabled = canWrite) {
                                                    Text(stringResource(R.string.guided_post_back))
                                                }
                                                JodloButton(onClick = {
                                                    if (guided.pendingUnpublishId != currentOwnRow.id) return@JodloButton
                                                    val (marker, review) = confirmedPublication(currentOwnRow)
                                                        ?: return@JodloButton
                                                    mutate { writes.changePublication(review, marker) }
                                                }, enabled = confirmedPublication(currentOwnRow) != null) {
                                                    Text(stringResource(R.string.worker_unpublish_selected))
                                                }
                                            }
                                        }
                                    } else if (currentOwnRow?.publicationStatus == OwnPublicationStatus.UNPUBLISHED) {
                                        if (guided.pendingResume?.id != currentOwnRow.id) {
                                            JodloTextAction(onClick = {
                                                beginVersionedReview(publication = true)
                                            }, enabled = canWrite) {
                                                Text(stringResource(R.string.worker_resume_review_action))
                                            }
                                        } else {
                                            Text(stringResource(R.string.worker_resume_warning),
                                                color = MaterialTheme.colorScheme.error)
                                            Text(stringResource(R.string.worker_resume_category,
                                                nameForOwnCategory(currentOwnRow.categoryId)
                                                    ?: currentOwnRow.categoryId))
                                            if (!guided.resumeReviewOpen) {
                                                JodloButton(onClick = {
                                                    guided = guided.reviewResume(
                                                        session?.accountExportSessionMarker(),
                                                    )
                                                }, enabled = canWrite) {
                                                    Text(stringResource(R.string.worker_resume_final_review))
                                                }
                                            } else {
                                                Text(stringResource(R.string.worker_resume_final_warning),
                                                    color = MaterialTheme.colorScheme.error)
                                                JodloButton(onClick = {
                                                    if (guided.resumeConfirmed(
                                                            session?.accountExportSessionMarker(),
                                                            displayedOwnListings,
                                                        ) == null) return@JodloButton
                                                    val (marker, review) = confirmedPublication(currentOwnRow)
                                                        ?: return@JodloButton
                                                    mutate { writes.changePublication(review, marker) }
                                                }, enabled = confirmedPublication(currentOwnRow) != null) {
                                                    Text(stringResource(R.string.worker_resume_confirm))
                                                }
                                            }
                                            JodloTextAction(onClick = {
                                                publicationReview = null
                                                guided = guided.cancelResume()
                                            }, enabled = !busy) {
                                                Text(stringResource(R.string.worker_resume_cancel))
                                            }
                                        }
                                    }
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
                                    if (!canWrite) return@JodloCard
                                    if (categoryEdit.source != null) {
                                        categoryEdit = categoryEdit.chooseDestination(
                                            category, categoryRows,
                                            session?.accountExportSessionMarker())
                                    } else {
                                        guided = guided.cancelResume().chooseCategory(
                                            category, categoryRows,
                                            session?.accountExportSessionMarker())
                                    }
                                },
                                selected = if (categoryEdit.source != null)
                                    categoryEdit.destination?.id == category.id
                                else guided.selectedCategory?.id == category.id,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(Modifier.padding(JodloSizes.CardPadding)) {
                                    Text(category.name)
                                    if (guided.selectedCategory?.id == category.id ||
                                        categoryEdit.destination?.id == category.id)
                                        Text(stringResource(R.string.worker_category_selected))
                                }
                            }
                        }
                        if (categoryCursor != null) item {
                            JodloTextAction(onClick = { loadCategories(categoryCursor) }, enabled = !busy) {
                                Text(stringResource(R.string.worker_load_more))
                            }
                        }
                        if (categoryEdit.source != null) item {
                            JodloCard(modifier = Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(JodloSizes.CardPadding),
                                    verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                                    Text(stringResource(R.string.worker_edit_heading),
                                        style = MaterialTheme.typography.titleMedium)
                                    Text(stringResource(R.string.worker_edit_existing_category,
                                        nameForOwnCategory(categoryEdit.source!!.categoryId)
                                            ?: categoryEdit.source!!.categoryId))
                                    Text(stringResource(R.string.worker_edit_description))
                                    Text(stringResource(R.string.worker_edit_revision_notice),
                                        style=MaterialTheme.typography.bodySmall)
                                    val next = categoryEdit.destination
                                    if (next == null) {
                                        Text(stringResource(R.string.worker_editor_step_choose),
                                            style = MaterialTheme.typography.titleSmall)
                                        Text(stringResource(R.string.worker_edit_choose_category))
                                    } else {
                                        val alreadyOwned = displayedOwnListings.any {
                                            it.id != categoryEdit.source?.id &&
                                                it.categoryId == next.id
                                        }
                                        Text(stringResource(R.string.worker_edit_new_category,
                                            next.name))
                                        if (alreadyOwned) {
                                            Text(stringResource(R.string.worker_editor_duplicate),
                                                color = MaterialTheme.colorScheme.error)
                                        }
                                        when {
                                            !categoryEdit.scopeReviewOpen -> {
                                                Text(stringResource(R.string.worker_editor_step_scope),
                                                    style = MaterialTheme.typography.titleSmall)
                                                Text(stringResource(
                                                    R.string.worker_editor_scope_intro))
                                                JodloButton(onClick = {
                                                    categoryEdit = categoryEdit.reviewScope(
                                                        session?.accountExportSessionMarker(),
                                                        categoryRows, displayedOwnListings)
                                                }, enabled = canWrite && !alreadyOwned) {
                                                    Text(stringResource(
                                                        R.string.worker_editor_review_scope))
                                                }
                                            }
                                            !categoryEdit.reviewOpen -> {
                                                Text(stringResource(R.string.worker_editor_step_final),
                                                    style = MaterialTheme.typography.titleSmall)
                                                Text(stringResource(
                                                    R.string.worker_editor_scope_public))
                                                Text(stringResource(
                                                    R.string.worker_editor_scope_locked))
                                                Text(stringResource(
                                                    R.string.worker_edit_revision_notice),
                                                    style = MaterialTheme.typography.bodySmall)
                                                JodloTextAction(onClick = {
                                                    categoryEdit = categoryEdit.invalidateCategory()
                                                }, enabled = canWrite) {
                                                    Text(stringResource(R.string.guided_post_back))
                                                }
                                                JodloButton(onClick = {
                                                    categoryEdit = categoryEdit.review(
                                                        session?.accountExportSessionMarker())
                                                }, enabled = canWrite && !alreadyOwned) {
                                                    Text(stringResource(R.string.worker_edit_review))
                                                }
                                            }
                                            else -> {
                                                Text(stringResource(
                                                    R.string.worker_editor_step_confirm),
                                                    style = MaterialTheme.typography.titleSmall)
                                                Text(stringResource(
                                                    R.string.worker_editor_scope_public))
                                                Text(stringResource(
                                                    R.string.worker_edit_public_warning),
                                                    color = MaterialTheme.colorScheme.error)
                                                JodloTextAction(onClick = {
                                                    categoryEdit = categoryEdit.cancelReview()
                                                }, enabled = canWrite) {
                                                    Text(stringResource(R.string.guided_post_back))
                                                }
                                                JodloButton(onClick = {
                                                    val owner = session?.accountPrivateReadMarker()
                                                        ?: return@JodloButton
                                                    if (owner != ownerRowsMarker) return@JodloButton
                                                    val command = categoryEdit.confirmedVersioned(
                                                        displayedOwnListings, categoryRows,
                                                        owner.sessionGeneration,
                                                    ) ?: return@JodloButton
                                                    mutate {
                                                        writes.editCategoryVersioned(
                                                            command.listingId,
                                                            command.expectedCategoryId,
                                                            command.nextCategoryId,
                                                            command.expectedRevision,
                                                            expectedOwner = owner,
                                                        )
                                                    }
                                                }, enabled = canWrite &&
                                                    !alreadyOwned && categoryEdit.confirmedVersioned(
                                                        displayedOwnListings, categoryRows,
                                                        session?.accountExportSessionMarker(),
                                                    ) != null) {
                                                    Text(stringResource(
                                                        R.string.worker_edit_confirm))
                                                }
                                            }
                                        }
                                    }
                                    JodloTextAction(onClick = {
                                        categoryEdit = categoryEdit.reset()
                                    }, enabled = !busy) {
                                        Text(stringResource(R.string.worker_edit_cancel))
                                    }
                                }
                            }
                        }
                        if (categoryEdit.source == null && guided.selectedCategory != null) item {
                            JodloCard(modifier = Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(JodloSizes.CardPadding),
                                    verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
                                    val chosen = guided.selectedCategory!!
                                    Text(stringResource(R.string.worker_editor_step_choose),
                                        style = MaterialTheme.typography.titleMedium)
                                    Text(chosen.name, style = MaterialTheme.typography.titleMedium)
                                    val knownDuplicate = displayedOwnListings.any {
                                        it.categoryId == chosen.id
                                    }
                                    if (knownDuplicate) {
                                        Text(stringResource(R.string.worker_editor_duplicate),
                                            color = MaterialTheme.colorScheme.error)
                                    }
                                    when {
                                        !guided.publishScopeReviewOpen -> {
                                            Text(stringResource(R.string.worker_editor_step_scope),
                                                style = MaterialTheme.typography.titleSmall)
                                            Text(stringResource(R.string.guided_post_before_review))
                                            JodloButton(onClick = {
                                                guided = guided.reviewPublicationScope(
                                                    session?.accountExportSessionMarker(),
                                                    categoryRows, displayedOwnListings)
                                            }, enabled = canWrite && !knownDuplicate) {
                                                Text(stringResource(
                                                    R.string.worker_editor_review_scope))
                                            }
                                        }
                                        !guided.publishReviewOpen -> {
                                            Text(stringResource(R.string.worker_editor_step_final),
                                                style = MaterialTheme.typography.titleSmall)
                                            Text(stringResource(R.string.worker_editor_scope_intro))
                                            Text(stringResource(R.string.worker_editor_scope_public))
                                            Text(stringResource(R.string.worker_editor_scope_locked))
                                            JodloTextAction(onClick = {
                                                guided = guided.clearPublication()
                                            }, enabled = canWrite) {
                                                Text(stringResource(R.string.guided_post_back))
                                            }
                                            JodloButton(onClick = {
                                                guided = guided.reviewPublication(
                                                    session?.accountExportSessionMarker())
                                            }, enabled = canWrite && !knownDuplicate) {
                                                Text(stringResource(R.string.guided_post_review))
                                            }
                                        }
                                        else -> {
                                            Text(stringResource(R.string.worker_editor_step_confirm),
                                                style = MaterialTheme.typography.titleSmall)
                                            Text(stringResource(R.string.guided_post_review_notice))
                                            Text(stringResource(R.string.guided_post_public_data))
                                            Row(horizontalArrangement = Arrangement.spacedBy(
                                                JodloSizes.SmallGap)) {
                                                JodloTextAction(onClick = {
                                                    guided = guided.cancelPublicationReview()
                                                }, enabled = canWrite) {
                                                    Text(stringResource(R.string.guided_post_back))
                                                }
                                                JodloButton(onClick = {
                                                    val owner = session?.accountPrivateReadMarker()
                                                        ?: return@JodloButton
                                                    val id = guided.categoryConfirmedForPublish(
                                                        owner.sessionGeneration, categoryRows, displayedOwnListings,
                                                    ) ?: return@JodloButton
                                                    mutate { writes.createListing(id, owner) }
                                                }, enabled = canWrite && !knownDuplicate &&
                                                    guided.categoryConfirmedForPublish(
                                                        session?.accountExportSessionMarker(),
                                                        categoryRows, displayedOwnListings,
                                                    ) != null) {
                                                    Text(stringResource(R.string.worker_publish_selected))
                                                }
                                            }
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
