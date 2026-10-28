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

/** Headless destination names, NOT a screen, layout, Activity or Android UI. */
enum class CustomerDestination { BROWSE, SEARCH, PUBLIC_LISTINGS }

/** Public, bounded request intent only. Never includes results, a bearer,
 * private worker state, cursor, offset, listing ID, or a selected Category.
 */
data class CustomerBrowseIntent(
    val language: Language, val availableOnly: Boolean, val pageSize: Int,
)
data class CustomerSearchIntent(
    val query: String, val language: Language,
    val availableOnly: Boolean, val pageSize: Int,
)
data class CustomerDiscoveryIntent(
    val browse: CustomerBrowseIntent? = null,
    val search: CustomerSearchIntent? = null,
    // PUBLIC_LISTINGS is intentionally not an allowed restoration destination.
    val destination: CustomerDestination = CustomerDestination.BROWSE,
)

data class CustomerNavigationState(
    val destination: CustomerDestination = CustomerDestination.BROWSE,
    val backDestination: CustomerDestination? = null,
)

/** Explicit selection is a CUSTOMER read choice, never posting consent. */
enum class CustomerCategorySource { BROWSE, SEARCH }
sealed class CustomerSelectionState {
    object Idle : CustomerSelectionState()
    object RefreshRequired : CustomerSelectionState()
    data class Chosen(val category: PublicCategory, val source: CustomerCategorySource)
        : CustomerSelectionState()
    data class Loading(val category: PublicCategory, val source: CustomerCategorySource)
        : CustomerSelectionState()
    data class Ready(
        val category: PublicCategory, val source: CustomerCategorySource,
        val listings: List<PublicListing>,
    ) : CustomerSelectionState()
    data class Error(
        val category: PublicCategory, val source: CustomerCategorySource,
        val kind: FailureKind,
    ) : CustomerSelectionState()
}
data class CatalogPageSnapshot(
    val closed: Boolean, val browse: PageState, val search: PageState,
    val selection: CustomerSelectionState = CustomerSelectionState.Idle,
    val navigation: CustomerNavigationState = CustomerNavigationState(),
    val intent: CustomerDiscoveryIntent = CustomerDiscoveryIntent(),
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
 * between two valid GETs. An exact user-selected Category from the current
 * Browse/Search result can be opened via a separate, read-only Listings GET.
 * Ambiguous Search choices are NEVER auto-selected, and neither selection nor
 * opening Listings invokes worker opt-in, posting, contact or verification.
 * Pure headless Back Navigation preserves an unexpired source page but cancels
 * selected Listings' late replies. Search/Browse can be revisited WITHOUT a
 * hidden request; worker writes and TTL still invalidate their data.
 * Separate in-process request intents allow a later fresh GET after a
 * failed/expired query or lifecycle recreation. Restoring intent NEVER
 * restores server data, selection, or in-flight requests and never sends GET.
 * No disk saving or automatic persistence is provided by this Core.
 * No polling, GPS, UI or public contact workflow.
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
    private var selectionState: CustomerSelectionState = CustomerSelectionState.Idle
    private var selectedCategory: PublicCategory? = null
    private var selectedSource: CustomerCategorySource? = null
    private var listingsSignal: CancellationSignal? = null
    private var destination = CustomerDestination.BROWSE
    private var browseIntent: CustomerBrowseIntent? = null
    private var searchIntent: CustomerSearchIntent? = null

    private fun intentLocked() = CustomerDiscoveryIntent(
        browseIntent, searchIntent,
        when (destination) {
            CustomerDestination.PUBLIC_LISTINGS ->
                if (selectedSource == CustomerCategorySource.SEARCH)
                    CustomerDestination.SEARCH else CustomerDestination.BROWSE
            else -> destination
        },
    )

    private fun navigationLocked() = CustomerNavigationState(
        destination,
        when (destination) {
            CustomerDestination.BROWSE -> null
            CustomerDestination.SEARCH -> CustomerDestination.BROWSE
            CustomerDestination.PUBLIC_LISTINGS ->
                when (selectedSource) {
                    CustomerCategorySource.BROWSE -> CustomerDestination.BROWSE
                    CustomerCategorySource.SEARCH -> CustomerDestination.SEARCH
                    null -> null
                }
        },
    )

    private fun resetSelectionLocked(refresh: Boolean) {
        if (destination == CustomerDestination.PUBLIC_LISTINGS) {
            destination = when (selectedSource) {
                CustomerCategorySource.SEARCH -> CustomerDestination.SEARCH
                else -> CustomerDestination.BROWSE
            }
        }
        listingsSignal?.cancel()
        listingsSignal = null
        selectedCategory = null
        selectedSource = null
        selectionState = if (refresh) CustomerSelectionState.RefreshRequired
            else CustomerSelectionState.Idle
    }

    private fun resetSelectionForLaneLocked(lane: Lane, refresh: Boolean) {
        if ((lane === browse && selectedSource == CustomerCategorySource.BROWSE) ||
            (lane === search && selectedSource == CustomerCategorySource.SEARCH)) {
            resetSelectionLocked(refresh)
        }
    }

    private fun reconcileLocked() {
        val current = session.publicReadMarker()
        if (current.revision != marker.revision) {
            browse.invalidate()
            search.invalidate()
            resetSelectionLocked(refresh = true)
        }
        marker = current
        val now = elapsedMillis()
        for (lane in listOf(browse, search)) {
            val started = lane.firstStarted ?: continue
            if (now < started || now - started >= publicFreshnessMillis) {
                lane.invalidate()
                resetSelectionForLaneLocked(lane, refresh = true)
            }
        }
    }

    fun snapshot(): CatalogPageSnapshot = synchronized(lock) {
        if (!closed) reconcileLocked()
        CatalogPageSnapshot(
            closed, browse.state, search.state, selectionState, navigationLocked(),
            intentLocked(),
        )
    }

    /** Current, reconciled public presentation. Pure projection: no GET,
     * private session data, implicit Category choice or automatic retry.
     */
    fun presentation(): CustomerViewState =
        HeadlessCustomerPresentation.project(snapshot())

    /** Capture a bounded navigation/query intent only. This is process-local
     * data, not permission to serialize a query to disk or remote analytics.
     * A closed scope cannot provide a resumable request.
     */
    fun captureRevisitIntent(): CustomerDiscoveryIntent? = synchronized(lock) {
        if (closed) null else {
            reconcileLocked()
            intentLocked()
        }
    }

    /** Restore ONLY request parameters onto a lifecycle-new scope. Validate
     * the complete candidate BEFORE clearing prior state, so malformed or
     * tampered inputs cannot erase the current state or trigger a GET.
     * Results are ALWAYS RefreshRequired, never rehydrated as Ready.
     */
    fun restoreRevisitIntent(intent: CustomerDiscoveryIntent): PageCompletion {
        require(intent.destination != CustomerDestination.PUBLIC_LISTINGS) {
            "Listings cannot be restored without a fresh Category selection"
        }
        intent.browse?.let {
            JodloRoutes.browse(it.language, it.availableOnly, it.pageSize)
        }
        intent.search?.let {
            JodloRoutes.search(it.query, it.language, it.availableOnly, true, it.pageSize, 0)
            require(it.query == Normalizer.normalize(it.query.trim(), Normalizer.Form.NFC)) {
                "Search intent must be normalized"
            }
        }
        // A user may navigate to Search BEFORE entering any query.
        // Restoring that valid empty Search destination must not invent a
        // search request or reject an otherwise safe navigation snapshot.
        // With null search intent the lane remains Idle and sends no GET.
        return synchronized(lock) {
            if (closed) return@synchronized PageCompletion.DISCARDED
            reconcileLocked()
            browse.invalidate()
            search.invalidate()
            resetSelectionLocked(refresh = false)
            browseIntent = intent.browse
            searchIntent = intent.search
            if (browseIntent == null) browse.close()
            if (searchIntent == null) search.close()
            destination = intent.destination
            PageCompletion.APPLIED
        }
    }

    /** Clear the current Search query, page results, choices and any
     * Search-derived Listings. Independent Browse cache/intent is preserved.
     * Clear is not a search request, so it sends no network traffic.
     */
    fun clearSearchIntent(): Boolean = synchronized(lock) {
        if (closed) return@synchronized false
        reconcileLocked()
        search.close()
        searchIntent = null
        resetSelectionForLaneLocked(search, refresh = false)
        if (destination == CustomerDestination.SEARCH) destination = CustomerDestination.BROWSE
        true
    }

    /** Explicitly forget all public discovery intent and results (logout,
     * new customer session, or caller-directed hard reset). No remote calls.
     */
    fun resetDiscovery(): Boolean = synchronized(lock) {
        if (closed) return@synchronized false
        browse.close()
        search.close()
        resetSelectionLocked(refresh = false)
        browseIntent = null
        searchIntent = null
        destination = CustomerDestination.BROWSE
        true
    }

    /** Headless routing only; switching destinations never starts a GET.
     * Previously cached pages remain subject to their original time window.
     * Public Listings are never retained as an invisible back-stack payload.
     */
    fun showBrowse(): PageCompletion = synchronized(lock) {
        if (closed) return@synchronized PageCompletion.DISCARDED
        reconcileLocked()
        resetSelectionLocked(refresh = false)
        destination = CustomerDestination.BROWSE
        PageCompletion.APPLIED
    }

    fun showSearch(): PageCompletion = synchronized(lock) {
        if (closed) return@synchronized PageCompletion.DISCARDED
        reconcileLocked()
        resetSelectionLocked(refresh = false)
        destination = CustomerDestination.SEARCH
        PageCompletion.APPLIED
    }

    /** One Back step: Listings -> chosen source, Search -> Browse.
     * No hidden network request or stale Listings restoration; Back at Browse
     * is a no-op and the outer future Android host may handle system exit.
     */
    fun back(): PageCompletion = synchronized(lock) {
        if (closed) return@synchronized PageCompletion.DISCARDED
        reconcileLocked()
        when (destination) {
            CustomerDestination.BROWSE -> PageCompletion.BLOCKED
            CustomerDestination.SEARCH -> {
                // Never leave a hidden Search lane stuck Loading. Retain an
                // already ready unexpired search for an explicit revisit.
                if (search.signal != null) search.invalidate()
                resetSelectionLocked(refresh = false)
                destination = CustomerDestination.BROWSE
                PageCompletion.APPLIED
            }
            CustomerDestination.PUBLIC_LISTINGS -> {
                resetSelectionLocked(refresh = false)
                PageCompletion.APPLIED
            }
        }
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
            resetSelectionLocked(refresh = true)
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
        destinationOnFirst: CustomerDestination? = null,
        newBrowseIntent: CustomerBrowseIntent? = null,
        newSearchIntent: CustomerSearchIntent? = null,
        recoveryOnly: Boolean = false,
    ): Admission = synchronized(lock) {
        if (closed) return@synchronized Admission.Discarded
        reconcileLocked()
        if (recoveryOnly) {
            // The retry must be attached to the same exact request intent,
            // not to a newer search that won the race after capture.
            if (!first || (lane.state !is PageState.Error &&
                    lane.state !== PageState.RefreshRequired))
                return@synchronized Admission.Blocked
            if (lane === browse && (newBrowseIntent == null ||
                    browseIntent != newBrowseIntent))
                return@synchronized Admission.Blocked
            if (lane === search && (newSearchIntent == null ||
                    searchIntent != newSearchIntent))
                return@synchronized Admission.Blocked
        }
        if (first) {
            if (lane === browse) browseIntent = requireNotNull(newBrowseIntent)
            if (lane === search) searchIntent = requireNotNull(newSearchIntent)
        }
        if (marker.writeInFlight) {
            lane.invalidate()
            resetSelectionForLaneLocked(lane, refresh = true)
            return@synchronized Admission.Deferred
        }
        val previous = if (first) null else (lane.state as? PageState.Ready
            ?: return@synchronized Admission.Blocked)
        if (previous != null && !hasNext(previous)) return@synchronized Admission.Blocked
        val time = if (first) elapsedMillis() else lane.firstStarted
            ?: return@synchronized Admission.Blocked
        lane.signal?.cancel()
        // The selected Category belongs to the OLD result generation.
        // Even a next-page attempt starts a new generation until applied.
        resetSelectionForLaneLocked(lane, refresh = false)
        val signal = CancellationSignal()
        lane.signal = signal
        lane.firstStarted = time
        lane.state = PageState.Loading
        if (first && destinationOnFirst != null) destination = destinationOnFirst
        Admission.Accepted(Ticket(signal, previous, time))
    }

    private fun run(
        lane: Lane, first: Boolean,
        hasNext: (PageState.Ready) -> Boolean,
        destinationOnFirst: CustomerDestination? = null,
        newBrowseIntent: CustomerBrowseIntent? = null,
        newSearchIntent: CustomerSearchIntent? = null,
        recoveryOnly: Boolean = false,
        request: (PageState.Ready?) -> ApiOutcome<PageState.Ready>,
    ): PageCompletion {
        val admission = admit(
            lane, first, hasNext, destinationOnFirst, newBrowseIntent, newSearchIntent,
            recoveryOnly,
        )
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
        return run(
            browse, first = true, hasNext = { true },
            destinationOnFirst = CustomerDestination.BROWSE,
            newBrowseIntent = CustomerBrowseIntent(language, availableOnly, pageSize),
        ) {
            browsePage(language, availableOnly, pageSize, null)
        }
    }

    /** One USER-initiated recovery attempt. Never retries automatically.
     * Only Failed/RefreshRequired public Browse can restart from page one;
     * READY, IDLE and LOADING remain blocked. No stale cursor replay.
     */
    fun retryBrowse(): PageCompletion {
        val intent = synchronized(lock) {
            if (!closed) {
                reconcileLocked()
                browseIntent
            } else null
        } ?: return synchronized(lock) {
            if (closed) PageCompletion.DISCARDED else PageCompletion.BLOCKED
        }
        return run(
            browse, first = true, hasNext = { true },
            destinationOnFirst = CustomerDestination.BROWSE,
            newBrowseIntent = intent, recoveryOnly = true,
        ) { browsePage(intent.language, intent.availableOnly, intent.pageSize, null) }
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
        return run(
            search, first = true, hasNext = { true },
            destinationOnFirst = CustomerDestination.SEARCH,
            newSearchIntent = CustomerSearchIntent(
                normalized, language, availableOnly, pageSize,
            ),
        ) {
            searchPage(normalized, language, availableOnly, pageSize, 0, true)
        }
    }

    /** User-initiated Search recovery from normalized query and filters.
     * The first page alone includes ambiguous choices; never reuse old
     * offsets, old results or a selected Category. No timers/backoff/GET.
     */
    fun retrySearch(): PageCompletion {
        val intent = synchronized(lock) {
            if (!closed) {
                reconcileLocked()
                searchIntent
            } else null
        } ?: return synchronized(lock) {
            if (closed) PageCompletion.DISCARDED else PageCompletion.BLOCKED
        }
        return run(
            search, first = true, hasNext = { true },
            destinationOnFirst = CustomerDestination.SEARCH,
            newSearchIntent = intent, recoveryOnly = true,
        ) {
            searchPage(intent.query, intent.language, intent.availableOnly, intent.pageSize,
                0, true)
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


    /** Only an exact item displayed in the CURRENT server-derived page may
     * become an explicit Customer selection. Search ambiguity uses choices,
     * normal Search uses categories; no inferred/first-result selection.
     */
    fun selectCategory(
        source: CustomerCategorySource, categoryId: String,
    ): PageCompletion {
        JodloRoutes.publicListings(categoryId)
        return synchronized(lock) {
            if (closed) return@synchronized PageCompletion.DISCARDED
            reconcileLocked()
            if (marker.writeInFlight) {
                resetSelectionLocked(refresh = true)
                return@synchronized PageCompletion.DEFERRED
            }
            val page = when (source) {
                CustomerCategorySource.BROWSE -> browse.state
                CustomerCategorySource.SEARCH -> search.state
            } as? PageState.Ready ?: return@synchronized PageCompletion.BLOCKED
            val allowed = if (source == CustomerCategorySource.SEARCH && page.needsChoice)
                page.choices else page.categories
            val category = allowed.singleOrNull { it.id == categoryId }
                ?: return@synchronized PageCompletion.BLOCKED
            resetSelectionLocked(refresh = false)
            selectedCategory = category
            selectedSource = source
            selectionState = CustomerSelectionState.Chosen(category, source)
            destination = CustomerDestination.PUBLIC_LISTINGS
            PageCompletion.APPLIED
        }
    }

    /** No GET is dispatched by selection alone. An explicit caller action
     * fetches only the chosen Category's public Listings. A later category
     * selection, new source page, worker write, TTL or close discards the
     * late response. No personal worker data is returned.
     */
    fun loadSelectedListings(): PageCompletion {
        data class Request(val category: PublicCategory, val source: CustomerCategorySource,
                           val signal: CancellationSignal)
        var deferred = false
        val request = synchronized(lock) {
            if (closed) return@synchronized null
            reconcileLocked()
            if (marker.writeInFlight) {
                resetSelectionLocked(refresh = true)
                deferred = true
                return@synchronized null
            }
            val category = selectedCategory ?: return@synchronized null
            val source = selectedSource ?: return@synchronized null
            if (selectionState is CustomerSelectionState.Loading)
                return@synchronized null
            val page = when (source) {
                CustomerCategorySource.BROWSE -> browse.state
                CustomerCategorySource.SEARCH -> search.state
            }
            if (page !is PageState.Ready) {
                resetSelectionLocked(refresh = true)
                return@synchronized null
            }
            val signal = CancellationSignal()
            listingsSignal?.cancel()
            listingsSignal = signal
            selectionState = CustomerSelectionState.Loading(category, source)
            Request(category, source, signal)
        } ?: return if (deferred) PageCompletion.DEFERRED else synchronized(lock) {
            if (closed) PageCompletion.DISCARDED else PageCompletion.BLOCKED
        }
        val result = if (request.signal.isCancelled)
            ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)
        else try {
            catalog.listings(request.category.id)
        } catch (_: Exception) {
            ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)
        }
        return synchronized(lock) {
            if (!closed) reconcileLocked()
            if (closed || listingsSignal !== request.signal ||
                request.signal.isCancelled || marker.writeInFlight ||
                selectedCategory != request.category || selectedSource != request.source) {
                return@synchronized PageCompletion.DISCARDED
            }
            selectionState = when (result) {
                is ApiOutcome.Failed -> CustomerSelectionState.Error(
                    request.category, request.source, result.kind)
                is ApiOutcome.Ok -> {
                    // Existing strict repository/decoder also validates this.
                    // Defend the headless coordination layer against fakes.
                    val rows = result.value
                    if (rows.size > 25 || rows.any { it.categoryId != request.category.id } ||
                        rows.map { it.id }.distinct().size != rows.size) {
                        CustomerSelectionState.Error(
                            request.category, request.source, FailureKind.BAD_RESPONSE)
                    } else CustomerSelectionState.Ready(
                        request.category, request.source, rows.toList())
                }
            }
            listingsSignal = null
            PageCompletion.APPLIED
        }
    }

    /** Explicitly leave Listings; a later GET requires another selection. */
    fun clearSelection() = synchronized(lock) {
        resetSelectionLocked(refresh = false)
    }

    fun close() = synchronized(lock) {
        closed = true
        browse.close()
        search.close()
        resetSelectionLocked(refresh = false)
        destination = CustomerDestination.BROWSE
        browseIntent = null
        searchIntent = null
    }
}
