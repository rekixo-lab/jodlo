package com.rekixo.jodlo.core.network

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

private const val CUSTOMER_LISTING_ID = "11111111-1111-4111-8111-111111111111"
private val CUSTOMER_TOKEN = "a".repeat(43)
private val PLUMBER_CHOICE = PublicCategory("plumber", "plumber", "प्लंबर")
private val CARPENTER_CHOICE = PublicCategory("carpenter", "carpenter", "बढ़ई")
private fun <T> asyncCustomer(block: () -> T) =
    FutureTask<T> { block() }.also { Thread(it, "jodlo-customer-fake").start() }
private fun <T> completedCustomer(task: FutureTask<T>): T = task.get(5, TimeUnit.SECONDS)
private fun awaitCustomer(latch: CountDownLatch) =
    check(latch.await(5, TimeUnit.SECONDS)) { "Fake request did not start" }

private class CustomerFakeCatalog : CatalogRepository, PublicListingPageRepository {
    var searchResponse: (String, Language) -> CatalogSearch = { query, lang ->
        CatalogSearch(lang, query, listOf(PLUMBER_CHOICE, CARPENTER_CHOICE),
            null, false, emptyList())
    }
    var publicResponse: (String) -> ApiOutcome<List<PublicListing>> = { id ->
        ApiOutcome.Ok(listOf(PublicListing(CUSTOMER_LISTING_ID, id)))
    }
    var onPublicGET: (() -> Unit)? = null
    var pagedResponse: (String, Int, String?) -> ApiOutcome<PublicListingPage> =
        { category, _, _ -> ApiOutcome.Ok(PublicListingPage(
            listOf(PublicListing(CUSTOMER_LISTING_ID,category)), null)) }
    val observedPages = CopyOnWriteArrayList<Pair<Int, String?>>()
    val observedIDs = CopyOnWriteArrayList<String>()
    val searchCalls = AtomicInteger()
    val browseCalls = AtomicInteger()
    override fun browse(language: Language, availableOnly: Boolean, limit: Int,
                        after: String?): ApiOutcome<CatalogBrowse> {
        browseCalls.incrementAndGet()
        return ApiOutcome.Ok(CatalogBrowse(language, listOf(PLUMBER_CHOICE), null))
    }
    override fun search(query: String, language: Language, availableOnly: Boolean,
                        includeChoices: Boolean, limit: Int,
                        offset: Int): ApiOutcome<CatalogSearch> {
        searchCalls.incrementAndGet()
        return ApiOutcome.Ok(searchResponse(query, language))
    }
    override fun listings(categoryId: String): ApiOutcome<List<PublicListing>> {
        observedIDs.add(categoryId)
        onPublicGET?.invoke()
        return publicResponse(categoryId)
    }
    override fun pageListings(categoryId: String, limit: Int,
                              after: String?): ApiOutcome<PublicListingPage> {
        observedIDs.add(categoryId)
        observedPages.add(Pair(limit, after))
        onPublicGET?.invoke()
        return pagedResponse(categoryId, limit, after)
    }
}
private class CustomerFakeWorker : WorkerRepository {
    val posts = AtomicInteger()
    val optIns = AtomicInteger()
    var beforePublish: (() -> Unit)? = null
    override fun myDraft(session: String) = ApiOutcome.Ok(WorkerDraft("draft"))
    override fun optIn(session: String): ApiOutcome<WorkerDraft> {
        optIns.incrementAndGet()
        return ApiOutcome.Ok(WorkerDraft("draft"))
    }
    override fun myListings(session: String) = ApiOutcome.Ok(emptyList<OwnListing>())
    override fun publishExplicitCategory(session: String, confirmedCategoryId: String):
        ApiOutcome<PublicListing> {
        posts.incrementAndGet()
        beforePublish?.invoke()
        return ApiOutcome.Ok(PublicListing(CUSTOMER_LISTING_ID, confirmedCategoryId))
    }
    override fun unpublish(session: String, listingId: String) = ApiOutcome.Ok(true)
}
private fun customerSession(worker: CustomerFakeWorker, clock: AtomicLong):
    InMemorySessionCoordinator =
    InMemorySessionCoordinator(worker, RequestSender { error("Auth sender unused") }) {
        clock.get()
    }
private fun signedWorker(worker: CustomerFakeWorker, clock: AtomicLong):
    InMemorySessionCoordinator = customerSession(worker, clock).also {
        val issued = TransportReply(200,
            """{"ok":true,"data":{"accessToken":"$CUSTOMER_TOKEN","tokenType":"Bearer","expiresInSeconds":3600}}""")
        check(it.acceptIssuedSession(issued) is ApiOutcome.Ok)
        check(it.optIn() == SessionResult.Success(WorkerState.DRAFT))
    }
private fun customerScope(
    catalog: CustomerFakeCatalog, worker: CustomerFakeWorker = CustomerFakeWorker(),
    clock: AtomicLong = AtomicLong(0), ttl: Long = 1_000,
    session: InMemorySessionCoordinator = customerSession(worker, clock),
) = HeadlessCatalogPaginationScope(catalog, session, { clock.get() }, ttl)

private fun testAmbiguousSearchNeedsExplicitExactSelectionAndGET() {
    val catalog = CustomerFakeCatalog()
    val worker = CustomerFakeWorker()
    catalog.searchResponse = { query, lang ->
        CatalogSearch(lang, query, emptyList(), null, true,
            listOf(PLUMBER_CHOICE, CARPENTER_CHOICE))
    }
    val scope = customerScope(catalog, worker)
    check(scope.startSearch("नल या लकड़ी", Language.HI) == PageCompletion.APPLIED)
    check(scope.snapshot().selection == CustomerSelectionState.Idle)
    check(catalog.observedIDs.isEmpty())
    check(scope.loadSelectedListings() == PageCompletion.BLOCKED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH, "electrician") ==
        PageCompletion.BLOCKED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH, "plumber") ==
        PageCompletion.APPLIED)
    check(scope.snapshot().selection ==
        CustomerSelectionState.Chosen(PLUMBER_CHOICE, CustomerCategorySource.SEARCH))
    check(catalog.observedIDs.isEmpty()) // Selection NEVER auto-fetches.
    check(scope.loadSelectedListings() == PageCompletion.APPLIED)
    val ready = scope.snapshot().selection as CustomerSelectionState.Ready
    check(ready.category == PLUMBER_CHOICE &&
        ready.listings == listOf(PublicListing(CUSTOMER_LISTING_ID, "plumber")))
    check(catalog.observedIDs.toList() == listOf("plumber"))
    check(worker.posts.get() == 0 && worker.optIns.get() == 0)
    check(!scope.snapshot().toString().contains(CUSTOMER_TOKEN))
    check(scope.selectCategory(CustomerCategorySource.SEARCH, "carpenter") ==
        PageCompletion.APPLIED)
    check(scope.snapshot().selection ==
        CustomerSelectionState.Chosen(CARPENTER_CHOICE, CustomerCategorySource.SEARCH))
    check(catalog.observedIDs.toList() == listOf("plumber"))
}

private fun testBrowseAndNormalSearchOnlyAllowDisplayedItems() {
    val catalog = CustomerFakeCatalog()
    val scope = customerScope(catalog)
    check(scope.startBrowse(Language.EN) == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH, "plumber") ==
        PageCompletion.BLOCKED)
    check(scope.selectCategory(CustomerCategorySource.BROWSE, "carpenter") ==
        PageCompletion.BLOCKED)
    check(scope.selectCategory(CustomerCategorySource.BROWSE, "plumber") ==
        PageCompletion.APPLIED)
    check(scope.startSearch("plumber", Language.EN) == PageCompletion.APPLIED)
    // Unrelated source lane doesn't silently override a Browse selection.
    check(scope.snapshot().selection ==
        CustomerSelectionState.Chosen(PLUMBER_CHOICE, CustomerCategorySource.BROWSE))
    check(scope.loadSelectedListings() == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH, "carpenter") ==
        PageCompletion.APPLIED)
    check(scope.loadSelectedListings() == PageCompletion.APPLIED)
    check(catalog.observedIDs.toList() == listOf("plumber","carpenter"))
    check(runCatching { scope.selectCategory(CustomerCategorySource.SEARCH,"not a valid id!") }
        .isFailure)
    check(scope.snapshot().selection is CustomerSelectionState.Ready)
    check(scope.startSearch("electrician", Language.EN) == PageCompletion.APPLIED)
    check(scope.snapshot().selection == CustomerSelectionState.Idle)
    check(scope.loadSelectedListings() == PageCompletion.BLOCKED)
}

private fun testSlowGETDiscardedAfterNewSearch() {
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val catalog = CustomerFakeCatalog()
    val scope = customerScope(catalog)
    check(scope.startSearch("plumber", Language.EN) == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH, "plumber") ==
        PageCompletion.APPLIED)
    catalog.onPublicGET = {
        started.countDown()
        check(release.await(5, TimeUnit.SECONDS))
    }
    val slow = asyncCustomer { scope.loadSelectedListings() }
    try {
        awaitCustomer(started)
        check(scope.snapshot().selection ==
            CustomerSelectionState.Loading(PLUMBER_CHOICE, CustomerCategorySource.SEARCH))
        check(scope.loadSelectedListings() == PageCompletion.BLOCKED)
        check(scope.startSearch("carpenter", Language.EN) == PageCompletion.APPLIED)
        check(scope.snapshot().selection == CustomerSelectionState.Idle)
    } finally {
        release.countDown()
    }
    check(completedCustomer(slow) == PageCompletion.DISCARDED)
    check(scope.snapshot().selection == CustomerSelectionState.Idle)
    check(scope.loadSelectedListings() == PageCompletion.BLOCKED)
}

private fun testWorkerWriteRejectsOldGETAndDefersDuringWrite() {
    val clock = AtomicLong(0)
    val worker = CustomerFakeWorker()
    val session = signedWorker(worker, clock)
    val catalog = CustomerFakeCatalog()
    val scope = customerScope(catalog, worker, clock, session = session)
    check(scope.startSearch("plumber", Language.EN) == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH, "plumber") ==
        PageCompletion.APPLIED)
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    catalog.onPublicGET = {
        started.countDown()
        check(release.await(5, TimeUnit.SECONDS))
    }
    val slow = asyncCustomer { scope.loadSelectedListings() }
    try {
        awaitCustomer(started)
        check(session.publishExplicitCategory("plumber") is SessionResult.Success)
        check(scope.snapshot().selection == CustomerSelectionState.RefreshRequired)
    } finally {
        release.countDown()
    }
    check(completedCustomer(slow) == PageCompletion.DISCARDED)
    check(catalog.observedIDs.size == 1 && worker.posts.get() == 1)
    check(scope.loadSelectedListings() == PageCompletion.BLOCKED)
    val writeStarted = CountDownLatch(1)
    val writeRelease = CountDownLatch(1)
    worker.beforePublish = {
        writeStarted.countDown()
        check(writeRelease.await(5, TimeUnit.SECONDS))
    }
    val pending = asyncCustomer { session.publishExplicitCategory("plumber") }
    try {
        awaitCustomer(writeStarted)
        check(scope.selectCategory(CustomerCategorySource.SEARCH, "plumber") ==
            PageCompletion.DEFERRED)
        check(scope.loadSelectedListings() == PageCompletion.DEFERRED)
        check(catalog.observedIDs.size == 1)
    } finally {
        writeRelease.countDown()
    }
    check(completedCustomer(pending) is SessionResult.Success)
    check(scope.startSearch("plumber", Language.EN) == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH, "plumber") ==
        PageCompletion.APPLIED)
    catalog.onPublicGET = null
    check(scope.loadSelectedListings() == PageCompletion.APPLIED)
}

private fun testTTLAndManualRefreshRemoveSelectionWithoutGET() {
    val clock = AtomicLong(100L)
    val catalog = CustomerFakeCatalog()
    val scope = customerScope(catalog, clock = clock, ttl = 1_000L)
    check(scope.startSearch("plumber", Language.EN) == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH, "plumber") ==
        PageCompletion.APPLIED)
    clock.set(1_099L)
    check(scope.snapshot().selection is CustomerSelectionState.Chosen)
    clock.set(1_100L)
    check(scope.snapshot().selection == CustomerSelectionState.RefreshRequired)
    check(scope.loadSelectedListings() == PageCompletion.BLOCKED)
    check(catalog.observedIDs.isEmpty())
    check(scope.startBrowse(Language.HI) == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.BROWSE, "plumber") ==
        PageCompletion.APPLIED)
    check(scope.requestRefresh())
    check(scope.snapshot().selection == CustomerSelectionState.RefreshRequired)
    check(scope.loadSelectedListings() == PageCompletion.BLOCKED)
    check(catalog.observedIDs.isEmpty())
    check(scope.startBrowse(Language.HI) == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.BROWSE, "plumber") ==
        PageCompletion.APPLIED)
    scope.clearSelection()
    check(scope.snapshot().selection == CustomerSelectionState.Idle)
    check(scope.loadSelectedListings() == PageCompletion.BLOCKED)
}

private fun testInvalidListingRepliesAreTypedAndNeverReused() {
    val catalog = CustomerFakeCatalog()
    val scope = customerScope(catalog)
    check(scope.startSearch("plumber", Language.EN) == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH, "plumber") ==
        PageCompletion.APPLIED)
    catalog.publicResponse = { ApiOutcome.Ok(listOf(
        PublicListing(CUSTOMER_LISTING_ID, "carpenter"))) }
    check(scope.loadSelectedListings() == PageCompletion.APPLIED)
    check(scope.snapshot().selection ==
        CustomerSelectionState.Error(PLUMBER_CHOICE, CustomerCategorySource.SEARCH,
            FailureKind.BAD_RESPONSE))
    catalog.publicResponse = { id -> ApiOutcome.Ok(listOf(
        PublicListing(CUSTOMER_LISTING_ID,id),
        PublicListing(CUSTOMER_LISTING_ID,id))) }
    check(scope.loadSelectedListings() == PageCompletion.APPLIED)
    check(scope.snapshot().selection is CustomerSelectionState.Error)
    catalog.publicResponse = { ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT,false) }
    check(scope.loadSelectedListings() == PageCompletion.APPLIED)
    check(scope.snapshot().selection ==
        CustomerSelectionState.Error(PLUMBER_CHOICE, CustomerCategorySource.SEARCH,
            FailureKind.OFFLINE_OR_TIMEOUT))
    catalog.publicResponse = { id -> ApiOutcome.Ok(listOf(PublicListing(CUSTOMER_LISTING_ID,id))) }
    check(scope.loadSelectedListings() == PageCompletion.APPLIED)
    check(scope.snapshot().selection is CustomerSelectionState.Ready)
    check(catalog.observedIDs.size == 4)
}

private fun testDuplicateSearchChoicesNotAcceptedAndCloseClearsLateGET() {
    val catalog = CustomerFakeCatalog()
    catalog.searchResponse = { query, lang ->
        CatalogSearch(lang,query,emptyList(),null,true,
            listOf(PLUMBER_CHOICE, PLUMBER_CHOICE))
    }
    val clock = AtomicLong(0)
    val scope = customerScope(catalog,clock=clock)
    check(scope.startSearch("नल लकड़ी",Language.HI) == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH, "plumber") ==
        PageCompletion.BLOCKED)
    catalog.searchResponse = { query, lang ->
        CatalogSearch(lang,query,emptyList(),null,true,
            listOf(PLUMBER_CHOICE,CARPENTER_CHOICE))
    }
    check(scope.startSearch("नल लकड़ी",Language.HI) == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH, "plumber") ==
        PageCompletion.APPLIED)
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    catalog.onPublicGET = {
        started.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val slow = asyncCustomer { scope.loadSelectedListings() }
    try {
        awaitCustomer(started)
        scope.close()
        check(scope.snapshot() == CatalogPageSnapshot(true,PageState.Idle,PageState.Idle))
        check(scope.selectCategory(CustomerCategorySource.SEARCH, "plumber") ==
            PageCompletion.DISCARDED)
        check(scope.loadSelectedListings() == PageCompletion.DISCARDED)
    } finally {
        release.countDown()
    }
    check(completedCustomer(slow) == PageCompletion.DISCARDED)
    check(scope.snapshot().selection == CustomerSelectionState.Idle)
}

private fun testSelectedPublicListingPaginationAndErrorRecovery() {
    val fake = CustomerFakeCatalog()
    val scope = customerScope(fake)
    val second = "22222222-2222-4222-8222-222222222222"
    val third = "33333333-3333-4333-8333-333333333333"
    fake.pagedResponse = { category, limit, after ->
        check(category == "plumber" && limit == 1)
        when (after) {
            null -> ApiOutcome.Ok(PublicListingPage(
                listOf(PublicListing(CUSTOMER_LISTING_ID,category)), CUSTOMER_LISTING_ID))
            CUSTOMER_LISTING_ID -> ApiOutcome.Ok(PublicListingPage(
                listOf(PublicListing(second,category)), second))
            second -> ApiOutcome.Ok(PublicListingPage(listOf(PublicListing(third,category)),null))
            else -> error("Unexpected request cursor")
        }
    }
    check(scope.startSelectedListingPages(1) == PageCompletion.BLOCKED)
    check(scope.nextSelectedListingPage() == PageCompletion.BLOCKED)
    check(scope.startSearch("plumber",Language.EN) == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH,"plumber") == PageCompletion.APPLIED)
    check(fake.observedPages.isEmpty()) // Choosing alone NEVER sends any GET.
    check(runCatching { scope.startSelectedListingPages(0) }.isFailure)
    check(runCatching { scope.startSelectedListingPages(26) }.isFailure)
    check(fake.observedPages.isEmpty())
    check(scope.startSelectedListingPages(1) == PageCompletion.APPLIED)
    val first = scope.snapshot().selection as CustomerSelectionState.Ready
    check(first.pageSize == 1 && first.pageCount == 1 &&
        first.nextCursor == CUSTOMER_LISTING_ID && first.listings.size == 1)
    check(scope.nextSelectedListingPage() == PageCompletion.APPLIED)
    val secondPage = scope.snapshot().selection as CustomerSelectionState.Ready
    check(secondPage.listings.map { it.id } == listOf(CUSTOMER_LISTING_ID,second))
    check(secondPage.nextCursor == second && secondPage.pageCount == 2)
    check(scope.nextSelectedListingPage() == PageCompletion.APPLIED)
    val complete = scope.snapshot().selection as CustomerSelectionState.Ready
    check(complete.listings.map { it.id } == listOf(CUSTOMER_LISTING_ID,second,third))
    check(complete.nextCursor == null && complete.pageCount == 3)
    check(scope.nextSelectedListingPage() == PageCompletion.BLOCKED)
    check(fake.observedPages.toList() == listOf(
        Pair(1,null), Pair(1,CUSTOMER_LISTING_ID), Pair(1,second)))
    check(scope.captureRevisitIntent()?.destination == CustomerDestination.SEARCH)
    // Switch to legacy. It remains an independent, unpaged API.
    check(scope.loadSelectedListings() == PageCompletion.APPLIED)
    val legacy = scope.snapshot().selection as CustomerSelectionState.Ready
    check(legacy.pageSize == null && legacy.nextCursor == null && legacy.pageCount == 1)
    check(scope.nextSelectedListingPage() == PageCompletion.BLOCKED)
}

private fun testHiddenAnchorAndDuplicatePagesFailClosed() {
    val fake = CustomerFakeCatalog()
    val scope = customerScope(fake)
    check(scope.startBrowse(Language.HI) == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.BROWSE,"plumber") == PageCompletion.APPLIED)
    val first = PublicListing(CUSTOMER_LISTING_ID,"plumber")
    fake.pagedResponse = { _, _, after ->
        if (after == null) ApiOutcome.Ok(PublicListingPage(listOf(first),first.id))
        else ApiOutcome.Ok(PublicListingPage(emptyList(),null))
    }
    check(scope.startSelectedListingPages(1) == PageCompletion.APPLIED)
    check(scope.nextSelectedListingPage() == PageCompletion.APPLIED)
    // The backend reports an empty continuation for removed or hidden anchor.
    // No old cached Listing or selection can look fresh after this event.
    check(scope.snapshot().selection == CustomerSelectionState.RefreshRequired)
    check(scope.snapshot().navigation.destination == CustomerDestination.BROWSE)
    check(scope.nextSelectedListingPage() == PageCompletion.BLOCKED)
    check(scope.startSelectedListingPages(1) == PageCompletion.BLOCKED)
    check(fake.observedPages.size == 2)
    check(scope.selectCategory(CustomerCategorySource.BROWSE,"plumber") == PageCompletion.APPLIED)
    fake.pagedResponse = { category, _, _ ->
        ApiOutcome.Ok(PublicListingPage(listOf(PublicListing(CUSTOMER_LISTING_ID,category)),
            CUSTOMER_LISTING_ID))
    }
    check(scope.startSelectedListingPages(1) == PageCompletion.APPLIED)
    check(scope.nextSelectedListingPage() == PageCompletion.APPLIED)
    check(scope.snapshot().selection == CustomerSelectionState.Error(
        PLUMBER_CHOICE,CustomerCategorySource.BROWSE,FailureKind.BAD_RESPONSE))
    check(scope.nextSelectedListingPage() == PageCompletion.BLOCKED)
    // Explicit re-request starts anew, never reuses a now-untrusted cursor.
    check(scope.startSelectedListingPages(1) == PageCompletion.APPLIED)
    check((scope.snapshot().selection as CustomerSelectionState.Ready).pageCount == 1)
}

private fun testPagedListingLateResponseAndWorkerWriteBarrier() {
    val clock = AtomicLong(100)
    val worker = CustomerFakeWorker()
    val session = signedWorker(worker,clock)
    val fake = CustomerFakeCatalog()
    val scope = customerScope(fake,worker,clock,session=session)
    check(scope.startSearch("plumber",Language.EN) == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH,"plumber") == PageCompletion.APPLIED)
    fake.pagedResponse = { cat, _, _ -> ApiOutcome.Ok(
        PublicListingPage(listOf(PublicListing(CUSTOMER_LISTING_ID,cat)),CUSTOMER_LISTING_ID)) }
    check(scope.startSelectedListingPages(1) == PageCompletion.APPLIED)
    val started=CountDownLatch(1)
    val release=CountDownLatch(1)
    fake.onPublicGET = {
        started.countDown()
        check(release.await(5, TimeUnit.SECONDS))
    }
    val pending = asyncCustomer { scope.nextSelectedListingPage() }
    try {
        awaitCustomer(started)
        check(scope.snapshot().selection is CustomerSelectionState.Loading)
        check(session.publishExplicitCategory("plumber") is SessionResult.Success)
        check(scope.snapshot().selection == CustomerSelectionState.RefreshRequired)
    } finally { release.countDown() }
    check(completedCustomer(pending) == PageCompletion.DISCARDED)
    check(scope.nextSelectedListingPage() == PageCompletion.BLOCKED)
    check(fake.observedPages.size == 2)
    fake.onPublicGET=null
    check(scope.startSearch("plumber",Language.EN) == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH,"plumber") == PageCompletion.APPLIED)
    check(scope.startSelectedListingPages(1) == PageCompletion.APPLIED)
    check(scope.back() == PageCompletion.APPLIED)
    check(scope.snapshot().selection == CustomerSelectionState.Idle)
    check(scope.nextSelectedListingPage() == PageCompletion.BLOCKED)
    clock.set(1_101)
    check(scope.startSelectedListingPages(1) == PageCompletion.BLOCKED)
}

fun main() {
    testAmbiguousSearchNeedsExplicitExactSelectionAndGET()
    testBrowseAndNormalSearchOnlyAllowDisplayedItems()
    testSlowGETDiscardedAfterNewSearch()
    testWorkerWriteRejectsOldGETAndDefersDuringWrite()
    testTTLAndManualRefreshRemoveSelectionWithoutGET()
    testInvalidListingRepliesAreTypedAndNeverReused()
    testDuplicateSearchChoicesNotAcceptedAndCloseClearsLateGET()
    testSelectedPublicListingPaginationAndErrorRecovery()
    testHiddenAnchorAndDuplicatePagesFailClosed()
    testPagedListingLateResponseAndWorkerWriteBarrier()
    println("JODLO customer selection: explicit Category, paged public Listings, stale-cursor, write/lifecycle safety OK")
}
