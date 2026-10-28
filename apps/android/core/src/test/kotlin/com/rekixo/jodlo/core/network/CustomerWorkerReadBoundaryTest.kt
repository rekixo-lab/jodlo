package com.rekixo.jodlo.core.network

import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

private const val OWNER_ONLY_ID = "11111111-1111-4111-8111-111111111111"
private const val PUBLIC_ONLY_ID = "22222222-2222-4222-8222-222222222222"
private val BOUNDARY_TOKEN_A = "a".repeat(43)
private val BOUNDARY_TOKEN_B = "b".repeat(43)
private val BOUNDARY_CATEGORY = PublicCategory("plumber","plumber","प्लंबर")
private fun granted(token: String) = TransportReply(200,
    """{"ok":true,"data":{"accessToken":"$token","tokenType":"Bearer","expiresInSeconds":3600}}""")
private fun <T> threaded(block: () -> T) =
    FutureTask<T> {block()}.also {Thread(it,"jodlo-boundary-fake").start()}
private fun <T> resolved(f: FutureTask<T>):T = f.get(5,TimeUnit.SECONDS)
private fun reachedBoundary(l: CountDownLatch) =
    check(l.await(5,TimeUnit.SECONDS)) {"Fake worker call not started"}

private class BoundaryCatalog: CatalogRepository {
    val requests = AtomicInteger()
    var beforeBrowse: (() -> Unit)? = null
    override fun browse(language: Language, availableOnly: Boolean, limit: Int,
        after: String?): ApiOutcome<CatalogBrowse> {
        requests.incrementAndGet()
        beforeBrowse?.invoke()
        return ApiOutcome.Ok(CatalogBrowse(language,listOf(BOUNDARY_CATEGORY),null))
    }
    override fun search(query: String, language: Language, availableOnly: Boolean,
        includeChoices: Boolean, limit: Int, offset: Int): ApiOutcome<CatalogSearch> {
        requests.incrementAndGet()
        return ApiOutcome.Ok(CatalogSearch(language,query,listOf(BOUNDARY_CATEGORY),null,
            false,emptyList()))
    }
    override fun listings(categoryId: String): ApiOutcome<List<PublicListing>> {
        requests.incrementAndGet()
        return ApiOutcome.Ok(listOf(PublicListing(PUBLIC_ONLY_ID,categoryId)))
    }
}
private class BoundaryWorker : WorkerRepository {
    val privateGETs = AtomicInteger()
    val writes = AtomicInteger()
    var beforeOwn: (() -> Unit)? = null
    var beforePublish: (() -> Unit)? = null
    override fun myDraft(session: String): ApiOutcome<WorkerDraft> =
        ApiOutcome.Ok(WorkerDraft("draft"))
    override fun optIn(session: String): ApiOutcome<WorkerDraft> =
        ApiOutcome.Ok(WorkerDraft("draft"))
    override fun myListings(session: String): ApiOutcome<List<OwnListing>> {
        privateGETs.incrementAndGet()
        beforeOwn?.invoke()
        return ApiOutcome.Ok(listOf(OwnListing(OWNER_ONLY_ID,"plumber",true)))
    }
    override fun publishExplicitCategory(session: String,
        confirmedCategoryId: String): ApiOutcome<PublicListing> {
        writes.incrementAndGet()
        beforePublish?.invoke()
        return ApiOutcome.Ok(PublicListing(OWNER_ONLY_ID,confirmedCategoryId))
    }
    override fun unpublish(session: String, listingId: String): ApiOutcome<Boolean> {
        writes.incrementAndGet()
        return ApiOutcome.Ok(true)
    }
}
private fun makeSession(worker: BoundaryWorker,clock: AtomicLong) =
    InMemorySessionCoordinator(worker,RequestSender {
        TransportReply(503,
            """{"ok":false,"error":{"code":"SERVICE_UNAVAILABLE","message":"unavailable"}}""")
    },{clock.get()})
private fun makeReads(catalog: BoundaryCatalog, session: InMemorySessionCoordinator,
    clock:AtomicLong) =
    HeadlessMarketplaceReadScope(catalog,session,{clock.get()},1_000)

private fun publicShapeCannotCarryPrivateWorkerRows() {
    val clock=AtomicLong()
    val catalog=BoundaryCatalog()
    val worker=BoundaryWorker()
    val session=makeSession(worker,clock)
    val reads=makeReads(catalog,session,clock)
    check(session.acceptIssuedSession(granted(BOUNDARY_TOKEN_A)) is ApiOutcome.Ok)
    check(session.optIn()==SessionResult.Success(WorkerState.DRAFT))
    check(reads.browse(Language.HI)==ReadCompletion.APPLIED)
    check(reads.search("प्लंबर",Language.HI)==ReadCompletion.APPLIED)
    check(reads.publicListings("plumber")==ReadCompletion.APPLIED)
    check(reads.checkWorker()==ReadCompletion.APPLIED)
    check(reads.ownListings()==ReadCompletion.APPLIED)
    val public=reads.customerSnapshot()
    val private=reads.workerSnapshot()
    check(public.browse is ReadState.Ready)
    check(public.search is ReadState.Ready)
    check(public.publicListings ==
        ReadState.Ready(listOf(PublicListing(PUBLIC_ONLY_ID,"plumber"))))
    check(private.login==LoginState.SignedIn(WorkerState.DRAFT))
    check(private.ownListings ==
        ReadState.Ready(listOf(OwnListing(OWNER_ONLY_ID,"plumber",true))))
    check(private.worker == ReadState.Ready(WorkerState.DRAFT))
    check("ownListings" !in CustomerMarketplaceSnapshot::class.java.declaredFields
        .map {it.name})
    check("worker" !in CustomerMarketplaceSnapshot::class.java.declaredFields
        .map {it.name})
    check("browse" !in WorkerMarketplaceSnapshot::class.java.declaredFields
        .map {it.name})
    check("search" !in WorkerMarketplaceSnapshot::class.java.declaredFields
        .map {it.name})
    check(!public.toString().contains(OWNER_ONLY_ID))
    check(!public.toString().contains(BOUNDARY_TOKEN_A))
    check(!private.toString().contains(BOUNDARY_TOKEN_A))
    check(!private.toString().contains(PUBLIC_ONLY_ID))
    check(catalog.requests.get()==3 && worker.privateGETs.get()==1)
    reads.close()
}

private fun localLogoutRemovesWorkerStateButKeepsPublicData() {
    val clock=AtomicLong()
    val catalog=BoundaryCatalog()
    val worker=BoundaryWorker()
    val session=makeSession(worker,clock)
    val reads=makeReads(catalog,session,clock)
    check(session.acceptIssuedSession(granted(BOUNDARY_TOKEN_A)) is ApiOutcome.Ok)
    check(reads.browse(Language.EN)==ReadCompletion.APPLIED)
    check(reads.ownListings()==ReadCompletion.APPLIED)
    check(reads.workerSnapshot().ownListings is ReadState.Ready)
    check(session.logout() is SessionResult.Failed) // remote revoke uncertain
    val owner=reads.workerSnapshot()
    check(owner.login==LoginState.SignedOut)
    check(owner.ownListings==ReadState.Idle && owner.worker==ReadState.Idle)
    val customer=reads.customerSnapshot()
    check(customer.browse is ReadState.Ready)
    check(catalog.requests.get()==1 && worker.privateGETs.get()==1)
    check(reads.ownListings()==ReadCompletion.APPLIED)
    check(reads.workerSnapshot().ownListings==ReadState.SessionError(SessionFailure.SIGNED_OUT))
    check(reads.workerSnapshot().login==LoginState.SignedOut)
}

private fun newAccountCannotInheritPreviousOwnerListing() {
    val clock=AtomicLong()
    val worker=BoundaryWorker()
    val session=makeSession(worker,clock)
    val reads=makeReads(BoundaryCatalog(),session,clock)
    check(session.acceptIssuedSession(granted(BOUNDARY_TOKEN_A)) is ApiOutcome.Ok)
    check(reads.ownListings()==ReadCompletion.APPLIED)
    check(reads.workerSnapshot().ownListings is ReadState.Ready)
    check(session.acceptIssuedSession(granted(BOUNDARY_TOKEN_B)) is ApiOutcome.Ok)
    val after=reads.workerSnapshot()
    check(after.login==LoginState.SignedIn(WorkerState.UNKNOWN))
    check(after.ownListings==ReadState.Idle)
    check(after.worker==ReadState.Idle)
    check(!after.toString().contains(OWNER_ONLY_ID))
}

private fun slowPrivateReadCannotCrossAccountEpoch() {
    val clock=AtomicLong()
    val worker=BoundaryWorker()
    val session=makeSession(worker,clock)
    val reads=makeReads(BoundaryCatalog(),session,clock)
    check(session.acceptIssuedSession(granted(BOUNDARY_TOKEN_A)) is ApiOutcome.Ok)
    val entered=CountDownLatch(1)
    val release=CountDownLatch(1)
    worker.beforeOwn={
        entered.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val slow=threaded {reads.ownListings()}
    try {
        reachedBoundary(entered)
        check(reads.workerSnapshot().ownListings==ReadState.Loading)
        check(session.acceptIssuedSession(granted(BOUNDARY_TOKEN_B)) is ApiOutcome.Ok)
        check(reads.workerSnapshot().ownListings==ReadState.Idle)
        check(reads.workerSnapshot().login==LoginState.SignedIn(WorkerState.UNKNOWN))
    } finally {release.countDown()}
    check(resolved(slow)==ReadCompletion.DISCARDED)
    check(reads.workerSnapshot().ownListings==ReadState.Idle)
    check(worker.privateGETs.get()==1)
}

private fun workerMutationInvalidatesPublicAndPrivateWhileDeferred() {
    val clock=AtomicLong()
    val worker=BoundaryWorker()
    val session=makeSession(worker,clock)
    val catalog=BoundaryCatalog()
    val reads=makeReads(catalog,session,clock)
    check(session.acceptIssuedSession(granted(BOUNDARY_TOKEN_A)) is ApiOutcome.Ok)
    check(session.optIn()==SessionResult.Success(WorkerState.DRAFT))
    check(reads.browse(Language.HI)==ReadCompletion.APPLIED)
    check(reads.ownListings()==ReadCompletion.APPLIED)
    val entered=CountDownLatch(1)
    val release=CountDownLatch(1)
    worker.beforePublish={
        entered.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val slow=threaded { session.publishExplicitCategory("plumber") }
    try {
        reachedBoundary(entered)
        check(reads.customerSnapshot().browse==ReadState.RefreshRequired)
        check(reads.workerSnapshot().ownListings==ReadState.Idle)
        val before=catalog.requests.get()
        check(reads.browse(Language.HI)==ReadCompletion.DEFERRED)
        check(catalog.requests.get()==before) // no public GET during write
    } finally {release.countDown()}
    check(resolved(slow) is SessionResult.Success)
    check(reads.customerSnapshot().browse==ReadState.RefreshRequired)
    check(reads.workerSnapshot().ownListings==ReadState.Idle)
    check(reads.browse(Language.HI)==ReadCompletion.APPLIED)
    check(reads.customerSnapshot().browse is ReadState.Ready)
    check(catalog.requests.get()==2 && worker.writes.get()==1)
}

private fun expiryAndCloseFailClosed() {
    val clock=AtomicLong(100)
    val worker=BoundaryWorker()
    val session=makeSession(worker,clock)
    val reads=makeReads(BoundaryCatalog(),session,clock)
    check(session.acceptIssuedSession(granted(BOUNDARY_TOKEN_A)) is ApiOutcome.Ok)
    check(reads.ownListings()==ReadCompletion.APPLIED)
    clock.set(3_600_101)
    check(reads.workerSnapshot().login==LoginState.SignedOut)
    check(reads.workerSnapshot().ownListings==ReadState.Idle)
    reads.close()
    check(reads.customerSnapshot()==CustomerMarketplaceSnapshot(true,
        ReadState.Idle,ReadState.Idle,ReadState.Idle))
    check(reads.workerSnapshot()==WorkerMarketplaceSnapshot(true,
        LoginState.SignedOut,ReadState.Idle,ReadState.Idle))
    check(worker.privateGETs.get()==1)
}

fun main() {
    publicShapeCannotCarryPrivateWorkerRows()
    localLogoutRemovesWorkerStateButKeepsPublicData()
    newAccountCannotInheritPreviousOwnerListing()
    slowPrivateReadCannotCrossAccountEpoch()
    workerMutationInvalidatesPublicAndPrivateWhileDeferred()
    expiryAndCloseFailClosed()
    println("JODLO actor boundaries: typed Customer public/Worker private, logout, replacement, write and lifecycle safety OK")
}
