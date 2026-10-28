package com.rekixo.jodlo.core.network

import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

private const val BACK_LISTING = "11111111-1111-4111-8111-111111111111"
private val BACK_TOKEN = "b".repeat(43)
private val BACK_PLUMBER = PublicCategory("plumber", "plumber", "प्लंबर")
private val BACK_CARPENTER = PublicCategory("carpenter", "carpenter", "बढ़ई")
private fun <T> onBackground(block: () -> T) =
    FutureTask<T> { block() }.also { Thread(it, "jodlo-back-navigation-test").start() }
private fun <T> result(task: FutureTask<T>): T = task.get(5, TimeUnit.SECONDS)
private fun began(latch: CountDownLatch) =
    check(latch.await(5, TimeUnit.SECONDS)) { "Expected fake GET to start" }

private class BackCatalog : CatalogRepository {
    val browseCount = AtomicInteger()
    val searchCount = AtomicInteger()
    val listingsCount = AtomicInteger()
    var beforeSearch: (() -> Unit)? = null
    var beforeListings: (() -> Unit)? = null
    override fun browse(language: Language, availableOnly: Boolean, limit: Int,
                        after: String?): ApiOutcome<CatalogBrowse> {
        browseCount.incrementAndGet()
        return ApiOutcome.Ok(CatalogBrowse(language, listOf(BACK_PLUMBER), null))
    }
    override fun search(query: String, language: Language, availableOnly: Boolean,
                        includeChoices: Boolean, limit: Int, offset: Int): ApiOutcome<CatalogSearch> {
        searchCount.incrementAndGet()
        beforeSearch?.invoke()
        return ApiOutcome.Ok(CatalogSearch(language, query, listOf(BACK_CARPENTER), null,
            false, emptyList()))
    }
    override fun listings(categoryId: String): ApiOutcome<List<PublicListing>> {
        listingsCount.incrementAndGet()
        beforeListings?.invoke()
        return ApiOutcome.Ok(listOf(PublicListing(BACK_LISTING, categoryId)))
    }
}

private class BackWorker : WorkerRepository {
    val mutations = AtomicInteger()
    override fun myDraft(session: String) = ApiOutcome.Ok(WorkerDraft("draft"))
    override fun optIn(session: String) = ApiOutcome.Ok(WorkerDraft("draft"))
    override fun myListings(session: String) = ApiOutcome.Ok(emptyList<OwnListing>())
    override fun publishExplicitCategory(session: String, confirmedCategoryId: String)
        : ApiOutcome<PublicListing> {
        mutations.incrementAndGet()
        return ApiOutcome.Ok(PublicListing(BACK_LISTING, confirmedCategoryId))
    }
    override fun unpublish(session: String, listingId: String): ApiOutcome<Boolean> {
        mutations.incrementAndGet()
        return ApiOutcome.Ok(true)
    }
}
private fun makeNavigation(
    catalog: BackCatalog, worker: BackWorker = BackWorker(),
    clock: AtomicLong = AtomicLong(0), ttl: Long = 1_000,
    session: InMemorySessionCoordinator = InMemorySessionCoordinator(worker,
        RequestSender { error("No auth calls") }, { clock.get() }),
) = HeadlessCatalogPaginationScope(catalog, session, { clock.get() }, ttl)

private fun testBackStackPreservesFreshSourcePagesWithoutGET() {
    val catalog = BackCatalog()
    val worker = BackWorker()
    val scope = makeNavigation(catalog,worker)
    check(scope.snapshot().navigation == CustomerNavigationState())
    check(scope.back() == PageCompletion.BLOCKED)
    check(scope.startBrowse(Language.HI) == PageCompletion.APPLIED)
    check(scope.snapshot().navigation.destination == CustomerDestination.BROWSE)
    check(scope.startSearch("बढ़ई",Language.HI) == PageCompletion.APPLIED)
    check(scope.snapshot().navigation ==
        CustomerNavigationState(CustomerDestination.SEARCH,CustomerDestination.BROWSE))
    check(scope.selectCategory(CustomerCategorySource.SEARCH,"carpenter")==PageCompletion.APPLIED)
    check(scope.snapshot().navigation ==
        CustomerNavigationState(CustomerDestination.PUBLIC_LISTINGS,CustomerDestination.SEARCH))
    check(catalog.listingsCount.get() == 0)
    check(scope.loadSelectedListings()==PageCompletion.APPLIED)
    check(scope.snapshot().selection is CustomerSelectionState.Ready)
    check(scope.back()==PageCompletion.APPLIED)
    check(scope.snapshot().navigation.destination == CustomerDestination.SEARCH)
    check(scope.snapshot().selection==CustomerSelectionState.Idle)
    check(scope.snapshot().search is PageState.Ready)
    check(scope.back()==PageCompletion.APPLIED)
    check(scope.snapshot().navigation.destination==CustomerDestination.BROWSE)
    check(scope.snapshot().browse is PageState.Ready)
    check(scope.back()==PageCompletion.BLOCKED)
    check(scope.showSearch()==PageCompletion.APPLIED)
    check(scope.snapshot().search is PageState.Ready)
    check(scope.snapshot().selection==CustomerSelectionState.Idle)
    check(catalog.browseCount.get()==1 && catalog.searchCount.get()==1 &&
        catalog.listingsCount.get()==1)
    check(worker.mutations.get()==0) // No implicit worker posting or opt-in.
}

private fun testBrowseChoiceReturnsToBrowse() {
    val catalog=BackCatalog()
    val scope=makeNavigation(catalog)
    check(scope.startBrowse(Language.EN)==PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.BROWSE,"plumber")==PageCompletion.APPLIED)
    check(scope.snapshot().navigation.backDestination==CustomerDestination.BROWSE)
    check(scope.loadSelectedListings()==PageCompletion.APPLIED)
    check(scope.back()==PageCompletion.APPLIED)
    check(scope.snapshot().navigation==CustomerNavigationState())
    check(scope.snapshot().browse is PageState.Ready)
    check(scope.snapshot().selection==CustomerSelectionState.Idle)
    check(catalog.listingsCount.get()==1)
}

private fun testBackWhileListingsGETPendingRejectsLateResponse() {
    val started=CountDownLatch(1)
    val release=CountDownLatch(1)
    val catalog=BackCatalog()
    val scope=makeNavigation(catalog)
    check(scope.startSearch("बढ़ई",Language.HI)==PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH,"carpenter")==PageCompletion.APPLIED)
    catalog.beforeListings={
        started.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val slow=onBackground { scope.loadSelectedListings() }
    try {
        began(started)
        check(scope.snapshot().selection is CustomerSelectionState.Loading)
        check(scope.back()==PageCompletion.APPLIED)
        check(scope.snapshot().navigation.destination==CustomerDestination.SEARCH)
        check(scope.snapshot().selection==CustomerSelectionState.Idle)
    } finally { release.countDown() }
    check(result(slow)==PageCompletion.DISCARDED)
    check(scope.snapshot().search is PageState.Ready)
    check(scope.loadSelectedListings()==PageCompletion.BLOCKED)
    check(catalog.listingsCount.get()==1)
}

private fun testBackWhileSearchGETPendingCancelsResponse() {
    val started=CountDownLatch(1)
    val release=CountDownLatch(1)
    val catalog=BackCatalog()
    val scope=makeNavigation(catalog)
    check(scope.startBrowse(Language.HI)==PageCompletion.APPLIED)
    catalog.beforeSearch={
        started.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val slow=onBackground { scope.startSearch("बढ़ई",Language.HI) }
    try {
        began(started)
        check(scope.snapshot().navigation.destination==CustomerDestination.SEARCH)
        check(scope.snapshot().search==PageState.Loading)
        check(scope.back()==PageCompletion.APPLIED)
        check(scope.snapshot().navigation.destination==CustomerDestination.BROWSE)
        check(scope.snapshot().search==PageState.RefreshRequired)
    } finally { release.countDown() }
    check(result(slow)==PageCompletion.DISCARDED)
    check(scope.showSearch()==PageCompletion.APPLIED)
    check(scope.snapshot().search==PageState.RefreshRequired)
    check(catalog.searchCount.get()==1)
}

private fun testBackAfterTTLNeverRestoresStaleContent() {
    val clock=AtomicLong(100)
    val scope=makeNavigation(BackCatalog(),clock=clock)
    check(scope.startSearch("बढ़ई",Language.HI)==PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH,"carpenter")==PageCompletion.APPLIED)
    check(scope.loadSelectedListings()==PageCompletion.APPLIED)
    clock.set(1_100) // The first Search GET is now exactly one TTL old.
    val expired=scope.snapshot()
    check(expired.navigation.destination==CustomerDestination.SEARCH)
    check(expired.search==PageState.RefreshRequired)
    check(expired.selection==CustomerSelectionState.RefreshRequired)
    check(scope.back()==PageCompletion.APPLIED)
    check(scope.snapshot().navigation.destination==CustomerDestination.BROWSE)
    check(scope.showSearch()==PageCompletion.APPLIED)
    check(scope.snapshot().search==PageState.RefreshRequired)
    check(scope.loadSelectedListings()==PageCompletion.BLOCKED)
}

private fun testLocalWorkerWriteDropsSelectedListingsAndPage() {
    val clock=AtomicLong()
    val worker=BackWorker()
    val session=InMemorySessionCoordinator(worker, RequestSender { error("No auth") }) {
        clock.get()
    }
    check(session.acceptIssuedSession(TransportReply(200,
        """{"ok":true,"data":{"accessToken":"$BACK_TOKEN","tokenType":"Bearer","expiresInSeconds":3600}}"""))
        is ApiOutcome.Ok)
    check(session.optIn()==SessionResult.Success(WorkerState.DRAFT))
    val catalog=BackCatalog()
    val scope=makeNavigation(catalog,worker,clock,session=session)
    check(scope.startSearch("बढ़ई",Language.HI)==PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH,"carpenter")==PageCompletion.APPLIED)
    check(scope.loadSelectedListings()==PageCompletion.APPLIED)
    check(session.publishExplicitCategory("carpenter") is SessionResult.Success)
    val after=scope.snapshot()
    check(after.navigation.destination==CustomerDestination.SEARCH)
    check(after.selection==CustomerSelectionState.RefreshRequired)
    check(after.search==PageState.RefreshRequired)
    check(scope.showBrowse()==PageCompletion.APPLIED)
    check(scope.snapshot().navigation.destination==CustomerDestination.BROWSE)
    check(catalog.listingsCount.get()==1 && worker.mutations.get()==1)
}

private fun testSwitchingToOtherDestinationDropsListingsButNotPages() {
    val cat=BackCatalog()
    val scope=makeNavigation(cat)
    check(scope.startBrowse(Language.HI)==PageCompletion.APPLIED)
    check(scope.startSearch("बढ़ई",Language.HI)==PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH,"carpenter")==PageCompletion.APPLIED)
    check(scope.loadSelectedListings()==PageCompletion.APPLIED)
    check(scope.showBrowse()==PageCompletion.APPLIED)
    check(scope.snapshot().selection==CustomerSelectionState.Idle)
    check(scope.snapshot().browse is PageState.Ready)
    check(scope.showSearch()==PageCompletion.APPLIED)
    check(scope.snapshot().search is PageState.Ready)
    check(scope.snapshot().navigation.backDestination==CustomerDestination.BROWSE)
    check(cat.listingsCount.get()==1)
}

private fun testCloseResetsNavigationAndRefusesBack() {
    val cat=BackCatalog()
    val scope=makeNavigation(cat)
    check(scope.startSearch("बढ़ई",Language.HI)==PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH,"carpenter")==PageCompletion.APPLIED)
    scope.close()
    check(scope.snapshot()==CatalogPageSnapshot(true,PageState.Idle,PageState.Idle))
    check(scope.back()==PageCompletion.DISCARDED)
    check(scope.showSearch()==PageCompletion.DISCARDED)
    check(scope.showBrowse()==PageCompletion.DISCARDED)
    check(scope.loadSelectedListings()==PageCompletion.DISCARDED)
    check(cat.listingsCount.get()==0)
}

fun main() {
    testBackStackPreservesFreshSourcePagesWithoutGET()
    testBrowseChoiceReturnsToBrowse()
    testBackWhileListingsGETPendingRejectsLateResponse()
    testBackWhileSearchGETPendingCancelsResponse()
    testBackAfterTTLNeverRestoresStaleContent()
    testLocalWorkerWriteDropsSelectedListingsAndPage()
    testSwitchingToOtherDestinationDropsListingsButNotPages()
    testCloseResetsNavigationAndRefusesBack()
    println("JODLO back navigation: fresh source restoration, no GET, late replies and expiry safety OK")
}
