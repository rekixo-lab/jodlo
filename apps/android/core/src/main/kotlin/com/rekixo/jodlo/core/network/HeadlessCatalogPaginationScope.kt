package com.rekixo.jodlo.core.network

import java.text.Normalizer

/** Only public Catalog data; no account, contact, location or bearer. */
sealed class PageState {
    object Idle : PageState()
    object Loading : PageState()
    object RefreshRequired : PageState()
    data class Error(val kind: FailureKind) : PageState()
    data class Ready(
        val language: Language,
        val availableOnly: Boolean,
        val pageSize: Int,
        val categories: List<PublicCategory>,
        val nextCursor: String? = null,
        val nextOffset: Int? = null,
        val query: String? = null,
        val choices: List<PublicCategory> = emptyList(),
        val needsChoice: Boolean = false,
        val pageCount: Int = 1,
    ) : PageState()
}
enum class PageCompletion { APPLIED, DISCARDED, DEFERRED, BLOCKED }
data class CatalogPageSnapshot(
    val closed: Boolean, val browse: PageState, val search: PageState,
)

/** Headless public pagination, always called off the future Android main thread.
 *
 * Browse uses the existing opaque cursor; Search uses the existing bounded
 * offset and only includes ambiguous choices on its first page. Each page
 * is one GET, never automatically fetched. A new first-page request supersedes
 * old in-flight replies. A duplicate category across pages, worker write,
 * explicit refresh or cache age expiry discards the accumulated result and
 * requires a new first page: mixed snapshots are never presented as fresh.
 *
 * The existing API has NO snapshot revision / transactional pagination token,
 * so a perfectly consistent cross-request server snapshot is NOT guaranteed.
 * We only enforce safe client-side boundaries; remote changes may still occur
 * between two valid GETs. No polling, GPS, UI or public contact workflow.
 */
class HeadlessCatalogPaginationScope(
    private val catalog: CatalogRepository,
    private val session: InMemorySessionCoordinator,
    private val elapsedMillis: () -> Long = { System.nanoTime() / 1_000_000L },
    private val publicFreshnessMillis: Long = 60_000L,
) {
    init {
        require(publicFreshnessMillis in 1L..300_000L) { "Invalid public freshness window" }
    }
    private class Lane {
        var state: PageState = PageState.Idle
        var signal: CancellationSignal? = null
        var firstStarted: Long? = null

        fun invalidate() {
            signal?.cancel()
            signal = null
            firstStarted = null
            state = PageState.RefreshRequired
        }
        fun close() {
            signal?.cancel()
            signal = null
            firstStarted = null
            state = PageState.Idle
        }
    }
    private val lock = Any()
    private var closed = false
    private var marker = session.publicReadMarker()
    private val browse = Lane()
    private val search = Lane()

    private fun reconcileLocked() {
        val current = session.publicReadMarker()
        if (current.revision != marker.revision) {
            browse.invalidate()
            search.invalidate()
        }
        marker = current
        val now = elapsedMillis()
        for (lane in listOf(browse, search)) {
            val started = lane.firstStarted ?: continue
            if (now < started || now - started >= publicFreshnessMillis) lane.invalidate()
        }
    }

    fun snapshot(): CatalogPageSnapshot = synchronized(lock) {
        if (!closed) reconcileLocked()
        CatalogPageSnapshot(closed, browse.state, search.state)
    }

    /** A future approved screen can request this on resume or explicit refresh.
     * No network or repeated GET is automatically scheduled.
     */
    fun requestRefresh(): Boolean = synchronized(lock) {
        if (closed) false
        else {
            reconcileLocked()
            browse.invalidate()
            search.invalidate()
            true
        }
    }

    private data class Ticket(
        val signal: CancellationSignal,
        val previous: PageState.Ready?,
        val firstStarted: Long,
    )
    private sealed class Admission {
        data class Accepted(val ticket: Ticket) : Admission()
        object Blocked : Admission()
        object Deferred : Admission()
        object Discarded : Admission()
    }

    private fun admit(
        lane: Lane, first: Boolean, hasNext: (PageState.Ready) -> Boolean,
    ): Admission = synchronized(lock) {
        if (closed) return@synchronized Admission.Discarded
        reconcileLocked()
        if (marker.writeInFlight) {
            lane.invalidate()
            return@synchronized Admission.Deferred
        }
        val previous = if (first) null else (lane.state as? PageState.Ready
            ?: return@synchronized Admission.Blocked)
        if (previous != null && !hasNext(previous)) return@synchronized Admission.Blocked
        val time = if (first) elapsedMillis() else lane.firstStarted
            ?: return@synchronized Admission.Blocked
        lane.signal?.cancel()
        val signal = CancellationSignal()
        lane.signal = signal
        lane.firstStarted = time
        lane.state = PageState.Loading
        Admission.Accepted(Ticket(signal, previous, time))
    }

    private fun run(
        lane: Lane, first: Boolean,
        hasNext: (PageState.Ready) -> Boolean,
        request: (PageState.Ready?) -> ApiOutcome<PageState.Ready>,
    ): PageCompletion {
        val admission = admit(lane, first, hasNext)
        val ticket = when (admission) {
            is Admission.Accepted -> admission.ticket
            Admission.Blocked -> return PageCompletion.BLOCKED
            Admission.Deferred -> return PageCompletion.DEFERRED
            Admission.Discarded -> return PageCompletion.DISCARDED
        }
        val result: ApiOutcome<PageState.Ready> = if (ticket.signal.isCancelled)
            ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)
        else try {
            request(ticket.previous)
        } catch (_: Exception) {
            ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)
        }
        return synchronized(lock) {
            if (!closed) reconcileLocked()
            if (closed || lane.signal !== ticket.signal || ticket.signal.isCancelled ||
                marker.writeInFlight) return@synchronized PageCompletion.DISCARDED
            val now = elapsedMillis()
            if (now < ticket.firstStarted ||
                now - ticket.firstStarted >= publicFreshnessMillis) {
                lane.invalidate()
                return@synchronized PageCompletion.DISCARDED
            }
            val next = when (result) {
                is ApiOutcome.Failed -> PageState.Error(result.kind)
                is ApiOutcome.Ok -> {
                    val page = result.value
                    val previous = ticket.previous
                    val combined = if (previous == null) page else {
                        // A category may move between offsets/cursors while the
                        // remote catalog changes. Never append a duplicate ID.
                        if (page.categories.any { candidate ->
                                previous.categories.any { it.id == candidate.id }
                            }) {
                            lane.invalidate()
                            return@synchronized PageCompletion.DISCARDED
                        }
                        previous.copy(
                            categories = previous.categories + page.categories,
                            nextCursor = page.nextCursor,
                            nextOffset = page.nextOffset,
                            pageCount = previous.pageCount + 1,
                        )
                    }
                    combined
                }
            }
            lane.state = next
            lane.signal = null
            if (next !is PageState.Ready) lane.firstStarted = null
            PageCompletion.APPLIED
        }
    }

    /** An explicit first page replaces any older Browse query/pages. */
    fun startBrowse(
        language: Language, availableOnly: Boolean = false, pageSize: Int = 20,
    ): PageCompletion {
        JodloRoutes.browse(language, availableOnly, pageSize)
        return run(browse, first = true, hasNext = { true }) {
            browsePage(language, availableOnly, pageSize, null)
        }
    }

    fun nextBrowse(): PageCompletion = run(
        browse, first = false, hasNext = { it.nextCursor != null && it.pageCount < 20 },
    ) { previous ->
        val ready = requireNotNull(previous)
        browsePage(ready.language, ready.availableOnly, ready.pageSize,
            requireNotNull(ready.nextCursor))
    }

    private fun browsePage(
        language: Language, availableOnly: Boolean, pageSize: Int, after: String?,
    ): ApiOutcome<PageState.Ready> {
        // Reuse the existing route builder and repository validation.
        JodloRoutes.browse(language, availableOnly, pageSize, after)
        return when (val result = catalog.browse(language, availableOnly, pageSize, after)) {
            is ApiOutcome.Failed -> result
            is ApiOutcome.Ok -> {
                val page = result.value
                val valid = page.language == language && page.categories.size <= pageSize &&
                    page.categories.map { it.id }.distinct().size == page.categories.size &&
                    (page.nextCursor == null ||
                        (page.categories.size == pageSize && page.nextCursor != after))
                if (!valid) ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)
                else ApiOutcome.Ok(PageState.Ready(
                    language, availableOnly, pageSize, page.categories,
                    nextCursor = page.nextCursor))
            }
        }
    }

    /** Search choices appear ONLY in the first response, never in next pages. */
    fun startSearch(
        query: String, language: Language, availableOnly: Boolean = false,
        pageSize: Int = 20,
    ): PageCompletion {
        JodloRoutes.search(query, language, availableOnly, true, pageSize, 0)
        val normalized = Normalizer.normalize(query.trim(), Normalizer.Form.NFC)
        return run(search, first = true, hasNext = { true }) {
            searchPage(normalized, language, availableOnly, pageSize, 0, true)
        }
    }

    fun nextSearch(): PageCompletion = run(
        search, first = false,
        hasNext = { !it.needsChoice && it.nextOffset != null && it.nextOffset in 0..100 },
    ) { previous ->
        val ready = requireNotNull(previous)
        searchPage(requireNotNull(ready.query), ready.language, ready.availableOnly,
            ready.pageSize, requireNotNull(ready.nextOffset), false)
    }

    private fun searchPage(
        query: String, language: Language, availableOnly: Boolean, pageSize: Int,
        offset: Int, choices: Boolean,
    ): ApiOutcome<PageState.Ready> {
        JodloRoutes.search(query, language, availableOnly, choices, pageSize, offset)
        return when (val result =
            catalog.search(query, language, availableOnly, choices, pageSize, offset)) {
            is ApiOutcome.Failed -> result
            is ApiOutcome.Ok -> {
                val page = result.value
                val valid = page.language == language && page.query == query &&
                    page.categories.size <= pageSize &&
                    page.categories.map { it.id }.distinct().size == page.categories.size &&
                    (!page.needsChoice || (choices && page.categories.isEmpty() &&
                        page.nextOffset == null && page.choices.isNotEmpty())) &&
                    (choices || (!page.needsChoice && page.choices.isEmpty())) &&
                    (page.nextOffset == null ||
                        (page.nextOffset == offset + pageSize && !page.needsChoice))
                if (!valid) ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)
                else ApiOutcome.Ok(PageState.Ready(
                    language, availableOnly, pageSize, page.categories,
                    // The current route permits at most offset 100. Do not
                    // expose a continuation it is impossible to request.
                    nextOffset = page.nextOffset?.takeIf { it <= 100 },
                    query = query, choices = page.choices, needsChoice = page.needsChoice))
            }
        }
    }

    fun close() = synchronized(lock) {
        closed = true
        browse.close()
        search.close()
    }
}
