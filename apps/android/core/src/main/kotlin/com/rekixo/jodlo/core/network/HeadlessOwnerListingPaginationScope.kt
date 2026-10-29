package com.rekixo.jodlo.core.network

/** One PRIVATE owner page at a time: no bearer, account ID or worker contact.
 * pageNumber counts deliberate user requests, NOT a 100/889 trade limit.
 */
data class OwnerListingPageView(
    val listings: List<OwnListing>,
    val nextCursor: String?,
    val pageSize: Int,
    val pageNumber: Int,
)

data class OwnerListingPageSnapshot(
    val closed: Boolean,
    val login: LoginState,
    val page: ReadState<OwnerListingPageView>,
)

/** Headless, nonvisual owner-pagination lifecycle.
 *
 * Only an explicit start()/next() sends ONE authenticated GET. Cached private
 * results are one page (<=25 rows), never the whole account/history. The
 * session coordinator owns the bearer, 401 handling, write and logout races.
 * Changes to its non-secret session/write fingerprint cancel pending reads
 * and discard cached pages. A complete browsing sequence expires from its
 * FIRST request start time; a new first page is needed to restart.
 *
 * A backend keyset is not a transactional snapshot across HTTP requests.
 * External moderation/other-device changes may occur between pages; no
 * polling, automatic retry, UI, contact or trust assertion is provided.
 * Call this blocking API OFF an eventual Android main thread.
 */
class HeadlessOwnerListingPaginationScope(
    private val session: InMemorySessionCoordinator,
    private val elapsedMillis: () -> Long = { System.nanoTime() / 1_000_000L },
    private val freshnessMillis: Long = 60_000L,
) {
    init {
        require(freshnessMillis in 1L..300_000L) { "Invalid private freshness window" }
    }

    private data class Ticket(
        val signal: CancellationSignal,
        val limit: Int,
        val after: String?,
        val started: Long,
        val pageNumber: Int,
    )

    /** Bind a private page source to the SAME in-memory session as its
     * Worker Dashboard. Two signed-in workers can both report DRAFT; the
     * public LoginState alone cannot prove actor identity across instances.
     * Identity never leaves the process and exposes no account/token.
     */
    internal fun belongsTo(coordinator: InMemorySessionCoordinator): Boolean =
        session === coordinator

    private val lock = Any()
    private var closed = false
    private var fingerprint = session.privateReadFingerprint()
    private var state: ReadState<OwnerListingPageView> = ReadState.Idle
    private var signal: CancellationSignal? = null
    private var firstStartedAt: Long? = null

    private fun resetLocked(next: ReadState<OwnerListingPageView>) {
        signal?.cancel()
        signal = null
        firstStartedAt = null
        state = next
    }

    private fun reconcileLocked() {
        val latest = session.privateReadFingerprint()
        if (latest != fingerprint) {
            fingerprint = latest
            resetLocked(if (session.snapshot() is LoginState.SignedOut)
                ReadState.Idle else ReadState.RefreshRequired)
        }
        val began = firstStartedAt
        if (began != null) {
            val now = elapsedMillis()
            if (now < began || now - began >= freshnessMillis)
                resetLocked(ReadState.RefreshRequired)
        }
        if (session.snapshot() is LoginState.SignedOut && state != ReadState.Idle)
            resetLocked(ReadState.Idle)
    }

    /** Bracket the private snapshot with a session fingerprint. A login
     * replacement in the middle returns no rows, even if a caller forgets
     * to close an old scope. Never make a network call from snapshot().
     */
    fun snapshot(): OwnerListingPageSnapshot {
        val before = session.privateReadFingerprint()
        val raw = synchronized(lock) {
            if (!closed) reconcileLocked()
            OwnerListingPageSnapshot(closed, session.snapshot(), state)
        }
        val after = session.privateReadFingerprint()
        if (raw.closed) return OwnerListingPageSnapshot(true, LoginState.SignedOut, ReadState.Idle)
        if (before != after || raw.login is LoginState.SignedOut)
            return OwnerListingPageSnapshot(false, LoginState.SignedOut, ReadState.Idle)
        return raw
    }

    /** Does not fetch: invalidate after manual refresh/external change. */
    fun requestRefresh(): Boolean = synchronized(lock) {
        if (closed) false else {
            reconcileLocked()
            resetLocked(ReadState.RefreshRequired)
            true
        }
    }

    /** The first page supersedes an earlier unfinished request. Caller must
     * deliberately start it again after a stale/invalidated continuation.
     */
    fun start(pageSize: Int = 20): PageCompletion {
        require(pageSize in 1..25) { "Invalid owner page size" }
        return fetch(first = true, pageSize = pageSize)
    }

    /** No hidden prefetch: only an already Ready page with a nextCursor can
     * advance. One page replaces the former page; memory remains bounded.
     */
    fun next(): PageCompletion = fetch(first = false, pageSize = null)

    private fun fetch(first: Boolean, pageSize: Int?): PageCompletion {
        var deferred = false
        val ticket = synchronized(lock) {
            if (closed) return@synchronized null
            reconcileLocked()
            if (session.publicReadMarker().writeInFlight) {
                resetLocked(ReadState.RefreshRequired)
                deferred = true
                return@synchronized null
            }
            val previous = if (first) null else
                (state as? ReadState.Ready<OwnerListingPageView>
                    ?: return@synchronized null)
            val old = previous?.value
            val after = if (first) null else
                (old?.nextCursor ?: return@synchronized null)
            val limit = pageSize ?: old?.pageSize ?: return@synchronized null
            val began = if (first) elapsedMillis() else
                (firstStartedAt ?: return@synchronized null)
            val count = if (first) 1 else (old?.pageNumber ?: 0) + 1
            if (count < 1) return@synchronized null
            signal?.cancel()
            Ticket(CancellationSignal(), limit, after, began, count).also {
                signal = it.signal
                firstStartedAt = began
                state = ReadState.Loading
            }
        } ?: return if (deferred) PageCompletion.DEFERRED else
            if (synchronized(lock) { closed }) PageCompletion.DISCARDED else PageCompletion.BLOCKED

        val reply = try {
            session.pageMyListings(ticket.limit, ticket.after, ticket.signal)
        } catch (_: Exception) {
            SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.BAD_RESPONSE)
        }
        return synchronized(lock) {
            if (!closed) reconcileLocked()
            if (closed || signal !== ticket.signal || ticket.signal.isCancelled)
                return@synchronized PageCompletion.DISCARDED
            if (reply is SessionResult.Failed &&
                reply.reason == SessionFailure.OPERATION_IN_PROGRESS) {
                resetLocked(ReadState.RefreshRequired)
                return@synchronized PageCompletion.DEFERRED
            }
            val now = elapsedMillis()
            if (now < ticket.started || now - ticket.started >= freshnessMillis) {
                resetLocked(ReadState.RefreshRequired)
                return@synchronized PageCompletion.DISCARDED
            }
            state = when (reply) {
                is SessionResult.Failed ->
                    ReadState.SessionError(reply.reason, reply.networkKind)
                is SessionResult.Success -> {
                    val page = reply.value
                    val valid = runCatching {
                        page.listings.size <= ticket.limit &&
                            page.listings.map { it.id }.toSet().size == page.listings.size &&
                            page.listings.all {
                                JodloRoutes.requireListingId(it.id)
                                JodloRoutes.requireCategoryId(it.categoryId)
                                it.id != ticket.after
                            } &&
                            (page.nextCursor == null || (
                                page.listings.size == ticket.limit &&
                                page.listings.last().id == page.nextCursor &&
                                page.nextCursor != ticket.after))
                    }.getOrDefault(false)
                    if (!valid) ReadState.ApiError(FailureKind.BAD_RESPONSE)
                    else ReadState.Ready(OwnerListingPageView(
                        page.listings, page.nextCursor, ticket.limit, ticket.pageNumber))
                }
            }
            signal = null
            PageCompletion.APPLIED
        }
    }

    /** Permanently wipe all cached private pages and discard slow replies. */
    fun close() = synchronized(lock) {
        closed = true
        resetLocked(ReadState.Idle)
    }
}
