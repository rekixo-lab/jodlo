package com.rekixo.jodlo.core.network

/** Pure, nonvisual WORKER-ONLY presentation semantics. Not Activity/Compose,
 * localized copy, an identity verifier, or authorization for a worker write.
 */
enum class WorkerProfilePhase {
    CLOSED, SIGNED_OUT, UNKNOWN, NO_DRAFT, DRAFT, LOADING, ERROR, REFRESH_REQUIRED,
}
enum class WorkerListingsPhase { HIDDEN, IDLE, LOADING, EMPTY, LISTINGS, ERROR, REFRESH_REQUIRED }
enum class WorkerMutationPhase {
    IDLE, SENDING, CONFIRMED, REJECTED, NEEDS_REVIEW, RECHECKING,
}
enum class WorkerMutationKind { PUBLISH, UNPUBLISH }
enum class WorkerDashboardAction {
    CHECK_PROFILE, LOAD_OWN_LISTINGS,
    START_OWNER_PAGE, LOAD_NEXT_OWNER_PAGE, REFRESH_OWNER_PAGE,
    RECHECK_UNCERTAIN_WRITE, ACKNOWLEDGE_UNCERTAINTY,
}

/** No bearer, Google proof, account identifier, public Customer query,
 * arbitrary server message, GPS, phone or contact information.
 *
 * Private rows are intentionally scoped only to this Worker DTO. An existing
 * owned listing's visible flag is NOT verification/approval or proof that a
 * potentially lost write acknowledgement succeeded.
 */
data class WorkerDashboardState(
    val profile: WorkerProfilePhase,
    val owned: WorkerListingsPhase = WorkerListingsPhase.HIDDEN,
    val mutation: WorkerMutationPhase = WorkerMutationPhase.IDLE,
    val actions: Set<WorkerDashboardAction> = emptySet(),
    val ownedListings: List<OwnListing> = emptyList(),
    val mutationKind: WorkerMutationKind? = null,
    val observedVisibility: WorkerVisibility? = null,
    val profileFailure: FailureKind? = null,
    val ownerFailure: FailureKind? = null,
    val ownerSessionFailure: SessionFailure? = null,
    val mutationFailure: FailureKind? = null,
    val mutationSessionFailure: SessionFailure? = null,
    val reviewReadFailure: SessionFailure? = null,
    /** Present only for the explicit owner-paged mode. Never an account ID,
     * bearer, server query token, or indication of worker verification.
     */
    val ownerPageNumber: Int? = null,
    val ownerPageSize: Int? = null,
    val ownerHasNextPage: Boolean = false,
)

/** Read-only adapter around existing scopes; does NOT own their lifecycle.
 * A non-secret session epoch and private-write fingerprint bracket both
 * snapshots. If either changes while composing the view, suppress all
 * private rows/status instead of mixing accounts or write generations.
 *
 * This is a process-memory safety boundary, not atomic remote snapshot
 * consistency. Prior returned immutable values cannot be remotely revoked.
 */
class HeadlessWorkerDashboardPresentation(
    private val session: InMemorySessionCoordinator,
    private val reads: HeadlessMarketplaceReadScope,
    private val writes: HeadlessWorkerWriteScope,
    /** Optional: original unpaged dashboard and callers remain unchanged. */
    private val pages: HeadlessOwnerListingPaginationScope? = null,
) {
    fun snapshot(): WorkerDashboardState {
        val beforeEpoch = session.sessionEpoch()
        val beforeWrite = session.privateReadFingerprint()
        val read = reads.workerSnapshot()
        val write = writes.snapshot()
        val ownerPage = pages?.snapshot()
        val afterWrite = session.privateReadFingerprint()
        val afterEpoch = session.sessionEpoch()
        if (read.closed || write.closed || ownerPage?.closed == true)
            return WorkerDashboardState(WorkerProfilePhase.CLOSED)
        if (beforeEpoch != afterEpoch || read.login is LoginState.SignedOut ||
            ownerPage?.login is LoginState.SignedOut)
            return WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT)
        if (beforeWrite != afterWrite || (ownerPage != null && ownerPage.login != read.login))
            return WorkerDashboardState(WorkerProfilePhase.REFRESH_REQUIRED)
        return HeadlessWorkerDashboardMapper.project(read, write, ownerPage)
    }
}

/** Pure conversion; a hint never executes HTTP, logout, opt-in or POST/DELETE.
 * Existing session/repository/scope methods remain the only authorities.
 * Do not call this with snapshots from unrelated scopes/accounts; use the
 * epoch-bracketed HeadlessWorkerDashboardPresentation for live integration.
 */
object HeadlessWorkerDashboardMapper {
    fun project(
        read: WorkerMarketplaceSnapshot,
        write: WorkerWriteSnapshot,
        /** Do NOT pass unrelated worker scopes here: live presentation owns
         * the session-fingerprint bracket around all three snapshots.
         */
        ownerPage: OwnerListingPageSnapshot? = null,
    ): WorkerDashboardState {
        if (read.closed || write.closed || ownerPage?.closed == true)
            return WorkerDashboardState(WorkerProfilePhase.CLOSED)
        if (ownerPage?.login is LoginState.SignedOut)
            return WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT)
        val login = read.login as? LoginState.SignedIn
            ?: return WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT)

        if (ownerPage != null && ownerPage.login != login)
            return WorkerDashboardState(WorkerProfilePhase.REFRESH_REQUIRED)

        val profile = when (val state = read.worker) {
            ReadState.Loading -> WorkerProfilePhase.LOADING
            is ReadState.ApiError, is ReadState.SessionError -> WorkerProfilePhase.ERROR
            is ReadState.Ready -> {
                if (state.value != login.worker) WorkerProfilePhase.REFRESH_REQUIRED
                else workerPhase(login.worker)
            }
            ReadState.Idle, ReadState.RefreshRequired -> workerPhase(login.worker)
        }
        val profileFailure = (read.worker as? ReadState.ApiError)?.kind
            ?: (read.worker as? ReadState.SessionError)?.networkKind

        val state = write.state
        val mutation = when (state) {
            WorkerWriteState.Idle -> WorkerMutationPhase.IDLE
            is WorkerWriteState.Sending -> WorkerMutationPhase.SENDING
            is WorkerWriteState.Confirmed -> WorkerMutationPhase.CONFIRMED
            is WorkerWriteState.Rejected -> WorkerMutationPhase.REJECTED
            is WorkerWriteState.NeedsReview -> WorkerMutationPhase.NEEDS_REVIEW
            is WorkerWriteState.Rechecking -> WorkerMutationPhase.RECHECKING
        }
        val action = when (state) {
            is WorkerWriteState.Sending -> state.action
            is WorkerWriteState.Confirmed -> state.action
            is WorkerWriteState.Rejected -> state.action
            is WorkerWriteState.NeedsReview -> state.action
            is WorkerWriteState.Rechecking -> state.prior.action
            WorkerWriteState.Idle -> null
        }
        val mutationKind = when (action) {
            is WorkerWriteAction.Publish -> WorkerMutationKind.PUBLISH
            is WorkerWriteAction.Unpublish -> WorkerMutationKind.UNPUBLISH
            null -> null
        }
        val review = when (state) {
            is WorkerWriteState.NeedsReview -> state
            is WorkerWriteState.Rechecking -> state.prior
            else -> null
        }
        val mutationFailure = when (state) {
            is WorkerWriteState.Rejected -> state.networkKind
            is WorkerWriteState.NeedsReview -> state.networkKind
            is WorkerWriteState.Rechecking -> state.prior.networkKind
            else -> null
        }
        val mutationSessionFailure = when (state) {
            is WorkerWriteState.Rejected -> state.reason
            is WorkerWriteState.NeedsReview -> state.reason
            is WorkerWriteState.Rechecking -> state.prior.reason
            else -> null
        }

        val ownsMayDisplay = profile == WorkerProfilePhase.DRAFT &&
            mutation != WorkerMutationPhase.SENDING &&
            mutation != WorkerMutationPhase.NEEDS_REVIEW &&
            mutation != WorkerMutationPhase.RECHECKING
        // In opt-in paged mode never mix legacy owner rows into page results.
        // A page refresh/error cannot accidentally expose an older 100-row list.
        val ownSource: ReadState<List<OwnListing>> = when (val page = ownerPage?.page) {
            null -> read.ownListings
            ReadState.Idle -> ReadState.Idle
            ReadState.Loading -> ReadState.Loading
            ReadState.RefreshRequired -> ReadState.RefreshRequired
            is ReadState.ApiError -> page
            is ReadState.SessionError -> page
            is ReadState.Ready -> ReadState.Ready(page.value.listings)
        }
        val own = if (ownsMayDisplay) when (ownSource) {
            ReadState.Idle -> WorkerListingsPhase.IDLE
            ReadState.RefreshRequired -> if (ownerPage == null)
                WorkerListingsPhase.IDLE else WorkerListingsPhase.REFRESH_REQUIRED
            ReadState.Loading -> WorkerListingsPhase.LOADING
            is ReadState.ApiError, is ReadState.SessionError -> WorkerListingsPhase.ERROR
            is ReadState.Ready -> if (ownSource.value.isEmpty())
                WorkerListingsPhase.EMPTY else WorkerListingsPhase.LISTINGS
        } else WorkerListingsPhase.HIDDEN
        val rows = if (own == WorkerListingsPhase.LISTINGS)
            (ownSource as ReadState.Ready).value.toList() else emptyList()
        val ownerFailure = if (own == WorkerListingsPhase.ERROR)
            (ownSource as? ReadState.ApiError)?.kind
                ?: (ownSource as? ReadState.SessionError)?.networkKind
        else null
        val ownerSessionFailure = if (own == WorkerListingsPhase.ERROR)
            (ownSource as? ReadState.SessionError)?.reason else null
        val pageInfo = if (ownsMayDisplay)
            (ownerPage?.page as? ReadState.Ready<OwnerListingPageView>)?.value
        else null
        val nextPage = own == WorkerListingsPhase.LISTINGS &&
            pageInfo?.nextCursor != null
        val actions = buildSet {
            if (profile != WorkerProfilePhase.LOADING &&
                mutation != WorkerMutationPhase.SENDING &&
                mutation != WorkerMutationPhase.RECHECKING &&
                mutation != WorkerMutationPhase.NEEDS_REVIEW)
                add(WorkerDashboardAction.CHECK_PROFILE)
            if (ownsMayDisplay && own != WorkerListingsPhase.LOADING) {
                if (ownerPage == null) {
                    add(WorkerDashboardAction.LOAD_OWN_LISTINGS)
                } else {
                    if (own == WorkerListingsPhase.REFRESH_REQUIRED ||
                        own == WorkerListingsPhase.ERROR)
                        add(WorkerDashboardAction.REFRESH_OWNER_PAGE)
                    else add(WorkerDashboardAction.START_OWNER_PAGE)
                    if (nextPage) add(WorkerDashboardAction.LOAD_NEXT_OWNER_PAGE)
                }
            }
            if (mutation == WorkerMutationPhase.NEEDS_REVIEW) {
                add(WorkerDashboardAction.RECHECK_UNCERTAIN_WRITE)
                add(WorkerDashboardAction.ACKNOWLEDGE_UNCERTAINTY)
            }
        }
        return WorkerDashboardState(
            profile = profile,
            owned = own,
            mutation = mutation,
            actions = actions,
            ownedListings = rows,
            mutationKind = mutationKind,
            // Observation is only an uncertain read-only diagnostic; NEVER
            // silently promote NEEDS_REVIEW to CONFIRMED.
            observedVisibility = if (mutation == WorkerMutationPhase.NEEDS_REVIEW)
                review?.observation else null,
            profileFailure = profileFailure,
            ownerFailure = ownerFailure,
            ownerSessionFailure = ownerSessionFailure,
            mutationFailure = mutationFailure,
            mutationSessionFailure = mutationSessionFailure,
            reviewReadFailure = if (mutation == WorkerMutationPhase.NEEDS_REVIEW)
                review?.readFailure else null,
            ownerPageNumber = pageInfo?.pageNumber,
            ownerPageSize = pageInfo?.pageSize,
            ownerHasNextPage = nextPage,
        )
    }

    private fun workerPhase(worker: WorkerState): WorkerProfilePhase = when (worker) {
        WorkerState.UNKNOWN -> WorkerProfilePhase.UNKNOWN
        WorkerState.NO_DRAFT -> WorkerProfilePhase.NO_DRAFT
        WorkerState.DRAFT -> WorkerProfilePhase.DRAFT
    }
}
