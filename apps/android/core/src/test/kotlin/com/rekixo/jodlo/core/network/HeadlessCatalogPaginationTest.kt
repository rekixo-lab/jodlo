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

private class PagingFakeCatalog : CatalogRepository, CatalogSearchCursorRepository {
    val browseCalls = CopyOnWriteArrayList<String?>()
    data class SearchCall(val query: String, val choice: Boolean, val offset: Int)
    val searchCalls = CopyOnWriteArrayList<SearchCall>()
    data class CursorCall(val query: String, val availableOnly: Boolean,
                          val limit: Int, val after: String?)
    val cursorCalls = CopyOnWriteArrayList<CursorCall>()
    var cursorReply: (String, Language, Boolean, Int, String?) ->
        ApiOutcome<CatalogSearchCursorPage> = { q, lang, _, _, after ->
            ApiOutcome.Ok(CatalogSearchCursorPage(lang,q,
                if(after==null) listOf(ONE,TWO) else listOf(THREE),
                if(after==null) "2:carpenter" else null))
        }
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
    override fun searchCursor(query: String, language: Language, availableOnly: Boolean,
                              limit: Int, after: String?): ApiOutcome<CatalogSearchCursorPage> {
        cursorCalls.add(CursorCall(query,availableOnly,limit,after))
        return cursorReply(query,language,availableOnly,limit,after)
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
    fake.searchReply = {q,lang,_,limit,offset ->
        ApiOutcome.Ok(CatalogSearch(lang,q,listOf(category("trade$offset")),
            offset + limit,false,emptyList()))
    }
    check(scope.startSearch("electrician",Language.EN,pageSize=25)==PageCompletion.APPLIED)
    repeat(4) { check(scope.nextSearch()==PageCompletion.APPLIED) }
    val end = scope.snapshot().search as PageState.Ready
    check(end.categories.map {it.id} ==
        listOf("trade0","trade25","trade50","trade75","trade100"))
    check(end.nextOffset == null) // Backend 125 exceeds route maximum of 100.
    check(scope.nextSearch()==PageCompletion.BLOCKED)
}


private fun testAll889CursorSearchAndLegacyIsolation() {
    val fake=PagingFakeCatalog()
    val clock=AtomicLong(0)
    val all=(0 until 889).map {i->
        val id="cat-"+i.toString().padStart(4,'0')
        PublicCategory(id,id,"काम $i")
    }
    val positions=all.mapIndexed { i,c -> "${i/3}:${c.id}" }
    fake.cursorReply={q,lang,available,limit,after->
        check(q=="सेवा" && lang==Language.HI && available && limit==25)
        val start=if(after==null) 0 else positions.indexOf(after)+1
        check(start in 0..889 && (after==null||start>0))
        val rows=all.drop(start).take(limit)
        val next=if(start+rows.size<all.size) positions[start+rows.size-1] else null
        ApiOutcome.Ok(CatalogSearchCursorPage(lang,q,rows,next))
    }
    val scope=HeadlessCatalogPaginationScope(fake,
        session(PagingFakeWorker(),clock),{clock.get()},1_000)
    check(scope.startCursorSearch(" सेवा ",Language.HI,availableOnly=true,pageSize=25)==
        PageCompletion.APPLIED)
    check(scope.snapshot().intent.search?.cursorMode==true)
    check(scope.nextSearch()==PageCompletion.BLOCKED)
    repeat(35){check(scope.nextCursorSearch()==PageCompletion.APPLIED)}
    val ready=scope.snapshot().search as PageState.Ready
    check(ready.searchCursorMode && !ready.needsChoice && ready.nextOffset==null)
    check(ready.categories.size==889 && ready.categories.map{it.id}.distinct().size==889)
    check(ready.categories.first().id=="cat-0000"&&ready.categories.last().id=="cat-0888")
    check(ready.nextCursor==null && ready.pageCount==36)
    check(fake.cursorCalls.size==36 && fake.searchCalls.isEmpty())
    check(scope.nextCursorSearch()==PageCompletion.BLOCKED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH,"cat-0888")==PageCompletion.APPLIED)
    check(scope.snapshot().selection is CustomerSelectionState.Chosen)
    check(scope.showSearch()==PageCompletion.APPLIED)
    check(scope.startSearch("प्लंबर",Language.HI,pageSize=2)==PageCompletion.APPLIED)
    check((scope.snapshot().search as PageState.Ready).searchCursorMode==false)
    check(scope.nextCursorSearch()==PageCompletion.BLOCKED)
    check(fake.searchCalls.single().offset==0)
}

private fun testCursorSearchTamperFallbackRetryAndRestore() {
    val fake=PagingFakeCatalog()
    val clock=AtomicLong()
    val scope=HeadlessCatalogPaginationScope(fake,
        session(PagingFakeWorker(),clock),{clock.get()},1_000)
    val old:CatalogRepository=object:CatalogRepository by fake {}
    val legacy=HeadlessCatalogPaginationScope(old,
        session(PagingFakeWorker(),clock),{clock.get()})
    check(legacy.startSearch("प्लंबर",Language.HI,pageSize=2)==PageCompletion.APPLIED)
    check(legacy.startCursorSearch("सेवा",Language.HI)==PageCompletion.BLOCKED)
    check((legacy.snapshot().search as PageState.Ready).query=="प्लंबर")
    check(scope.startCursorSearch("सेवा",Language.HI,pageSize=2)==PageCompletion.APPLIED)
    check(runCatching{scope.startCursorSearch("x",Language.HI)}.isFailure)
    check((scope.snapshot().search as PageState.Ready).query=="सेवा")
    fake.cursorReply={q,lang,_,_,after->
        ApiOutcome.Ok(CatalogSearchCursorPage(lang,q,
            if(after==null) listOf(ONE,TWO) else listOf(TWO,THREE),
            if(after==null) "2:carpenter" else null))
    }
    check(scope.startCursorSearch("सेवा",Language.HI,pageSize=2)==PageCompletion.APPLIED)
    check(scope.nextCursorSearch()==PageCompletion.DISCARDED)
    check(scope.snapshot().search==PageState.RefreshRequired)
    for(page in listOf(
        CatalogSearchCursorPage(Language.EN,"सेवा",listOf(ONE),null),
        CatalogSearchCursorPage(Language.HI,"गलत",listOf(ONE),null),
        CatalogSearchCursorPage(Language.HI,"सेवा",listOf(ONE,ONE),null),
        CatalogSearchCursorPage(Language.HI,"सेवा",listOf(ONE),"3:carpenter"),
        CatalogSearchCursorPage(Language.HI,"सेवा",listOf(ONE),"3:plumber"),
    )){
        fake.cursorReply={_,_,_,_,_->ApiOutcome.Ok(page)}
        check(scope.startCursorSearch("सेवा",Language.HI,pageSize=2)==PageCompletion.APPLIED)
        check(scope.snapshot().search==PageState.Error(FailureKind.BAD_RESPONSE))
    }
    fake.cursorReply={q,lang,_,_,_->
        ApiOutcome.Ok(CatalogSearchCursorPage(lang,q,listOf(ONE),null))
    }
    val oldCalls=fake.searchCalls.size
    check(scope.retrySearch()==PageCompletion.APPLIED)
    check(fake.searchCalls.size==oldCalls)
    check((scope.snapshot().search as PageState.Ready).searchCursorMode)
    val intent=scope.captureRevisitIntent()!!
    check(intent.search?.cursorMode==true)
    val fresh=HeadlessCatalogPaginationScope(fake,
        session(PagingFakeWorker(),clock),{clock.get()},1_000)
    val before=fake.cursorCalls.size
    check(fresh.restoreRevisitIntent(intent)==PageCompletion.APPLIED)
    check(fake.cursorCalls.size==before)
    check(fresh.retrySearch()==PageCompletion.APPLIED)
    check(fake.cursorCalls.last().after==null)
    clock.set(1_000)
    check(fresh.snapshot().search==PageState.RefreshRequired)
    check(fresh.nextCursorSearch()==PageCompletion.BLOCKED)
}

private fun testCursorSearchWorkerBarrierAndSlowReply() {
    val clock=AtomicLong()
    val worker=PagingFakeWorker()
    val coordinator=signedIn(worker,clock)
    val fake=PagingFakeCatalog()
    val scope=HeadlessCatalogPaginationScope(fake,coordinator,{clock.get()})
    check(scope.startCursorSearch("सेवा",Language.HI,pageSize=2)==PageCompletion.APPLIED)
    val began=CountDownLatch(1)
    val finish=CountDownLatch(1)
    worker.writeStarted={began.countDown();check(finish.await(5,TimeUnit.SECONDS))}
    val writing=threaded{coordinator.publishExplicitCategory("plumber")}
    try{
        reached(began)
        check(scope.snapshot().search==PageState.RefreshRequired)
        check(scope.nextCursorSearch()==PageCompletion.DEFERRED)
        check(scope.startCursorSearch("सेवा",Language.HI,pageSize=2)==PageCompletion.DEFERRED)
    }finally{finish.countDown()}
    check(finished(writing) is SessionResult.Success)
    check(scope.retrySearch()==PageCompletion.APPLIED)
    // Another Search wins before the old network response is delivered.
    val slowStart=CountDownLatch(1)
    val slowFinish=CountDownLatch(1)
    fake.cursorReply={q,lang,_,_,_->
        slowStart.countDown()
        check(slowFinish.await(5,TimeUnit.SECONDS))
        ApiOutcome.Ok(CatalogSearchCursorPage(lang,q,listOf(ONE),null))
    }
    val slow=threaded{scope.startCursorSearch("old search",Language.EN)}
    try{
        reached(slowStart)
        check(scope.startSearch("प्लंबर",Language.HI,pageSize=2)==PageCompletion.APPLIED)
    }finally{slowFinish.countDown()}
    check(finished(slow)==PageCompletion.DISCARDED)
    check((scope.snapshot().search as PageState.Ready).query=="प्लंबर")
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
    testAll889CursorSearchAndLegacyIsolation()
    testCursorSearchTamperFallbackRetryAndRestore()
    testCursorSearchWorkerBarrierAndSlowReply()
    println("JODLO pagination: cursor/offset isolation, duplicate fail-close, TTL and worker write safety OK")
}
