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

fun main() {
    signedOutAndUnknownNeverPublish()
    optedInWorkerShowsOnlyAuthenticatedOwnedRowsAndReadHints()
    readErrorAndEmptyAreDistinctAndNeverAutoRetry()
    uncertainPublishIsNeverPromotedByVisibilityObservation()
    sendingAndRecheckingHideOldRowsAndNoAutomaticWrites()
    rejectedWriteNeverPretendsToBeConfirmed()
    logoutAccountReplacementExpiryAndCloseNeverExposeOldRows()
    forgedActorSnapshotsFailClosedWithoutTrustingUnconfirmedWrites()
    println("JODLO worker dashboard: private profile/own-listing states, uncertain writes, account epoch and no auto mutation OK")
}
