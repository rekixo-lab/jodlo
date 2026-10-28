package com.rekixo.jodlo.core.network

import java.io.IOException

private val TOKEN_ONE = "a".repeat(43)
private val TOKEN_TWO = "b".repeat(43)
private const val LISTING_ID = "11111111-1111-4111-8111-111111111111"

private fun issued(token: String = TOKEN_ONE, ttl: Int = 3600) =
    TransportReply(200, """{"ok":true,"data":{"accessToken":"$token","tokenType":"Bearer","expiresInSeconds":$ttl}}""")
private fun error(status: Int, code: String) = TransportReply(
    status, """{"ok":false,"error":{"code":"$code","message":"server-private-detail"}}"""
)
private fun checkRejected(label: String, operation: () -> Unit) {
    check(runCatching(operation).isFailure) { "Expected refusal: $label" }
}
private class FakeWorkers : WorkerRepository {
    var lookup: ApiOutcome<WorkerDraft> = ApiOutcome.Failed(FailureKind.NOT_FOUND, false)
    var optin: ApiOutcome<WorkerDraft> = ApiOutcome.Ok(WorkerDraft("draft"))
    var listings: ApiOutcome<List<OwnListing>> = ApiOutcome.Ok(emptyList())
    var posting: ApiOutcome<PublicListing> = ApiOutcome.Ok(PublicListing(LISTING_ID, "plumber"))
    var deleting: ApiOutcome<Boolean> = ApiOutcome.Ok(true)
    var beforeLookup: (() -> Unit)? = null
    var beforePosting: (() -> Unit)? = null
    var lookupCalls = 0
    var postCalls = 0
    val observedTokens = mutableListOf<String>()
    override fun myDraft(session: String): ApiOutcome<WorkerDraft> {
        observedTokens.add(session)
        lookupCalls++
        beforeLookup?.invoke()
        return lookup
    }
    override fun optIn(session: String): ApiOutcome<WorkerDraft> {
        observedTokens.add(session)
        return optin
    }
    override fun myListings(session: String): ApiOutcome<List<OwnListing>> {
        observedTokens.add(session)
        return listings
    }
    override fun publishExplicitCategory(session: String, confirmedCategoryId: String)
        : ApiOutcome<PublicListing> {
        observedTokens.add(session)
        postCalls++
        beforePosting?.invoke()
        check(confirmedCategoryId == "plumber")
        return posting
    }
    override fun unpublish(session: String, listingId: String): ApiOutcome<Boolean> {
        observedTokens.add(session)
        check(listingId == LISTING_ID)
        return deleting
    }
}

private val unauthorized = SessionResult.Failed(
    SessionFailure.REMOTE_FAILURE, FailureKind.UNAUTHORIZED
)
private fun testIssuanceAndExpiry() {
    var time = 1_000L
    val fake = FakeWorkers()
    val coordinator = InMemorySessionCoordinator(fake, RequestSender { error(503, "SERVICE_UNAVAILABLE") }) { time }
    check(coordinator.snapshot() == LoginState.SignedOut)
    check(coordinator.checkWorker() == SessionResult.Failed(SessionFailure.SIGNED_OUT))
    check(coordinator.acceptIssuedSession(issued()) ==
        ApiOutcome.Ok(LoginState.SignedIn(WorkerState.UNKNOWN)))
    check(!coordinator.toString().contains(TOKEN_ONE))
    check(coordinator.snapshot() == LoginState.SignedIn(WorkerState.UNKNOWN))
    check(fake.lookupCalls == 0)
    check(coordinator.publishExplicitCategory("plumber") ==
        SessionResult.Failed(SessionFailure.OPT_IN_REQUIRED))
    check(fake.postCalls == 0)
    // A NOT_FOUND draft is a known non-worker; it never grants verified status.
    check(coordinator.checkWorker() == SessionResult.Success(WorkerState.NO_DRAFT))
    check(coordinator.snapshot() == LoginState.SignedIn(WorkerState.NO_DRAFT))
    check(coordinator.optIn() == SessionResult.Success(WorkerState.DRAFT))
    check(coordinator.snapshot() == LoginState.SignedIn(WorkerState.DRAFT))
    check(coordinator.publishExplicitCategory("plumber") ==
        SessionResult.Success(PublicListing(LISTING_ID, "plumber")))
    check(fake.postCalls == 1)
    check(coordinator.unpublish(LISTING_ID) == SessionResult.Success(true))
    check(coordinator.myListings() == SessionResult.Success(emptyList<OwnListing>()))
    check(fake.observedTokens.all { it == TOKEN_ONE })
    time = 3_601_000L
    check(coordinator.snapshot() == LoginState.SignedOut)
    check(coordinator.checkWorker() == SessionResult.Failed(SessionFailure.SIGNED_OUT))
    check(fake.lookupCalls == 1)
    check(coordinator.optIn() == SessionResult.Failed(SessionFailure.SIGNED_OUT))
}

private fun testRejectedIssuancePreservesGoodSession() {
    val coordinator = InMemorySessionCoordinator(FakeWorkers(), RequestSender { error(503,"SERVICE_UNAVAILABLE") }) { 0L }
    check(coordinator.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    for (invalid in listOf(
        issued("invalid"), issued(TOKEN_ONE, 0), issued(TOKEN_ONE, 3601),
        TransportReply(200, """{"ok":true,"data":{"accessToken":"$TOKEN_TWO","tokenType":"Basic","expiresInSeconds":3600}}"""),
        TransportReply(200, """{"ok":true,"data":{"accessToken":"$TOKEN_TWO","tokenType":"Bearer","expiresInSeconds":3600,"accountId":"secret"}}"""),
        error(401, "UNAUTHORIZED"),
    )) {
        check(coordinator.acceptIssuedSession(invalid) is ApiOutcome.Failed)
        check(coordinator.snapshot() == LoginState.SignedIn(WorkerState.UNKNOWN))
    }
    val valid = JodloReplyDecoder.issuedSession(issued())
    check(valid is ApiOutcome.Ok)
    check(!valid.value.toString().contains(TOKEN_ONE))
    check(!valid.toString().contains(TOKEN_ONE))
}

private fun testReLoginStaleReplyIsolation() {
    val fake=FakeWorkers()
    val session=InMemorySessionCoordinator(fake, RequestSender { error(503, "SERVICE_UNAVAILABLE") }) { 0L }
    check(session.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    fake.lookup=ApiOutcome.Ok(WorkerDraft("draft"))
    fake.beforeLookup={
        // Replace account while old network call is still pending.
        check(session.acceptIssuedSession(issued(TOKEN_TWO)) is ApiOutcome.Ok)
        fake.beforeLookup=null
    }
    check(session.checkWorker()==SessionResult.Failed(SessionFailure.REPLACED))
    check(session.snapshot()==LoginState.SignedIn(WorkerState.UNKNOWN))
    check(session.checkWorker()==SessionResult.Success(WorkerState.DRAFT))
    check(fake.observedTokens==listOf(TOKEN_ONE,TOKEN_TWO))
}

private fun testUnauthorizedAndTransientErrors() {
    var time = 0L
    val fake = FakeWorkers()
    val session=InMemorySessionCoordinator(fake, RequestSender { error(503,"SERVICE_UNAVAILABLE") }) { time }
    check(session.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    fake.lookup=ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT,false)
    check(session.checkWorker()==SessionResult.Failed(
        SessionFailure.REMOTE_FAILURE,FailureKind.OFFLINE_OR_TIMEOUT))
    check(session.snapshot()==LoginState.SignedIn(WorkerState.UNKNOWN))
    fake.lookup=ApiOutcome.Failed(FailureKind.FORBIDDEN,false)
    check(session.checkWorker()==SessionResult.Failed(
        SessionFailure.REMOTE_FAILURE,FailureKind.FORBIDDEN))
    check(session.snapshot()==LoginState.SignedIn(WorkerState.UNKNOWN))
    fake.lookup=ApiOutcome.Failed(FailureKind.UNAUTHORIZED,false)
    check(session.checkWorker()==unauthorized)
    check(session.snapshot()==LoginState.SignedOut)
    check(session.myListings()==SessionResult.Failed(SessionFailure.SIGNED_OUT))
    check(session.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    time=3_600_000L
    // Expiry detected before initiating a new privileged network call.
    check(session.checkWorker()==SessionResult.Failed(SessionFailure.EXPIRED))
    check(fake.lookupCalls==3)
}

private fun testLogoutAndUncertainRevoke() {
    var sent=0
    lateinit var coordinator: InMemorySessionCoordinator
    val sender=RequestSender { call ->
        sent++
        check(call.method==HttpMethod.POST)
        check(call.resource=="/api/v1/auth/logout-all")
        check(call.headers()["Authorization"]=="Bearer $TOKEN_ONE")
        check(coordinator.snapshot()==LoginState.SignedOut) // cleared BEFORE network
        TransportReply(200, """{"ok":true,"data":{"revoked":true,"allDevices":true}}""")
    }
    coordinator=InMemorySessionCoordinator(FakeWorkers(),sender) { 0L }
    check(coordinator.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    check(coordinator.logout(allDevices=true)==SessionResult.Success(true))
    check(sent==1 && coordinator.snapshot()==LoginState.SignedOut)
    check(coordinator.logout()==SessionResult.Failed(SessionFailure.SIGNED_OUT))
    check(sent==1)
    val serverError=InMemorySessionCoordinator(FakeWorkers(),RequestSender {
        throw IOException("private transport error")
    }) { 0L }
    check(serverError.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    check(serverError.logout()==SessionResult.Failed(
        SessionFailure.REMOTE_FAILURE,FailureKind.OFFLINE_OR_TIMEOUT))
    check(serverError.snapshot()==LoginState.SignedOut)
    // A failed HTTP revoke is not a claim that the server's token was revoked.
    val wrongShape=InMemorySessionCoordinator(FakeWorkers(),RequestSender {
        TransportReply(200, """{"ok":true,"data":{"revoked":true,"allDevices":true}}""")
    }) { 0L }
    check(wrongShape.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    check(wrongShape.logout()==SessionResult.Failed(
        SessionFailure.REMOTE_FAILURE,FailureKind.BAD_RESPONSE))
    check(wrongShape.snapshot()==LoginState.SignedOut)
    // A local drop cannot resurrect an in-flight worker response.
    lateinit var during: InMemorySessionCoordinator
    val fake=FakeWorkers()
    during=InMemorySessionCoordinator(fake,RequestSender {
        TransportReply(200, """{"ok":true,"data":{"revoked":true}}""")
    }) { 0L }
    check(during.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    fake.lookup=ApiOutcome.Ok(WorkerDraft("draft"))
    fake.beforeLookup={ check(during.logout()==SessionResult.Success(true)) }
    check(during.checkWorker()==SessionResult.Failed(SessionFailure.REPLACED))
    check(during.snapshot()==LoginState.SignedOut)
}

private fun testStalePublishNeverGrantsSuccess() {
    val fake=FakeWorkers()
    lateinit var coordinator: InMemorySessionCoordinator
    coordinator=InMemorySessionCoordinator(fake,RequestSender {
        TransportReply(200, """{"ok":true,"data":{"revoked":true}}""")
    }) { 0L }
    check(coordinator.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    check(coordinator.optIn()==SessionResult.Success(WorkerState.DRAFT))
    fake.beforePosting={ check(coordinator.logout()==SessionResult.Success(true)) }
    check(coordinator.publishExplicitCategory("plumber")==
        SessionResult.Failed(SessionFailure.REPLACED))
    check(fake.postCalls==1)
    check(coordinator.snapshot()==LoginState.SignedOut)
    // Do not repeat the request: a stale response may mean the backend DID publish.
}
fun main() {
    testIssuanceAndExpiry()
    testRejectedIssuancePreservesGoodSession()
    testReLoginStaleReplyIsolation()
    testUnauthorizedAndTransientErrors()
    testLogoutAndUncertainRevoke()
    testStalePublishNeverGrantsSuccess()
    checkRejected("wrong category") {
        JodloRoutes.publishListing(TOKEN_ONE, "natural language")
    }
    println("JODLO Kotlin session: memory-only expiry, worker draft, logout and stale-reply isolation OK")
}
