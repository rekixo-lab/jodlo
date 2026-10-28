package com.rekixo.jodlo.core.network

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

private val PROOF = "a".repeat(43)
private fun category(id: String) = PublicCategory(id, id, "काम $id")
private val ONE = category("plumber")
private val TWO = category("carpenter")
private val THREE = category("electrician")
private val FOUR = category("painter")
private fun <T> threaded(block: () -> T) =
    FutureTask<T> { block() }.also { Thread(it, "jodlo-paging-fake").start() }
private fun <T> finished(task: FutureTask<T>): T = task.get(5, TimeUnit.SECONDS)
private fun reached(latch: CountDownLatch) =
    check(latch.await(5, TimeUnit.SECONDS)) { "Fake HTTP request never started" }

private class PagingFakeCatalog : CatalogRepository {
    val browseCalls = CopyOnWriteArrayList<String?>()
    data class SearchCall(val query: String, val choice: Boolean, val offset: Int)
    val searchCalls = CopyOnWriteArrayList<SearchCall>()
    var browseReply: (String?, Language, Int) -> ApiOutcome<CatalogBrowse> =
        { after, lang, _ -> ApiOutcome.Ok(CatalogBrowse(lang,
            if (after == null) listOf(ONE, TWO) else listOf(THREE),
            if (after == null) "2:carpenter" else null)) }
    var searchReply: (String, Language, Boolean, Int, Int) -> ApiOutcome<CatalogSearch> =
        { q, lang, _, limit, offset ->
            ApiOutcome.Ok(CatalogSearch(lang, q,
                if (offset == 0) listOf(ONE, TWO) else listOf(THREE),
                if (offset == 0) limit else null, false, emptyList()))
        }

    override fun browse(language: Language, availableOnly: Boolean, limit: Int,
                        after: String?): ApiOutcome<CatalogBrowse> {
        browseCalls.add(after)
        return browseReply(after, language, limit)
    }
    override fun search(query: String, language: Language, availableOnly: Boolean,
                        includeChoices: Boolean, limit: Int,
                        offset: Int): ApiOutcome<CatalogSearch> {
        searchCalls.add(SearchCall(query, includeChoices, offset))
        return searchReply(query, language, includeChoices, limit, offset)
    }
    override fun listings(categoryId: String): ApiOutcome<List<PublicListing>> =
        error("No listing GET in a Category pagination test")
}
private class PagingFakeWorker : WorkerRepository {
    var writeStarted: (() -> Unit)? = null
    val writes = AtomicInteger()
    override fun myDraft(session: String) = ApiOutcome.Ok(WorkerDraft("draft"))
    override fun optIn(session: String) = ApiOutcome.Ok(WorkerDraft("draft"))
    override fun myListings(session: String) = ApiOutcome.Ok(emptyList<OwnListing>())
    override fun publishExplicitCategory(session: String, confirmedCategoryId: String):
        ApiOutcome<PublicListing> {
        writes.incrementAndGet()
        writeStarted?.invoke()
        return ApiOutcome.Ok(PublicListing("11111111-1111-4111-8111-111111111111", confirmedCategoryId))
    }
    override fun unpublish(session: String, listingId: String): ApiOutcome<Boolean> {
        writes.incrementAndGet()
        return ApiOutcome.Ok(true)
    }
}
private fun session(worker: PagingFakeWorker, clock: AtomicLong): InMemorySessionCoordinator =
    InMemorySessionCoordinator(worker, RequestSender { error("Auth network unused") }, {clock.get()})
private fun signedIn(worker: PagingFakeWorker, clock: AtomicLong): InMemorySessionCoordinator =
    session(worker, clock).also {
        check(it.acceptIssuedSession(TransportReply(200,
            """{"ok":true,"data":{"accessToken":"$PROOF","tokenType":"Bearer","expiresInSeconds":3600}}"""))
            is ApiOutcome.Ok)
        check(it.optIn() == SessionResult.Success(WorkerState.DRAFT))
    }

private fun testCursorAppendWithDistinctIDsAndNoHiddenGET() {
    val fake = PagingFakeCatalog()
    val clock = AtomicLong(0)
    val scope = HeadlessCatalogPaginationScope(fake, session(PagingFakeWorker(), clock),
        { clock.get() }, 1_000)
    check(scope.startBrowse(Language.HI, pageSize = 2) == PageCompletion.APPLIED)
    val first = scope.snapshot().browse as PageState.Ready
    check(first.categories == listOf(ONE, TWO))
    check(first.nextCursor == "2:carpenter" && first.pageCount == 1)
    check(scope.nextBrowse() == PageCompletion.APPLIED)
    val combined = scope.snapshot().browse as PageState.Ready
    check(combined.categories == listOf(ONE, TWO, THREE) && combined.nextCursor == null)
    check(combined.pageCount == 2)
    check(scope.nextBrowse() == PageCompletion.BLOCKED)
    check(fake.browseCalls.toList() == listOf(null, "2:carpenter"))
    // Changing language/filter/page size starts from scratch, not from old cursor.
    check(scope.startBrowse(Language.EN, availableOnly = true, pageSize = 2) ==
        PageCompletion.APPLIED)
    val replaced = scope.snapshot().browse as PageState.Ready
    check(replaced.language == Language.EN && replaced.availableOnly)
    check(replaced.categories == listOf(ONE, TWO) && replaced.pageCount == 1)
    check(fake.browseCalls.toList() == listOf(null, "2:carpenter", null))
}

private fun testOffsetAppendAndFirstPageOnlyChoices() {
    val fake = PagingFakeCatalog()
    val clock = AtomicLong()
    val scope = HeadlessCatalogPaginationScope(fake, session(PagingFakeWorker(), clock),
        {clock.get()})
    check(scope.startSearch(" प्लंबर ", Language.HI, pageSize = 2) ==
        PageCompletion.APPLIED)
    check(scope.nextSearch() == PageCompletion.APPLIED)
    val ready = scope.snapshot().search as PageState.Ready
    check(ready.query == "प्लंबर" && ready.categories == listOf(ONE, TWO, THREE))
    check(ready.nextOffset == null && ready.pageCount == 2)
    check(scope.nextSearch() == PageCompletion.BLOCKED)
    check(fake.searchCalls.toList() == listOf(
        PagingFakeCatalog.SearchCall("प्लंबर", true, 0),
        PagingFakeCatalog.SearchCall("प्लंबर", false, 2)))
    // Search intent updates replace the old offset and old page.
    check(scope.startSearch("electrician", Language.EN, pageSize = 2) == PageCompletion.APPLIED)
    check((scope.snapshot().search as PageState.Ready).categories == listOf(ONE, TWO))

    fake.searchReply = { q, lang, _, _, _ ->
        ApiOutcome.Ok(CatalogSearch(lang,q,emptyList(),null,true,listOf(ONE,TWO)))
    }
    check(scope.startSearch("नल और लकड़ी", Language.HI) == PageCompletion.APPLIED)
    val choice = scope.snapshot().search as PageState.Ready
    check(choice.needsChoice && choice.categories.isEmpty() &&
        choice.choices == listOf(ONE, TWO) && choice.nextOffset == null)
    check(scope.nextSearch() == PageCompletion.BLOCKED)
}

private fun testDuplicatePageFailClosedWithoutPartialMixture() {
    val fake = PagingFakeCatalog()
    fake.browseReply = { after, lang, _ ->
        ApiOutcome.Ok(CatalogBrowse(lang,
            if (after == null) listOf(ONE,TWO) else listOf(TWO,THREE),
            if (after == null) "2:carpenter" else null))
    }
    val clock = AtomicLong()
    val scope = HeadlessCatalogPaginationScope(fake, session(PagingFakeWorker(),clock),
        {clock.get()})
    check(scope.startBrowse(Language.HI,pageSize=2) == PageCompletion.APPLIED)
    check(scope.nextBrowse() == PageCompletion.DISCARDED)
    check(scope.snapshot().browse == PageState.RefreshRequired)
    check(scope.nextBrowse() == PageCompletion.BLOCKED)
    check(fake.browseCalls.size == 2)
    // Same ID moved between search offsets: fail closed, not concatenate.
    fake.searchReply = { q,lang,_,limit,offset ->
        ApiOutcome.Ok(CatalogSearch(lang,q,
            if (offset == 0) listOf(ONE,TWO) else listOf(TWO,THREE),
            if (offset==0) limit else null,false,emptyList()))
    }
    check(scope.startSearch("plumber",Language.EN,pageSize=2) == PageCompletion.APPLIED)
    check(scope.nextSearch() == PageCompletion.DISCARDED)
    check(scope.snapshot().search == PageState.RefreshRequired)
}

private fun testSlowEarlierPageCannotOverrideChangedSearch() {
    val start = CountDownLatch(1)
    val release = CountDownLatch(1)
    val fake = PagingFakeCatalog()
    fake.searchReply = { q,lang,_,limit,offset ->
        if (q == "पुरानी खोज") {
            start.countDown()
            check(release.await(5,TimeUnit.SECONDS))
        }
        ApiOutcome.Ok(CatalogSearch(lang,q,listOf(ONE),null,false,emptyList()))
    }
    val clock = AtomicLong()
    val scope = HeadlessCatalogPaginationScope(fake, session(PagingFakeWorker(),clock),
        {clock.get()})
    val slow = threaded { scope.startSearch("पुरानी खोज",Language.HI) }
    try {
        reached(start)
        check(scope.snapshot().search == PageState.Loading)
        check(scope.startSearch("नई खोज",Language.HI) == PageCompletion.APPLIED)
    } finally {
        release.countDown()
    }
    check(finished(slow) == PageCompletion.DISCARDED)
    val ready = scope.snapshot().search as PageState.Ready
    check(ready.query == "नई खोज" && ready.categories == listOf(ONE))
}

private fun testWholeSequenceTTLAndSlowPage() {
    val clock = AtomicLong(1_000)
    val fake = PagingFakeCatalog()
    val scope = HeadlessCatalogPaginationScope(fake, session(PagingFakeWorker(),clock),
        {clock.get()},1_000)
    check(scope.startBrowse(Language.HI,pageSize=2) == PageCompletion.APPLIED)
    clock.set(1_900)
    fake.browseReply = { after,lang,_ ->
        if (after != null) clock.set(2_001)
        ApiOutcome.Ok(CatalogBrowse(lang,if (after==null) listOf(ONE,TWO)
            else listOf(THREE),if (after==null) "2:carpenter" else null))
    }
    check(scope.nextBrowse() == PageCompletion.DISCARDED)
    check(scope.snapshot().browse == PageState.RefreshRequired)
    check(fake.browseCalls.size == 2) // No automatic restart
    check(scope.nextBrowse() == PageCompletion.BLOCKED)
    check(scope.startBrowse(Language.HI,pageSize=2) == PageCompletion.APPLIED)
    clock.set(3_001)
    check(scope.snapshot().browse == PageState.RefreshRequired)
}

private fun testWorkerWriteDefersNewPageAndDiscardsOld() {
    val clock = AtomicLong()
    val worker = PagingFakeWorker()
    val session = signedIn(worker, clock)
    val fake = PagingFakeCatalog()
    val scope = HeadlessCatalogPaginationScope(fake,session,{clock.get()})
    check(scope.startBrowse(Language.HI,pageSize=2) == PageCompletion.APPLIED)
    val start = CountDownLatch(1)
    val release = CountDownLatch(1)
    worker.writeStarted = {
        start.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val slow = threaded { session.publishExplicitCategory("plumber") }
    try {
        reached(start)
        check(scope.snapshot().browse == PageState.RefreshRequired)
        check(scope.nextBrowse() == PageCompletion.DEFERRED)
        check(scope.startSearch("plumber",Language.EN) == PageCompletion.DEFERRED)
        check(fake.searchCalls.isEmpty() && fake.browseCalls.size == 1)
    } finally {
        release.countDown()
    }
    check(finished(slow) is SessionResult.Success)
    check(scope.snapshot().browse == PageState.RefreshRequired)
    check(scope.startBrowse(Language.HI,pageSize=2) == PageCompletion.APPLIED)
    check(fake.browseCalls.size == 2 && worker.writes.get()==1)
}

private fun testManualRefreshAndCloseRejectLateContinuation() {
    val start = CountDownLatch(1)
    val release = CountDownLatch(1)
    val clock = AtomicLong()
    val fake = PagingFakeCatalog()
    val scope = HeadlessCatalogPaginationScope(fake,session(PagingFakeWorker(),clock),
        {clock.get()})
    check(scope.startBrowse(Language.HI,pageSize=2) == PageCompletion.APPLIED)
    fake.browseReply = { after,lang,_ ->
        if (after != null) {
            start.countDown()
            check(release.await(5,TimeUnit.SECONDS))
        }
        ApiOutcome.Ok(CatalogBrowse(lang,listOf(THREE),null))
    }
    val page = threaded { scope.nextBrowse() }
    try {
        reached(start)
        check(scope.requestRefresh())
        check(scope.snapshot().browse == PageState.RefreshRequired)
        check(scope.snapshot().search == PageState.RefreshRequired)
    } finally {
        release.countDown()
    }
    check(finished(page)==PageCompletion.DISCARDED)
    check(scope.snapshot().browse==PageState.RefreshRequired)
    scope.close()
    check(!scope.requestRefresh())
    check(scope.snapshot()==CatalogPageSnapshot(true,PageState.Idle,PageState.Idle))
    check(scope.startBrowse(Language.HI)==PageCompletion.DISCARDED)
    check(fake.browseCalls.size==2)
}

private fun testBadInputDoesNotReplaceValidPageAndNoUnsupportedOffset() {
    val fake = PagingFakeCatalog()
    val clock = AtomicLong()
    val scope = HeadlessCatalogPaginationScope(fake,session(PagingFakeWorker(),clock),
        {clock.get()})
    check(scope.startBrowse(Language.EN,pageSize=2)==PageCompletion.APPLIED)
    check(runCatching {scope.startBrowse(Language.EN,pageSize=50)}.isFailure)
    check((scope.snapshot().browse as PageState.Ready).categories==listOf(ONE,TWO))
    check(scope.startSearch("electrician",Language.EN,pageSize=2)==PageCompletion.APPLIED)
    check(runCatching {scope.startSearch("x",Language.EN)}.isFailure)
    check((scope.snapshot().search as PageState.Ready).query=="electrician")
    fake.searchReply = {q,lang,_,limit,_ ->
        ApiOutcome.Ok(CatalogSearch(lang,q,listOf(ONE,TWO),125,false,emptyList()))
    }
    check(scope.startSearch("electrician",Language.EN,pageSize=25)==PageCompletion.APPLIED)
    check((scope.snapshot().search as PageState.Ready).nextOffset == null)
    check(scope.nextSearch()==PageCompletion.BLOCKED)
}

fun main() {
    testCursorAppendWithDistinctIDsAndNoHiddenGET()
    testOffsetAppendAndFirstPageOnlyChoices()
    testDuplicatePageFailClosedWithoutPartialMixture()
    testSlowEarlierPageCannotOverrideChangedSearch()
    testWholeSequenceTTLAndSlowPage()
    testWorkerWriteDefersNewPageAndDiscardsOld()
    testManualRefreshAndCloseRejectLateContinuation()
    testBadInputDoesNotReplaceValidPageAndNoUnsupportedOffset()
    println("JODLO pagination: cursor/offset isolation, duplicate fail-close, TTL and worker write safety OK")
}
