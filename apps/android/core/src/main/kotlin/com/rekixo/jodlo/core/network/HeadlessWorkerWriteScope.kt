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

    /** One read-only, authenticated check; never calls publish/unpublish.
     * An observation is NOT a write acknowledgement. Rechecking may be repeated
     * manually after offline failures; the first 100 owned rows are a limit.
     */
    fun recheckOwnListings(): WorkerWriteCompletion {
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

        val reply: SessionResult<List<OwnListing>> = try {
            if (captured.isCancelled) SessionResult.Failed(SessionFailure.CANCELLED)
            else session.myListings(captured)
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
                                reply.value.firstOrNull { it.categoryId == action.confirmedCategoryId }
                            is WorkerWriteAction.Unpublish ->
                                reply.value.firstOrNull { it.id == action.listingId }
                        }
                        val observation = when {
                            match == null -> WorkerVisibility.NOT_IN_FIRST_100
                            match.visible -> WorkerVisibility.VISIBLE
                            else -> WorkerVisibility.NOT_VISIBLE
                        }
                        prior.copy(observation = observation, readFailure = null)
                    }
                    is SessionResult.Failed ->
                        prior.copy(readFailure = reply.reason, observation = null)
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
