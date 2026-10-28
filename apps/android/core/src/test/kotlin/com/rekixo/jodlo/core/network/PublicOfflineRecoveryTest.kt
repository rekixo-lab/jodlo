package com.rekixo.jodlo.core.network

import java.io.IOException
import java.net.SocketTimeoutException
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

private const val OFFLINE_LISTING_ID = "11111111-1111-4111-8111-111111111111"
private const val OFFLINE_CARPENTER = """{"id":"carpenter","slug":"carpenter","name":"बढ़ई"}"""
private const val OFFLINE_PAINTER = """{"id":"painter","slug":"painter","name":"पेंटर"}"""
private const val OFFLINE_ELECTRICIAN = """{"id":"electrician","slug":"electrician","name":"इलेक्ट्रीशियन"}"""
private fun offlineOK(body: String) =
    TransportReply(200, """{"ok":true,"data":$body}""")
private fun offlineParams(call: ApiCall): Map<String, String> =
    call.resource.substringAfter("?", "").split("&")
        .filter { it.contains("=") }
        .associate {
            val parts = it.split("=", limit = 2)
            parts[0] to URLDecoder.decode(parts[1], StandardCharsets.UTF_8.name())
        }
private class OfflineWire : RequestSender {
    val calls = CopyOnWriteArrayList<ApiCall>()
    @Volatile var browseOffline = false
    @Volatile var searchTimeout = false
    @Volatile var nextSearchTimeout = false
    @Volatile var listingOffline = false
    @Volatile var onSend: ((ApiCall) -> Unit)? = null

    override fun send(call: ApiCall): TransportReply {
        check(call.method == HttpMethod.GET && call.bodyUtf8() == null)
        check("Authorization" !in call.headers())
        calls.add(call)
        onSend?.invoke(call)
        val p = offlineParams(call)
        return when {
            call.resource.startsWith("/api/v1/catalog/search?") -> {
                val offset = requireNotNull(p["offset"]).toInt()
                if (searchTimeout || (offset > 0 && nextSearchTimeout)) {
                    throw SocketTimeoutException("private transport exception must not leak")
                }
                check((offset == 0) == (p["includeChoices"] == "1"))
                val q = requireNotNull(p["q"])
                val lang = requireNotNull(p["lang"])
                val limit = requireNotNull(p["limit"]).toInt()
                offlineOK(
                    if (offset == 0)
                        """{"language":"$lang","query":"$q","categories":[$OFFLINE_CARPENTER,$OFFLINE_PAINTER],"nextOffset":$limit}"""
                    else
                        """{"language":"$lang","query":"$q","categories":[$OFFLINE_ELECTRICIAN],"nextOffset":null}"""
                )
            }
            call.resource.startsWith("/api/v1/catalog?") -> {
                if (browseOffline) throw IOException("offline customer device")
                val lang = requireNotNull(p["lang"])
                offlineOK(
                    """{"language":"$lang","categories":[$OFFLINE_CARPENTER],"nextCursor":null}"""
                )
            }
            call.resource.startsWith("/api/v1/listings?") -> {
                if (listingOffline) throw IOException("offline customer device")
                val id = requireNotNull(p["categoryId"])
                offlineOK("""{"listings":[{"id":"$OFFLINE_LISTING_ID","categoryId":"$id"}]}""")
            }
            else -> error("Unexpected Customer request")
        }
    }
    fun count(path: String) = calls.count { it.resource.startsWith(path) }
}
private class DenyWorkerOffline : WorkerRepository {
    override fun myDraft(session: String) = error("No private worker GET allowed")
    override fun optIn(session: String) = error("No opt-in allowed")
    override fun myListings(session: String) = error("No private listing allowed")
    override fun publishExplicitCategory(session: String, confirmedCategoryId: String)
        : ApiOutcome<PublicListing> = error("No automatic worker posting")
    override fun unpublish(session: String, listingId: String)
        : ApiOutcome<Boolean> = error("No automatic unpublish")
}
private fun offlineScope(wire: OfflineWire, clock: AtomicLong = AtomicLong(0)) =
    HeadlessCatalogPaginationScope(
        RemoteCatalogRepository(wire),
        InMemorySessionCoordinator(DenyWorkerOffline(), RequestSender {
            error("No auth request allowed")
        }, { clock.get() }),
        { clock.get() }, 1_000L,
    )
private fun <T> threadOff(block: () -> T) =
    FutureTask<T> { block() }.also { Thread(it, "jodlo-offline-test").start() }
private fun <T> completedOff(f: FutureTask<T>): T = f.get(5, TimeUnit.SECONDS)
private fun arrivedOff(l: CountDownLatch) =
    check(l.await(5, TimeUnit.SECONDS)) { "Expected fake HTTP request did not begin" }

private fun browseOfflineNeedsExplicitRecoveryAndPreservesIntent() {
    val wire = OfflineWire()
    val clock = AtomicLong(100)
    val scope = offlineScope(wire, clock)
    check(scope.retryBrowse() == PageCompletion.BLOCKED)
    wire.browseOffline = true
    check(scope.startBrowse(Language.HI, availableOnly = true, pageSize = 5) ==
        PageCompletion.APPLIED)
    check(scope.snapshot().browse == PageState.Error(FailureKind.OFFLINE_OR_TIMEOUT))
    check(scope.snapshot().intent.browse == CustomerBrowseIntent(Language.HI,true,5))
    val before = wire.count("/api/v1/catalog?")
    repeat(3) {
        check(scope.snapshot().browse == PageState.Error(FailureKind.OFFLINE_OR_TIMEOUT))
        check(scope.nextBrowse() == PageCompletion.BLOCKED)
        check(scope.showBrowse() == PageCompletion.APPLIED)
    }
    check(wire.count("/api/v1/catalog?") == before)
    wire.browseOffline = false
    check(scope.retryBrowse() == PageCompletion.APPLIED)
    val ready = scope.snapshot().browse as PageState.Ready
    check(ready.categories.single().id == "carpenter" &&
        ready.language == Language.HI && ready.availableOnly && ready.pageSize == 5)
    check(wire.count("/api/v1/catalog?") == before+1)
    check(wire.calls.last().resource.contains("availableOnly=1"))
    check(wire.calls.last().resource.contains("limit=5"))
    check(scope.retryBrowse() == PageCompletion.BLOCKED)
    check(wire.count("/api/v1/catalog?") == before+1)
    clock.set(1_100)
    check(scope.snapshot().browse == PageState.RefreshRequired)
    check(scope.retryBrowse() == PageCompletion.APPLIED)
    check(scope.snapshot().browse is PageState.Ready)
    check(wire.count("/api/v1/catalog?") == before+2)
    scope.close()
}

private fun searchTimeoutThenExplicitRetrySameQueryFilterFirstPage() {
    val wire = OfflineWire()
    val scope = offlineScope(wire)
    wire.searchTimeout = true
    check(scope.retrySearch() == PageCompletion.BLOCKED)
    check(scope.startSearch("  बढ़ई  ", Language.HI, availableOnly = true, pageSize = 2) ==
        PageCompletion.APPLIED)
    check(scope.snapshot().search == PageState.Error(FailureKind.OFFLINE_OR_TIMEOUT))
    check(scope.snapshot().intent.search == CustomerSearchIntent("बढ़ई",Language.HI,true,2))
    check(scope.selectCategory(CustomerCategorySource.SEARCH, "carpenter") ==
        PageCompletion.BLOCKED)
    check(scope.nextSearch() == PageCompletion.BLOCKED)
    val before = wire.count("/api/v1/catalog/search?")
    check(scope.back() == PageCompletion.APPLIED)
    check(scope.showSearch() == PageCompletion.APPLIED)
    check(wire.count("/api/v1/catalog/search?") == before)
    wire.searchTimeout = false
    check(scope.retrySearch() == PageCompletion.APPLIED)
    val ready = scope.snapshot().search as PageState.Ready
    check(ready.query == "बढ़ई" && ready.availableOnly && ready.pageSize == 2)
    check(ready.categories.map { it.id } == listOf("carpenter","painter"))
    check(wire.calls.last().resource.contains("includeChoices=1"))
    check(wire.calls.last().resource.contains("availableOnly=1"))
    check(wire.calls.last().resource.contains("offset=0"))
    check(scope.retrySearch() == PageCompletion.BLOCKED)
    check(wire.count("/api/v1/catalog/search?") == before+1)
}

private fun secondPageTimeoutMustRestartFromFirstPageWithoutMergingOldRows() {
    val wire = OfflineWire()
    val scope = offlineScope(wire)
    check(scope.startSearch("carpenter", Language.EN, pageSize = 2) == PageCompletion.APPLIED)
    wire.nextSearchTimeout = true
    check(scope.nextSearch() == PageCompletion.APPLIED)
    check(scope.snapshot().search == PageState.Error(FailureKind.OFFLINE_OR_TIMEOUT))
    check(scope.nextSearch() == PageCompletion.BLOCKED)
    val afterFailure = wire.count("/api/v1/catalog/search?")
    wire.nextSearchTimeout = false
    check(scope.retrySearch() == PageCompletion.APPLIED)
    val fresh = scope.snapshot().search as PageState.Ready
    check(fresh.pageCount == 1 && fresh.categories.map { it.id } ==
        listOf("carpenter","painter") && fresh.nextOffset == 2)
    check(wire.count("/api/v1/catalog/search?") == afterFailure+1)
    check(wire.calls.last().resource.contains("offset=0"))
    check(scope.nextSearch() == PageCompletion.APPLIED)
    val all = scope.snapshot().search as PageState.Ready
    check(all.pageCount == 2 && all.categories.map { it.id } ==
        listOf("carpenter","painter","electrician"))
    check(wire.calls.last().resource.contains("offset=2"))
    check(!wire.calls.last().resource.contains("includeChoices=1"))
}

private fun listingsOfflineCannotAutoFetchOrRestoreAfterBack() {
    val wire = OfflineWire()
    val scope = offlineScope(wire)
    check(scope.startSearch("carpenter",Language.EN,pageSize=2) == PageCompletion.APPLIED)
    check(scope.selectCategory(CustomerCategorySource.SEARCH,"carpenter") ==
        PageCompletion.APPLIED)
    wire.listingOffline = true
    check(scope.loadSelectedListings() == PageCompletion.APPLIED)
    check(scope.snapshot().selection == CustomerSelectionState.Error(
        PublicCategory("carpenter","carpenter","बढ़ई"),
        CustomerCategorySource.SEARCH, FailureKind.OFFLINE_OR_TIMEOUT))
    val before = wire.count("/api/v1/listings?")
    check(scope.snapshot().selection is CustomerSelectionState.Error)
    check(scope.captureRevisitIntent()!!.destination == CustomerDestination.SEARCH)
    check(wire.count("/api/v1/listings?") == before)
    wire.listingOffline = false
    check(scope.loadSelectedListings() == PageCompletion.APPLIED)
    check(scope.snapshot().selection is CustomerSelectionState.Ready)
    check(wire.count("/api/v1/listings?") == before+1)
    check(scope.back() == PageCompletion.APPLIED)
    check(scope.snapshot().selection == CustomerSelectionState.Idle)
    check(scope.loadSelectedListings() == PageCompletion.BLOCKED)
    check(wire.count("/api/v1/listings?") == before+1)
}

private fun timeoutAfterResetOrCloseCannotResurrectOldReply() {
    val wire = OfflineWire()
    val scope = offlineScope(wire)
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    wire.searchTimeout = true
    wire.onSend = { call ->
        if(call.resource.startsWith("/api/v1/catalog/search?")) {
            started.countDown()
            check(release.await(5,TimeUnit.SECONDS))
        }
    }
    val pending = threadOff {
        scope.startSearch("carpenter",Language.EN,availableOnly = true,pageSize=2)
    }
    try {
        arrivedOff(started)
        check(scope.resetDiscovery())
        check(scope.snapshot().search == PageState.Idle)
        check(scope.captureRevisitIntent() == CustomerDiscoveryIntent())
    } finally { release.countDown() }
    check(completedOff(pending) == PageCompletion.DISCARDED)
    check(wire.count("/api/v1/catalog/search?") == 1)
    check(scope.retrySearch() == PageCompletion.BLOCKED)
    scope.close()
    check(scope.retrySearch() == PageCompletion.DISCARDED)
    check(scope.retryBrowse() == PageCompletion.DISCARDED)
    check(wire.count("/api/v1/catalog/search?") == 1)
}

private fun aNewQueryCannotBeOverwrittenBySlowFailedOldSearch() {
    val wire = OfflineWire()
    val scope = offlineScope(wire)
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    wire.onSend = { call ->
        if(call.resource.contains("q=carpenter")) {
            started.countDown()
            check(release.await(5,TimeUnit.SECONDS))
            throw SocketTimeoutException("lost old request")
        }
    }
    val pending = threadOff { scope.startSearch("carpenter",Language.EN,pageSize=2) }
    try {
        arrivedOff(started)
        check(scope.startSearch("electrician",Language.EN,pageSize=2) ==
            PageCompletion.APPLIED)
        check((scope.snapshot().search as PageState.Ready).query=="electrician")
    } finally { release.countDown() }
    check(completedOff(pending) == PageCompletion.DISCARDED)
    check(scope.snapshot().intent.search ==
        CustomerSearchIntent("electrician",Language.EN,false,2))
    check(scope.retrySearch() == PageCompletion.BLOCKED)
    check(wire.count("/api/v1/catalog/search?") == 2)
}

fun main() {
    browseOfflineNeedsExplicitRecoveryAndPreservesIntent()
    searchTimeoutThenExplicitRetrySameQueryFilterFirstPage()
    secondPageTimeoutMustRestartFromFirstPageWithoutMergingOldRows()
    listingsOfflineCannotAutoFetchOrRestoreAfterBack()
    timeoutAfterResetOrCloseCannotResurrectOldReply()
    aNewQueryCannotBeOverwrittenBySlowFailedOldSearch()
    println("JODLO offline recovery: explicit GET only, same intent, first-page restart, stale timeout and no replay OK")
}
