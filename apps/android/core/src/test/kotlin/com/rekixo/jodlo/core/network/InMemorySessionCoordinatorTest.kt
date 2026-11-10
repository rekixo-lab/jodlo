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
    var beforeListings: (() -> Unit)? = null
    var beforePosting: (() -> Unit)? = null
    var lookupCalls = 0
    var postCalls = 0
    var optInCalls = 0
    val observedTokens = mutableListOf<String>()
    override fun myDraft(session: String): ApiOutcome<WorkerDraft> {
        observedTokens.add(session)
        lookupCalls++
        beforeLookup?.invoke()
        return lookup
    }
    override fun optIn(session: String): ApiOutcome<WorkerDraft> {
        observedTokens.add(session)
        optInCalls++
        return optin
    }
    override fun myListings(session: String): ApiOutcome<List<OwnListing>> {
        observedTokens.add(session)
        beforeListings?.invoke()
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

/** A slow pre-opt-in 404 must not downgrade the successful DRAFT state. */
private fun testOldProfileCannotUndoOptIn() {
    val fake = FakeWorkers()
    val session = InMemorySessionCoordinator(fake, RequestSender {
        error(503, "SERVICE_UNAVAILABLE")
    }) { 0L }
    check(session.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    fake.beforeLookup = {
        fake.beforeLookup = null
        check(session.optIn() == SessionResult.Success(WorkerState.DRAFT))
    }
    check(session.checkWorker() == SessionResult.Failed(SessionFailure.STALE_RESULT))
    check(session.snapshot() == LoginState.SignedIn(WorkerState.DRAFT))
    check(fake.lookupCalls == 1 && fake.optInCalls == 1)
}

/** Two rapid taps never send two overlapping writes or queue a replay. */
private fun testConcurrentMutationsRejected() {
    val fake = FakeWorkers()
    val session = InMemorySessionCoordinator(fake, RequestSender {
        error(503, "SERVICE_UNAVAILABLE")
    }) { 0L }
    check(session.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    check(session.optIn() == SessionResult.Success(WorkerState.DRAFT))
    fake.beforePosting = {
        fake.beforePosting = null
        val busy = SessionResult.Failed(SessionFailure.OPERATION_IN_PROGRESS)
        check(session.publishExplicitCategory("plumber") == busy)
        check(session.unpublish(LISTING_ID) == busy)
        check(session.optIn() == busy)
        check(session.checkWorker() == busy)
        check(session.myListings() == busy)
        check(session.snapshot() == LoginState.SignedIn(WorkerState.DRAFT))
    }
    check(session.publishExplicitCategory("plumber") ==
        SessionResult.Success(PublicListing(LISTING_ID, "plumber")))
    check(fake.postCalls == 1 && fake.optInCalls == 1)
    // An uncertain remote acknowledgement is NOT safe to replay automatically.
    fake.posting = ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT, false)
    check(session.publishExplicitCategory("plumber") ==
        SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.OFFLINE_OR_TIMEOUT))
    check(fake.postCalls == 2)
    check(session.unpublish(LISTING_ID) == SessionResult.Success(true))
}

/** Earlier owned-listing data cannot be applied after a successful publish. */
private fun testStaleOwnListingsResponseRejected() {
    val fake = FakeWorkers()
    val session = InMemorySessionCoordinator(fake, RequestSender {
        error(503, "SERVICE_UNAVAILABLE")
    }) { 0L }
    check(session.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    check(session.optIn() == SessionResult.Success(WorkerState.DRAFT))
    fake.beforeListings = {
        fake.beforeListings = null
        check(session.publishExplicitCategory("plumber") ==
            SessionResult.Success(PublicListing(LISTING_ID, "plumber")))
    }
    check(session.myListings() == SessionResult.Failed(SessionFailure.STALE_RESULT))
    check(session.myListings() == SessionResult.Success(emptyList<OwnListing>()))
}

/** Unexpected fake-adapter exceptions never strand the session write lock. */
private fun testExceptionalSenderReleasesGate() {
    val fake = FakeWorkers()
    val session = InMemorySessionCoordinator(fake, RequestSender {
        error(503, "SERVICE_UNAVAILABLE")
    }) { 0L }
    check(session.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    check(session.optIn() == SessionResult.Success(WorkerState.DRAFT))
    fake.beforePosting = {
        fake.beforePosting = null
        throw IllegalStateException("injected fake failure")
    }
    checkRejected("unexpected fake sender exception") {
        session.publishExplicitCategory("plumber")
    }
    check(session.publishExplicitCategory("plumber") ==
        SessionResult.Success(PublicListing(LISTING_ID, "plumber")))
    check(fake.postCalls == 2)
}

/** A document export must be discarded after logout/account replacement,
 * even if its HTTP response arrives successfully from the previous session.
 */
private fun testOwnerExportAndEpochIsolation() {
    var lateLogout = false
    var exportCalls = 0
    lateinit var session: InMemorySessionCoordinator
    val exportBody = """{"ok":true,"data":{"schemaVersion":1,
        "account":{"accountId":"account-identity-a111","createdAt":"2026-11-04T00:00:00.000Z",
        "workerEnabled":false,"workerSince":null,"totalServices":0,
        "publishedServices":0,"visibleServices":0,"activeSessions":1,"receivesCalls":false},
        "identity":[],"services":[],"callPreferences":[],"availabilityPreferences":[],
        "blocksMade":[],"abuseCounters":[],"sessions":[],
        "limitations":["JODLO-owned D1 rows only"]}}""".trimIndent()
    val sender = RequestSender { call ->
        when (call.resource) {
            "/api/v1/me/data-export" -> {
                exportCalls++
                check(call.headers()["Authorization"] == "Bearer $TOKEN_ONE")
                if (lateLogout) {
                    check(session.logout() == SessionResult.Success(true))
                }
                TransportReply(200, exportBody)
            }
            "/api/v1/auth/logout" -> TransportReply(
                200, """{"ok":true,"data":{"revoked":true}}""",
            )
            else -> error(503, "SERVICE_UNAVAILABLE")
        }
    }
    session = InMemorySessionCoordinator(FakeWorkers(), sender) { 0L }
    check(session.accountExportSessionMarker() == null)
    check(session.accountDataExport() == SessionResult.Failed(SessionFailure.SIGNED_OUT))
    check(session.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    val firstMarker = session.accountExportSessionMarker()
    check(firstMarker != null)
    val first = session.accountDataExport()
    check(first is SessionResult.Success)
    check(first.value.json.contains("schemaVersion"))
    check(!first.toString().contains("account-identity-a111"))
    check(exportCalls == 1)
    lateLogout = true
    check(session.accountDataExport() == SessionResult.Failed(SessionFailure.REPLACED))
    check(exportCalls == 2)
    check(session.accountExportSessionMarker() == null)
    check(session.acceptIssuedSession(issued(TOKEN_TWO)) is ApiOutcome.Ok)
    check(session.accountExportSessionMarker() != firstMarker)
}

private fun testExactSelectedServiceReadSessionIsolation() {
    val selected=OwnListing(LISTING_ID,"plumber",true,
        OwnPublicationStatus.PUBLISHED)
    val fake=FakeWorkers()
    lateinit var current: InMemorySessionCoordinator
    var changeSession=false
    var mutateDuringRead=false
    var seen=0
    val capable=object : WorkerRepository by fake, ExactManagedOwnListingRepository {
        override fun exactManagedOwnListing(session:String,listingId:String):
            ApiOutcome<OwnListing> {
            seen++
            check(listingId==LISTING_ID)
            check(session==TOKEN_ONE || session==TOKEN_TWO)
            if(changeSession) check(current.acceptIssuedSession(issued(TOKEN_TWO))
                is ApiOutcome.Ok)
            if(mutateDuringRead) check(current.optIn() ==
                SessionResult.Success(WorkerState.DRAFT))
            return ApiOutcome.Ok(selected)
        }
    }
    current=InMemorySessionCoordinator(capable,
        RequestSender { error(503,"SERVICE_UNAVAILABLE") }) { 0L }
    check(current.exactManagedOwnListing(LISTING_ID) ==
        SessionResult.Failed(SessionFailure.SIGNED_OUT))
    check(seen==0)
    check(current.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    check(current.exactManagedOwnListing(LISTING_ID)==SessionResult.Success(selected))
    changeSession=true
    check(current.exactManagedOwnListing(LISTING_ID)==
        SessionResult.Failed(SessionFailure.REPLACED))
    changeSession=false
    // New/current session after replacement has an independent epoch.
    check(current.exactManagedOwnListing(LISTING_ID)==SessionResult.Success(selected))
    mutateDuringRead=true
    check(current.exactManagedOwnListing(LISTING_ID)==
        SessionResult.Failed(SessionFailure.STALE_RESULT))
    mutateDuringRead=false
    check(current.exactManagedOwnListing(LISTING_ID)==SessionResult.Success(selected))
    check(seen==5)
    checkRejected("exact ID syntax") {
        current.exactManagedOwnListing("../foreign")
    }
    val unsupported=InMemorySessionCoordinator(fake,
        RequestSender { error(503,"SERVICE_UNAVAILABLE") }) { 0L }
    check(unsupported.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    check(unsupported.exactManagedOwnListing(LISTING_ID)==
        SessionResult.Failed(SessionFailure.REMOTE_FAILURE,
            FailureKind.SERVICE_UNAVAILABLE))
}

private fun testRevisionSnapshotAndSingleFlightCas() {
    val fake=FakeWorkers()
    val row=OwnListing(LISTING_ID,"plumber",true,OwnPublicationStatus.PUBLISHED)
    var readCount=0
    var editCount=0
    var readReplacesSession=false
    var readStartsWorkerWrite=false
    var failEdit=false
    lateinit var session: InMemorySessionCoordinator
    val versioned=object: WorkerRepository by fake, VersionedOwnListingRepository {
        override fun exactVersionedOwnListing(
            token:String,listingId:String,
        ):ApiOutcome<VersionedOwnListing> {
            check(token==TOKEN_ONE||token==TOKEN_TWO)
            check(listingId==LISTING_ID)
            readCount++
            if (readReplacesSession) {
                check(session.acceptIssuedSession(issued(TOKEN_TWO)) is ApiOutcome.Ok)
            }
            if (readStartsWorkerWrite) {
                check(session.optIn()==SessionResult.Success(WorkerState.DRAFT))
            }
            return ApiOutcome.Ok(VersionedOwnListing(row,7))
        }
        override fun editCategoryVersioned(
            token:String,listingId:String,expectedCategoryId:String,
            nextCategoryId:String,expectedRevision:Long,
        ):ApiOutcome<VersionedCategoryEditReceipt> {
            editCount++
            check(token==TOKEN_ONE||token==TOKEN_TWO)
            check(listingId==LISTING_ID && expectedCategoryId=="plumber" &&
                nextCategoryId=="carpenter" && expectedRevision==7L)
            return if (failEdit)
                ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT, retryable=false)
            else ApiOutcome.Ok(VersionedCategoryEditReceipt(
                PublicListing(LISTING_ID,"carpenter"),8))
        }
    }
    session=InMemorySessionCoordinator(versioned,
        RequestSender { error(503,"SERVICE_UNAVAILABLE") }) { 0L }
    check(session.exactVersionedOwnListing(LISTING_ID)==
        SessionResult.Failed(SessionFailure.SIGNED_OUT))
    check(readCount==0)
    check(session.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    check(session.exactVersionedOwnListing(LISTING_ID)==
        SessionResult.Success(VersionedOwnListing(row,7)))
    check(session.editListingCategoryVersioned(
        LISTING_ID,"plumber","carpenter",7)==
        SessionResult.Failed(SessionFailure.OPT_IN_REQUIRED))
    check(session.optIn()==SessionResult.Success(WorkerState.DRAFT))
    val writeScope=HeadlessWorkerWriteScope(session)
    check(writeScope.editCategoryVersioned(
        LISTING_ID,"plumber","carpenter",7)==WorkerWriteCompletion.APPLIED)
    check(writeScope.snapshot().state is WorkerWriteState.Confirmed)
    check(editCount==1)
    failEdit=true
    check(writeScope.editCategoryVersioned(
        LISTING_ID,"plumber","carpenter",7)==WorkerWriteCompletion.APPLIED)
    check(writeScope.snapshot().state is WorkerWriteState.NeedsReview)
    check(writeScope.editCategoryVersioned(
        LISTING_ID,"plumber","carpenter",7)==WorkerWriteCompletion.BLOCKED)
    check(editCount==2)
    check(writeScope.acknowledgeUncertainty())
    // Read is an observation, never proof that an uncertain PUT committed.
    check(session.exactVersionedOwnListing(LISTING_ID)==
        SessionResult.Success(VersionedOwnListing(row,7)))
    readReplacesSession=true
    check(session.exactVersionedOwnListing(LISTING_ID)==
        SessionResult.Failed(SessionFailure.REPLACED))
    readReplacesSession=false
    readStartsWorkerWrite=true
    check(session.exactVersionedOwnListing(LISTING_ID)==
        SessionResult.Failed(SessionFailure.STALE_RESULT))
    readStartsWorkerWrite=false
    check(session.exactVersionedOwnListing(LISTING_ID)==
        SessionResult.Success(VersionedOwnListing(row,7)))
    check(runCatching {
        session.editListingCategoryVersioned(
            LISTING_ID,"plumber","carpenter",-1)
    }.isFailure)
    check(session.snapshot()==LoginState.SignedIn(WorkerState.DRAFT))
}

private fun testOwnerAccountPrivatePresentationFence() {
    val worker = FakeWorkers()
    val coordinator=InMemorySessionCoordinator(worker,
        RequestSender { error(503, "SERVICE_UNAVAILABLE") }) { 1_000L }
    val ownerSummary=OwnAccountOverview(
        "2026-11-04T00:00:00.000Z",false,null,0,0,0,1,false)
    val success=SessionResult.Success(ownerSummary)
    check(coordinator.accountPrivateReadMarker()==null)
    check(AccountPrivateSummary.confirmed(null,null,success)==null)
    check(coordinator.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    val ownerOne=coordinator.accountPrivateReadMarker()!!
    val bound=AccountPrivateSummary.confirmed(ownerOne,ownerOne,success)!!
    check(bound.forCurrent(ownerOne)==ownerSummary)
    check(bound.forCurrent(null)==null)
    check(!bound.toString().contains("2026-11-04"))
    check(AccountPrivateSummary.confirmed(ownerOne,null,success)==null)
    check(AccountPrivateSummary.confirmed(ownerOne,ownerOne,
        SessionResult.Failed(SessionFailure.REMOTE_FAILURE))==null)
    // Same public SignedIn shape, different owner: old data is not visible.
    check(coordinator.acceptIssuedSession(issued(TOKEN_TWO)) is ApiOutcome.Ok)
    val ownerTwo=coordinator.accountPrivateReadMarker()!!
    check(ownerTwo!=ownerOne)
    check(bound.forCurrent(ownerTwo)==null)
    check(AccountPrivateSummary.confirmed(ownerOne,ownerTwo,success)==null)
    // Worker writes invalidate an owner's previously observed facts.
    check(coordinator.checkWorker()==SessionResult.Success(WorkerState.NO_DRAFT))
    check(coordinator.optIn()==SessionResult.Success(WorkerState.DRAFT))
    val afterOptIn=coordinator.accountPrivateReadMarker()!!
    check(afterOptIn!=ownerTwo)
    check(bound.forCurrent(afterOptIn)==null)
    var sawBlockedDuringWrite=false
    worker.beforePosting={
        sawBlockedDuringWrite=true
        check(coordinator.accountPrivateReadMarker()==null)
        check(bound.forCurrent(coordinator.accountPrivateReadMarker())==null)
    }
    check(coordinator.publishExplicitCategory("plumber") is SessionResult.Success)
    check(sawBlockedDuringWrite)
    val afterPublish=coordinator.accountPrivateReadMarker()!!
    check(afterPublish!=afterOptIn)
    check(AccountPrivateSummary.confirmed(afterOptIn,afterPublish,success)==null)
    check(coordinator.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    check(coordinator.accountPrivateReadMarker()!=afterPublish)
}

/**
 * An uncertain invite or termination is never repeated implicitly. A user
 * retry retains Idempotency-Key; a failed end is reconciled with a fresh GET
 * under the current account marker instead of claiming the call ended.
 */
private fun testUncertainVoiceCallRecovery() {
    val invitationId = "22222222-2222-4222-8222-222222222222"
    val attemptKey = "original-call-attempt-123456"
    val deadline = 2_000_000_100_000L
    var dialPosts = 0
    var cancelPuts = 0
    var statusGets = 0
    var serverPhase = "ringing"
    val sender = RequestSender { request ->
        check(request.headers()["Authorization"] == "Bearer $TOKEN_ONE")
        when {
            request.resource.startsWith("/api/v1/me/call-invitation?") -> {
                check(request.method == HttpMethod.POST)
                check(request.headers()["Idempotency-Key"] == attemptKey)
                check(request.resource.contains("listingId=$LISTING_ID"))
                dialPosts++
                if (dialPosts == 1) {
                    // Pretend the server committed but its reply was lost.
                    error(503, "SERVICE_UNAVAILABLE")
                } else TransportReply(200,
                    """{"ok":true,"data":{"id":"$invitationId","ringDeadlineMs":$deadline}}""")
            }
            request.resource == "/api/v1/me/call?id=$invitationId&action=cancel" -> {
                check(request.method == HttpMethod.PUT)
                cancelPuts++
                serverPhase = "cancelled" // The response still gets lost.
                error(503, "SERVICE_UNAVAILABLE")
            }
            request.resource == "/api/v1/me/call?id=$invitationId" -> {
                check(request.method == HttpMethod.GET)
                statusGets++
                TransportReply(200,
                    """{"ok":true,"data":{"role":"caller","phase":"$serverPhase","ringDeadlineMs":$deadline}}""")
            }
            else -> error("Unexpected fake call: ${request.method}")
        }
    }
    val session = InMemorySessionCoordinator(FakeWorkers(), sender) { 0L }
    check(session.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    val before = session.accountPrivateReadMarker()!!
    check(session.startCall(before, LISTING_ID, attemptKey) ==
        SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.SERVICE_UNAVAILABLE))
    check(dialPosts == 1 && cancelPuts == 0 && statusGets == 0)
    val afterFirstAttempt = session.accountPrivateReadMarker()!!
    check(afterFirstAttempt != before)
    check(session.startCall(before, LISTING_ID, attemptKey) is SessionResult.Failed)
    check(dialPosts == 1) // Stale epoch never sends another invitation.
    check(session.startCall(afterFirstAttempt, LISTING_ID, attemptKey) ==
        SessionResult.Success(CallInvitation(invitationId, deadline)))
    check(dialPosts == 2) // Only explicit same-key retry.
    val afterDial = session.accountPrivateReadMarker()!!
    check(session.callSignal(afterDial, invitationId, CallAction.CANCEL) ==
        SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.SERVICE_UNAVAILABLE))
    check(cancelPuts == 1 && statusGets == 0)
    val afterCancel = session.accountPrivateReadMarker()!!
    val status = session.callSignal(afterCancel, invitationId)
    check(status is SessionResult.Success && status.value ==
        CallSignal(CallRole.CALLER, CallPhase.CANCELLED, deadline))
    check(CallEndProtocol.isConfirmed(CallRole.CALLER, status.value))
    check(statusGets == 1 && cancelPuts == 1)
}

fun main() {
    testUncertainVoiceCallRecovery()
    testOwnerAccountPrivatePresentationFence()
    testRevisionSnapshotAndSingleFlightCas()
    testExactSelectedServiceReadSessionIsolation()
    testOldProfileCannotUndoOptIn()
    testConcurrentMutationsRejected()
    testOwnerExportAndEpochIsolation()
    testStaleOwnListingsResponseRejected()
    testExceptionalSenderReleasesGate()
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
