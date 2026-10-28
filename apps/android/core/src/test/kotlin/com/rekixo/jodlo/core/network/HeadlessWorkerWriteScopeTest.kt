package com.rekixo.jodlo.core.network

import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

private val TOKEN_A = "a".repeat(43)
private val TOKEN_B = "b".repeat(43)
private const val LISTING_ID = "11111111-1111-4111-8111-111111111111"
private fun issued(token: String = TOKEN_A) = TransportReply(200,
    """{"ok":true,"data":{"accessToken":"$token","tokenType":"Bearer","expiresInSeconds":3600}}""")
private fun serverError(status: Int, code: String) = TransportReply(status,
    """{"ok":false,"error":{"code":"$code","message":"private diagnostic"}}""")
private fun <T> background(work: () -> T) =
    FutureTask<T> { work() }.also { Thread(it, "jodlo-fake-network").start() }
private fun <T> completed(task: FutureTask<T>): T = task.get(5, TimeUnit.SECONDS)
private fun reached(latch: CountDownLatch) {
    check(latch.await(5, TimeUnit.SECONDS)) { "Fake network call not started" }
}

private class ReviewFakeWorkerRepository : WorkerRepository {
    var published: ApiOutcome<PublicListing> = ApiOutcome.Ok(PublicListing(LISTING_ID,"plumber"))
    var unpublished: ApiOutcome<Boolean> = ApiOutcome.Ok(true)
    var rows: ApiOutcome<List<OwnListing>> = ApiOutcome.Ok(emptyList())
    var beforePublish: (() -> Unit)? = null
    var beforeOwnRead: (() -> Unit)? = null
    var publishCalls = 0
    var unpublishCalls = 0
    var readCalls = 0
    override fun myDraft(session: String) = ApiOutcome.Ok(WorkerDraft("draft"))
    override fun optIn(session: String) = ApiOutcome.Ok(WorkerDraft("draft"))
    override fun myListings(session: String): ApiOutcome<List<OwnListing>> {
        readCalls++
        beforeOwnRead?.invoke()
        return rows
    }
    override fun publishExplicitCategory(session: String, confirmedCategoryId: String)
        : ApiOutcome<PublicListing> {
        check(confirmedCategoryId == "plumber")
        publishCalls++
        beforePublish?.invoke()
        return published
    }
    override fun unpublish(session: String, listingId: String): ApiOutcome<Boolean> {
        check(listingId == LISTING_ID)
        unpublishCalls++
        return unpublished
    }
}
private fun coordinator(fake: ReviewFakeWorkerRepository): InMemorySessionCoordinator =
    InMemorySessionCoordinator(fake, RequestSender {
        serverError(503, "SERVICE_UNAVAILABLE")
    }) { 0L }
private fun signedInDraft(fake: ReviewFakeWorkerRepository): InMemorySessionCoordinator =
    coordinator(fake).also {
        check(it.acceptIssuedSession(issued()) is ApiOutcome.Ok)
        check(it.optIn() == SessionResult.Success(WorkerState.DRAFT))
    }
private fun review(state: WorkerWriteState): WorkerWriteState.NeedsReview =
    state as? WorkerWriteState.NeedsReview ?: error("Expected unresolved write")

private fun testExplicitPublishUncertainThenReadOnlyVisibility() {
    val fake = ReviewFakeWorkerRepository()
    val session = signedInDraft(fake)
    fake.published = ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT, false)
    val scope = HeadlessWorkerWriteScope(session)
    check(scope.publishExplicitCategory("plumber") == WorkerWriteCompletion.APPLIED)
    val pending = review(scope.snapshot().state)
    check(pending.action == WorkerWriteAction.Publish("plumber"))
    check(pending.reason == SessionFailure.REMOTE_FAILURE)
    check(pending.networkKind == FailureKind.OFFLINE_OR_TIMEOUT)
    check(pending.observation == null)
    // Never send a second POST, even with a different explicitly selected ID.
    check(scope.publishExplicitCategory("plumber") == WorkerWriteCompletion.BLOCKED)
    check(scope.unpublish(LISTING_ID) == WorkerWriteCompletion.BLOCKED)
    check(fake.publishCalls == 1 && fake.unpublishCalls == 0)
    fake.rows = ApiOutcome.Ok(listOf(OwnListing(LISTING_ID, "plumber", true)))
    check(scope.recheckOwnListings() == WorkerWriteCompletion.APPLIED)
    val after = review(scope.snapshot().state)
    check(after.observation == WorkerVisibility.VISIBLE)
    check(after.action == pending.action)
    check(scope.snapshot().state is WorkerWriteState.NeedsReview) // Not a write acknowledgement.
    check(fake.publishCalls == 1 && fake.readCalls == 1)
    check(!scope.snapshot().toString().contains(TOKEN_A))
    check(scope.acknowledgeUncertainty())
    check(!scope.acknowledgeUncertainty())
    check(scope.snapshot().state == WorkerWriteState.Idle)
    // Only a NEW caller action, not recheck, may submit the next operation.
    fake.published = ApiOutcome.Ok(PublicListing(LISTING_ID, "plumber"))
    check(scope.publishExplicitCategory("plumber") == WorkerWriteCompletion.APPLIED)
    check(scope.snapshot().state == WorkerWriteState.Confirmed(WorkerWriteAction.Publish("plumber")))
    check(fake.publishCalls == 2)
}

private fun testUnpublishAmbiguityCannotBeCertifiedByInvisibleRecord() {
    val fake = ReviewFakeWorkerRepository()
    val session = signedInDraft(fake)
    fake.unpublished = ApiOutcome.Failed(FailureKind.SERVICE_UNAVAILABLE, false)
    val scope = HeadlessWorkerWriteScope(session)
    check(scope.unpublish(LISTING_ID) == WorkerWriteCompletion.APPLIED)
    check(fake.unpublishCalls == 1)
    fake.rows = ApiOutcome.Ok(listOf(OwnListing(LISTING_ID, "plumber", false)))
    check(scope.recheckOwnListings() == WorkerWriteCompletion.APPLIED)
    // Could also be moderation or category inactivity: still UNCONFIRMED.
    check(review(scope.snapshot().state).observation == WorkerVisibility.NOT_VISIBLE)
    fake.rows = ApiOutcome.Ok(emptyList())
    check(scope.recheckOwnListings() == WorkerWriteCompletion.APPLIED)
    check(review(scope.snapshot().state).observation == WorkerVisibility.NOT_IN_FIRST_100)
    check(fake.unpublishCalls == 1 && fake.readCalls == 2)
}

private fun testRejectedAndInvalidActionsNeverReplay() {
    val fake = ReviewFakeWorkerRepository()
    val session = signedInDraft(fake)
    val scope = HeadlessWorkerWriteScope(session)
    check(runCatching { scope.publishExplicitCategory("raw trade description") }.isFailure)
    check(runCatching { scope.unpublish("invalid id") }.isFailure)
    check(scope.snapshot().state == WorkerWriteState.Idle)
    fake.published = ApiOutcome.Failed(FailureKind.FORBIDDEN, false)
    check(scope.publishExplicitCategory("plumber") == WorkerWriteCompletion.APPLIED)
    check(scope.snapshot().state ==
        WorkerWriteState.Rejected(WorkerWriteAction.Publish("plumber"),
            SessionFailure.REMOTE_FAILURE, FailureKind.FORBIDDEN))
    check(scope.recheckOwnListings() == WorkerWriteCompletion.BLOCKED)
    check(fake.publishCalls == 1 && fake.readCalls == 0)
    fake.published = ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)
    check(scope.publishExplicitCategory("plumber") == WorkerWriteCompletion.APPLIED)
    check(review(scope.snapshot().state).networkKind == FailureKind.BAD_RESPONSE)
}

private fun testUncertainReadFailureKeepsGuard() {
    val fake = ReviewFakeWorkerRepository()
    val scope = HeadlessWorkerWriteScope(signedInDraft(fake))
    fake.published = ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT, false)
    check(scope.publishExplicitCategory("plumber") == WorkerWriteCompletion.APPLIED)
    fake.rows = ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT, false)
    check(scope.recheckOwnListings() == WorkerWriteCompletion.APPLIED)
    val state = review(scope.snapshot().state)
    check(state.readFailure == SessionFailure.REMOTE_FAILURE)
    check(state.observation == null)
    check(scope.publishExplicitCategory("plumber") == WorkerWriteCompletion.BLOCKED)
    check(fake.publishCalls == 1)
}

private fun testSingleFlightAndSlowRead() {
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val fake = ReviewFakeWorkerRepository()
    val session = signedInDraft(fake)
    val scope = HeadlessWorkerWriteScope(session)
    fake.beforePublish = {
        started.countDown()
        check(release.await(5, TimeUnit.SECONDS))
    }
    fake.published = ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT, false)
    val pending = background { scope.publishExplicitCategory("plumber") }
    try {
        reached(started)
        check(scope.snapshot().state == WorkerWriteState.Sending(
            WorkerWriteAction.Publish("plumber")))
        check(scope.publishExplicitCategory("plumber") == WorkerWriteCompletion.BLOCKED)
        check(scope.recheckOwnListings() == WorkerWriteCompletion.BLOCKED)
        check(!scope.acknowledgeUncertainty())
    } finally {
        release.countDown()
    }
    check(completed(pending) == WorkerWriteCompletion.APPLIED)
    check(fake.publishCalls == 1)
    val readingStarted = CountDownLatch(1)
    val readingRelease = CountDownLatch(1)
    fake.beforeOwnRead = {
        readingStarted.countDown()
        check(readingRelease.await(5, TimeUnit.SECONDS))
    }
    val read = background { scope.recheckOwnListings() }
    try {
        reached(readingStarted)
        check(scope.snapshot().state is WorkerWriteState.Rechecking)
        check(scope.recheckOwnListings() == WorkerWriteCompletion.BLOCKED)
        check(scope.unpublish(LISTING_ID) == WorkerWriteCompletion.BLOCKED)
    } finally {
        readingRelease.countDown()
    }
    check(completed(read) == WorkerWriteCompletion.APPLIED)
    check(fake.readCalls == 1)
}

private fun testNewAccountPurgesPendingWriteAndCloseDiscardsReplies() {
    val fake = ReviewFakeWorkerRepository()
    val session = signedInDraft(fake)
    fake.published = ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT, false)
    val scope = HeadlessWorkerWriteScope(session)
    check(scope.publishExplicitCategory("plumber") == WorkerWriteCompletion.APPLIED)
    check(scope.snapshot().state is WorkerWriteState.NeedsReview)
    check(session.acceptIssuedSession(issued(TOKEN_B)) is ApiOutcome.Ok)
    check(scope.snapshot().state == WorkerWriteState.Idle)
    check(scope.recheckOwnListings() == WorkerWriteCompletion.BLOCKED)

    // Cancellation after a request starts must not resurrect a closed scope.
    check(session.optIn() == SessionResult.Success(WorkerState.DRAFT))
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    fake.beforePublish = {
        started.countDown()
        check(release.await(5, TimeUnit.SECONDS))
    }
    val slow = background { scope.publishExplicitCategory("plumber") }
    try {
        reached(started)
        scope.close()
        check(scope.snapshot() == WorkerWriteSnapshot(true, WorkerWriteState.Idle))
        check(scope.publishExplicitCategory("plumber") == WorkerWriteCompletion.DISCARDED)
    } finally {
        release.countDown()
    }
    check(completed(slow) == WorkerWriteCompletion.DISCARDED)
    check(scope.snapshot().state == WorkerWriteState.Idle)
}

private fun testReadScopePurgesCacheWhenWriteAttempted() {
    val fake = ReviewFakeWorkerRepository()
    val session = signedInDraft(fake)
    fake.rows = ApiOutcome.Ok(listOf(OwnListing(LISTING_ID, "plumber", true)))
    val reads = HeadlessMarketplaceReadScope(RemoteCatalogRepository(RequestSender {
        error("Catalog must not be used")
    }), session)
    check(reads.checkWorker() == ReadCompletion.APPLIED)
    check(reads.ownListings() == ReadCompletion.APPLIED)
    check(reads.snapshot().ownListings is ReadState.Ready)
    check(reads.snapshot().worker is ReadState.Ready)
    fake.published = ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT, false)
    val writes = HeadlessWorkerWriteScope(session)
    check(writes.publishExplicitCategory("plumber") == WorkerWriteCompletion.APPLIED)
    check(reads.snapshot().ownListings == ReadState.Idle)
    check(reads.snapshot().worker == ReadState.Idle)
    // An uncertain write must NOT leave outdated "visible" cached as current.
    check(writes.snapshot().state is WorkerWriteState.NeedsReview)
}

fun main() {
    testExplicitPublishUncertainThenReadOnlyVisibility()
    testUnpublishAmbiguityCannotBeCertifiedByInvisibleRecord()
    testRejectedAndInvalidActionsNeverReplay()
    testUncertainReadFailureKeepsGuard()
    testSingleFlightAndSlowRead()
    testNewAccountPurgesPendingWriteAndCloseDiscardsReplies()
    testReadScopePurgesCacheWhenWriteAttempted()
    println("JODLO worker writes: explicit intent, uncertain no-retry guard, read-only visibility and cache invalidation OK")
}
