package com.rekixo.jodlo.core.network

/** Immutable, nonvisual read states. Never contain bearer or Google proof. */
sealed class ReadState<out T> {
    object Idle : ReadState<Nothing>()
    object Loading : ReadState<Nothing>()
    data class Ready<T>(val value: T) : ReadState<T>()
    data class ApiError(val kind: FailureKind) : ReadState<Nothing>()
    data class SessionError(
        val reason: SessionFailure,
        val networkKind: FailureKind? = null,
    ) : ReadState<Nothing>()
}

enum class ReadCompletion { APPLIED, DISCARDED }

/** An immutable copy; no Activity, Compose, location, private contacts or token. */
data class MarketplaceReadSnapshot(
    val closed: Boolean,
    val browse: ReadState<CatalogBrowse>,
    val search: ReadState<CatalogSearch>,
    val publicListings: ReadState<List<PublicListing>>,
    val worker: ReadState<WorkerState>,
    val ownListings: ReadState<List<OwnListing>>,
)

/** One instance per future approved screen/view lifecycle, not per account.
 *
 * Calls are blocking and MUST run off Android's main thread. Each lane is
 * latest-request-wins: starting a newer search cancels only the old search,
 * not unrelated browse/listing reads. Closing permanently cancels all lanes,
 * drops cached snapshots and makes late results DISCARDED. Cancellation is
 * cooperative and never promises to stop a request already sent on the wire.
 *
 * Private reads compare a non-secret session/write fingerprint. Changing
 * account, signing out, unauthorized revocation, session expiry OR starting
 * a worker mutation clears cached private data, including uncertain writes.
 *
 * This is deliberately READ-ONLY. A suggested Search category never
 * triggers worker opt-in or a service publication. Worker writes must stay
 * explicitly user-confirmed through InMemorySessionCoordinator.
 */
class HeadlessMarketplaceReadScope(
    private val catalog: CatalogRepository,
    private val session: InMemorySessionCoordinator,
) {
    private class Lane<T> {
        var signal: CancellationSignal? = null
        var state: ReadState<T> = ReadState.Idle

        fun discard() {
            signal?.cancel()
            signal = null
            state = ReadState.Idle
        }
    }

    private val lock = Any()
    private var closed = false
    private var workerFingerprint = session.privateReadFingerprint()
    private val browseLane = Lane<CatalogBrowse>()
    private val searchLane = Lane<CatalogSearch>()
    private val publicLane = Lane<List<PublicListing>>()
    private val workerLane = Lane<WorkerState>()
    private val ownLane = Lane<List<OwnListing>>()

    private fun checkWorkerEpochLocked() {
        val current = session.privateReadFingerprint()
        if (workerFingerprint != current) {
            workerFingerprint = current
            workerLane.discard()
            ownLane.discard()
        }
    }

    /** Snapshot never returns old worker data after a session replacement. */
    fun snapshot(): MarketplaceReadSnapshot = synchronized(lock) {
        checkWorkerEpochLocked()
        MarketplaceReadSnapshot(
            closed, browseLane.state, searchLane.state, publicLane.state,
            workerLane.state, ownLane.state,
        )
    }

    private fun <T> load(
        lane: Lane<T>,
        privateRead: Boolean = false,
        fetch: (CancellationSignal) -> ReadState<T>,
    ): ReadCompletion {
        val signal = synchronized(lock) {
            if (closed) return@synchronized null
            if (privateRead) checkWorkerEpochLocked()
            lane.signal?.cancel()
            CancellationSignal().also {
                lane.signal = it
                lane.state = ReadState.Loading
            }
        } ?: return ReadCompletion.DISCARDED

        // The send may race with cancellation. We guarantee late result
        // suppression, not an impossible rollback of already-started HTTP.
        val result: ReadState<T> = if (signal.isCancelled) ReadState.Idle else {
            try {
                fetch(signal)
            } catch (_: Exception) {
                // Do not leak arbitrary injected adapter/server exception text.
                ReadState.ApiError(FailureKind.BAD_RESPONSE)
            }
        }
        return synchronized(lock) {
            if (privateRead) checkWorkerEpochLocked()
            if (closed || lane.signal !== signal || signal.isCancelled) {
                ReadCompletion.DISCARDED
            } else {
                lane.state = result
                lane.signal = null
                ReadCompletion.APPLIED
            }
        }
    }

    private fun <T> api(result: ApiOutcome<T>): ReadState<T> = when (result) {
        is ApiOutcome.Ok -> ReadState.Ready(result.value)
        is ApiOutcome.Failed -> ReadState.ApiError(result.kind)
    }

    private fun <T> authenticated(result: SessionResult<T>): ReadState<T> = when (result) {
        is SessionResult.Success -> ReadState.Ready(result.value)
        is SessionResult.Failed -> ReadState.SessionError(result.reason, result.networkKind)
    }

    fun browse(
        language: Language,
        availableOnly: Boolean = false,
        limit: Int = 20,
        after: String? = null,
    ): ReadCompletion {
        // Reuse the existing validation BEFORE replacing an in-progress lane.
        JodloRoutes.browse(language, availableOnly, limit, after)
        return load(browseLane) { api(catalog.browse(language, availableOnly, limit, after)) }
    }

    fun search(
        query: String,
        language: Language,
        availableOnly: Boolean = false,
        includeChoices: Boolean = true,
        limit: Int = 20,
        offset: Int = 0,
    ): ReadCompletion {
        JodloRoutes.search(query, language, availableOnly, includeChoices, limit, offset)
        return load(searchLane) {
            api(catalog.search(query, language, availableOnly, includeChoices, limit, offset))
        }
    }

    fun publicListings(categoryId: String): ReadCompletion {
        JodloRoutes.publicListings(categoryId)
        return load(publicLane) { api(catalog.listings(categoryId)) }
    }

    /** A new empty query may explicitly discard the prior search result. */
    fun clearSearch() = synchronized(lock) { searchLane.discard() }

    fun checkWorker(): ReadCompletion =
        load(workerLane, privateRead = true) { authenticated(session.checkWorker(it)) }

    fun ownListings(): ReadCompletion =
        load(ownLane, privateRead = true) { authenticated(session.myListings(it)) }

    /** Permanent; create a new scope on the next approved lifecycle. */
    fun close() = synchronized(lock) {
        closed = true
        browseLane.discard()
        searchLane.discard()
        publicLane.discard()
        workerLane.discard()
        ownLane.discard()
    }
}
