package com.rekixo.jodlo.core.network

import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

private val DASH_TOKEN_A = "a".repeat(43)
private val DASH_TOKEN_B = "b".repeat(43)
private const val DASH_OWN_ID = "11111111-1111-4111-8111-111111111111"
private val DASH_OWN_ROW = OwnListing(DASH_OWN_ID,"plumber",true)
private fun dashIssued(token: String = DASH_TOKEN_A) = TransportReply(200,
    """{"ok":true,"data":{"accessToken":"$token","tokenType":"Bearer","expiresInSeconds":3600}}""")
private fun <T> dashAsync(block: () -> T) =
    FutureTask<T> { block() }.also { Thread(it,"jodlo-dashboard-fake").start() }
private fun <T> dashDone(task: FutureTask<T>):T = task.get(5,TimeUnit.SECONDS)
private fun dashReached(latch: CountDownLatch) =
    check(latch.await(5,TimeUnit.SECONDS)) { "Expected fake Worker adapter was not called" }

private class DashboardWorker : WorkerRepository {
    val ownCalls=AtomicInteger()
    val publishCalls=AtomicInteger()
    val unpublishCalls=AtomicInteger()
    val profileCalls=AtomicInteger()
    var draft: ApiOutcome<WorkerDraft> = ApiOutcome.Ok(WorkerDraft("draft"))
    var rows: ApiOutcome<List<OwnListing>> = ApiOutcome.Ok(listOf(DASH_OWN_ROW))
    var publish: ApiOutcome<PublicListing> =
        ApiOutcome.Ok(PublicListing(DASH_OWN_ID,"plumber"))
    var beforeOwn: (() -> Unit)? = null
    var beforePublish: (() -> Unit)? = null
    override fun myDraft(session: String): ApiOutcome<WorkerDraft> {
        profileCalls.incrementAndGet()
        return draft
    }
    override fun optIn(session: String) = ApiOutcome.Ok(WorkerDraft("draft"))
    override fun myListings(session: String): ApiOutcome<List<OwnListing>> {
        ownCalls.incrementAndGet()
        beforeOwn?.invoke()
        return rows
    }
    override fun publishExplicitCategory(session: String,confirmedCategoryId:String):
        ApiOutcome<PublicListing> {
        check(confirmedCategoryId=="plumber")
        publishCalls.incrementAndGet()
        beforePublish?.invoke()
        return publish
    }
    override fun unpublish(session:String,listingId:String):ApiOutcome<Boolean> {
        unpublishCalls.incrementAndGet()
        return ApiOutcome.Ok(true)
    }
}
private class DashboardCatalog: CatalogRepository {
    override fun browse(language:Language,availableOnly:Boolean,limit:Int,after:String?) =
        error("Worker Dashboard must not request public Browse")
    override fun search(query:String,language:Language,availableOnly:Boolean,
                        includeChoices:Boolean,limit:Int,offset:Int):ApiOutcome<CatalogSearch> =
        error("Worker Dashboard must not Search public Catalog")
    override fun listings(categoryId:String):ApiOutcome<List<PublicListing>> =
        error("Worker Dashboard must not fetch Customer Listings")
}
private class DashboardHarness(
    val worker: DashboardWorker = DashboardWorker(),
    val clock: AtomicLong = AtomicLong(),
) {
    val session = InMemorySessionCoordinator(worker,RequestSender {
        TransportReply(503,
            """{"ok":false,"error":{"code":"SERVICE_UNAVAILABLE","message":"private diagnostic"}}""")
    },{clock.get()})
    val reads = HeadlessMarketplaceReadScope(DashboardCatalog(),session,
        {clock.get()},1_000L)
    val writes = HeadlessWorkerWriteScope(session)
    val dashboard = HeadlessWorkerDashboardPresentation(session,reads,writes)
    fun signIn(token: String = DASH_TOKEN_A) {
        check(session.acceptIssuedSession(dashIssued(token)) is ApiOutcome.Ok)
    }
    fun optIn() {
        check(session.optIn()==SessionResult.Success(WorkerState.DRAFT))
    }
}

private fun signedOutAndUnknownNeverPublish() {
    val h=DashboardHarness()
    check(h.dashboard.snapshot()==WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT))
    h.signIn()
    val unknown=h.dashboard.snapshot()
    check(unknown.profile==WorkerProfilePhase.UNKNOWN)
    check(unknown.owned==WorkerListingsPhase.HIDDEN)
    check(unknown.actions==setOf(WorkerDashboardAction.CHECK_PROFILE))
    check(unknown.mutation==WorkerMutationPhase.IDLE)
    check(h.worker.profileCalls.get()==0 && h.worker.publishCalls.get()==0)
    h.worker.draft=ApiOutcome.Failed(FailureKind.NOT_FOUND,false)
    check(h.reads.checkWorker()==ReadCompletion.APPLIED)
    val noDraft=h.dashboard.snapshot()
    check(noDraft.profile==WorkerProfilePhase.NO_DRAFT)
    check(noDraft.owned==WorkerListingsPhase.HIDDEN)
    check(noDraft.actions==setOf(WorkerDashboardAction.CHECK_PROFILE))
    check(h.worker.publishCalls.get()==0 && h.worker.unpublishCalls.get()==0)
}

private fun optedInWorkerShowsOnlyAuthenticatedOwnedRowsAndReadHints() {
    val h=DashboardHarness()
    h.signIn()
    h.optIn()
    val first=h.dashboard.snapshot()
    check(first.profile==WorkerProfilePhase.DRAFT)
    check(first.owned==WorkerListingsPhase.IDLE)
    check(first.actions==setOf(WorkerDashboardAction.CHECK_PROFILE,
        WorkerDashboardAction.LOAD_OWN_LISTINGS))
    check(first.ownedListings.isEmpty())
    check(h.worker.ownCalls.get()==0)
    val entered=CountDownLatch(1)
    val release=CountDownLatch(1)
    h.worker.beforeOwn={
        entered.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val pending=dashAsync {h.reads.ownListings()}
    try {
        dashReached(entered)
        val loading=h.dashboard.snapshot()
        check(loading.profile==WorkerProfilePhase.DRAFT)
        check(loading.owned==WorkerListingsPhase.LOADING)
        check(WorkerDashboardAction.LOAD_OWN_LISTINGS !in loading.actions)
        check(loading.ownedListings.isEmpty())
        check(h.worker.publishCalls.get()==0)
    }finally {release.countDown()}
    check(dashDone(pending)==ReadCompletion.APPLIED)
    val ready=h.dashboard.snapshot()
    check(ready.profile==WorkerProfilePhase.DRAFT)
    check(ready.owned==WorkerListingsPhase.LISTINGS)
    check(ready.ownedListings==listOf(DASH_OWN_ROW))
    check(ready.mutation==WorkerMutationPhase.IDLE)
    check(ready.toString().contains(DASH_OWN_ID))
    check(!ready.toString().contains(DASH_TOKEN_A))
    check("search" !in WorkerDashboardState::class.java.declaredFields.map{it.name})
    check("customerListings" !in WorkerDashboardState::class.java.declaredFields.map{it.name})
    repeat(5){check(h.dashboard.snapshot()==ready)}
    check(h.worker.ownCalls.get()==1 && h.worker.publishCalls.get()==0)
}

private fun readErrorAndEmptyAreDistinctAndNeverAutoRetry() {
    val h=DashboardHarness()
    h.signIn()
    h.optIn()
    h.worker.rows=ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT,false)
    check(h.reads.ownListings()==ReadCompletion.APPLIED)
    val failed=h.dashboard.snapshot()
    check(failed.owned==WorkerListingsPhase.ERROR)
    check(failed.ownerFailure==FailureKind.OFFLINE_OR_TIMEOUT)
    check(failed.actions.contains(WorkerDashboardAction.LOAD_OWN_LISTINGS))
    check(failed.ownedListings.isEmpty())
    repeat(4){check(h.dashboard.snapshot()==failed)}
    check(h.worker.ownCalls.get()==1)
    h.worker.rows=ApiOutcome.Ok(emptyList())
    check(h.reads.ownListings()==ReadCompletion.APPLIED)
    val empty=h.dashboard.snapshot()
    check(empty.owned==WorkerListingsPhase.EMPTY)
    check(empty.ownerFailure==null && empty.ownedListings.isEmpty())
    check(h.worker.ownCalls.get()==2)
    h.worker.draft=ApiOutcome.Failed(FailureKind.SERVICE_UNAVAILABLE,false)
    check(h.reads.checkWorker()==ReadCompletion.APPLIED)
    val profileFailure=h.dashboard.snapshot()
    check(profileFailure.profile==WorkerProfilePhase.ERROR)
    check(profileFailure.profileFailure==FailureKind.SERVICE_UNAVAILABLE)
    check(profileFailure.owned==WorkerListingsPhase.HIDDEN)
}

private fun uncertainPublishIsNeverPromotedByVisibilityObservation() {
    val h=DashboardHarness()
    h.signIn()
    h.optIn()
    check(h.reads.ownListings()==ReadCompletion.APPLIED)
    h.worker.publish=ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT,false)
    check(h.writes.publishExplicitCategory("plumber")==WorkerWriteCompletion.APPLIED)
    val uncertain=h.dashboard.snapshot()
    check(uncertain.profile==WorkerProfilePhase.DRAFT)
    check(uncertain.mutation==WorkerMutationPhase.NEEDS_REVIEW)
    check(uncertain.mutationKind==WorkerMutationKind.PUBLISH)
    check(uncertain.mutationFailure==FailureKind.OFFLINE_OR_TIMEOUT)
    check(uncertain.owned==WorkerListingsPhase.HIDDEN)
    check(uncertain.ownedListings.isEmpty())
    check(uncertain.actions==setOf(
        WorkerDashboardAction.RECHECK_UNCERTAIN_WRITE,
        WorkerDashboardAction.ACKNOWLEDGE_UNCERTAINTY))
    check(h.worker.publishCalls.get()==1 && h.worker.ownCalls.get()==1)
    check(h.writes.publishExplicitCategory("plumber")==WorkerWriteCompletion.BLOCKED)
    check(h.writes.recheckOwnListings()==WorkerWriteCompletion.APPLIED)
    val observed=h.dashboard.snapshot()
    check(observed.mutation==WorkerMutationPhase.NEEDS_REVIEW)
    check(observed.observedVisibility==WorkerVisibility.VISIBLE)
    check(observed.actions==uncertain.actions)
    check(observed.ownedListings.isEmpty())
    check(h.worker.publishCalls.get()==1)
    repeat(3){check(h.dashboard.snapshot()==observed)}
    check(h.writes.acknowledgeUncertainty())
    check(h.dashboard.snapshot().mutation==WorkerMutationPhase.IDLE)
    check(h.worker.publishCalls.get()==1)
    // Another publish requires a NEW explicit selection and call.
    h.worker.publish=ApiOutcome.Ok(PublicListing(DASH_OWN_ID,"plumber"))
    check(h.writes.publishExplicitCategory("plumber")==WorkerWriteCompletion.APPLIED)
    val confirmed=h.dashboard.snapshot()
    check(confirmed.mutation==WorkerMutationPhase.CONFIRMED)
    check(confirmed.mutationKind==WorkerMutationKind.PUBLISH)
    check(confirmed.observedVisibility==null)
    check(h.worker.publishCalls.get()==2)
}

private fun sendingAndRecheckingHideOldRowsAndNoAutomaticWrites() {
    val h=DashboardHarness()
    h.signIn()
    h.optIn()
    check(h.reads.ownListings()==ReadCompletion.APPLIED)
    h.worker.publish=ApiOutcome.Failed(FailureKind.SERVICE_UNAVAILABLE,false)
    val started=CountDownLatch(1)
    val release=CountDownLatch(1)
    h.worker.beforePublish={
        started.countDown()
        check(release.await(5,TimeUnit.SECONDS))
    }
    val pending=dashAsync {h.writes.publishExplicitCategory("plumber")}
    try {
        dashReached(started)
        val sending=h.dashboard.snapshot()
        check(sending.mutation==WorkerMutationPhase.SENDING)
        check(sending.mutationKind==WorkerMutationKind.PUBLISH)
        check(sending.owned==WorkerListingsPhase.HIDDEN)
        check(sending.actions.isEmpty())
        check(sending.ownedListings.isEmpty())
        check(h.worker.publishCalls.get()==1)
    }finally {release.countDown()}
    check(dashDone(pending)==WorkerWriteCompletion.APPLIED)
    check(h.dashboard.snapshot().mutation==WorkerMutationPhase.NEEDS_REVIEW)
    val checkStarted=CountDownLatch(1)
    val checkRelease=CountDownLatch(1)
    h.worker.beforeOwn={
        checkStarted.countDown()
        check(checkRelease.await(5,TimeUnit.SECONDS))
    }
    val checking=dashAsync {h.writes.recheckOwnListings()}
    try {
        dashReached(checkStarted)
        val current=h.dashboard.snapshot()
        check(current.mutation==WorkerMutationPhase.RECHECKING)
        check(current.owned==WorkerListingsPhase.HIDDEN)
        check(current.actions.isEmpty())
        check(current.observedVisibility==null)
    }finally {checkRelease.countDown()}
    check(dashDone(checking)==WorkerWriteCompletion.APPLIED)
    check(h.dashboard.snapshot().mutation==WorkerMutationPhase.NEEDS_REVIEW)
    check(h.worker.publishCalls.get()==1)
}

private fun rejectedWriteNeverPretendsToBeConfirmed() {
    val h=DashboardHarness()
    h.signIn()
    h.optIn()
    h.worker.publish=ApiOutcome.Failed(FailureKind.FORBIDDEN,false)
    check(h.writes.publishExplicitCategory("plumber")==WorkerWriteCompletion.APPLIED)
    val rejected=h.dashboard.snapshot()
    check(rejected.mutation==WorkerMutationPhase.REJECTED)
    check(rejected.mutationKind==WorkerMutationKind.PUBLISH)
    check(rejected.mutationSessionFailure==SessionFailure.REMOTE_FAILURE)
    check(rejected.mutationFailure==FailureKind.FORBIDDEN)
    check(rejected.observedVisibility==null)
    check(WorkerDashboardAction.RECHECK_UNCERTAIN_WRITE !in rejected.actions)
    check(WorkerDashboardAction.ACKNOWLEDGE_UNCERTAINTY !in rejected.actions)
    check(h.worker.publishCalls.get()==1)
}

private fun logoutAccountReplacementExpiryAndCloseNeverExposeOldRows() {
    val h=DashboardHarness()
    h.signIn()
    h.optIn()
    check(h.reads.ownListings()==ReadCompletion.APPLIED)
    check(h.dashboard.snapshot().ownedListings==listOf(DASH_OWN_ROW))
    check(h.session.logout() is SessionResult.Failed) // local-first, remote uncertain
    check(h.dashboard.snapshot()==WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT))
    h.signIn(DASH_TOKEN_B)
    val replacement=h.dashboard.snapshot()
    check(replacement.profile==WorkerProfilePhase.UNKNOWN)
    check(replacement.owned==WorkerListingsPhase.HIDDEN)
    check(replacement.mutation==WorkerMutationPhase.IDLE)
    check(replacement.ownedListings.isEmpty())
    check(!replacement.toString().contains(DASH_OWN_ID))
    h.optIn()
    check(h.dashboard.snapshot().profile==WorkerProfilePhase.DRAFT)
    check(h.dashboard.snapshot().owned==WorkerListingsPhase.IDLE)
    h.clock.set(3_600_000L)
    check(h.dashboard.snapshot()==WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT))
    h.reads.close()
    check(h.dashboard.snapshot()==WorkerDashboardState(WorkerProfilePhase.CLOSED))
}

private fun forgedActorSnapshotsFailClosedWithoutTrustingUnconfirmedWrites() {
    val ready=WorkerMarketplaceSnapshot(false,
        LoginState.SignedIn(WorkerState.DRAFT),
        ReadState.Ready(WorkerState.DRAFT),
        ReadState.Ready(listOf(DASH_OWN_ROW)))
    val unresolved=WorkerWriteSnapshot(false, WorkerWriteState.NeedsReview(
        WorkerWriteAction.Publish("plumber"),SessionFailure.REMOTE_FAILURE,
        FailureKind.OFFLINE_OR_TIMEOUT,WorkerVisibility.VISIBLE))
    val untrusted=HeadlessWorkerDashboardMapper.project(ready,unresolved)
    check(untrusted.mutation==WorkerMutationPhase.NEEDS_REVIEW)
    check(untrusted.ownedListings.isEmpty())
    check(untrusted.owned==WorkerListingsPhase.HIDDEN)
    check(untrusted.observedVisibility==WorkerVisibility.VISIBLE)
    val mismatch=ready.copy(worker=ReadState.Ready(WorkerState.NO_DRAFT))
    val hidden=HeadlessWorkerDashboardMapper.project(mismatch,
        WorkerWriteSnapshot(false,WorkerWriteState.Idle))
    check(hidden.profile==WorkerProfilePhase.REFRESH_REQUIRED)
    check(hidden.ownedListings.isEmpty())
    val signedOut=ready.copy(login=LoginState.SignedOut)
    check(HeadlessWorkerDashboardMapper.project(signedOut,unresolved)==
        WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT))
    check(HeadlessWorkerDashboardMapper.project(ready,unresolved.copy(closed=true))==
        WorkerDashboardState(WorkerProfilePhase.CLOSED))
}


/** Exercises the real HTTPS-wire DTO parser through the fake sender and
 * private scope, NOT a fabricated success snapshot or any Android UI.
 */
private fun optInPagedDashboardShowsExplicitActionsAndCurrentPageOnly() {
    val requested=AtomicInteger()
    val profileRequests=AtomicInteger()
    val legacyRequests=AtomicInteger()
    val secondId="22222222-2222-4222-8222-222222222222"
    val thirdId="33333333-3333-4333-8333-333333333333"
    val sender=RequestSender { call ->
        when {
            call.resource=="/api/v1/me/worker-profile" && call.method==HttpMethod.POST -> {
                profileRequests.incrementAndGet()
                TransportReply(200,"""{"ok":true,"data":{"profile":{"status":"draft"}}}""")
            }
            call.resource=="/api/v1/me/listings" -> {
                legacyRequests.incrementAndGet()
                TransportReply(200,"""{"ok":true,"data":{"listings":[{"id":"$thirdId","categoryId":"old","visible":true}]}}""")
            }
            call.resource.startsWith("/api/v1/me/listings?limit=2") -> {
                check(call.method==HttpMethod.GET && call.bodyUtf8()==null)
                check(call.headers()["Authorization"]=="Bearer $DASH_TOKEN_A")
                check(!call.resource.contains(DASH_TOKEN_A))
                requested.incrementAndGet()
                val data=if(!call.resource.contains("&after=")) {
                    """{"listings":[{"id":"$DASH_OWN_ID","categoryId":"plumber","visible":true},{"id":"$secondId","categoryId":"carpenter","visible":false}],"nextCursor":"$secondId"}"""
                } else {
                    check(call.resource.endsWith("&after=$secondId"))
                    """{"listings":[{"id":"$thirdId","categoryId":"electrician","visible":false}],"nextCursor":null}"""
                }
                TransportReply(200,"""{"ok":true,"data":$data}""")
            }
            else -> error("Unexpected dashboard GET or write")
        }
    }
    val worker=RemoteWorkerRepository(sender)
    val session=InMemorySessionCoordinator(worker,sender,{0L})
    val reads=HeadlessMarketplaceReadScope(DashboardCatalog(),session)
    val writes=HeadlessWorkerWriteScope(session)
    val pages=HeadlessOwnerListingPaginationScope(session,{0L})
    val dashboard=HeadlessWorkerDashboardPresentation(session,reads,writes,pages)

    check(dashboard.snapshot()==WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT))
    check(session.acceptIssuedSession(dashIssued()) is ApiOutcome.Ok)
    check(session.optIn()==SessionResult.Success(WorkerState.DRAFT))
    val initial=dashboard.snapshot()
    check(initial.profile==WorkerProfilePhase.DRAFT)
    check(initial.owned==WorkerListingsPhase.IDLE)
    check(initial.ownedListings.isEmpty() && initial.ownerPageNumber==null)
    check(initial.actions==setOf(
        WorkerDashboardAction.CHECK_PROFILE,WorkerDashboardAction.START_OWNER_PAGE))
    check(requested.get()==0 && legacyRequests.get()==0 && profileRequests.get()==1)

    // An unrelated old read must never be mixed into paged dashboard DTOs.
    check(reads.ownListings()==ReadCompletion.APPLIED)
    check(reads.workerSnapshot().ownListings is ReadState.Ready)
    check(dashboard.snapshot()==initial)
    check(legacyRequests.get()==1 && requested.get()==0)
    check(pages.next()==PageCompletion.BLOCKED)
    check(pages.start(2)==PageCompletion.APPLIED)
    val first=dashboard.snapshot()
    check(first.owned==WorkerListingsPhase.LISTINGS)
    check(first.ownedListings==listOf(
        OwnListing(DASH_OWN_ID,"plumber",true),
        OwnListing(secondId,"carpenter",false)))
    check(first.ownerPageNumber==1 && first.ownerPageSize==2 && first.ownerHasNextPage)
    check(WorkerDashboardAction.LOAD_NEXT_OWNER_PAGE in first.actions)
    check(WorkerDashboardAction.START_OWNER_PAGE in first.actions)
    check(WorkerDashboardAction.LOAD_OWN_LISTINGS !in first.actions)
    repeat(4){check(dashboard.snapshot()==first)}
    check(requested.get()==1)

    check(pages.next()==PageCompletion.APPLIED)
    val second=dashboard.snapshot()
    check(second.owned==WorkerListingsPhase.LISTINGS)
    check(second.ownedListings==listOf(OwnListing(thirdId,"electrician",false)))
    check(second.ownerPageNumber==2 && second.ownerPageSize==2 && !second.ownerHasNextPage)
    check(WorkerDashboardAction.LOAD_NEXT_OWNER_PAGE !in second.actions)
    check(pages.next()==PageCompletion.BLOCKED)
    check(requested.get()==2)

    check(pages.requestRefresh())
    val refresh=dashboard.snapshot()
    check(refresh.owned==WorkerListingsPhase.REFRESH_REQUIRED)
    check(refresh.ownedListings.isEmpty())
    check(refresh.ownerPageNumber==null && !refresh.ownerHasNextPage)
    check(refresh.actions==setOf(
        WorkerDashboardAction.CHECK_PROFILE,WorkerDashboardAction.REFRESH_OWNER_PAGE))
    check(requested.get()==2) // hint is not an implicit GET
    check(pages.start(2)==PageCompletion.APPLIED)
    check(dashboard.snapshot().ownerPageNumber==1)
    pages.close()
    check(dashboard.snapshot()==WorkerDashboardState(WorkerProfilePhase.CLOSED))
    check(requested.get()==3 && profileRequests.get()==1)
}

private fun optInPagedDashboardHidesUncertainMutationsAndSessionChanges() {
    val count=AtomicInteger()
    val sender=RequestSender { call ->
        when {
            call.resource=="/api/v1/me/worker-profile" && call.method==HttpMethod.POST ->
                TransportReply(200,"""{"ok":true,"data":{"profile":{"status":"draft"}}}""")
            call.resource.startsWith("/api/v1/me/listings?") -> {
                count.incrementAndGet()
                val id=if(call.headers()["Authorization"]=="Bearer $DASH_TOKEN_A")
                    DASH_OWN_ID else "44444444-4444-4444-8444-444444444444"
                TransportReply(200,
                    """{"ok":true,"data":{"listings":[{"id":"$id","categoryId":"plumber","visible":true}],"nextCursor":null}}""")
            }
            call.method==HttpMethod.POST && call.resource=="/api/v1/me/listings" ->
                TransportReply(503,
                    """{"ok":false,"error":{"code":"SERVICE_UNAVAILABLE","message":"do-not-leak"}}""")
            else -> error("Unexpected dashboard action")
        }
    }
    val session=InMemorySessionCoordinator(RemoteWorkerRepository(sender),sender,{0L})
    val reads=HeadlessMarketplaceReadScope(DashboardCatalog(),session)
    val writes=HeadlessWorkerWriteScope(session)
    val pages=HeadlessOwnerListingPaginationScope(session,{0L})
    val dashboard=HeadlessWorkerDashboardPresentation(session,reads,writes,pages)

    check(session.acceptIssuedSession(dashIssued()) is ApiOutcome.Ok)
    check(session.optIn()==SessionResult.Success(WorkerState.DRAFT))
    check(pages.start(2)==PageCompletion.APPLIED)
    check(dashboard.snapshot().ownedListings.single().id==DASH_OWN_ID)
    check(writes.publishExplicitCategory("plumber")==WorkerWriteCompletion.APPLIED)
    val uncertain=dashboard.snapshot()
    check(uncertain.mutation==WorkerMutationPhase.NEEDS_REVIEW)
    check(uncertain.owned==WorkerListingsPhase.HIDDEN)
    check(uncertain.ownedListings.isEmpty())
    check(uncertain.ownerPageNumber==null && !uncertain.ownerHasNextPage)
    check(uncertain.actions==setOf(
        WorkerDashboardAction.RECHECK_UNCERTAIN_WRITE,
        WorkerDashboardAction.ACKNOWLEDGE_UNCERTAINTY))
    check(!uncertain.toString().contains("do-not-leak"))
    check(writes.acknowledgeUncertainty())
    check(dashboard.snapshot().owned==WorkerListingsPhase.REFRESH_REQUIRED)
    check(count.get()==1)
    check(pages.start(2)==PageCompletion.APPLIED)
    check(dashboard.snapshot().ownedListings.single().id==DASH_OWN_ID)
    check(session.acceptIssuedSession(dashIssued(DASH_TOKEN_B)) is ApiOutcome.Ok)
    val switched=dashboard.snapshot()
    check(switched.profile==WorkerProfilePhase.UNKNOWN)
    check(switched.owned==WorkerListingsPhase.HIDDEN && switched.ownedListings.isEmpty())
    check(switched.ownerPageNumber==null && !switched.ownerHasNextPage)
    check(!switched.toString().contains(DASH_OWN_ID))
    check(session.optIn()==SessionResult.Success(WorkerState.DRAFT))
    check(dashboard.snapshot().owned==WorkerListingsPhase.REFRESH_REQUIRED)
    check(pages.start(2)==PageCompletion.APPLIED)
    check(dashboard.snapshot().ownedListings.single().id==
        "44444444-4444-4444-8444-444444444444")
    check(session.logout() is SessionResult.Failed)
    check(dashboard.snapshot()==WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT))
    check(count.get()==3)
}

private fun optInPagedDashboardLoadingAndErrorsAreReadOnlyAndFailClosed() {
    val entered=CountDownLatch(1)
    val release=CountDownLatch(1)
    val calls=AtomicInteger()
    var bad=false
    val sender=RequestSender {call ->
        when {
            call.resource=="/api/v1/me/worker-profile" && call.method==HttpMethod.POST ->
                TransportReply(200,"""{"ok":true,"data":{"profile":{"status":"draft"}}}""")
            call.resource.startsWith("/api/v1/me/listings?") -> {
                calls.incrementAndGet()
                if(!bad) {
                    entered.countDown()
                    check(release.await(5,TimeUnit.SECONDS))
                }
                if(bad)
                    TransportReply(200,
                        """{"ok":true,"data":{"listings":[{"id":"$DASH_OWN_ID","categoryId":"plumber","visible":true,"phone":"private"}],"nextCursor":null}}""")
                else TransportReply(200,
                    """{"ok":true,"data":{"listings":[{"id":"$DASH_OWN_ID","categoryId":"plumber","visible":true}],"nextCursor":null}}""")
            }
            else -> error("Unexpected dashboard call")
        }
    }
    val session=InMemorySessionCoordinator(RemoteWorkerRepository(sender),sender,{0L})
    val reads=HeadlessMarketplaceReadScope(DashboardCatalog(),session)
    val writes=HeadlessWorkerWriteScope(session)
    val pages=HeadlessOwnerListingPaginationScope(session,{0L})
    val dashboard=HeadlessWorkerDashboardPresentation(session,reads,writes,pages)
    check(session.acceptIssuedSession(dashIssued()) is ApiOutcome.Ok)
    check(session.optIn()==SessionResult.Success(WorkerState.DRAFT))
    val pending=dashAsync{ pages.start(2) }
    try {
        dashReached(entered)
        val loading=dashboard.snapshot()
        check(loading.owned==WorkerListingsPhase.LOADING)
        check(loading.ownedListings.isEmpty())
        check(WorkerDashboardAction.START_OWNER_PAGE !in loading.actions)
        check(WorkerDashboardAction.LOAD_NEXT_OWNER_PAGE !in loading.actions)
        check(calls.get()==1)
    }finally {release.countDown()}
    check(dashDone(pending)==PageCompletion.APPLIED)
    check(dashboard.snapshot().owned==WorkerListingsPhase.LISTINGS)
    bad=true
    check(pages.start(2)==PageCompletion.APPLIED)
    val error=dashboard.snapshot()
    check(error.owned==WorkerListingsPhase.ERROR)
    check(error.ownerFailure==FailureKind.BAD_RESPONSE)
    check(error.ownerSessionFailure==SessionFailure.REMOTE_FAILURE)
    check(error.ownedListings.isEmpty() && error.ownerPageNumber==null)
    check(error.actions==setOf(WorkerDashboardAction.CHECK_PROFILE,
        WorkerDashboardAction.REFRESH_OWNER_PAGE))
    repeat(3) {check(dashboard.snapshot()==error)}
    check(calls.get()==2)
    check(!error.toString().contains("private"))
}

private fun optInPagedMapperRejectsMixedOrSignedOutSnapshots() {
    val read=WorkerMarketplaceSnapshot(false,
        LoginState.SignedIn(WorkerState.DRAFT),
        ReadState.Ready(WorkerState.DRAFT),
        ReadState.Ready(listOf(DASH_OWN_ROW)))
    val write=WorkerWriteSnapshot(false,WorkerWriteState.Idle)
    val page=OwnerListingPageSnapshot(false,
        LoginState.SignedIn(WorkerState.DRAFT),
        ReadState.Ready(OwnerListingPageView(
            listOf(OwnListing("55555555-5555-4555-8555-555555555555","carpenter",false)),
            null,2,1)))
    val projection=HeadlessWorkerDashboardMapper.project(read,write,page)
    check(projection.ownedListings==listOf(
        OwnListing("55555555-5555-4555-8555-555555555555","carpenter",false)))
    check(projection.ownerPageNumber==1 && !projection.ownerHasNextPage)
    check(HeadlessWorkerDashboardMapper.project(read,write,page.copy(
        login=LoginState.SignedOut))==
        WorkerDashboardState(WorkerProfilePhase.SIGNED_OUT))
    check(HeadlessWorkerDashboardMapper.project(read,write,page.copy(
        login=LoginState.SignedIn(WorkerState.NO_DRAFT)))==
        WorkerDashboardState(WorkerProfilePhase.REFRESH_REQUIRED))
    check(HeadlessWorkerDashboardMapper.project(read,write,page.copy(closed=true))==
        WorkerDashboardState(WorkerProfilePhase.CLOSED))
    // The legacy 100-row projection remains the exact original DTO and actions.
    val legacy=HeadlessWorkerDashboardMapper.project(read,write)
    check(legacy.ownedListings==listOf(DASH_OWN_ROW))
    check(legacy.ownerPageNumber==null && !legacy.ownerHasNextPage)
    check(legacy.actions.contains(WorkerDashboardAction.LOAD_OWN_LISTINGS))
    check(legacy.actions.none{it==WorkerDashboardAction.START_OWNER_PAGE ||
        it==WorkerDashboardAction.LOAD_NEXT_OWNER_PAGE})
}

fun main() {
    signedOutAndUnknownNeverPublish()
    optedInWorkerShowsOnlyAuthenticatedOwnedRowsAndReadHints()
    readErrorAndEmptyAreDistinctAndNeverAutoRetry()
    uncertainPublishIsNeverPromotedByVisibilityObservation()
    sendingAndRecheckingHideOldRowsAndNoAutomaticWrites()
    rejectedWriteNeverPretendsToBeConfirmed()
    logoutAccountReplacementExpiryAndCloseNeverExposeOldRows()
    forgedActorSnapshotsFailClosedWithoutTrustingUnconfirmedWrites()
    optInPagedDashboardShowsExplicitActionsAndCurrentPageOnly()
    optInPagedDashboardHidesUncertainMutationsAndSessionChanges()
    optInPagedDashboardLoadingAndErrorsAreReadOnlyAndFailClosed()
    optInPagedMapperRejectsMixedOrSignedOutSnapshots()
    println("JODLO worker dashboard: private profile/own-listing states, uncertain writes, account epoch and no auto mutation OK")
}
