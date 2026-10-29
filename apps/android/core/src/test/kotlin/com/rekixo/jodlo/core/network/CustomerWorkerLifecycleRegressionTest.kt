package com.rekixo.jodlo.core.network

import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/** Cross-scope regression against the *real* lifecycle/session/read/write
 * controllers. Fake transport only; no Android UI, provider, network or deploy.
 */
private const val LIFE_LISTING = "11111111-1111-4111-8111-111111111111"
private const val LIFE_PAGE_LAST = "22222222-2222-4222-8222-222222222222"
private const val LIFE_PAGE_FINAL = "33333333-3333-4333-8333-333333333333"
private val LIFE_CATEGORY = PublicCategory("plumber", "plumber", "प्लंबर")
private val LIFE_TOKEN_A = "a".repeat(43)
private val LIFE_TOKEN_B = "b".repeat(43)
private fun lifeSessionReply(token: String) = TransportReply(200,
    """{"ok":true,"data":{"accessToken":"$token","tokenType":"Bearer","expiresInSeconds":3600}}""")
private fun <T> lifeThread(block: () -> T) =
    FutureTask<T> { block() }.also { Thread(it, "jodlo-lifecycle-fake").start() }
private fun <T> lifeDone(task: FutureTask<T>): T = task.get(5, TimeUnit.SECONDS)
private fun lifeEntered(latch: CountDownLatch) =
    check(latch.await(5, TimeUnit.SECONDS)) { "Expected fake transport not reached" }

private class LifeWorker : WorkerRepository, OwnListingPageRepository {
    val publishCalls = AtomicInteger()
    val ownCalls = AtomicInteger()
    val pageCalls = AtomicInteger()
    @Volatile var beforePage: (() -> Unit)? = null
    @Volatile var beforePublish: (() -> Unit)? = null
    @Volatile var beforeOwn: (() -> Unit)? = null
    @Volatile var uncertainPublish = false
    @Volatile var visible = false

    override fun myDraft(session: String) = ApiOutcome.Ok(WorkerDraft("draft"))
    override fun optIn(session: String) = ApiOutcome.Ok(WorkerDraft("draft"))
    override fun myListings(session: String): ApiOutcome<List<OwnListing>> {
        ownCalls.incrementAndGet()
        beforeOwn?.invoke()
        return ApiOutcome.Ok(if (visible)
            listOf(OwnListing(LIFE_LISTING, "plumber", true)) else emptyList())
    }
    /** Fake approved active Categories only; no original historical seed.
     * Request structure is already independently covered by real decoder
     * tests. This tests session/write/lifecycle crossings across scopes.
     */
    override fun pageMyListings(
        session: String, limit: Int, after: String?,
    ): ApiOutcome<OwnListingPage> {
        check(session == LIFE_TOKEN_A || session == LIFE_TOKEN_B)
        check(limit == 2)
        pageCalls.incrementAndGet()
        beforePage?.invoke()
        return when (after) {
            null -> ApiOutcome.Ok(OwnListingPage(listOf(
                OwnListing(LIFE_LISTING, "plumber", visible),
                OwnListing(LIFE_PAGE_LAST, "carpenter", false),
            ), LIFE_PAGE_LAST))
            LIFE_PAGE_LAST -> ApiOutcome.Ok(OwnListingPage(listOf(
                OwnListing(LIFE_PAGE_FINAL, "plumber", visible),
            ), null))
            else -> error("Unexpected private continuation cursor")
        }
    }

    override fun publishExplicitCategory(session: String,
        confirmedCategoryId: String): ApiOutcome<PublicListing> {
        check(confirmedCategoryId == "plumber")
        publishCalls.incrementAndGet()
        beforePublish?.invoke()
        visible = true // a remote commit can outlive its original local session
        return if (uncertainPublish)
            ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT, false)
        else ApiOutcome.Ok(PublicListing(LIFE_LISTING, "plumber"))
    }
    override fun unpublish(session: String, listingId: String): ApiOutcome<Boolean> {
        error("No unpublish should be sent during lifecycle restoration")
    }
}
private class LifeCatalog(private val worker: LifeWorker) : CatalogRepository {
    val browseCalls=AtomicInteger()
    @Volatile var beforeSearch: (() -> Unit)? = null
    val searchCalls=AtomicInteger()
    val publicCalls=AtomicInteger()
    override fun browse(language: Language, availableOnly: Boolean, limit: Int,
        after: String?): ApiOutcome<CatalogBrowse> {
        browseCalls.incrementAndGet()
        check(after == null)
        return ApiOutcome.Ok(CatalogBrowse(language, listOf(LIFE_CATEGORY), null))
    }
    override fun search(query: String, language: Language, availableOnly: Boolean,
        includeChoices: Boolean, limit: Int, offset: Int): ApiOutcome<CatalogSearch> {
        searchCalls.incrementAndGet()
        beforeSearch?.invoke()
        check(query == "प्लंबर" && language == Language.HI && includeChoices && offset == 0)
        return ApiOutcome.Ok(CatalogSearch(language, query,
            listOf(LIFE_CATEGORY), null, false, emptyList()))
    }
    override fun listings(categoryId: String): ApiOutcome<List<PublicListing>> {
        publicCalls.incrementAndGet()
        check(categoryId == "plumber")
        return ApiOutcome.Ok(if (worker.visible)
            listOf(PublicListing(LIFE_LISTING, categoryId)) else emptyList())
    }
}
private class LifeHarness {
    val clock=AtomicLong()
    val worker=LifeWorker()
    val catalog=LifeCatalog(worker)
    val session=InMemorySessionCoordinator(worker, RequestSender {
        // A remote revoke that failed cannot retain private *local* state.
        TransportReply(503,
            """{"ok":false,"error":{"code":"SERVICE_UNAVAILABLE","message":"secret ignored"}}""")
    }, { clock.get() })
    val reads=HeadlessMarketplaceReadScope(catalog,session,{clock.get()},60_000L)
    val writes=HeadlessWorkerWriteScope(session)
    val dashboard=HeadlessWorkerDashboardPresentation(session,reads,writes)
    fun customer()=HeadlessCatalogPaginationScope(catalog,session,{clock.get()},60_000L)
    fun owner()=HeadlessOwnerListingPaginationScope(session,{clock.get()},60_000L)
    fun pagedDashboard(owner: HeadlessOwnerListingPaginationScope) =
        HeadlessWorkerDashboardPresentation(session,reads,writes,owner)
    fun login(token: String = LIFE_TOKEN_A) {
        check(session.acceptIssuedSession(lifeSessionReply(token)) is ApiOutcome.Ok)
    }
    fun optIn() {
        check(session.optIn()==SessionResult.Success(WorkerState.DRAFT))
    }
}

private fun emptySearchDestinationSurvivesLifecycleWithoutGET() {
    val h=LifeHarness()
    val old=h.customer()
    check(old.showSearch()==PageCompletion.APPLIED)
    check(old.presentation().phase==CustomerViewPhase.IDLE)
    val intent=requireNotNull(old.captureRevisitIntent())
    check(intent==CustomerDiscoveryIntent(destination=CustomerDestination.SEARCH))
    old.close()
    val fresh=h.customer()
    check(fresh.restoreRevisitIntent(intent)==PageCompletion.APPLIED)
    val restored=fresh.presentation()
    check(restored.destination==CustomerDestination.SEARCH)
    check(restored.phase==CustomerViewPhase.IDLE)
    check(restored.actions==setOf(CustomerViewAction.START_SEARCH,CustomerViewAction.BACK))
    check(restored.categories.isEmpty() && restored.listings.isEmpty())
    check(restored.searchIntent==null && restored.selectedCategory==null)
    check(h.catalog.browseCalls.get()==0 &&
        h.catalog.searchCalls.get()==0 && h.catalog.publicCalls.get()==0)
    check(fresh.retrySearch()==PageCompletion.BLOCKED)
    check(fresh.startSearch("प्लंबर",Language.HI)==PageCompletion.APPLIED)
    check(fresh.presentation().phase==CustomerViewPhase.CATEGORIES)
    check(h.catalog.searchCalls.get()==1)
}

private fun logoutDuringOldPublishKeepsPublicWriteBarrierUntilWireEnds() {
    val h=LifeHarness()
    h.login()
    h.optIn()
    val customer=h.customer()
    check(customer.startBrowse(Language.HI)==PageCompletion.APPLIED)
    check(h.reads.browse(Language.HI)==ReadCompletion.APPLIED)
    val entered=CountDownLatch(1)
    val release=CountDownLatch(1)
    h.worker.beforePublish={
        entered.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val sending=lifeThread {h.writes.publishExplicitCategory("plumber")}
    try {
        lifeEntered(entered)
        check(h.dashboard.snapshot().mutation==WorkerMutationPhase.SENDING)
        check(customer.presentation().phase==CustomerViewPhase.REFRESH_REQUIRED)
        val before=h.catalog.browseCalls.get()
        check(h.session.logout() is SessionResult.Failed) // remote uncertain
        check(h.dashboard.snapshot()==WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT))
        check(h.reads.workerSnapshot().ownListings==ReadState.Idle)
        check(customer.retryBrowse()==PageCompletion.DEFERRED)
        check(h.reads.browse(Language.HI)==ReadCompletion.DEFERRED)
        check(h.catalog.browseCalls.get()==before)
    } finally {release.countDown()}
    check(lifeDone(sending)==WorkerWriteCompletion.DISCARDED)
    check(h.worker.publishCalls.get()==1)
    check(h.dashboard.snapshot()==WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT))
    check(h.writes.snapshot().state==WorkerWriteState.Idle)
    check(customer.presentation().phase==CustomerViewPhase.REFRESH_REQUIRED)
    check(customer.retryBrowse()==PageCompletion.APPLIED) // explicit public-only GET
    check(customer.presentation().phase==CustomerViewPhase.CATEGORIES)
    check(h.worker.publishCalls.get()==1)
}

private fun replacementDuringOldPublishCannotTransferWorkerStateOrBypassBarrier() {
    val h=LifeHarness()
    h.login()
    h.optIn()
    val customer=h.customer()
    check(customer.startSearch("प्लंबर",Language.HI)==PageCompletion.APPLIED)
    check(h.reads.ownListings()==ReadCompletion.APPLIED)
    val entered=CountDownLatch(1)
    val release=CountDownLatch(1)
    h.worker.beforePublish={
        entered.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val old=lifeThread {h.writes.publishExplicitCategory("plumber")}
    try {
        lifeEntered(entered)
        h.login(LIFE_TOKEN_B)
        val dashboard=h.dashboard.snapshot()
        check(dashboard.profile==WorkerProfilePhase.UNKNOWN)
        check(dashboard.mutation==WorkerMutationPhase.IDLE)
        check(dashboard.owned==WorkerListingsPhase.HIDDEN)
        check(dashboard.ownedListings.isEmpty())
        check(h.reads.workerSnapshot().ownListings==ReadState.Idle)
        check(customer.presentation().phase==CustomerViewPhase.REFRESH_REQUIRED)
        val before=h.catalog.searchCalls.get()
        check(customer.retrySearch()==PageCompletion.DEFERRED)
        check(h.catalog.searchCalls.get()==before)
    } finally {release.countDown()}
    check(lifeDone(old)==WorkerWriteCompletion.DISCARDED)
    check(h.worker.publishCalls.get()==1)
    check(h.dashboard.snapshot().mutation==WorkerMutationPhase.IDLE)
    check(h.dashboard.snapshot().profile==WorkerProfilePhase.UNKNOWN)
    check(customer.retrySearch()==PageCompletion.APPLIED)
    check(customer.presentation().phase==CustomerViewPhase.CATEGORIES)
    check(h.reads.workerSnapshot().ownListings==ReadState.Idle)
}

private fun expiryWhileOldPrivateGETCannotResurrectWorkerRows() {
    val h=LifeHarness()
    h.login()
    h.optIn()
    val customer=h.customer()
    check(customer.startBrowse(Language.HI)==PageCompletion.APPLIED)
    val entered=CountDownLatch(1)
    val release=CountDownLatch(1)
    h.worker.beforeOwn={
        entered.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val old=lifeThread {h.reads.ownListings()}
    try {
        lifeEntered(entered)
        check(h.dashboard.snapshot().owned==WorkerListingsPhase.LOADING)
        h.clock.set(3_600_000L)
        check(h.dashboard.snapshot()==WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT))
        check(h.reads.workerSnapshot().ownListings==ReadState.Idle)
        check(customer.presentation().phase==CustomerViewPhase.REFRESH_REQUIRED)
    } finally {release.countDown()}
    check(lifeDone(old)==ReadCompletion.DISCARDED)
    check(h.reads.workerSnapshot().ownListings==ReadState.Idle)
    check(h.worker.ownCalls.get()==1)
    check(customer.retryBrowse()==PageCompletion.APPLIED)
    check(h.dashboard.snapshot()==WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT))
}

private fun lifecycleRecreationDuringWriteRestoresIntentNotResultsOrSelection() {
    val h=LifeHarness()
    h.login()
    h.optIn()
    val old=h.customer()
    check(old.startSearch("प्लंबर",Language.HI,true,5)==PageCompletion.APPLIED)
    check(old.selectCategory(CustomerCategorySource.SEARCH,"plumber")==PageCompletion.APPLIED)
    check(old.loadSelectedListings()==PageCompletion.APPLIED)
    val intent=requireNotNull(old.captureRevisitIntent())
    check(intent.destination==CustomerDestination.SEARCH)
    old.close()
    val entered=CountDownLatch(1)
    val release=CountDownLatch(1)
    h.worker.beforePublish={
        entered.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val posting=lifeThread {h.writes.publishExplicitCategory("plumber")}
    val fresh=h.customer()
    try {
        lifeEntered(entered)
        check(fresh.restoreRevisitIntent(intent)==PageCompletion.APPLIED)
        val restored=fresh.presentation()
        check(restored.destination==CustomerDestination.SEARCH)
        check(restored.phase==CustomerViewPhase.REFRESH_REQUIRED)
        check(restored.searchIntent==intent.search)
        check(restored.categories.isEmpty() && restored.listings.isEmpty())
        check(restored.selectedCategory==null)
        val before=h.catalog.searchCalls.get()
        check(fresh.retrySearch()==PageCompletion.DEFERRED)
        check(h.catalog.searchCalls.get()==before)
        // The global worker-write barrier takes precedence over the absent
        // selection; neither DEFERRED nor BLOCKED dispatches public HTTP.
        val beforePublic=h.catalog.publicCalls.get()
        check(fresh.loadSelectedListings()==PageCompletion.DEFERRED)
        check(h.catalog.publicCalls.get()==beforePublic)
    } finally {release.countDown()}
    check(lifeDone(posting)==WorkerWriteCompletion.APPLIED)
    check(fresh.retrySearch()==PageCompletion.APPLIED)
    check(fresh.presentation().phase==CustomerViewPhase.CATEGORIES)
    check(fresh.loadSelectedListings()==PageCompletion.BLOCKED)
    check(fresh.selectCategory(CustomerCategorySource.SEARCH,"plumber")==PageCompletion.APPLIED)
    check(fresh.loadSelectedListings()==PageCompletion.APPLIED)
    check(fresh.presentation().phase==CustomerViewPhase.LISTINGS)
    check(h.catalog.publicCalls.get()==2)
    check(h.worker.publishCalls.get()==1)
}

private fun logoutWhileUncertainWriteRecheckIsPendingCannotResurrectReview() {
    val h=LifeHarness()
    h.login()
    h.optIn()
    h.worker.uncertainPublish=true
    check(h.writes.publishExplicitCategory("plumber")==WorkerWriteCompletion.APPLIED)
    check(h.dashboard.snapshot().mutation==WorkerMutationPhase.NEEDS_REVIEW)
    val entered=CountDownLatch(1)
    val release=CountDownLatch(1)
    h.worker.beforeOwn={
        entered.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val checking=lifeThread {h.writes.recheckOwnListings()}
    try {
        lifeEntered(entered)
        check(h.dashboard.snapshot().mutation==WorkerMutationPhase.RECHECKING)
        check(h.session.logout() is SessionResult.Failed)
        check(h.dashboard.snapshot()==WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT))
        check(h.writes.snapshot().state==WorkerWriteState.Idle)
    } finally {release.countDown()}
    check(lifeDone(checking)==WorkerWriteCompletion.DISCARDED)
    check(h.dashboard.snapshot()==WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT))
    check(h.worker.publishCalls.get()==1)
    h.login(LIFE_TOKEN_B)
    check(h.dashboard.snapshot().profile==WorkerProfilePhase.UNKNOWN)
    check(h.dashboard.snapshot().mutation==WorkerMutationPhase.IDLE)
    check(h.writes.recheckOwnListings()==WorkerWriteCompletion.BLOCKED)
    check(h.worker.publishCalls.get()==1)
}

fun main() {
    emptySearchDestinationSurvivesLifecycleWithoutGET()
    logoutDuringOldPublishKeepsPublicWriteBarrierUntilWireEnds()
    replacementDuringOldPublishCannotTransferWorkerStateOrBypassBarrier()
    expiryWhileOldPrivateGETCannotResurrectWorkerRows()
    lifecycleRecreationDuringWriteRestoresIntentNotResultsOrSelection()
    logoutWhileUncertainWriteRecheckIsPendingCannotResurrectReview()
    println("JODLO lifecycle regression: empty Search, logout/replacement, expiry, write barrier, recheck and no replay OK")
}
