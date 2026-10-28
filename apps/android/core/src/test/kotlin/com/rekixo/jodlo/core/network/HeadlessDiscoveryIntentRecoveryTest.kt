package com.rekixo.jodlo.core.network

import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

private const val REVISIT_LISTING = "11111111-1111-4111-8111-111111111111"
private val REVISIT_CATEGORY = PublicCategory("carpenter", "carpenter", "बढ़ई")
private fun <T> concurrent(block: () -> T) =
    FutureTask<T> { block() }.also { Thread(it, "jodlo-intent-test").start() }
private fun <T> done(task: FutureTask<T>): T = task.get(5, TimeUnit.SECONDS)
private fun awaitStart(latch: CountDownLatch) =
    check(latch.await(5, TimeUnit.SECONDS)) { "Fake request never started" }

private class IntentCatalog : CatalogRepository {
    val browsing = AtomicInteger()
    val searching = AtomicInteger()
    val listingGETs = AtomicInteger()
    var beforeBrowse: (() -> Unit)? = null
    var beforeSearch: ((String) -> Unit)? = null
    var failSearch = false

    override fun browse(language: Language, availableOnly: Boolean, limit: Int,
                        after: String?): ApiOutcome<CatalogBrowse> {
        browsing.incrementAndGet()
        beforeBrowse?.invoke()
        return ApiOutcome.Ok(CatalogBrowse(language, listOf(REVISIT_CATEGORY), null))
    }
    override fun search(query: String, language: Language, availableOnly: Boolean,
                        includeChoices: Boolean, limit: Int, offset: Int): ApiOutcome<CatalogSearch> {
        searching.incrementAndGet()
        beforeSearch?.invoke(query)
        return if (failSearch) ApiOutcome.Failed(FailureKind.SERVICE_UNAVAILABLE, false)
        else ApiOutcome.Ok(CatalogSearch(language, query, listOf(REVISIT_CATEGORY),
            null, false, emptyList()))
    }
    override fun listings(categoryId: String): ApiOutcome<List<PublicListing>> {
        listingGETs.incrementAndGet()
        return ApiOutcome.Ok(listOf(PublicListing(REVISIT_LISTING, categoryId)))
    }
}
private class IntentWorker : WorkerRepository {
    val writes = AtomicInteger()
    override fun myDraft(session: String) = ApiOutcome.Ok(WorkerDraft("draft"))
    override fun optIn(session: String) = ApiOutcome.Ok(WorkerDraft("draft"))
    override fun myListings(session: String) = ApiOutcome.Ok(emptyList<OwnListing>())
    override fun publishExplicitCategory(session: String, confirmedCategoryId: String):
        ApiOutcome<PublicListing> {
        writes.incrementAndGet()
        return ApiOutcome.Ok(PublicListing(REVISIT_LISTING, confirmedCategoryId))
    }
    override fun unpublish(session: String, listingId: String): ApiOutcome<Boolean> {
        writes.incrementAndGet()
        return ApiOutcome.Ok(true)
    }
}
private fun intentSession(worker: IntentWorker, clock: AtomicLong) =
    InMemorySessionCoordinator(worker, RequestSender { error("No auth calls") }, {clock.get()})
private fun intentScope(
    cat: IntentCatalog, clock: AtomicLong = AtomicLong(0),
    session: InMemorySessionCoordinator = intentSession(IntentWorker(), clock),
) = HeadlessCatalogPaginationScope(cat, session, {clock.get()}, 1_000L)

private fun testCaptureContainsOnlyParametersAndNeverListings() {
    val cat = IntentCatalog()
    val scope = intentScope(cat)
    check(scope.captureRevisitIntent() == CustomerDiscoveryIntent())
    check(scope.startBrowse(Language.HI, availableOnly = true, pageSize = 5)
        == PageCompletion.APPLIED)
    check(scope.startSearch(" बढ़ई ", Language.HI, availableOnly = true, pageSize = 10)
        == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH, "carpenter")
        == PageCompletion.APPLIED)
    check(scope.loadSelectedListings() == PageCompletion.APPLIED)
    val intent = scope.captureRevisitIntent()
    check(intent == CustomerDiscoveryIntent(
        browse = CustomerBrowseIntent(Language.HI, true, 5),
        search = CustomerSearchIntent("बढ़ई", Language.HI, true, 10),
        destination = CustomerDestination.SEARCH,
    ))
    check(intent.toString().contains("बढ़ई"))
    check(!intent.toString().contains(REVISIT_LISTING))
    check(!intent.toString().contains("accessToken"))
    // In-memory snapshot may still contain valid listings, while the resume
    // intent never contains selected Category or result rows.
    check(scope.snapshot().selection is CustomerSelectionState.Ready)
    check(cat.searching.get() == 1 && cat.listingGETs.get() == 1)
}

private fun testNewScopeRestoresOnlyIntentAndRequiresExplicitFreshGET() {
    val cat = IntentCatalog()
    val old = intentScope(cat)
    check(old.startBrowse(Language.EN, pageSize = 4) == PageCompletion.APPLIED)
    check(old.startSearch("carpenter", Language.EN, availableOnly = true, pageSize = 7)
        == PageCompletion.APPLIED)
    val intent = requireNotNull(old.captureRevisitIntent())
    old.close()
    check(old.captureRevisitIntent() == null)
    val fresh = intentScope(cat)
    val before = cat.searching.get()
    check(fresh.restoreRevisitIntent(intent) == PageCompletion.APPLIED)
    val restored = fresh.snapshot()
    check(restored.intent == intent)
    check(restored.browse == PageState.RefreshRequired)
    check(restored.search == PageState.RefreshRequired)
    check(restored.selection == CustomerSelectionState.Idle)
    check(restored.navigation.destination == CustomerDestination.SEARCH)
    check(fresh.nextSearch() == PageCompletion.BLOCKED)
    check(fresh.loadSelectedListings() == PageCompletion.BLOCKED)
    check(cat.searching.get() == before && cat.listingGETs.get() == 0)
    val next = requireNotNull(fresh.captureRevisitIntent()).search!!
    check(fresh.startSearch(next.query, next.language, next.availableOnly, next.pageSize)
        == PageCompletion.APPLIED)
    check((fresh.snapshot().search as PageState.Ready).query == "carpenter")
    check(cat.searching.get() == before + 1)
}

private fun testErrorAndTTLRetainQueryAndFiltersWithoutKeepingRows() {
    val clock = AtomicLong(100L)
    val cat = IntentCatalog()
    cat.failSearch = true
    val scope = intentScope(cat,clock)
    check(scope.startSearch("electrician", Language.EN, true, 3) == PageCompletion.APPLIED)
    check(scope.snapshot().search == PageState.Error(FailureKind.SERVICE_UNAVAILABLE))
    val intent = scope.captureRevisitIntent()!!.search
    check(intent == CustomerSearchIntent("electrician", Language.EN, true, 3))
    cat.failSearch = false
    check(scope.startSearch(intent!!.query, intent.language,
        intent.availableOnly, intent.pageSize) == PageCompletion.APPLIED)
    clock.set(1_100L)
    check(scope.snapshot().search == PageState.RefreshRequired)
    check(scope.captureRevisitIntent()!!.search == intent)
    check(cat.searching.get()==2)
    check(scope.nextSearch() == PageCompletion.BLOCKED)
}

private fun testClearSearchPreservesBrowseAndCancelsLateResponse() {
    val clock = AtomicLong()
    val cat = IntentCatalog()
    val scope = intentScope(cat,clock)
    check(scope.startBrowse(Language.HI, availableOnly = true) == PageCompletion.APPLIED)
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    cat.beforeSearch = {
        entered.countDown()
        check(release.await(5, TimeUnit.SECONDS))
    }
    val old = concurrent { scope.startSearch("बढ़ई", Language.HI) }
    try {
        awaitStart(entered)
        check(scope.snapshot().intent.search?.query=="बढ़ई")
        check(scope.clearSearchIntent())
        check(scope.snapshot().search == PageState.Idle)
        check(scope.snapshot().browse is PageState.Ready)
        check(scope.snapshot().intent.search == null)
        check(scope.snapshot().navigation.destination == CustomerDestination.BROWSE)
    } finally { release.countDown() }
    check(done(old)==PageCompletion.DISCARDED)
    check(scope.captureRevisitIntent()?.browse ==
        CustomerBrowseIntent(Language.HI,true,20))
    check(cat.searching.get()==1 && cat.browsing.get()==1)
}

private fun testNewerSearchIntentWinsDuringSlowOldGET() {
    val cat = IntentCatalog()
    val scope = intentScope(cat)
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    cat.beforeSearch = {
        if (it=="बढ़ई") {
            entered.countDown()
            check(release.await(5,TimeUnit.SECONDS))
        }
    }
    val old = concurrent { scope.startSearch("बढ़ई",Language.HI,true,4) }
    try {
        awaitStart(entered)
        check(scope.startSearch("carpenter",Language.EN,false,7)==PageCompletion.APPLIED)
        check(scope.captureRevisitIntent()?.search ==
            CustomerSearchIntent("carpenter",Language.EN,false,7))
    } finally { release.countDown() }
    check(done(old)==PageCompletion.DISCARDED)
    check((scope.snapshot().search as PageState.Ready).query=="carpenter")
}

private fun testUntrustedRestoreIsRejectedBeforeMutatingOldState() {
    val cat = IntentCatalog()
    val scope = intentScope(cat)
    check(scope.startSearch("carpenter",Language.EN)==PageCompletion.APPLIED)
    val original = scope.snapshot()
    val invalid = listOf(
        CustomerDiscoveryIntent(search=CustomerSearchIntent("x",Language.EN,false,20),
            destination=CustomerDestination.SEARCH),
        CustomerDiscoveryIntent(browse=CustomerBrowseIntent(Language.HI,false,99)),
        CustomerDiscoveryIntent(search=CustomerSearchIntent(" carpenter ",Language.EN,false,20),
            destination=CustomerDestination.SEARCH),
        CustomerDiscoveryIntent(search=CustomerSearchIntent("carpenter",Language.EN,false,20),
            destination=CustomerDestination.PUBLIC_LISTINGS),
        CustomerDiscoveryIntent(destination=CustomerDestination.SEARCH),
    )
    for (candidate in invalid) {
        check(runCatching {scope.restoreRevisitIntent(candidate)}.isFailure)
        check(scope.snapshot()==original)
    }
    check(cat.searching.get()==1 && cat.browsing.get()==0)
}

private fun testHardResetDropsBothIntentsAndCancelsSlowBrowse() {
    val cat = IntentCatalog()
    val scope = intentScope(cat)
    check(scope.startSearch("carpenter", Language.EN)==PageCompletion.APPLIED)
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    cat.beforeBrowse = {
        entered.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val pending = concurrent {scope.startBrowse(Language.HI)}
    try {
        awaitStart(entered)
        check(scope.resetDiscovery())
        check(scope.snapshot()==CatalogPageSnapshot(true,PageState.Idle,PageState.Idle).copy(
            closed = false))
        check(scope.captureRevisitIntent()==CustomerDiscoveryIntent())
    } finally {release.countDown()}
    check(done(pending)==PageCompletion.DISCARDED)
    check(cat.searching.get()==1 && cat.browsing.get()==1)
}

private fun testWorkerWriteRetainsSafeIntentButClearsAllResults() {
    val clock = AtomicLong()
    val worker = IntentWorker()
    val session = intentSession(worker,clock)
    val issued = TransportReply(200,
        """{"ok":true,"data":{"accessToken":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","tokenType":"Bearer","expiresInSeconds":3600}}""")
    check(session.acceptIssuedSession(issued) is ApiOutcome.Ok)
    check(session.optIn()==SessionResult.Success(WorkerState.DRAFT))
    val cat = IntentCatalog()
    val scope = intentScope(cat,clock,session)
    check(scope.startSearch("carpenter",Language.EN,true,8)==PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH,"carpenter")==PageCompletion.APPLIED)
    check(scope.loadSelectedListings()==PageCompletion.APPLIED)
    val intent = scope.captureRevisitIntent()
    check(session.publishExplicitCategory("carpenter") is SessionResult.Success)
    val snapshot=scope.snapshot()
    check(snapshot.search==PageState.RefreshRequired)
    check(snapshot.selection==CustomerSelectionState.RefreshRequired)
    check(snapshot.navigation.destination==CustomerDestination.SEARCH)
    check(snapshot.intent==intent)
    check(cat.listingGETs.get()==1 && worker.writes.get()==1)
}

private fun testLifecycleCloseRefusesRestoreAndClearsIntent() {
    val cat = IntentCatalog()
    val scope = intentScope(cat)
    check(scope.startSearch("carpenter",Language.EN)==PageCompletion.APPLIED)
    val saved = requireNotNull(scope.captureRevisitIntent())
    scope.close()
    check(scope.snapshot()==CatalogPageSnapshot(true,PageState.Idle,PageState.Idle))
    check(scope.captureRevisitIntent()==null)
    check(scope.restoreRevisitIntent(saved)==PageCompletion.DISCARDED)
    check(!scope.clearSearchIntent() && !scope.resetDiscovery())
    check(cat.searching.get()==1)
}

fun main() {
    testCaptureContainsOnlyParametersAndNeverListings()
    testNewScopeRestoresOnlyIntentAndRequiresExplicitFreshGET()
    testErrorAndTTLRetainQueryAndFiltersWithoutKeepingRows()
    testClearSearchPreservesBrowseAndCancelsLateResponse()
    testNewerSearchIntentWinsDuringSlowOldGET()
    testUntrustedRestoreIsRejectedBeforeMutatingOldState()
    testHardResetDropsBothIntentsAndCancelsSlowBrowse()
    testWorkerWriteRetainsSafeIntentButClearsAllResults()
    testLifecycleCloseRefusesRestoreAndClearsIntent()
    println("JODLO discovery intent: bounded query/filter recovery, no replay, stale cancellation and lifecycle safety OK")
}
