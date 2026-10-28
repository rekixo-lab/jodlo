package com.rekixo.jodlo.core.network

import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

private const val LISTING = "11111111-1111-4111-8111-111111111111"
private val SESSION_TOKEN = "a".repeat(43)
private val PLUMBER = PublicCategory("plumber", "plumber", "प्लंबर")

private fun issuedToken() = TransportReply(200,
    """{"ok":true,"data":{"accessToken":"$SESSION_TOKEN","tokenType":"Bearer","expiresInSeconds":3600}}""")
private fun failure(status: Int, code: String) = TransportReply(status,
    """{"ok":false,"error":{"code":"$code","message":"server detail not exposed"}}""")
private fun <T> asynchronous(operation: () -> T) =
    FutureTask<T> { operation() }.also { Thread(it, "jodlo-fake-background").start() }
private fun <T> completed(task: FutureTask<T>): T = task.get(5, TimeUnit.SECONDS)
private fun reached(latch: CountDownLatch) {
    check(latch.await(5, TimeUnit.SECONDS)) { "Fake network request not reached" }
}

private class RefreshFakeCatalog : CatalogRepository {
    val browseCalls = AtomicInteger()
    val searchCalls = AtomicInteger()
    val publicCalls = AtomicInteger()
    var beforePublic: (() -> Unit)? = null
    override fun browse(language: Language, availableOnly: Boolean, limit: Int,
                        after: String?): ApiOutcome<CatalogBrowse> {
        browseCalls.incrementAndGet()
        return ApiOutcome.Ok(CatalogBrowse(language, listOf(PLUMBER), null))
    }
    override fun search(query: String, language: Language, availableOnly: Boolean,
                        includeChoices: Boolean, limit: Int, offset: Int): ApiOutcome<CatalogSearch> {
        searchCalls.incrementAndGet()
        return ApiOutcome.Ok(CatalogSearch(language, query, listOf(PLUMBER),
            null, false, emptyList()))
    }
    override fun listings(categoryId: String): ApiOutcome<List<PublicListing>> {
        publicCalls.incrementAndGet()
        beforePublic?.invoke()
        return ApiOutcome.Ok(listOf(PublicListing(LISTING, categoryId)))
    }
}

private class RefreshFakeWorker : WorkerRepository {
    val writes = AtomicInteger()
    var beforePublish: (() -> Unit)? = null
    var posting: ApiOutcome<PublicListing> =
        ApiOutcome.Ok(PublicListing(LISTING, "plumber"))
    override fun myDraft(session: String): ApiOutcome<WorkerDraft> =
        ApiOutcome.Ok(WorkerDraft("draft"))
    override fun optIn(session: String): ApiOutcome<WorkerDraft> =
        ApiOutcome.Ok(WorkerDraft("draft"))
    override fun myListings(session: String): ApiOutcome<List<OwnListing>> =
        ApiOutcome.Ok(emptyList())
    override fun publishExplicitCategory(session: String, confirmedCategoryId: String):
        ApiOutcome<PublicListing> {
        writes.incrementAndGet()
        beforePublish?.invoke()
        return posting
    }
    override fun unpublish(session: String, listingId: String): ApiOutcome<Boolean> {
        writes.incrementAndGet()
        return ApiOutcome.Ok(true)
    }
}

private fun makeSession(worker: RefreshFakeWorker): InMemorySessionCoordinator =
    InMemorySessionCoordinator(worker, RequestSender { failure(503,"SERVICE_UNAVAILABLE") }) {
        0L
    }.also {
        check(it.acceptIssuedSession(issuedToken()) is ApiOutcome.Ok)
        check(it.optIn() == SessionResult.Success(WorkerState.DRAFT))
    }

private fun populate(reads: HeadlessMarketplaceReadScope) {
    check(reads.browse(Language.HI, availableOnly = true) == ReadCompletion.APPLIED)
    check(reads.search("प्लंबर", Language.HI, availableOnly = true) == ReadCompletion.APPLIED)
    check(reads.publicListings("plumber") == ReadCompletion.APPLIED)
    val state = reads.snapshot()
    check(state.browse is ReadState.Ready)
    check(state.search is ReadState.Ready)
    check(state.publicListings is ReadState.Ready)
}

/** A successful explicit publish makes every public lane stale until a GET. */
private fun testSuccessfulWriteMarksAllPublicLanes() {
    val catalog = RefreshFakeCatalog()
    val worker = RefreshFakeWorker()
    val session = makeSession(worker)
    val reads = HeadlessMarketplaceReadScope(catalog, session)
    populate(reads)
    check(session.publishExplicitCategory("plumber") ==
        SessionResult.Success(PublicListing(LISTING, "plumber")))
    val after = reads.snapshot()
    check(after.browse == ReadState.RefreshRequired)
    check(after.search == ReadState.RefreshRequired)
    check(after.publicListings == ReadState.RefreshRequired)
    check(catalog.browseCalls.get() == 1 && catalog.searchCalls.get() == 1 &&
        catalog.publicCalls.get() == 1) // no automatic GET
    check(reads.publicListings("plumber") == ReadCompletion.APPLIED)
    check(reads.snapshot().publicListings is ReadState.Ready)
    check(reads.snapshot().browse == ReadState.RefreshRequired)
    check(reads.snapshot().search == ReadState.RefreshRequired)
    check(worker.writes.get() == 1)
}

/** An uncertain POST can still publish remotely: old Customer data must go. */
private fun testTimeoutAndUnpublishInvalidateWithoutRetry() {
    val catalog = RefreshFakeCatalog()
    val worker = RefreshFakeWorker()
    val session = makeSession(worker)
    val reads = HeadlessMarketplaceReadScope(catalog, session)
    populate(reads)
    worker.posting = ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT, false)
    val writes = HeadlessWorkerWriteScope(session)
    check(writes.publishExplicitCategory("plumber") == WorkerWriteCompletion.APPLIED)
    check(writes.snapshot().state is WorkerWriteState.NeedsReview)
    check(reads.snapshot().publicListings == ReadState.RefreshRequired)
    check(worker.writes.get() == 1)
    check(catalog.publicCalls.get() == 1)
    // A previous uncertainty guard stays intact even when a GET is performed.
    check(reads.publicListings("plumber") == ReadCompletion.APPLIED)
    check(writes.snapshot().state is WorkerWriteState.NeedsReview)
    check(writes.acknowledgeUncertainty())
    check(writes.unpublish(LISTING) == WorkerWriteCompletion.APPLIED)
    check(reads.snapshot().publicListings == ReadState.RefreshRequired)
    check(worker.writes.get() == 2)
}

/** Public GETs while a worker write is on the wire must be deferred, not
 * accepted as fresh snapshots that could become stale a millisecond later.
 */
private fun testNoGETDuringSlowWriteAndExplicitRefreshAfterwards() {
    val start = CountDownLatch(1)
    val release = CountDownLatch(1)
    val catalog = RefreshFakeCatalog()
    val worker = RefreshFakeWorker()
    val session = makeSession(worker)
    val reads = HeadlessMarketplaceReadScope(catalog, session)
    populate(reads)
    worker.beforePublish = {
        start.countDown()
        check(release.await(5, TimeUnit.SECONDS))
    }
    val future = asynchronous { session.publishExplicitCategory("plumber") }
    try {
        reached(start)
        check(reads.snapshot().publicListings == ReadState.RefreshRequired)
        check(reads.search("प्लंबर", Language.HI) == ReadCompletion.DEFERRED)
        check(reads.browse(Language.HI) == ReadCompletion.DEFERRED)
        check(reads.publicListings("plumber") == ReadCompletion.DEFERRED)
        check(catalog.publicCalls.get() == 1 && catalog.searchCalls.get() == 1 &&
            catalog.browseCalls.get() == 1)
    } finally {
        release.countDown()
    }
    check(completed(future) is SessionResult.Success)
    check(reads.snapshot().publicListings == ReadState.RefreshRequired)
    check(reads.publicListings("plumber") == ReadCompletion.APPLIED)
    check(catalog.publicCalls.get() == 2 && worker.writes.get() == 1)
}

/** A GET started before a write cannot overwrite refreshed state afterwards. */
private fun testSlowOldGETRejectedWhenWriteFinishes() {
    val start = CountDownLatch(1)
    val release = CountDownLatch(1)
    val catalog = RefreshFakeCatalog()
    val worker = RefreshFakeWorker()
    val session = makeSession(worker)
    val reads = HeadlessMarketplaceReadScope(catalog, session)
    catalog.beforePublic = {
        start.countDown()
        check(release.await(5, TimeUnit.SECONDS))
    }
    val old = asynchronous { reads.publicListings("plumber") }
    try {
        reached(start)
        check(reads.snapshot().publicListings == ReadState.Loading)
        check(session.unpublish(LISTING) == SessionResult.Success(true))
        check(reads.snapshot().publicListings == ReadState.RefreshRequired)
    } finally {
        release.countDown()
    }
    check(completed(old) == ReadCompletion.DISCARDED)
    check(reads.snapshot().publicListings == ReadState.RefreshRequired)
    catalog.beforePublic = null
    check(reads.publicListings("plumber") == ReadCompletion.APPLIED)
    check(reads.snapshot().publicListings is ReadState.Ready)
}

/** The GET may start after a write starts but before it resolves. Even if
 * it returns early, write finish must require another explicit fresh GET.
 */
private fun testSlowWriteFinishesAfterPriorPublicRequest() {
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val catalog = RefreshFakeCatalog()
    val worker = RefreshFakeWorker()
    val session = makeSession(worker)
    val reads = HeadlessMarketplaceReadScope(catalog, session)
    val old = asynchronous {
        catalog.beforePublic = {
            started.countDown()
            check(release.await(5, TimeUnit.SECONDS))
        }
        reads.publicListings("plumber")
    }
    try {
        reached(started)
        check(session.publishExplicitCategory("plumber") is SessionResult.Success)
    } finally {
        release.countDown()
    }
    check(completed(old) == ReadCompletion.DISCARDED)
    check(reads.snapshot().publicListings == ReadState.RefreshRequired)
}

/** Read-only worker status and account replacement do not require public-data
 * refresh. Only actual reserved write attempts advance the public marker.
 */
private fun testNoSpuriousRefreshForWorkerReadsOrAccountChange() {
    val catalog = RefreshFakeCatalog()
    val worker = RefreshFakeWorker()
    val session = makeSession(worker)
    val reads = HeadlessMarketplaceReadScope(catalog, session)
    populate(reads)
    check(session.checkWorker() == SessionResult.Success(WorkerState.DRAFT))
    check(session.acceptIssuedSession(issuedToken()) is ApiOutcome.Ok)
    check(reads.snapshot().browse is ReadState.Ready)
    check(reads.snapshot().search is ReadState.Ready)
    check(reads.snapshot().publicListings is ReadState.Ready)
}

/** Future callers may close during a write; late completions cannot resurrect
 * public snapshots and no implicit refresh or retry is scheduled.
 */
private fun testClosedScopeRemainsClosedDuringWrite() {
    val catalog = RefreshFakeCatalog()
    val worker = RefreshFakeWorker()
    val session = makeSession(worker)
    val reads = HeadlessMarketplaceReadScope(catalog, session)
    populate(reads)
    reads.close()
    check(session.publishExplicitCategory("plumber") is SessionResult.Success)
    val after = reads.snapshot()
    check(after.closed)
    check(after.publicListings == ReadState.RefreshRequired || after.publicListings == ReadState.Idle)
    check(reads.publicListings("plumber") == ReadCompletion.DISCARDED)
    check(worker.writes.get() == 1 && catalog.publicCalls.get() == 1)
}

fun main() {
    testSuccessfulWriteMarksAllPublicLanes()
    testTimeoutAndUnpublishInvalidateWithoutRetry()
    testNoGETDuringSlowWriteAndExplicitRefreshAfterwards()
    testSlowOldGETRejectedWhenWriteFinishes()
    testSlowWriteFinishesAfterPriorPublicRequest()
    testNoSpuriousRefreshForWorkerReadsOrAccountChange()
    testClosedScopeRemainsClosedDuringWrite()
    println("JODLO public refresh: old GET discarded, write barrier deferred, explicit refetch safe OK")
}
