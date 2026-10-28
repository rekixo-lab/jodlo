package com.rekixo.jodlo.core.network

/** Pure, nonvisual WORKER-ONLY presentation semantics. Not Activity/Compose,
 * localized copy, an identity verifier, or authorization for a worker write.
 */
enum class WorkerProfilePhase {
    CLOSED, SIGNED_OUT, UNKNOWN, NO_DRAFT, DRAFT, LOADING, ERROR, REFRESH_REQUIRED,
}
enum class WorkerListingsPhase { HIDDEN, IDLE, LOADING, EMPTY, LISTINGS, ERROR }
enum class WorkerMutationPhase {
    IDLE, SENDING, CONFIRMED, REJECTED, NEEDS_REVIEW, RECHECKING,
}
enum class WorkerMutationKind { PUBLISH, UNPUBLISH }
enum class WorkerDashboardAction {
    CHECK_PROFILE, LOAD_OWN_LISTINGS,
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
) {
    fun snapshot(): WorkerDashboardState {
        val beforeEpoch = session.sessionEpoch()
        val beforeWrite = session.privateReadFingerprint()
        val read = reads.workerSnapshot()
        val write = writes.snapshot()
        val afterWrite = session.privateReadFingerprint()
        val afterEpoch = session.sessionEpoch()
        if (read.closed || write.closed)
            return WorkerDashboardState(WorkerProfilePhase.CLOSED)
        if (beforeEpoch != afterEpoch || read.login is LoginState.SignedOut)
            return WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT)
        if (beforeWrite != afterWrite)
            return WorkerDashboardState(WorkerProfilePhase.REFRESH_REQUIRED)
        return HeadlessWorkerDashboardMapper.project(read, write)
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
    ): WorkerDashboardState {
        if (read.closed || write.closed)
            return WorkerDashboardState(WorkerProfilePhase.CLOSED)
        val login = read.login as? LoginState.SignedIn
            ?: return WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT)

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
        val own = if (ownsMayDisplay) when (read.ownListings) {
            ReadState.Idle, ReadState.RefreshRequired -> WorkerListingsPhase.IDLE
            ReadState.Loading -> WorkerListingsPhase.LOADING
            is ReadState.ApiError, is ReadState.SessionError -> WorkerListingsPhase.ERROR
            is ReadState.Ready -> if (read.ownListings.value.isEmpty())
                WorkerListingsPhase.EMPTY else WorkerListingsPhase.LISTINGS
        } else WorkerListingsPhase.HIDDEN
        val rows = if (own == WorkerListingsPhase.LISTINGS)
            (read.ownListings as ReadState.Ready).value.toList() else emptyList()
        val ownerFailure = if (own == WorkerListingsPhase.ERROR)
            (read.ownListings as? ReadState.ApiError)?.kind
                ?: (read.ownListings as? ReadState.SessionError)?.networkKind
        else null
        val ownerSessionFailure = if (own == WorkerListingsPhase.ERROR)
            (read.ownListings as? ReadState.SessionError)?.reason else null
        val actions = buildSet {
            if (profile != WorkerProfilePhase.LOADING &&
                mutation != WorkerMutationPhase.SENDING &&
                mutation != WorkerMutationPhase.RECHECKING &&
                mutation != WorkerMutationPhase.NEEDS_REVIEW)
                add(WorkerDashboardAction.CHECK_PROFILE)
            if (ownsMayDisplay && own != WorkerListingsPhase.LOADING)
                add(WorkerDashboardAction.LOAD_OWN_LISTINGS)
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
        )
    }

    private fun workerPhase(worker: WorkerState): WorkerProfilePhase = when (worker) {
        WorkerState.UNKNOWN -> WorkerProfilePhase.UNKNOWN
        WorkerState.NO_DRAFT -> WorkerProfilePhase.NO_DRAFT
        WorkerState.DRAFT -> WorkerProfilePhase.DRAFT
    }
}
