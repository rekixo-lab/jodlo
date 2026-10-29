package com.rekixo.jodlo.core.network

import java.io.IOException
import java.net.URLDecoder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

private val KEY_A = "a".repeat(43)
private val KEY_B = "b".repeat(43)
private fun listingId(n:Int) = "00000000-0000-4000-8000-" + n.toString().padStart(12,'0')
private fun tradeId(n:Int) = "trade-" + n.toString().padStart(4,'0')
private fun ownerRow(n:Int,visible:Boolean=true) =
    """{"id":"${listingId(n)}","categoryId":"${tradeId(n)}","visible":$visible}"""
private fun ok(data:String) = TransportReply(200,"""{"ok":true,"data":$data}""")
private fun denied() = TransportReply(401,
    """{"ok":false,"error":{"code":"UNAUTHORIZED","message":"do-not-copy"}}""")
private fun issued(token:String=KEY_A) = ok(
    """{"accessToken":"$token","tokenType":"Bearer","expiresInSeconds":3600}""")
private fun <T> running(call:()->T) =
    FutureTask<T> { call() }.also { Thread(it,"jodlo-owner-fake-network").start() }
private fun reached(latch:CountDownLatch) =
    check(latch.await(8,TimeUnit.SECONDS)) { "Test network did not start" }
private fun <T> finished(task:FutureTask<T>) = task.get(8,TimeUnit.SECONDS)
private fun session(sender:RequestSender,clock:AtomicLong=AtomicLong()):InMemorySessionCoordinator =
    InMemorySessionCoordinator(RemoteWorkerRepository(sender),sender,{clock.get()})

private fun testAll889PrivateOwnerPagesWithoutAutoReadOrTradeCap() {
    val count=AtomicInteger()
    val ids=(0 until 889).map(::listingId)
    val sender=RequestSender { call ->
        check(call.method==HttpMethod.GET && call.bodyUtf8()==null)
        check(call.resource.startsWith("/api/v1/me/listings?limit=25"))
        check(call.headers()["Authorization"]=="Bearer $KEY_A")
        check(!call.resource.contains(KEY_A) && !call.toString().contains(KEY_A))
        val raw=call.resource.substringAfter("&after=","")
        val after=if(raw.isEmpty()) null else URLDecoder.decode(raw,"UTF-8")
        val from=if(after==null)0 else ids.indexOf(after)+1
        check(from>=0 && (after==null||from>0))
        val rows=(from until minOf(from+25,889)).joinToString(",") {i->
            ownerRow(i, visible=i%2==0)
        }
        val end=minOf(from+25,889)
        val next=if(end<889) "\""+ids[end-1]+"\"" else "null"
        count.incrementAndGet()
        ok("""{"listings":[$rows],"nextCursor":$next}""")
    }
    val coordinator=session(sender)
    check(coordinator.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    val scope=HeadlessOwnerListingPaginationScope(coordinator)
    check(scope.snapshot().page==ReadState.Idle && count.get()==0)
    check(scope.next()==PageCompletion.BLOCKED && count.get()==0)
    val all=mutableListOf<OwnListing>()
    check(scope.start(25)==PageCompletion.APPLIED)
    var pageNumber=1
    while(true) {
        val snap=scope.snapshot()
        check(snap.login is LoginState.SignedIn && !snap.closed)
        val ready=(snap.page as ReadState.Ready).value
        check(ready.pageSize==25 && ready.pageNumber==pageNumber)
        check(ready.listings.size in 1..25)
        check(ready.listings.all { it.categoryId.startsWith("trade-") })
        all.addAll(ready.listings)
        if(ready.nextCursor==null)break
        val prior=count.get()
        check(scope.next()==PageCompletion.APPLIED)
        check(count.get()==prior+1) // Exactly one requested GET.
        pageNumber++
        check(pageNumber<=36)
    }
    check(pageNumber==36 && count.get()==36)
    check(all.size==889 && all.map{it.id}.distinct().size==889)
    check(all.first()==OwnListing(ids.first(),tradeId(0),true))
    check(all[1]==OwnListing(ids[1],tradeId(1),false))
    check(all.last()==OwnListing(ids.last(),tradeId(888),true))
    check(scope.next()==PageCompletion.BLOCKED && count.get()==36)
    check((scope.snapshot().page as ReadState.Ready).value.listings.size==14)
    check(!scope.snapshot().toString().contains(KEY_A))
    check(!scope.snapshot().toString().contains("accountId"))
    scope.close()
    check(scope.snapshot().closed && scope.snapshot().page==ReadState.Idle)
    check(scope.start(25)==PageCompletion.DISCARDED)
    check(count.get()==36)
}

private fun testSessionReplacementAndLogoutWipeRowsBeforeRecheck() {
    val calls=AtomicInteger()
    val sender=RequestSender {call ->
        when {
            call.resource.startsWith("/api/v1/me/listings?") -> {
                calls.incrementAndGet()
                val token=call.headers()["Authorization"]
                val row=if(token=="Bearer $KEY_A")ownerRow(0) else {
                    check(token=="Bearer $KEY_B")
                    ownerRow(10,false)
                }
                ok("""{"listings":[$row],"nextCursor":null}""")
            }
            call.resource=="/api/v1/auth/logout" -> ok("""{"revoked":true}""")
            else -> error("Unexpected fake route")
        }
    }
    val coordinator=session(sender)
    val scope=HeadlessOwnerListingPaginationScope(coordinator)
    check(coordinator.acceptIssuedSession(issued(KEY_A)) is ApiOutcome.Ok)
    check(scope.start(2)==PageCompletion.APPLIED)
    check((scope.snapshot().page as ReadState.Ready).value.listings.single().id==listingId(0))
    check(coordinator.acceptIssuedSession(issued(KEY_B)) is ApiOutcome.Ok)
    check(scope.snapshot().page==ReadState.RefreshRequired)
    check(scope.next()==PageCompletion.BLOCKED)
    check(scope.start(2)==PageCompletion.APPLIED)
    check((scope.snapshot().page as ReadState.Ready).value.listings.single().id==listingId(10))
    check(coordinator.logout()==SessionResult.Success(true))
    val snap=scope.snapshot()
    check(snap.login==LoginState.SignedOut && snap.page==ReadState.Idle)
    check(scope.start()==PageCompletion.DISCARDED)
    check(scope.snapshot().page==ReadState.Idle)
    check(calls.get()==2)
}

private fun testSlowOldAccountReplyIsDiscardedAndNoImplicitRetry() {
    val entered=CountDownLatch(1)
    val release=CountDownLatch(1)
    val reads=AtomicInteger()
    val sender=RequestSender {call ->
        if(call.resource.startsWith("/api/v1/me/listings?")) {
            reads.incrementAndGet()
            if(call.headers()["Authorization"]=="Bearer $KEY_A"){
                entered.countDown()
                check(release.await(8,TimeUnit.SECONDS))
            }
            ok("""{"listings":[${if(call.headers()["Authorization"]=="Bearer $KEY_A")
                ownerRow(0) else ownerRow(10)}],"nextCursor":null}""")
        } else error("Unexpected fake request")
    }
    val coordinator=session(sender)
    check(coordinator.acceptIssuedSession(issued(KEY_A)) is ApiOutcome.Ok)
    val scope=HeadlessOwnerListingPaginationScope(coordinator)
    val old=running {scope.start(1)}
    try {
        reached(entered)
        check(scope.snapshot().page==ReadState.Loading)
        check(coordinator.acceptIssuedSession(issued(KEY_B)) is ApiOutcome.Ok)
        check(scope.snapshot().page==ReadState.RefreshRequired)
        check(scope.start(1)==PageCompletion.APPLIED)
        check((scope.snapshot().page as ReadState.Ready).value.listings.single().id==listingId(10))
    }finally{release.countDown()}
    check(finished(old)==PageCompletion.DISCARDED)
    check((scope.snapshot().page as ReadState.Ready).value.listings.single().id==listingId(10))
    check(reads.get()==2)
}

private fun testWriteBarrierCancelsCachedPageAndSlowContinuation() {
    val entered=CountDownLatch(1)
    val release=CountDownLatch(1)
    val writes=AtomicInteger()
    val reads=AtomicInteger()
    val sender=RequestSender {call ->
        when {
            call.resource.startsWith("/api/v1/me/listings?") -> {
                reads.incrementAndGet()
                if(call.resource.contains("&after=")){
                    entered.countDown()
                    check(release.await(8,TimeUnit.SECONDS))
                }
                val idx=if(call.resource.contains("&after=")) 2 else 0
                val rows=(idx until idx+2).joinToString(",") {ownerRow(it)}
                val next=if(idx==0) "\""+listingId(1)+"\"" else "null"
                ok("""{"listings":[$rows],"nextCursor":$next}""")
            }
            call.resource=="/api/v1/me/worker-profile" && call.method==HttpMethod.POST -> {
                writes.incrementAndGet()
                ok("""{"profile":{"status":"draft"}}""")
            }
            else -> error("Unexpected fake route")
        }
    }
    val coordinator=session(sender)
    check(coordinator.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    val scope=HeadlessOwnerListingPaginationScope(coordinator)
    check(scope.start(2)==PageCompletion.APPLIED)
    check((scope.snapshot().page as ReadState.Ready).value.nextCursor==listingId(1))
    val slow=running {scope.next()}
    try {
        reached(entered)
        check(scope.snapshot().page==ReadState.Loading)
        check(coordinator.optIn()==SessionResult.Success(WorkerState.DRAFT))
        check(scope.snapshot().page==ReadState.RefreshRequired)
        check(scope.next()==PageCompletion.BLOCKED)
    }finally{release.countDown()}
    check(finished(slow)==PageCompletion.DISCARDED)
    check(scope.snapshot().page==ReadState.RefreshRequired)
    check(scope.start(2)==PageCompletion.APPLIED)
    check(reads.get()==3 && writes.get()==1)
}

private fun testWriteInFlightDefersPageWithoutNetwork() {
    val entered=CountDownLatch(1)
    val release=CountDownLatch(1)
    val calls=AtomicInteger()
    val sender=RequestSender {call ->
        when {
            call.resource=="/api/v1/me/worker-profile" -> {
                entered.countDown()
                check(release.await(8,TimeUnit.SECONDS))
                ok("""{"profile":{"status":"draft"}}""")
            }
            call.resource.startsWith("/api/v1/me/listings?") -> {
                calls.incrementAndGet()
                ok("""{"listings":[${ownerRow(0)}],"nextCursor":null}""")
            }
            else -> error("Unexpected fake route")
        }
    }
    val coordinator=session(sender)
    check(coordinator.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    val scope=HeadlessOwnerListingPaginationScope(coordinator)
    val write=running { coordinator.optIn() }
    try{
        reached(entered)
        check(scope.start(2)==PageCompletion.DEFERRED)
        check(calls.get()==0)
        check(scope.snapshot().page==ReadState.RefreshRequired)
    }finally{release.countDown()}
    check(finished(write)==SessionResult.Success(WorkerState.DRAFT))
    check(scope.start(2)==PageCompletion.APPLIED && calls.get()==1)
}

private fun test401ExpiryAndInvalidRepliesFailClosed() {
    val clock=AtomicLong()
    var bad=false
    var authorizationError=false
    val sender=RequestSender { call ->
        check(call.resource.startsWith("/api/v1/me/listings?"))
        when {
            authorizationError -> denied()
            bad -> ok("""{"listings":[${ownerRow(0)}],"nextCursor":"${listingId(99)}"}""")
            else -> ok("""{"listings":[${ownerRow(0)}],"nextCursor":null}""")
        }
    }
    val coordinator=session(sender,clock)
    check(coordinator.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    val scope=HeadlessOwnerListingPaginationScope(coordinator,{clock.get()},1_000)
    check(scope.start(1)==PageCompletion.APPLIED)
    check(scope.snapshot().page is ReadState.Ready)
    bad=true
    check(scope.start(1)==PageCompletion.APPLIED)
    check(scope.snapshot().page==ReadState.ApiError(FailureKind.BAD_RESPONSE))
    bad=false
    check(scope.start(1)==PageCompletion.APPLIED)
    clock.set(1_000)
    check(scope.snapshot().page==ReadState.RefreshRequired)
    check(scope.next()==PageCompletion.BLOCKED)
    clock.set(1_001)
    authorizationError=true
    check(scope.start(1)==PageCompletion.DISCARDED)
    check(coordinator.snapshot()==LoginState.SignedOut)
    check(scope.snapshot().page==ReadState.Idle)
    check(!scope.snapshot().toString().contains("do-not-copy"))
}

private fun testLatestFirstPageAndLifecycleCloseDiscardLateReplies() {
    val entered=CountDownLatch(1)
    val release=CountDownLatch(1)
    val count=AtomicInteger()
    val sender=RequestSender {call ->
        val n=count.incrementAndGet()
        check(call.resource.startsWith("/api/v1/me/listings?"))
        if(n==1){
            entered.countDown()
            check(release.await(8,TimeUnit.SECONDS))
        }
        ok("""{"listings":[${ownerRow(n)}],"nextCursor":null}""")
    }
    val coordinator=session(sender)
    check(coordinator.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    val scope=HeadlessOwnerListingPaginationScope(coordinator)
    val slow=running{scope.start(2)}
    try{
        reached(entered)
        check(scope.start(2)==PageCompletion.APPLIED)
        check((scope.snapshot().page as ReadState.Ready).value.listings.single().id==listingId(2))
    }finally{release.countDown()}
    check(finished(slow)==PageCompletion.DISCARDED)
    check((scope.snapshot().page as ReadState.Ready).value.listings.single().id==listingId(2))
    val previousCount=count.get()
    check(scope.requestRefresh())
    check(scope.snapshot().page==ReadState.RefreshRequired)
    scope.close()
    check(!scope.requestRefresh())
    check(scope.next()==PageCompletion.DISCARDED)
    check(scope.snapshot().page==ReadState.Idle)
    check(count.get()==previousCount)
}

private fun testInvalidInputAndMissingOptInRepository() {
    val count=AtomicInteger()
    val sender=RequestSender {
        count.incrementAndGet()
        ok("""{"listings":[${ownerRow(0)}],"nextCursor":null}""")
    }
    val coordinator=session(sender)
    check(coordinator.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    val scope=HeadlessOwnerListingPaginationScope(coordinator)
    check(scope.start(1)==PageCompletion.APPLIED)
    check(runCatching{scope.start(0)}.isFailure)
    check(runCatching{scope.start(26)}.isFailure)
    check((scope.snapshot().page as ReadState.Ready).value.listings.single().id==listingId(0))
    check(count.get()==1)
    // Fake legacy clients implementing only WorkerRepository must still compile
    // and have no accidental fallback to the old 100-row endpoint.
    val legacy=object:WorkerRepository {
        override fun myDraft(session:String)=ApiOutcome.Ok(WorkerDraft("draft"))
        override fun optIn(session:String)=ApiOutcome.Ok(WorkerDraft("draft"))
        override fun myListings(session:String)=ApiOutcome.Ok(emptyList<OwnListing>())
        override fun publishExplicitCategory(session:String,confirmedCategoryId:String)=
            ApiOutcome.Ok(PublicListing(listingId(0),tradeId(0)))
        override fun unpublish(session:String,listingId:String)=ApiOutcome.Ok(true)
    }
    val noPages=InMemorySessionCoordinator(legacy,sender,{0L})
    check(noPages.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    check(noPages.pageMyListings()==SessionResult.Failed(
        SessionFailure.REMOTE_FAILURE,FailureKind.SERVICE_UNAVAILABLE))
    check(count.get()==1)
}

fun main(){
    testAll889PrivateOwnerPagesWithoutAutoReadOrTradeCap()
    testSessionReplacementAndLogoutWipeRowsBeforeRecheck()
    testSlowOldAccountReplyIsDiscardedAndNoImplicitRetry()
    testWriteBarrierCancelsCachedPageAndSlowContinuation()
    testWriteInFlightDefersPageWithoutNetwork()
    test401ExpiryAndInvalidRepliesFailClosed()
    testLatestFirstPageAndLifecycleCloseDiscardLateReplies()
    testInvalidInputAndMissingOptInRepository()
    println("JODLO private owner pages: 889 synthetic trade reach, bounded memory, session/write/TTL isolation OK")
}
