package com.rekixo.jodlo.core.network

import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

private val TOKEN_A = "a".repeat(43)
private val TOKEN_B = "b".repeat(43)
private const val LISTING = "11111111-1111-4111-8111-111111111111"
private const val GOOGLE_PROOF = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.signature"

private fun issued(token: String = TOKEN_A) = TransportReply(200,
    """{"ok":true,"data":{"accessToken":"$token","tokenType":"Bearer","expiresInSeconds":3600}}""")
private fun ok(data: String) = TransportReply(200, """{"ok":true,"data":$data}""")
private fun apiError(status: Int, code: String) = TransportReply(status,
    """{"ok":false,"error":{"code":"$code","message":"redacted server detail"}}""")
private fun session(sender: RequestSender) =
    InMemorySessionCoordinator(RemoteWorkerRepository(sender), sender) { 0L }
private fun <T> background(block: () -> T): FutureTask<T> =
    FutureTask<T> { block() }.also { Thread(it, "jodlo-test-network").start() }
private fun reached(latch: CountDownLatch) {
    check(latch.await(5, TimeUnit.SECONDS)) { "Network test did not reach expected point" }
}
private fun <T> result(task: FutureTask<T>): T = task.get(5, TimeUnit.SECONDS)
private val cancelled = SessionResult.Failed(SessionFailure.CANCELLED)

private fun testCancelBeforeAnyNetwork() {
    val count = AtomicInteger()
    val sender = RequestSender { count.incrementAndGet(); apiError(503, "SERVICE_UNAVAILABLE") }
    val coordinator = session(sender)
    check(coordinator.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    val signal = CancellationSignal()
    signal.cancel()
    signal.cancel()
    check(signal.isCancelled)
    check(coordinator.checkWorker(signal) == cancelled)
    check(coordinator.optIn(signal) == cancelled)
    check(coordinator.myListings(signal) == cancelled)
    check(coordinator.publishExplicitCategory("plumber", signal) == cancelled)
    check(coordinator.unpublish(LISTING, signal) == cancelled)
    check(coordinator.signInWithGoogleIdToken(GOOGLE_PROOF, signal) == cancelled)
    check(count.get() == 0)
    check(coordinator.snapshot() == LoginState.SignedIn(WorkerState.UNKNOWN))
    check(!signal.toString().contains(TOKEN_A))
}

private fun testCancelSlowWorkerReadWithoutStateMutation() {
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val count = AtomicInteger()
    val sender = RequestSender { request ->
        count.incrementAndGet()
        check(request.resource == "/api/v1/me/worker-profile")
        started.countDown()
        check(release.await(5, TimeUnit.SECONDS))
        ok("""{"profile":{"status":"draft"}}""")
    }
    val coordinator = session(sender)
    check(coordinator.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    val signal = CancellationSignal()
    val task = background { coordinator.checkWorker(signal) }
    try {
        reached(started)
        check(coordinator.snapshot() == LoginState.SignedIn(WorkerState.UNKNOWN))
        signal.cancel()
    } finally {
        release.countDown()
    }
    check(result(task) == cancelled)
    check(coordinator.snapshot() == LoginState.SignedIn(WorkerState.UNKNOWN))
    check(count.get() == 1)
}

private fun testCancelSlowPublishReleasesWriteGate() {
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val posts = AtomicInteger()
    val sender = RequestSender { request ->
        when {
            request.resource == "/api/v1/me/worker-profile" && request.method == HttpMethod.POST ->
                ok("""{"profile":{"status":"draft"}}""")
            request.resource == "/api/v1/me/listings" && request.method == HttpMethod.POST -> {
                posts.incrementAndGet()
                started.countDown()
                check(release.await(5, TimeUnit.SECONDS))
                ok("""{"listing":{"id":"$LISTING","categoryId":"plumber"}}""")
            }
            request.resource == "/api/v1/me/listings" && request.method == HttpMethod.GET ->
                ok("""{"listings":[]}""")
            else -> throw IllegalStateException("Unexpected request")
        }
    }
    val coordinator = session(sender)
    check(coordinator.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    check(coordinator.optIn() == SessionResult.Success(WorkerState.DRAFT))
    val signal = CancellationSignal()
    val task = background { coordinator.publishExplicitCategory("plumber", signal) }
    try {
        reached(started)
        check(coordinator.publishExplicitCategory("plumber") ==
            SessionResult.Failed(SessionFailure.OPERATION_IN_PROGRESS))
        check(coordinator.myListings() ==
            SessionResult.Failed(SessionFailure.OPERATION_IN_PROGRESS))
        signal.cancel()
    } finally {
        release.countDown()
    }
    check(result(task) == cancelled) // Server may nevertheless have published.
    check(coordinator.snapshot() == LoginState.SignedIn(WorkerState.DRAFT))
    check(posts.get() == 1)
    check(coordinator.myListings() == SessionResult.Success(emptyList<OwnListing>()))
}

private fun testCancelSlowGoogleExchangeKeepsExistingSession() {
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val loginPosts = AtomicInteger()
    val sender = RequestSender { request ->
        when (request.resource) {
            "/api/v1/auth/google" -> {
                loginPosts.incrementAndGet()
                check(!request.headers().containsKey("Authorization"))
                started.countDown()
                check(release.await(5, TimeUnit.SECONDS))
                issued(TOKEN_B)
            }
            "/api/v1/me/worker-profile" -> {
                check(request.headers()["Authorization"] == "Bearer $TOKEN_A")
                apiError(404, "NOT_FOUND")
            }
            else -> throw IllegalStateException("Unexpected route")
        }
    }
    val coordinator = session(sender)
    check(coordinator.acceptIssuedSession(issued(TOKEN_A)) is ApiOutcome.Ok)
    val signal = CancellationSignal()
    val task = background { coordinator.signInWithGoogleIdToken(GOOGLE_PROOF, signal) }
    try {
        reached(started)
        signal.cancel()
    } finally {
        release.countDown()
    }
    check(result(task) == cancelled)
    check(coordinator.snapshot() == LoginState.SignedIn(WorkerState.UNKNOWN))
    check(coordinator.checkWorker() == SessionResult.Success(WorkerState.NO_DRAFT))
    check(loginPosts.get() == 1)
}

private fun testUnauthorizedResponseStillRevokesCancelledSession() {
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val sender = RequestSender {
        started.countDown()
        check(release.await(5, TimeUnit.SECONDS))
        apiError(401, "UNAUTHORIZED")
    }
    val coordinator = session(sender)
    check(coordinator.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    val signal = CancellationSignal()
    val task = background { coordinator.checkWorker(signal) }
    try {
        reached(started)
        signal.cancel()
    } finally {
        release.countDown()
    }
    check(result(task) == SessionResult.Failed(
        SessionFailure.REMOTE_FAILURE, FailureKind.UNAUTHORIZED))
    check(coordinator.snapshot() == LoginState.SignedOut)
}

private fun testLogoutWinsOverCancellation() {
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val sender = RequestSender { request ->
        when (request.resource) {
            "/api/v1/me/worker-profile" -> {
                started.countDown()
                check(release.await(5, TimeUnit.SECONDS))
                ok("""{"profile":{"status":"draft"}}""")
            }
            "/api/v1/auth/logout" -> ok("""{"revoked":true}""")
            else -> throw IllegalStateException("Unexpected route")
        }
    }
    val coordinator = session(sender)
    check(coordinator.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    val signal = CancellationSignal()
    val task = background { coordinator.checkWorker(signal) }
    try {
        reached(started)
        signal.cancel()
        check(coordinator.logout() == SessionResult.Success(true))
    } finally {
        release.countDown()
    }
    check(result(task) == SessionResult.Failed(SessionFailure.REPLACED))
    check(coordinator.snapshot() == LoginState.SignedOut)
}

fun main() {
    testCancelBeforeAnyNetwork()
    testCancelSlowWorkerReadWithoutStateMutation()
    testCancelSlowPublishReleasesWriteGate()
    testCancelSlowGoogleExchangeKeepsExistingSession()
    testUnauthorizedResponseStillRevokesCancelledSession()
    testLogoutWinsOverCancellation()
    println("JODLO Kotlin cancellation: pre-send, slow read/write/login, 401 and logout race OK")
}
