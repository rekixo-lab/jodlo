package com.rekixo.jodlo.core.network

import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

// Integration through EXISTING production contracts, not a new listing API,
// public state machine, live category activation or deployment.
private const val RECON_LISTING = "11111111-1111-4111-8111-111111111111"
private const val RECON_CATEGORY = """{"id":"plumber","slug":"plumber","name":"प्लंबर"}"""
private val RECON_TOKEN = "a".repeat(43)
private fun reconOk(payload: String) =
    TransportReply(200, """{"ok":true,"data":$payload}""")
private fun reconParams(resource: String) =
    resource.substringAfter("?", "").split("&").filter { it.contains("=") }.associate {
        val kv = it.split("=",limit=2)
        kv[0] to URLDecoder.decode(kv[1],StandardCharsets.UTF_8.name())
    }
private fun reconIssued() = TransportReply(200,
    """{"ok":true,"data":{"accessToken":"$RECON_TOKEN","tokenType":"Bearer","expiresInSeconds":3600}}""")

private class PublicationBackend : WorkerRepository, RequestSender {
    @Volatile var visible = false
    @Volatile var uncertainPublish = false
    @Volatile var uncertainUnpublish = false
    @Volatile var beforeWrite: (() -> Unit)? = null
    @Volatile var beforePublicGET: (() -> Unit)? = null
    val requests = CopyOnWriteArrayList<ApiCall>()
    val publishCalls = AtomicInteger()
    val unpublishCalls = AtomicInteger()
    val ownCalls = AtomicInteger()

    override fun send(call: ApiCall): TransportReply {
        check(call.method == HttpMethod.GET && call.bodyUtf8()==null)
        check(call.headers()["Authorization"]==null)
        requests.add(call)
        val query=reconParams(call.resource)
        return when {
            call.resource.startsWith("/api/v1/catalog/search?") -> {
                check(query["q"]=="प्लंबर" && query["lang"]=="hi")
                check(query["includeChoices"]=="1" && query["offset"]=="0")
                reconOk("""{"language":"hi","query":"प्लंबर","categories":[$RECON_CATEGORY],"nextOffset":null}""")
            }
            call.resource.startsWith("/api/v1/catalog?") -> {
                check(query["lang"]=="hi")
                reconOk("""{"language":"hi","categories":[$RECON_CATEGORY],"nextCursor":null}""")
            }
            call.resource.startsWith("/api/v1/listings?") -> {
                check(query["categoryId"]=="plumber")
                beforePublicGET?.invoke()
                val body=if(visible) """[{"id":"$RECON_LISTING","categoryId":"plumber"}]"""
                    else "[]"
                reconOk("""{"listings":$body}""")
            }
            else -> error("Public Customer cannot access Worker/auth routes")
        }
    }
    override fun myDraft(session: String): ApiOutcome<WorkerDraft> =
        ApiOutcome.Ok(WorkerDraft("draft"))
    override fun optIn(session: String): ApiOutcome<WorkerDraft> =
        ApiOutcome.Ok(WorkerDraft("draft"))
    override fun myListings(session: String): ApiOutcome<List<OwnListing>> {
        ownCalls.incrementAndGet()
        return ApiOutcome.Ok(if(visible)
            listOf(OwnListing(RECON_LISTING,"plumber",true)) else emptyList())
    }
    override fun publishExplicitCategory(session: String,
        confirmedCategoryId: String): ApiOutcome<PublicListing> {
        check(confirmedCategoryId=="plumber")
        publishCalls.incrementAndGet()
        beforeWrite?.invoke()
        visible=true // simulate a remote COMMIT even when acknowledgement is lost
        return if(uncertainPublish) ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT,false)
            else ApiOutcome.Ok(PublicListing(RECON_LISTING,"plumber"))
    }
    override fun unpublish(session:String,listingId:String):ApiOutcome<Boolean> {
        check(listingId==RECON_LISTING)
        unpublishCalls.incrementAndGet()
        beforeWrite?.invoke()
        visible=false
        return if(uncertainUnpublish) ApiOutcome.Failed(
            FailureKind.SERVICE_UNAVAILABLE,false)
        else ApiOutcome.Ok(true)
    }
    fun publicCount()=requests.count { it.resource.startsWith("/api/v1/listings?") }
    fun allCount()=requests.size
}

private class ReconciliationHarness {
    val clock=AtomicLong()
    val api=PublicationBackend()
    val session=InMemorySessionCoordinator(api,RequestSender {
        error("No OAuth or logout requests in integration scenario")
    },{clock.get()})
    val catalog=RemoteCatalogRepository(api)
    val customer=HeadlessCatalogPaginationScope(catalog,session,{clock.get()},60_000L)
    val reads=HeadlessMarketplaceReadScope(catalog,session,{clock.get()},60_000L)
    val writes=HeadlessWorkerWriteScope(session)
    val dashboard=HeadlessWorkerDashboardPresentation(session,reads,writes)

    init {
        check(session.acceptIssuedSession(reconIssued()) is ApiOutcome.Ok)
        check(session.optIn()==SessionResult.Success(WorkerState.DRAFT))
    }
    fun browseAndOpen(): Unit {
        check(customer.startBrowse(Language.HI, pageSize=5)==PageCompletion.APPLIED)
        check(customer.selectCategory(CustomerCategorySource.BROWSE,"plumber")==
            PageCompletion.APPLIED)
        check(customer.loadSelectedListings()==PageCompletion.APPLIED)
    }
}
private fun <T> reconAsync(block: () -> T) =
    FutureTask<T> {block()}.also { Thread(it,"jodlo-reconciliation-fake").start() }
private fun <T> reconDone(f:FutureTask<T>):T = f.get(5,TimeUnit.SECONDS)
private fun reconStarted(l:CountDownLatch)=
    check(l.await(5,TimeUnit.SECONDS)){"Fake network request was not admitted"}

private fun successPublishThenExplicitPublicRefreshThenUnpublish() {
    val h=ReconciliationHarness()
    h.browseAndOpen()
    check(h.customer.presentation().phase==CustomerViewPhase.EMPTY)
    check(h.reads.publicListings("plumber")==ReadCompletion.APPLIED)
    check(h.reads.customerSnapshot().publicListings==ReadState.Ready(emptyList()))
    check(h.reads.ownListings()==ReadCompletion.APPLIED)
    check(h.dashboard.snapshot().owned==WorkerListingsPhase.EMPTY)
    val beforePublic=h.api.allCount()
    check(h.writes.publishExplicitCategory("plumber")==WorkerWriteCompletion.APPLIED)
    check(h.dashboard.snapshot().mutation==WorkerMutationPhase.CONFIRMED)
    check(h.customer.presentation().phase==CustomerViewPhase.REFRESH_REQUIRED)
    check(h.customer.presentation().listings.isEmpty())
    check(h.reads.customerSnapshot().publicListings==ReadState.RefreshRequired)
    check(h.dashboard.snapshot().owned==WorkerListingsPhase.IDLE)
    check(h.api.allCount()==beforePublic) // a write never starts a hidden Customer GET
    check(h.customer.loadSelectedListings()==PageCompletion.BLOCKED)
    // An explicit intent-bound recovery and exact Category choice are required.
    check(h.customer.retryBrowse()==PageCompletion.APPLIED)
    check(h.customer.selectCategory(CustomerCategorySource.BROWSE,"plumber")==
        PageCompletion.APPLIED)
    check(h.customer.loadSelectedListings()==PageCompletion.APPLIED)
    check(h.customer.presentation().listings==
        listOf(PublicListing(RECON_LISTING,"plumber")))
    check(h.reads.publicListings("plumber")==ReadCompletion.APPLIED)
    check(h.reads.customerSnapshot().publicListings ==
        ReadState.Ready(listOf(PublicListing(RECON_LISTING,"plumber"))))
    check(h.reads.ownListings()==ReadCompletion.APPLIED)
    check(h.dashboard.snapshot().ownedListings==
        listOf(OwnListing(RECON_LISTING,"plumber",true)))
    val afterFetch=h.api.allCount()
    check(h.writes.unpublish(RECON_LISTING)==WorkerWriteCompletion.APPLIED)
    check(h.api.allCount()==afterFetch)
    check(h.customer.presentation().phase==CustomerViewPhase.REFRESH_REQUIRED)
    check(h.reads.customerSnapshot().publicListings==ReadState.RefreshRequired)
    check(h.dashboard.snapshot().ownedListings.isEmpty())
    check(h.customer.retryBrowse()==PageCompletion.APPLIED)
    check(h.customer.selectCategory(CustomerCategorySource.BROWSE,"plumber")==
        PageCompletion.APPLIED)
    check(h.customer.loadSelectedListings()==PageCompletion.APPLIED)
    check(h.customer.presentation().phase==CustomerViewPhase.EMPTY)
    check(h.api.publishCalls.get()==1 && h.api.unpublishCalls.get()==1)
}

private fun uncertainPublishCanBeVisibleButNeverCertifiedByGet() {
    val h=ReconciliationHarness()
    h.browseAndOpen()
    check(h.reads.search("प्लंबर",Language.HI)==ReadCompletion.APPLIED)
    h.api.uncertainPublish=true
    val before=h.api.allCount()
    check(h.writes.publishExplicitCategory("plumber")==WorkerWriteCompletion.APPLIED)
    check(h.customer.presentation().phase==CustomerViewPhase.REFRESH_REQUIRED)
    check(h.reads.customerSnapshot().search==ReadState.RefreshRequired)
    check(h.api.allCount()==before)
    val uncertain=h.dashboard.snapshot()
    check(uncertain.mutation==WorkerMutationPhase.NEEDS_REVIEW)
    check(uncertain.observedVisibility==null)
    check(uncertain.ownedListings.isEmpty())
    check(h.writes.publishExplicitCategory("plumber")==WorkerWriteCompletion.BLOCKED)
    check(h.writes.recheckOwnListings()==WorkerWriteCompletion.APPLIED)
    val observed=h.dashboard.snapshot()
    check(observed.mutation==WorkerMutationPhase.NEEDS_REVIEW)
    check(observed.observedVisibility==WorkerVisibility.VISIBLE)
    check(h.api.ownCalls.get()==1 && h.api.publishCalls.get()==1)
    check(h.customer.retryBrowse()==PageCompletion.APPLIED)
    check(h.customer.selectCategory(CustomerCategorySource.BROWSE,"plumber")==
        PageCompletion.APPLIED)
    check(h.customer.loadSelectedListings()==PageCompletion.APPLIED)
    check(h.customer.presentation().phase==CustomerViewPhase.LISTINGS)
    // Seeing it from Customer does not prove this POST caused it.
    check(h.dashboard.snapshot().mutation==WorkerMutationPhase.NEEDS_REVIEW)
    check(h.writes.unpublish(RECON_LISTING)==WorkerWriteCompletion.BLOCKED)
    check(h.api.publishCalls.get()==1 && h.api.unpublishCalls.get()==0)
    check(h.writes.acknowledgeUncertainty())
    check(h.dashboard.snapshot().mutation==WorkerMutationPhase.IDLE)
    check(h.api.publishCalls.get()==1) // explicit acknowledgement is local only
}

private fun noPublicGetWhileWriteOnWireAndNoOldResultsAfterFinish() {
    val h=ReconciliationHarness()
    h.browseAndOpen()
    check(h.reads.publicListings("plumber")==ReadCompletion.APPLIED)
    val entered=CountDownLatch(1)
    val release=CountDownLatch(1)
    h.api.beforeWrite={
        entered.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val slow=reconAsync {h.writes.publishExplicitCategory("plumber")}
    try {
        reconStarted(entered)
        check(h.customer.presentation().phase==CustomerViewPhase.REFRESH_REQUIRED)
        check(h.dashboard.snapshot().mutation==WorkerMutationPhase.SENDING)
        check(h.reads.customerSnapshot().publicListings==ReadState.RefreshRequired)
        val count=h.api.allCount()
        check(h.customer.retryBrowse()==PageCompletion.DEFERRED)
        check(h.reads.publicListings("plumber")==ReadCompletion.DEFERRED)
        check(h.api.allCount()==count)
    }finally {release.countDown()}
    check(reconDone(slow)==WorkerWriteCompletion.APPLIED)
    check(h.customer.presentation().phase==CustomerViewPhase.REFRESH_REQUIRED)
    check(h.api.publishCalls.get()==1)
    h.api.beforeWrite=null
    check(h.customer.retryBrowse()==PageCompletion.APPLIED)
    check(h.customer.selectCategory(CustomerCategorySource.BROWSE,"plumber")==
        PageCompletion.APPLIED)
    check(h.customer.loadSelectedListings()==PageCompletion.APPLIED)
    check(h.customer.presentation().phase==CustomerViewPhase.LISTINGS)
}

private fun oldPublicGetCannotResurrectAfterUncertainUnpublish() {
    val h=ReconciliationHarness()
    h.api.visible=true
    h.browseAndOpen()
    check(h.customer.presentation().phase==CustomerViewPhase.LISTINGS)
    val started=CountDownLatch(1)
    val release=CountDownLatch(1)
    h.api.beforePublicGET={
        started.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val stale=reconAsync {h.customer.loadSelectedListings()}
    try {
        reconStarted(started)
        h.api.uncertainUnpublish=true
        check(h.writes.unpublish(RECON_LISTING)==WorkerWriteCompletion.APPLIED)
        check(h.dashboard.snapshot().mutation==WorkerMutationPhase.NEEDS_REVIEW)
        check(h.customer.presentation().phase==CustomerViewPhase.REFRESH_REQUIRED)
    } finally {release.countDown()}
    check(reconDone(stale)==PageCompletion.DISCARDED)
    check(h.customer.presentation().listings.isEmpty())
    check(h.writes.recheckOwnListings()==WorkerWriteCompletion.APPLIED)
    check(h.dashboard.snapshot().mutation==WorkerMutationPhase.NEEDS_REVIEW)
    check(h.dashboard.snapshot().observedVisibility==
        WorkerVisibility.NOT_IN_FIRST_100)
    h.api.beforePublicGET=null
    check(h.customer.retryBrowse()==PageCompletion.APPLIED)
    check(h.customer.selectCategory(CustomerCategorySource.BROWSE,"plumber")==
        PageCompletion.APPLIED)
    check(h.customer.loadSelectedListings()==PageCompletion.APPLIED)
    check(h.customer.presentation().phase==CustomerViewPhase.EMPTY)
    check(h.writes.snapshot().state is WorkerWriteState.NeedsReview)
    check(h.api.unpublishCalls.get()==1)
}

fun main() {
    successPublishThenExplicitPublicRefreshThenUnpublish()
    uncertainPublishCanBeVisibleButNeverCertifiedByGet()
    noPublicGetWhileWriteOnWireAndNoOldResultsAfterFinish()
    oldPublicGetCannotResurrectAfterUncertainUnpublish()
    println("JODLO publication reconciliation E2E: publish/unpublish, public refresh, uncertain write and late GET safety OK")
}
