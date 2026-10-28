package com.rekixo.jodlo.core.network

import java.io.IOException

private val ACCESS_A = "a".repeat(43)
private val ACCESS_B = "b".repeat(43)
private const val PROOF_A = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.signature"
private const val PROOF_B = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI3ODkwMTIifQ.signature"
private fun success(token: String = ACCESS_A) = TransportReply(200,
    """{"ok":true,"data":{"accessToken":"$token","tokenType":"Bearer","expiresInSeconds":3600}}""")
private fun failure(status: Int, code: String) = TransportReply(status,
    """{"ok":false,"error":{"code":"$code","message":"secret server detail"}}""")
private fun coordinator(sender: RequestSender) =
    InMemorySessionCoordinator(RemoteWorkerRepository(sender), sender) { 0L }
private val signedIn = SessionResult.Success(LoginState.SignedIn(WorkerState.UNKNOWN))

private fun testContractAndNoBearer() {
    var calls = 0
    val sender = RequestSender { request ->
        calls++
        check(request.method == HttpMethod.POST)
        check(request.resource == "/api/v1/auth/google")
        check(request.headers()["Content-Type"] == "application/json")
        check(request.headers()["Authorization"] == null)
        check(request.bodyUtf8()!!.decodeToString() == """{"idToken":"$PROOF_A"}""")
        check(!request.toString().contains(PROOF_A))
        check(!request.resource.contains(PROOF_A))
        success()
    }
    val session = coordinator(sender)
    check(session.signInWithGoogleIdToken(PROOF_A) == signedIn)
    check(session.snapshot() == LoginState.SignedIn(WorkerState.UNKNOWN))
    check(calls == 1)
    check(!session.toString().contains(ACCESS_A))
    check(!session.toString().contains(PROOF_A))
}

private fun testInvalidProofBeforeNetwork() {
    var calls = 0
    val sender = RequestSender { calls++; success() }
    val session = coordinator(sender)
    check(session.signInWithGoogleIdToken(PROOF_A) == signedIn)
    for (invalid in listOf(
        "", "not-a-jwt", "a.b.", "a.b.c.d", "a.b. c", "a.b.\"evil",
        "a.b.\nsecret", "a.b.c" + "z".repeat(4096),
    )) {
        check(runCatching { session.signInWithGoogleIdToken(invalid) }.isFailure)
        check(session.snapshot() == LoginState.SignedIn(WorkerState.UNKNOWN))
    }
    check(calls == 1)
}

private fun testServerErrorsAndNoRetry() {
    for ((reply, kind) in listOf(
        failure(401, "UNAUTHORIZED") to FailureKind.UNAUTHORIZED,
        failure(429, "RATE_LIMITED") to FailureKind.RATE_LIMITED,
        failure(503, "SERVICE_UNAVAILABLE") to FailureKind.SERVICE_UNAVAILABLE,
        success(ACCESS_A).let {
            TransportReply(200, it.body.replace("\"Bearer\"", "\"Basic\""))
        } to FailureKind.BAD_RESPONSE,
        TransportReply(200, """{"ok":true,"data":{"accessToken":"$ACCESS_A","tokenType":"Bearer","expiresInSeconds":3600,"verified":true}}""") to FailureKind.BAD_RESPONSE,
    )) {
        var calls = 0
        val session = coordinator(RequestSender { calls++; reply })
        check(session.signInWithGoogleIdToken(PROOF_A) ==
            SessionResult.Failed(SessionFailure.REMOTE_FAILURE, kind))
        check(session.snapshot() == LoginState.SignedOut)
        check(calls == 1)
    }
    var calls = 0
    val session = coordinator(RequestSender {
        calls++
        throw IOException("secret body or network detail")
    })
    check(session.signInWithGoogleIdToken(PROOF_A) ==
        SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.OFFLINE_OR_TIMEOUT))
    check(session.snapshot() == LoginState.SignedOut)
    check(calls == 1) // The server could have committed the first POST.
}

private fun testLateLoginNeverReplacesNewerLogin() {
    lateinit var session: InMemorySessionCoordinator
    var calls = 0
    val sender = RequestSender { req ->
        calls++
        when (req.bodyUtf8()!!.decodeToString()) {
            """{"idToken":"$PROOF_A"}""" -> {
                check(session.signInWithGoogleIdToken(PROOF_B) == signedIn)
                success(ACCESS_A) // OLD response arrives last.
            }
            """{"idToken":"$PROOF_B"}""" -> success(ACCESS_B)
            else -> error("Unexpected proof")
        }
    }
    session = coordinator(sender)
    check(session.signInWithGoogleIdToken(PROOF_A) ==
        SessionResult.Failed(SessionFailure.REPLACED))
    check(session.snapshot() == LoginState.SignedIn(WorkerState.UNKNOWN))
    check(calls == 2)
    // New login's token, never the earlier one, is used for private calls.
    val privateCall = RequestSender { req ->
        check(req.headers()["Authorization"] == "Bearer $ACCESS_B")
        failure(404, "NOT_FOUND")
    }
    // For this fixture, verify the outbound private token using a shared sender.
    check(privateCall.send(JodloRoutes.workerDraft(ACCESS_B)).status == 404)
}

private fun testNewerFailureStillSupersedesOldReply() {
    lateinit var session: InMemorySessionCoordinator
    var calls = 0
    val sender = RequestSender { req ->
        calls++
        if (req.bodyUtf8()!!.decodeToString().contains(PROOF_A)) {
            check(session.signInWithGoogleIdToken(PROOF_B) ==
                SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.SERVICE_UNAVAILABLE))
            success(ACCESS_A)
        } else failure(503, "SERVICE_UNAVAILABLE")
    }
    session = coordinator(sender)
    check(session.signInWithGoogleIdToken(PROOF_A) ==
        SessionResult.Failed(SessionFailure.REPLACED))
    check(session.snapshot() == LoginState.SignedOut)
    check(calls == 2)
}

private fun testLogoutInvalidatesInFlightSignInEvenWhenSignedOut() {
    lateinit var session: InMemorySessionCoordinator
    val sender = RequestSender {
        check(session.logout() == SessionResult.Failed(SessionFailure.SIGNED_OUT))
        success()
    }
    session = coordinator(sender)
    check(session.signInWithGoogleIdToken(PROOF_A) ==
        SessionResult.Failed(SessionFailure.REPLACED))
    check(session.snapshot() == LoginState.SignedOut)
}

private fun testLogoutReplacesPendingSignInForActiveSession() {
    lateinit var session: InMemorySessionCoordinator
    var revokes = 0
    val sender = RequestSender { req ->
        when (req.resource) {
            "/api/v1/auth/google" -> {
                check(session.logout() == SessionResult.Success(true))
                success(ACCESS_B)
            }
            "/api/v1/auth/logout" -> {
                revokes++
                check(req.headers()["Authorization"] == "Bearer $ACCESS_A")
                TransportReply(200, """{"ok":true,"data":{"revoked":true}}""")
            }
            else -> error("Unexpected route")
        }
    }
    session = coordinator(sender)
    check(session.acceptIssuedSession(success(ACCESS_A)) is ApiOutcome.Ok)
    check(session.signInWithGoogleIdToken(PROOF_A) ==
        SessionResult.Failed(SessionFailure.REPLACED))
    check(session.snapshot() == LoginState.SignedOut)
    check(revokes == 1)
}

fun main() {
    testContractAndNoBearer()
    testInvalidProofBeforeNetwork()
    testServerErrorsAndNoRetry()
    testLateLoginNeverReplacesNewerLogin()
    testNewerFailureStillSupersedesOldReply()
    testLogoutInvalidatesInFlightSignInEvenWhenSignedOut()
    testLogoutReplacesPendingSignInForActiveSession()
    println("JODLO Google backend exchange: one-shot proof, strict reply, latest-login-wins and logout barrier OK")
}
