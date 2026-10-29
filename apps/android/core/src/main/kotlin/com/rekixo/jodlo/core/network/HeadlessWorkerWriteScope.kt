package com.rekixo.jodlo.core.network

/** No user identity, address, contact, Google proof or bearer is stored here. */
sealed class WorkerWriteAction {
    data class Publish(val confirmedCategoryId: String) : WorkerWriteAction()
    data class Unpublish(val listingId: String) : WorkerWriteAction()
}

enum class WorkerVisibility {
    /** A matching owned record currently appears publicly visible. */
    VISIBLE,
    /** Record exists but is not currently public; moderation can also hide it. */
    NOT_VISIBLE,
    /** The API returns at most 100 rows; absence proves nothing about a write. */
    NOT_IN_FIRST_100,
    /** No match in the deliberately scanned page(s). Even a terminal keyset
     * page is NOT proof of absence: other devices may change rows mid-scan.
     */
    NOT_OBSERVED_IN_PAGED_SCAN,
}

sealed class WorkerWriteState {
    object Idle : WorkerWriteState()
    data class Sending(val action: WorkerWriteAction) : WorkerWriteState()
    /** Only a positive authenticated server acknowledgement confirms the call. */
    data class Confirmed(val action: WorkerWriteAction) : WorkerWriteState()
    data class Rejected(
        val action: WorkerWriteAction,
        val reason: SessionFailure,
        val networkKind: FailureKind? = null,
    ) : WorkerWriteState()
    /** A sent request MAY have committed; never infer write success from a GET. */
    data class NeedsReview(
        val action: WorkerWriteAction,
        val reason: SessionFailure,
        val networkKind: FailureKind? = null,
        val observation: WorkerVisibility? = null,
        val readFailure: SessionFailure? = null,
        /** Private, opaque continuation for an explicit read-only scan.
         * This is never a public Customer cursor or a worker identity.
         */
        val pagedNextCursor: String? = null,
        val pagedPagesChecked: Int = 0,
        val pagedScanComplete: Boolean = false,
    ) : WorkerWriteState()
    data class Rechecking(val prior: NeedsReview) : WorkerWriteState()
}

enum class WorkerWriteCompletion { APPLIED, BLOCKED, DISCARDED }

data class WorkerWriteSnapshot(
    val closed: Boolean,
    val state: WorkerWriteState,
)

/** A headless, explicit-intent-only worker mutation controller.
 *
 * Does not publish a Search suggestion or generate a Category confirmation.
 * All calls block on the caller's background thread; no Android ViewModel/UI.
 * After an uncertain POST/DELETE, further writes are blocked until the caller
 * explicitly acknowledges the unresolved outcome. Recheck is a GET only and
 * reports current visibility, NOT proof that this request caused that state.
 *
 * The server can finish an already-sent request even after close/logout.
 * No implicit retry, optimistic success, remote rollback or exactly-once claim.
 */
class HeadlessWorkerWriteScope(private val session: InMemorySessionCoordinator) {
    /** Do not wire another account's private read/write controller into a
     * Worker Dashboard just because both accounts have the same worker role.
     * This is process-local object identity, not a credential or actor ID.
     */
    internal fun belongsTo(coordinator: InMemorySessionCoordinator): Boolean =
        session === coordinator

    private val lock = Any()
    private var closed = false
    private var sessionEpoch = session.sessionEpoch()
    private var signal: CancellationSignal? = null
    private var state: WorkerWriteState = WorkerWriteState.Idle

    private fun checkSessionLocked() {
        val current = session.sessionEpoch()
        if (current != sessionEpoch) {
            sessionEpoch = current
            signal?.cancel()
            signal = null
            state = WorkerWriteState.Idle
        }
    }

    fun snapshot(): WorkerWriteSnapshot = synchronized(lock) {
        checkSessionLocked()
        WorkerWriteSnapshot(closed, state)
    }

    /** Called after validating the caller-selected ID, never by Search. */
    private fun write(
        action: WorkerWriteAction,
        send: (CancellationSignal) -> SessionResult<*>,
    ): WorkerWriteCompletion {
        val active = synchronized(lock) {
            checkSessionLocked()
            if (closed || state is WorkerWriteState.Sending ||
                state is WorkerWriteState.Rechecking ||
                state is WorkerWriteState.NeedsReview) return@synchronized null
            CancellationSignal().also {
                signal = it
                state = WorkerWriteState.Sending(action)
            }
        } ?: return synchronized(lock) {
            if (closed) WorkerWriteCompletion.DISCARDED else WorkerWriteCompletion.BLOCKED
        }

        val reply: SessionResult<*> = try {
            if (active.isCancelled) SessionResult.Failed(SessionFailure.CANCELLED)
            else send(active)
        } catch (_: Exception) {
            // Unknown fake adapter errors cannot certify the server did nothing.
            SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.BAD_RESPONSE)
        }
        return synchronized(lock) {
            checkSessionLocked()
            if (closed || signal !== active || active.isCancelled) {
                WorkerWriteCompletion.DISCARDED
            } else {
                state = when (reply) {
                    is SessionResult.Success -> WorkerWriteState.Confirmed(action)
                    is SessionResult.Failed -> {
                        val kind = reply.networkKind
                        val uncertain = when (reply.reason) {
                            SessionFailure.CANCELLED, SessionFailure.REPLACED,
                            SessionFailure.EXPIRED, SessionFailure.STALE_RESULT -> true
                            SessionFailure.REMOTE_FAILURE -> kind == FailureKind.OFFLINE_OR_TIMEOUT ||
                                kind == FailureKind.BAD_RESPONSE ||
                                kind == FailureKind.SERVICE_UNAVAILABLE
                            else -> false
                        }
                        if (uncertain) WorkerWriteState.NeedsReview(action, reply.reason, kind)
                        else WorkerWriteState.Rejected(action, reply.reason, kind)
                    }
                }
                signal = null
                WorkerWriteCompletion.APPLIED
            }
        }
    }

    /** Only a deliberately chosen Category can be sent. */
    fun publishExplicitCategory(confirmedCategoryId: String): WorkerWriteCompletion {
        JodloRoutes.requireCategoryId(confirmedCategoryId)
        return write(WorkerWriteAction.Publish(confirmedCategoryId)) {
            session.publishExplicitCategory(confirmedCategoryId, it)
        }
    }

    fun unpublish(listingId: String): WorkerWriteCompletion {
        JodloRoutes.requireListingId(listingId)
        return write(WorkerWriteAction.Unpublish(listingId)) {
            session.unpublish(listingId, it)
        }
    }

    /** Explicit one-page read-only uncertainty recheck.
     *
     * Legacy recheckOwnListings() intentionally keeps its first-100 API for
     * older fake WorkerRepository clients. This opt-in path consumes exactly
     * ONE 25-row owner page per user invocation, so a listing in the 889th
     * approved Category can be inspected without auto-fetching 36 pages.
     * A match is only an observation, never write confirmation; nonmatches
     * after ANY number of keyset pages never prove the write did not commit.
     */
    fun recheckOwnListingsPage(): WorkerWriteCompletion = recheck(paged = true)

    /** Old single-GET diagnostic, still bounded to first 100 owner rows. */
    fun recheckOwnListings(): WorkerWriteCompletion = recheck(paged = false)

    private data class ReviewRows(val listings: List<OwnListing>, val nextCursor: String?)

    /** Exactly one authenticated GET per explicit call. Never replay POST or
     * DELETE. The same single-flight + session-epoch gate owns both modes.
     */
    private fun recheck(paged: Boolean): WorkerWriteCompletion {
        val captured = synchronized(lock) {
            checkSessionLocked()
            if (closed) return@synchronized null
            val review = state as? WorkerWriteState.NeedsReview ?: return@synchronized null
            CancellationSignal().also {
                signal = it
                state = WorkerWriteState.Rechecking(review)
            }
        } ?: return synchronized(lock) {
            if (closed) WorkerWriteCompletion.DISCARDED else WorkerWriteCompletion.BLOCKED
        }

        val reply: SessionResult<ReviewRows> = try {
            if (captured.isCancelled) SessionResult.Failed(SessionFailure.CANCELLED)
            else if (paged) {
                val prior = (synchronized(lock) { state } as? WorkerWriteState.Rechecking)?.prior
                val after = prior?.pagedNextCursor
                when (val page = session.pageMyListings(25, after, captured)) {
                    is SessionResult.Success ->
                        SessionResult.Success(ReviewRows(page.value.listings, page.value.nextCursor))
                    is SessionResult.Failed -> page
                }
            } else when (val old = session.myListings(captured)) {
                is SessionResult.Success -> SessionResult.Success(ReviewRows(old.value, null))
                is SessionResult.Failed -> old
            }
        } catch (_: Exception) {
            SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.BAD_RESPONSE)
        }

        return synchronized(lock) {
            checkSessionLocked()
            val checking = state as? WorkerWriteState.Rechecking
            if (closed || signal !== captured || captured.isCancelled || checking == null) {
                WorkerWriteCompletion.DISCARDED
            } else {
                val prior = checking.prior
                state = when (reply) {
                    is SessionResult.Success -> {
                        val match = when (val action = prior.action) {
                            is WorkerWriteAction.Publish ->
                                reply.value.listings.firstOrNull {
                                    it.categoryId == action.confirmedCategoryId
                                }
                            is WorkerWriteAction.Unpublish ->
                                reply.value.listings.firstOrNull { it.id == action.listingId }
                        }
                        if (paged && prior.pagedNextCursor != null &&
                            reply.value.listings.isEmpty()) {
                            // A deleted/inactive/foreign keyset anchor can return
                            // an empty terminal reply. Do not treat that as a
                            // completed scan; restart explicitly from page one.
                            prior.copy(observation = null,
                                readFailure = SessionFailure.STALE_RESULT,
                                pagedNextCursor = null, pagedPagesChecked = 0,
                                pagedScanComplete = false)
                        } else {
                            val observation = when {
                                match == null -> if (paged)
                                    WorkerVisibility.NOT_OBSERVED_IN_PAGED_SCAN
                                else WorkerVisibility.NOT_IN_FIRST_100
                                match.visible -> WorkerVisibility.VISIBLE
                                else -> WorkerVisibility.NOT_VISIBLE
                            }
                            prior.copy(
                                observation = observation, readFailure = null,
                                pagedNextCursor = if (paged && match == null)
                                    reply.value.nextCursor else null,
                                pagedPagesChecked = if (paged)
                                    (if (prior.pagedNextCursor == null) 1
                                     else prior.pagedPagesChecked + 1) else 0,
                                pagedScanComplete = paged &&
                                    (match != null || reply.value.nextCursor == null),
                            )
                        }
                    }
                    is SessionResult.Failed ->
                        prior.copy(readFailure = reply.reason, observation = null,
                            pagedNextCursor = if (paged) prior.pagedNextCursor else null,
                            pagedPagesChecked = if (paged) prior.pagedPagesChecked else 0,
                            pagedScanComplete = paged && prior.pagedScanComplete)
                }
                signal = null
                WorkerWriteCompletion.APPLIED
            }
        }
    }

    /** A manual acknowledgement is NOT confirmation of the previous write.
     * It only removes this local guard; the next user action must separately
     * select a Category/listing and submit it explicitly.
     */
    fun acknowledgeUncertainty(): Boolean = synchronized(lock) {
        checkSessionLocked()
        if (closed || state !is WorkerWriteState.NeedsReview) false
        else {
            state = WorkerWriteState.Idle
            true
        }
    }

    fun close() = synchronized(lock) {
        closed = true
        signal?.cancel()
        signal = null
        state = WorkerWriteState.Idle
    }
}
