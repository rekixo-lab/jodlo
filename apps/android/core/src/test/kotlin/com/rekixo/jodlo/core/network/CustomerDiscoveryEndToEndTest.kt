package com.rekixo.jodlo.core.network

import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

// Local fake HTTP only. The production route builder, one-shot repository,
// strict JSON decoder, page coordinator and navigation/recovery are all REAL.
private const val E2E_LISTING = "11111111-1111-4111-8111-111111111111"
private const val E2E_PLUMBER = """{"id":"plumber","slug":"plumber","name":"प्लंबर"}"""
private const val E2E_CARPENTER = """{"id":"carpenter","slug":"carpenter","name":"बढ़ई"}"""
private const val E2E_PAINTER = """{"id":"painter","slug":"painter","name":"पेंटर"}"""
private const val E2E_ELECTRICIAN = """{"id":"electrician","slug":"electrician","name":"इलेक्ट्रीशियन"}"""
private fun jsonOk(data: String) = TransportReply(200, """{"ok":true,"data":$data}""")
private fun params(resource: String): Map<String,String> =
    resource.substringAfter('?', "").takeIf { it.isNotEmpty() }
        ?.split("&")?.associate {
            val pair=it.split("=",limit=2)
            pair[0] to URLDecoder.decode(pair.getOrElse(1){""},StandardCharsets.UTF_8.name())
        } ?: emptyMap()

private class FakeDiscoveryWire : RequestSender {
    val requests=CopyOnWriteArrayList<ApiCall>()
    var beforeReturn: ((ApiCall)->Unit)? = null
    var invalidListings=false
    var malformedSearch=false
    var failSearch=false

    override fun send(call: ApiCall): TransportReply {
        check(call.method == HttpMethod.GET) { "Customer journey must not POST/DELETE" }
        check(call.headers()["Authorization"] == null && call.bodyUtf8()==null) {
            "No personal token or body allowed in public GET"
        }
        requests.add(call)
        beforeReturn?.invoke(call)
        val query=params(call.resource)
        return when {
            call.resource.startsWith("/api/v1/catalog/search?") -> {
                val q=query["q"] ?: error("Search query missing")
                val lang=query["lang"] ?: error("Search language missing")
                val offset=(query["offset"] ?: "0").toInt()
                val limit=(query["limit"] ?: "20").toInt()
                check(query["includeChoices"] == "1" && offset == 0 ||
                    query["includeChoices"] == null && offset > 0) {
                    "Choices only on first search page"
                }
                when {
                    failSearch -> TransportReply(503,
                        """{"ok":false,"error":{"code":"SERVICE_UNAVAILABLE","message":"temporary"}}""")
                    malformedSearch -> jsonOk(
                        """{"language":"$lang","query":"$q","categories":[],"nextOffset":null,"privatePhone":"secret"}""")
                    q == "नल या लकड़ी" -> jsonOk(
                        """{"language":"hi","query":"$q","categories":[],"nextOffset":null,"needsChoice":true,"choices":[$E2E_PLUMBER,$E2E_CARPENTER]}""")
                    q == "carpenter" -> jsonOk(
                        if (offset==0)
                            """{"language":"$lang","query":"$q","categories":[$E2E_CARPENTER,$E2E_PAINTER],"nextOffset":$limit}"""
                        else
                            """{"language":"$lang","query":"$q","categories":[$E2E_ELECTRICIAN],"nextOffset":null}"""
                    )
                    else -> jsonOk(
                        """{"language":"$lang","query":"$q","categories":[$E2E_ELECTRICIAN],"nextOffset":null}""")
                }
            }
            call.resource.startsWith("/api/v1/catalog?") -> {
                val language=query["lang"] ?: error("Browse language missing")
                when (query["after"]) {
                    null -> jsonOk(
                        """{"language":"$language","categories":[$E2E_PLUMBER,$E2E_CARPENTER],"nextCursor":"2:carpenter"}""")
                    "2:carpenter" -> jsonOk(
                        """{"language":"$language","categories":[$E2E_PAINTER],"nextCursor":null}""")
                    else -> error("Unexpected Browse cursor")
                }
            }
            call.resource.startsWith("/api/v1/listings?") -> {
                val id=query["categoryId"] ?: error("Missing Category ID")
                if (invalidListings) jsonOk(
                    """{"listings":[{"id":"$E2E_LISTING","categoryId":"wrong"}]}""")
                else jsonOk(
                    """{"listings":[{"id":"$E2E_LISTING","categoryId":"$id"}]}""")
            }
            else -> error("No other service routes are allowed for Customer")
        }
    }
    fun count(prefix: String) = requests.count {it.resource.startsWith(prefix)}
}
private class NoCustomerWrites : WorkerRepository {
    val mutations=AtomicInteger(0)
    override fun myDraft(session: String) = error("No worker read in customer journey")
    override fun optIn(session: String): ApiOutcome<WorkerDraft> = error("No opt-in")
    override fun myListings(session: String): ApiOutcome<List<OwnListing>> =
        error("No owner listing GET")
    override fun publishExplicitCategory(session: String,confirmedCategoryId: String):
        ApiOutcome<PublicListing> {
        mutations.incrementAndGet()
        error("A Customer selection must not publish")
    }
    override fun unpublish(session: String,listingId: String): ApiOutcome<Boolean> {
        mutations.incrementAndGet()
        error("A Customer must not unpublish")
    }
}
private fun fakeSession(worker: WorkerRepository,clock: AtomicLong) =
    InMemorySessionCoordinator(worker,RequestSender {error("No authentication request")}) {
        clock.get()
    }
private fun scope(wire: FakeDiscoveryWire,worker: WorkerRepository,clock: AtomicLong) =
    HeadlessCatalogPaginationScope(RemoteCatalogRepository(wire),fakeSession(worker,clock),
        {clock.get()},60_000L)
private fun <T> async(block: ()->T) =
    FutureTask<T> {block()}.also {Thread(it,"jodlo-e2e-fake").start()}
private fun <T> awaitFuture(f:FutureTask<T>):T = f.get(5,TimeUnit.SECONDS)
private fun awaitStarted(l:CountDownLatch)=
    check(l.await(5,TimeUnit.SECONDS)){"Expected fake HTTP GET never started"}

private fun journeyBrowseAmbiguousSelectionBackAndRestore() {
    val wire=FakeDiscoveryWire()
    val worker=NoCustomerWrites()
    val clock=AtomicLong(5_000)
    val first=scope(wire,worker,clock)

    // Browse pages really pass through Cursor route and strict JSON decoder.
    check(first.startBrowse(Language.HI,pageSize=2)==PageCompletion.APPLIED)
    check(first.nextBrowse()==PageCompletion.APPLIED)
    val browse=first.snapshot().browse as PageState.Ready
    check(browse.categories.map {it.id}==listOf("plumber","carpenter","painter"))
    check(browse.pageCount==2 && browse.nextCursor==null)
    check(wire.requests[0].resource=="/api/v1/catalog?lang=hi&limit=2")
    check(wire.requests[1].resource.contains("after=2%3Acarpenter"))
    check(first.nextBrowse()==PageCompletion.BLOCKED)

    // Ambiguous search needs one *explicit* exact category choice.
    check(first.startSearch("  नल या लकड़ी  ",Language.HI,pageSize=2)
        ==PageCompletion.APPLIED)
    val search=first.snapshot().search as PageState.Ready
    check(search.needsChoice && search.categories.isEmpty() &&
        search.choices.map {it.id}==listOf("plumber","carpenter"))
    check(first.nextSearch()==PageCompletion.BLOCKED)
    check(first.selectCategory(CustomerCategorySource.SEARCH,"painter")
        ==PageCompletion.BLOCKED)
    check(first.selectCategory(CustomerCategorySource.SEARCH,"carpenter")
        ==PageCompletion.APPLIED)
    check(first.snapshot().navigation==CustomerNavigationState(
        CustomerDestination.PUBLIC_LISTINGS,CustomerDestination.SEARCH))
    check(wire.count("/api/v1/listings?")==0)
    check(first.loadSelectedListings()==PageCompletion.APPLIED)
    val selected=first.snapshot().selection as CustomerSelectionState.Ready
    check(selected.category.id=="carpenter" &&
        selected.listings==listOf(PublicListing(E2E_LISTING,"carpenter")))
    check(wire.requests.last().resource=="/api/v1/listings?categoryId=carpenter")

    // Back never replays network traffic and never retains Listings.
    val beforeBack=wire.requests.size
    check(first.back()==PageCompletion.APPLIED)
    check(first.snapshot().navigation.destination==CustomerDestination.SEARCH)
    check(first.snapshot().selection==CustomerSelectionState.Idle)
    check(first.snapshot().search is PageState.Ready)
    check(first.back()==PageCompletion.APPLIED)
    check(first.snapshot().navigation.destination==CustomerDestination.BROWSE)
    check(first.showSearch()==PageCompletion.APPLIED)
    check(first.snapshot().search is PageState.Ready)
    check(wire.requests.size==beforeBack)

    // Life-cycle handoff captures only bounded first-page request parameters,
    // NOT the categories, selected IDs, listing rows or old JSON/HTTP payloads.
    val saved=requireNotNull(first.captureRevisitIntent())
    check(saved.search==CustomerSearchIntent("नल या लकड़ी",Language.HI,false,2))
    check(saved.browse==CustomerBrowseIntent(Language.HI,false,2))
    check(saved.destination==CustomerDestination.SEARCH)
    check(!saved.toString().contains(E2E_LISTING))
    first.close()
    check(first.captureRevisitIntent()==null)
    val later=scope(wire,worker,clock)
    val countBeforeRestore=wire.requests.size
    check(later.restoreRevisitIntent(saved)==PageCompletion.APPLIED)
    check(later.snapshot().search==PageState.RefreshRequired)
    check(later.snapshot().browse==PageState.RefreshRequired)
    check(later.snapshot().selection==CustomerSelectionState.Idle)
    check(later.snapshot().navigation.destination==CustomerDestination.SEARCH)
    check(wire.requests.size==countBeforeRestore)
    check(later.loadSelectedListings()==PageCompletion.BLOCKED)
    check(later.selectCategory(CustomerCategorySource.SEARCH,"carpenter")
        ==PageCompletion.BLOCKED)
    check(later.startSearch(saved.search!!.query,saved.search.language,
        saved.search.availableOnly,saved.search.pageSize)==PageCompletion.APPLIED)
    check(later.selectCategory(CustomerCategorySource.SEARCH,"carpenter")
        ==PageCompletion.APPLIED)
    check(later.loadSelectedListings()==PageCompletion.APPLIED)
    check(wire.count("/api/v1/listings?")==2 && worker.mutations.get()==0)
    later.close()
}

private fun journeyPaginatedEnglishSearchFiltersAndNewQuery() {
    val wire=FakeDiscoveryWire()
    val worker=NoCustomerWrites()
    val clock=AtomicLong()
    val flow=scope(wire,worker,clock)
    check(flow.startSearch("carpenter",Language.EN,availableOnly=true,pageSize=2)
        ==PageCompletion.APPLIED)
    check(flow.nextSearch()==PageCompletion.APPLIED)
    val page=flow.snapshot().search as PageState.Ready
    check(page.categories.map {it.id}==listOf("carpenter","painter","electrician"))
    check(page.pageCount==2 && page.availableOnly && page.nextOffset==null)
    check(wire.requests[0].resource.contains("availableOnly=1"))
    check(wire.requests[0].resource.contains("includeChoices=1"))
    check(wire.requests[1].resource.contains("offset=2"))
    check(!wire.requests[1].resource.contains("includeChoices=1"))
    check(flow.selectCategory(CustomerCategorySource.SEARCH,"electrician")
        ==PageCompletion.APPLIED)
    check(flow.loadSelectedListings()==PageCompletion.APPLIED)
    check(flow.back()==PageCompletion.APPLIED)
    check(flow.snapshot().search is PageState.Ready)
    val before=wire.requests.size
    check(flow.showBrowse()==PageCompletion.APPLIED)
    check(flow.showSearch()==PageCompletion.APPLIED)
    check(wire.requests.size==before)
    check(flow.startSearch("electrician",Language.EN,pageSize=2)==PageCompletion.APPLIED)
    val changed=flow.snapshot()
    check((changed.search as PageState.Ready).categories.map{it.id}==listOf("electrician"))
    check(changed.selection==CustomerSelectionState.Idle)
    check(changed.intent.search==CustomerSearchIntent("electrician",Language.EN,false,2))
    check(flow.selectCategory(CustomerCategorySource.SEARCH,"painter")
        ==PageCompletion.BLOCKED)
    check(worker.mutations.get()==0)
    flow.close()
}

private fun journeyProtocolFailureAndRefreshMustFailClosed() {
    val wire=FakeDiscoveryWire()
    val worker=NoCustomerWrites()
    val clock=AtomicLong()
    val flow=scope(wire,worker,clock)
    check(flow.startSearch("electrician",Language.EN,pageSize=2)==PageCompletion.APPLIED)
    check(flow.selectCategory(CustomerCategorySource.SEARCH,"electrician")
        ==PageCompletion.APPLIED)
    wire.invalidListings=true
    check(flow.loadSelectedListings()==PageCompletion.APPLIED)
    check(flow.snapshot().selection==CustomerSelectionState.Error(
        PublicCategory("electrician","electrician","इलेक्ट्रीशियन"),
        CustomerCategorySource.SEARCH,FailureKind.BAD_RESPONSE))
    check(flow.back()==PageCompletion.APPLIED)
    wire.malformedSearch=true
    check(flow.startSearch("electrician",Language.EN,pageSize=2)==PageCompletion.APPLIED)
    check(flow.snapshot().search==PageState.Error(FailureKind.BAD_RESPONSE))
    check(flow.captureRevisitIntent()!!.search!!.query=="electrician")
    check(flow.selectCategory(CustomerCategorySource.SEARCH,"electrician")
        ==PageCompletion.BLOCKED)
    wire.malformedSearch=false
    wire.invalidListings=false
    check(flow.requestRefresh())
    check(flow.snapshot().search==PageState.RefreshRequired)
    check(flow.startSearch("electrician",Language.EN,pageSize=2)==PageCompletion.APPLIED)
    check(flow.selectCategory(CustomerCategorySource.SEARCH,"electrician")
        ==PageCompletion.APPLIED)
    check(flow.loadSelectedListings()==PageCompletion.APPLIED)
    clock.set(60_000)  // Exact default expiry boundary from first GET started at 0.
    check(flow.snapshot().search==PageState.RefreshRequired)
    check(flow.snapshot().selection==CustomerSelectionState.RefreshRequired)
    check(flow.loadSelectedListings()==PageCompletion.BLOCKED)
    check(worker.mutations.get()==0)
    flow.close()
}

private fun journeyLateHTTPResponseRejectedAfterResetAndClose() {
    val wire=FakeDiscoveryWire()
    val worker=NoCustomerWrites()
    val clock=AtomicLong(0)
    val flow=scope(wire,worker,clock)
    check(flow.startSearch("carpenter",Language.EN,pageSize=2)==PageCompletion.APPLIED)
    check(flow.selectCategory(CustomerCategorySource.SEARCH,"carpenter")
        ==PageCompletion.APPLIED)
    val started=CountDownLatch(1)
    val release=CountDownLatch(1)
    wire.beforeReturn={call->
        if(call.resource.startsWith("/api/v1/listings?")){
            started.countDown()
            check(release.await(5,TimeUnit.SECONDS))
        }
    }
    val slow=async{flow.loadSelectedListings()}
    try{
        awaitStarted(started)
        check(flow.resetDiscovery())
        val snap=flow.snapshot()
        check(snap.navigation==CustomerNavigationState())
        check(snap.search==PageState.Idle && snap.browse==PageState.Idle)
        check(snap.selection==CustomerSelectionState.Idle)
        check(snap.intent==CustomerDiscoveryIntent())
    }finally{release.countDown()}
    check(awaitFuture(slow)==PageCompletion.DISCARDED)
    check(wire.count("/api/v1/listings?")==1)
    check(flow.loadSelectedListings()==PageCompletion.BLOCKED)
    flow.close()
    check(flow.snapshot().closed)
    check(worker.mutations.get()==0)
}

fun main(){
    journeyBrowseAmbiguousSelectionBackAndRestore()
    journeyPaginatedEnglishSearchFiltersAndNewQuery()
    journeyProtocolFailureAndRefreshMustFailClosed()
    journeyLateHTTPResponseRejectedAfterResetAndClose()
    println("JODLO customer E2E: real HTTP routes/JSON decoder and Browse-Search-Choice-Listings-Back-Restore safety OK")
}
