package com.rekixo.jodlo.core.network

import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

private const val FRESH_LISTING_ID = "11111111-1111-4111-8111-111111111111"
private val FRESH_TOKEN = "a".repeat(43)
private val FRESH_CATEGORY = PublicCategory("plumber", "plumber", "प्लंबर")
private fun <T> runOnNetworkThread(op: () -> T) =
    FutureTask<T> { op() }.also { Thread(it, "jodlo-freshness-test").start() }
private fun <T> finished(task: FutureTask<T>): T = task.get(5, TimeUnit.SECONDS)
private fun reach(latch: CountDownLatch) {
    check(latch.await(5, TimeUnit.SECONDS)) { "Slow public GET did not begin" }
}

private class FreshnessFakeCatalog : CatalogRepository {
    val browseCalls = AtomicInteger()
    val searchCalls = AtomicInteger()
    val listingCalls = AtomicInteger()
    var beforeListing: (() -> Unit)? = null
    override fun browse(language: Language, availableOnly: Boolean, limit: Int,
                        after: String?): ApiOutcome<CatalogBrowse> {
        browseCalls.incrementAndGet()
        return ApiOutcome.Ok(CatalogBrowse(language, listOf(FRESH_CATEGORY), null))
    }
    override fun search(query: String, language: Language, availableOnly: Boolean,
                        includeChoices: Boolean, limit: Int,
                        offset: Int): ApiOutcome<CatalogSearch> {
        searchCalls.incrementAndGet()
        return ApiOutcome.Ok(CatalogSearch(language, query, listOf(FRESH_CATEGORY), null, false,
            emptyList()))
    }
    override fun listings(categoryId: String): ApiOutcome<List<PublicListing>> {
        listingCalls.incrementAndGet()
        beforeListing?.invoke()
        return ApiOutcome.Ok(listOf(PublicListing(FRESH_LISTING_ID, categoryId)))
    }
}
private fun freshnessScope(
    cat: CatalogRepository, clock: AtomicLong, limit: Long = 1_000L,
    session: InMemorySessionCoordinator = InMemorySessionCoordinator(
        RemoteWorkerRepository(RequestSender { error("Worker network not expected") }),
        RequestSender { error("Auth network not expected") },
        { clock.get() },
    ),
) = HeadlessMarketplaceReadScope(cat, session, { clock.get() }, limit)

private fun fill(scope: HeadlessMarketplaceReadScope) {
    check(scope.browse(Language.HI, availableOnly = true) == ReadCompletion.APPLIED)
    check(scope.search("प्लंबर", Language.HI, availableOnly = true) == ReadCompletion.APPLIED)
    check(scope.publicListings("plumber") == ReadCompletion.APPLIED)
    val state = scope.snapshot()
    check(state.browse is ReadState.Ready)
    check(state.search is ReadState.Ready)
    check(state.publicListings is ReadState.Ready)
}

/** Public snapshot bounded by request START, without timers or background GETs. */
private fun testExactBoundaryExpiresEachPublicLane() {
    val clock = AtomicLong(10_000L)
    val cat = FreshnessFakeCatalog()
    val scope = freshnessScope(cat, clock)
    fill(scope)
    clock.addAndGet(999L)
    check(scope.snapshot().browse is ReadState.Ready)
    check(scope.snapshot().search is ReadState.Ready)
    check(scope.snapshot().publicListings is ReadState.Ready)
    clock.incrementAndGet()
    val expired = scope.snapshot()
    check(expired.browse == ReadState.RefreshRequired)
    check(expired.search == ReadState.RefreshRequired)
    check(expired.publicListings == ReadState.RefreshRequired)
    check(cat.browseCalls.get() == 1)
    check(cat.searchCalls.get() == 1)
    check(cat.listingCalls.get() == 1)
    // One explicit refetch updates only the requested lane.
    check(scope.publicListings("plumber") == ReadCompletion.APPLIED)
    check(scope.snapshot().publicListings is ReadState.Ready)
    check(scope.snapshot().browse == ReadState.RefreshRequired)
    check(scope.snapshot().search == ReadState.RefreshRequired)
    check(cat.listingCalls.get() == 2)
}

private fun testSlowGETAlreadyStaleBeforeServerReplies() {
    val clock = AtomicLong(100L)
    val cat = FreshnessFakeCatalog()
    val scope = freshnessScope(cat, clock)
    cat.beforeListing = { clock.addAndGet(1_001L) }
    check(scope.publicListings("plumber") == ReadCompletion.DISCARDED)
    check(scope.snapshot().publicListings == ReadState.RefreshRequired)
    check(cat.listingCalls.get() == 1)
    cat.beforeListing = null
    check(scope.publicListings("plumber") == ReadCompletion.APPLIED)
    check(scope.snapshot().publicListings is ReadState.Ready)
    check(cat.listingCalls.get() == 2)
}

private fun testManualRefreshCancelsSlowGETAndPreservesNoAutomaticNetwork() {
    val clock = AtomicLong(2_000L)
    val cat = FreshnessFakeCatalog()
    val scope = freshnessScope(cat, clock)
    fill(scope)
    val begun = CountDownLatch(1)
    val release = CountDownLatch(1)
    cat.beforeListing = {
        begun.countDown()
        check(release.await(5, TimeUnit.SECONDS))
    }
    val old = runOnNetworkThread { scope.publicListings("plumber") }
    try {
        reach(begun)
        check(scope.snapshot().publicListings == ReadState.Loading)
        check(scope.requestPublicRefresh())
        val marked = scope.snapshot()
        check(marked.browse == ReadState.RefreshRequired)
        check(marked.search == ReadState.RefreshRequired)
        check(marked.publicListings == ReadState.RefreshRequired)
        // No hidden GET performed for other lanes.
        check(cat.browseCalls.get() == 1)
        check(cat.searchCalls.get() == 1)
        check(cat.listingCalls.get() == 2)
    } finally {
        release.countDown()
    }
    check(finished(old) == ReadCompletion.DISCARDED)
    check(scope.snapshot().publicListings == ReadState.RefreshRequired)
    cat.beforeListing = null
    check(scope.search("प्लंबर", Language.HI) == ReadCompletion.APPLIED)
    check(scope.snapshot().search is ReadState.Ready)
    check(scope.snapshot().browse == ReadState.RefreshRequired)
}

private fun testMonotonicClockRollbackFailsClosed() {
    val clock = AtomicLong(5_000L)
    val scope = freshnessScope(FreshnessFakeCatalog(), clock)
    check(scope.publicListings("plumber") == ReadCompletion.APPLIED)
    clock.set(4_999L) // Unexpected monotonic regression: do not accept old data.
    check(scope.snapshot().publicListings == ReadState.RefreshRequired)
}

private fun testPublicExpiryDoesNotEraseWorkerStateOrSignOut() {
    val clock = AtomicLong(10_000L)
    val cat = FreshnessFakeCatalog()
    val worker = object : WorkerRepository {
        override fun myDraft(session: String): ApiOutcome<WorkerDraft> =
            ApiOutcome.Ok(WorkerDraft("draft"))
        override fun optIn(session: String): ApiOutcome<WorkerDraft> =
            ApiOutcome.Ok(WorkerDraft("draft"))
        override fun myListings(session: String): ApiOutcome<List<OwnListing>> =
            ApiOutcome.Ok(emptyList())
        override fun publishExplicitCategory(session: String, confirmedCategoryId: String):
            ApiOutcome<PublicListing> = error("Write must not occur")
        override fun unpublish(session: String, listingId: String):
            ApiOutcome<Boolean> = error("Write must not occur")
    }
    val coordinator = InMemorySessionCoordinator(worker,
        RequestSender { error("Auth network not expected") }, { clock.get() })
    val issued = TransportReply(200,
        """{"ok":true,"data":{"accessToken":"$FRESH_TOKEN","tokenType":"Bearer","expiresInSeconds":3600}}""")
    check(coordinator.acceptIssuedSession(issued) is ApiOutcome.Ok)
    val scope = freshnessScope(cat, clock, session = coordinator)
    check(scope.checkWorker() == ReadCompletion.APPLIED)
    check(scope.ownListings() == ReadCompletion.APPLIED)
    check(scope.browse(Language.EN) == ReadCompletion.APPLIED)
    clock.addAndGet(1_000L)
    val snapshot = scope.snapshot()
    check(snapshot.browse == ReadState.RefreshRequired)
    check(snapshot.worker == ReadState.Ready(WorkerState.DRAFT))
    check(snapshot.ownListings == ReadState.Ready(emptyList<OwnListing>()))
    check(coordinator.snapshot() == LoginState.SignedIn(WorkerState.DRAFT))
}

private fun testClosedScopeIsPermanentlyEmptyAndWindowIsValidated() {
    val clock = AtomicLong(0L)
    val cat = FreshnessFakeCatalog()
    for (bad in listOf(0L, -1L, 300_001L, Long.MAX_VALUE)) {
        check(runCatching { freshnessScope(cat, clock, bad) }.isFailure)
    }
    val scope = freshnessScope(cat, clock, 1L)
    fill(scope)
    scope.close()
    clock.set(1_000_000L)
    check(!scope.requestPublicRefresh())
    val snapshot = scope.snapshot()
    check(snapshot.closed && snapshot.browse == ReadState.Idle)
    check(snapshot.search == ReadState.Idle)
    check(snapshot.publicListings == ReadState.Idle)
    check(scope.publicListings("plumber") == ReadCompletion.DISCARDED)
    check(cat.listingCalls.get() == 1)
}

fun main() {
    testExactBoundaryExpiresEachPublicLane()
    testSlowGETAlreadyStaleBeforeServerReplies()
    testManualRefreshCancelsSlowGETAndPreservesNoAutomaticNetwork()
    testMonotonicClockRollbackFailsClosed()
    testPublicExpiryDoesNotEraseWorkerStateOrSignOut()
    testClosedScopeIsPermanentlyEmptyAndWindowIsValidated()
    println("JODLO public cache freshness: bounded age, slow GET, manual invalidate and private isolation OK")
}
