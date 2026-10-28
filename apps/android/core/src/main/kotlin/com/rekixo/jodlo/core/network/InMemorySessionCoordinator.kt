package com.rekixo.jodlo.core.network

/** Nonvisual, session-free snapshot; NEVER expose a bearer or Google identity. */
enum class WorkerState { UNKNOWN, NO_DRAFT, DRAFT }
sealed class LoginState {
    object SignedOut : LoginState()
    data class SignedIn(val worker: WorkerState) : LoginState()
}

enum class SessionFailure { SIGNED_OUT, EXPIRED, REPLACED, OPT_IN_REQUIRED, REMOTE_FAILURE, OPERATION_IN_PROGRESS, STALE_RESULT, CANCELLED }
sealed class SessionResult<out T> {
    data class Success<T>(val value: T) : SessionResult<T>()
    data class Failed(
        val reason: SessionFailure,
        val networkKind: FailureKind? = null,
    ) : SessionResult<Nothing>()
}

/** In-memory session gate for an eventual Android app.
 *
 * Only a TRUSTED backend /auth/google HTTPS response may be passed to
 * acceptIssuedSession: parsing JSON does NOT independently authenticate Google
 * identity or the server TLS peer. There is NO Android SDK, UI or secret store.
 *
 * All mutable state is guarded by lock. Network callbacks run WITHOUT the
 * lock; their responses are ignored when a newer login/logout supersedes
 * the captured generation. A rejected late response does not reverse a
 * remote write that may already have committed: never automatically retry.
 *
 * System.nanoTime-derived elapsed milliseconds handles session lifetimes even
 * when the wall clock changes. Process death discards the session.
 * JVM Strings cannot be zeroized securely.
 */
class InMemorySessionCoordinator(
    private val workers: WorkerRepository,
    private val authSender: RequestSender,
    private val elapsedMillis: () -> Long = { System.nanoTime() / 1_000_000L },
) {
    private val lock = Any()
    private data class Active(
        val token: String,
        val expiresAt: Long,
        val version: Long,
        var worker: WorkerState = WorkerState.UNKNOWN,
        var workerRevision: Long = 0,
        var writeRevision: Long = 0,
        var mutationInFlight: Boolean = false,
    )
    private var active: Active? = null
    private var generation: Long = 0
    private var latestSignInAttempt: Long = 0
    // Process-local, non-secret public-data barrier. A write can affect public
    // Category availability/search/listings even when its reply is uncertain.
    // Keep the version across logout and replacement; an older write can finish
    // on the server after its original session was discarded.
    private var publicReadRevision: Long = 0
    private var writesOnWire: Int = 0
    private val googleBackend = BackendGoogleSessionExchange(authSender)

    private fun forget() {
        generation += 1
        active = null
    }

    private fun expired(value: Active): Boolean = elapsedMillis() >= value.expiresAt

    private fun readableActive(): Active? {
        val current = active ?: return null
        if (expired(current)) {
            forget()
            return null
        }
        return current
    }

    /** Internal non-secret epoch for invalidating account-scoped read snapshots.
     * Advances on replacement, logout, authorization failure and expiry.
     * Not a credential or a stable account identifier.
     */
    internal fun sessionEpoch(): Long = synchronized(lock) {
        readableActive()
        generation
    }

    /** Non-secret fingerprint: a private read may be stale after ANY worker
     * mutation begins, even if the POST/DELETE response is lost or cancelled.
     * Never expose an account ID or bearer via this fingerprint.
     */
    internal fun privateReadFingerprint(): Pair<Long, Long> = synchronized(lock) {
        readableActive()
        generation to (active?.writeRevision ?: 0L)
    }

    /** A non-secret marker shared with read-only Customer scopes in this process.
     * Both start and finish of each worker write invalidate previous public GET
     * responses, including a GET sent while a write was still in flight.
     * This is local invalidation, NOT push updates from unrelated devices.
     */
    internal data class PublicReadMarker(val revision: Long, val writeInFlight: Boolean)

    internal fun publicReadMarker(): PublicReadMarker = synchronized(lock) {
        PublicReadMarker(publicReadRevision, writesOnWire > 0)
    }

    /** Snapshot contains ONLY public account/worker state. */
    fun snapshot(): LoginState = synchronized(lock) {
        val session = readableActive()
        if (session == null) LoginState.SignedOut else LoginState.SignedIn(session.worker)
    }

    /** For tests and trusted pre-exchanged HTTPS replies only. It does NOT
     * verify the Google ID token or TLS. Invalid replies keep the old session.
     * Use signInWithGoogleIdToken for the complete fakeable backend round-trip.
     */
    fun acceptIssuedSession(reply: TransportReply): ApiOutcome<LoginState> {
        val parsed = JodloReplyDecoder.issuedSession(reply)
        if (parsed is ApiOutcome.Failed) return parsed
        return synchronized(lock) {
            installIssued((parsed as ApiOutcome.Ok).value)
        }
    }

    /** Caller supplies an ephemeral ID token from a future approved provider.
     * NO Google SDK/client ID/real OAuth integration is performed here.
     * One non-retrying request, made off the Android main thread.
     *
     * A newer login attempt wins even if it fails; older responses cannot
     * overwrite a newer session. Logout (including when already signed out)
     * cancels acceptance of all in-flight login acknowledgements locally.
     * This cannot undo a remote session issued by the backend.
     */
    fun signInWithGoogleIdToken(
        idToken: String,
        cancellation: CancellationSignal? = null,
    ): SessionResult<LoginState> {
        if (cancellation?.isCancelled == true)
            return SessionResult.Failed(SessionFailure.CANCELLED)
        // Validate BEFORE superseding any already-pending legitimate login.
        val request = JodloRoutes.googleExchange(idToken)
        val (attempt, startingGeneration) = synchronized(lock) {
            latestSignInAttempt += 1
            latestSignInAttempt to generation
        }
        if (cancellation?.isCancelled == true)
            return SessionResult.Failed(SessionFailure.CANCELLED)
        val reply = googleBackend.exchange(request)
        return synchronized(lock) {
            if (attempt != latestSignInAttempt || generation != startingGeneration)
                return@synchronized SessionResult.Failed(SessionFailure.REPLACED)
            if (cancellation?.isCancelled == true)
                return@synchronized SessionResult.Failed(SessionFailure.CANCELLED)
            when (reply) {
                is ApiOutcome.Ok -> when (val installed = installIssued(reply.value)) {
                    is ApiOutcome.Ok -> SessionResult.Success(installed.value)
                    is ApiOutcome.Failed ->
                        SessionResult.Failed(SessionFailure.REMOTE_FAILURE, installed.kind)
                }
                is ApiOutcome.Failed ->
                    SessionResult.Failed(SessionFailure.REMOTE_FAILURE, reply.kind)
            }
        }
    }

    /** Called only with lock held, never returns the opaque bearer. */
    private fun installIssued(issued: IssuedSession): ApiOutcome<LoginState> {
        val now = elapsedMillis()
        val lifetime = issued.expiresInSeconds.toLong() * 1_000
        if (now > Long.MAX_VALUE - lifetime)
            return ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)
        forget()
        active = Active(issued.accessToken, now + lifetime, generation)
        return ApiOutcome.Ok(LoginState.SignedIn(WorkerState.UNKNOWN))
    }

    private data class Lease(val token: String, val version: Long, val workerRevision: Long)

    /** Reserve one write while holding the session lock. No queue or replay. */
    private fun lease(
        needsWorker: Boolean,
        mutation: Boolean,
        consistentRead: Boolean,
    ): Pair<Lease?, SessionFailure> = synchronized(lock) {
        val current = active ?: return@synchronized null to SessionFailure.SIGNED_OUT
        if (expired(current)) {
            forget()
            return@synchronized null to SessionFailure.EXPIRED
        }
        if ((mutation || consistentRead) && current.mutationInFlight)
            return@synchronized null to SessionFailure.OPERATION_IN_PROGRESS
        if (needsWorker && current.worker != WorkerState.DRAFT)
            return@synchronized null to SessionFailure.OPT_IN_REQUIRED
        if (mutation) {
            current.mutationInFlight = true
            current.writeRevision += 1
            publicReadRevision += 1
            writesOnWire += 1
            // A read begun before this worker write must not apply afterwards.
            current.workerRevision += 1
        }
        Lease(current.token, current.version, current.workerRevision) to SessionFailure.SIGNED_OUT
    }

    /** Single blocking attempt outside the lock. A failed/late POST may still
     * have committed on the server; never automatically retry it.
     */
    private fun <T, R> withSession(
        call: (String) -> ApiOutcome<T>,
        update: (ApiOutcome<T>, Active) -> SessionResult<R>,
        needsWorker: Boolean = false,
        mutation: Boolean = false,
        consistentRead: Boolean = false,
        cancellation: CancellationSignal? = null,
    ): SessionResult<R> {
        if (cancellation?.isCancelled == true)
            return SessionResult.Failed(SessionFailure.CANCELLED)
        val (captured, absent) = lease(needsWorker, mutation, consistentRead)
        if (captured == null) return SessionResult.Failed(absent)
        try {
            if (cancellation?.isCancelled == true)
                return SessionResult.Failed(SessionFailure.CANCELLED)
            val reply = call(captured.token)
            return synchronized(lock) {
                val current = active
                if (current == null || current.version != captured.version)
                    return@synchronized SessionResult.Failed(SessionFailure.REPLACED)
                if (expired(current)) {
                    forget()
                    return@synchronized SessionResult.Failed(SessionFailure.EXPIRED)
                }
                if (reply is ApiOutcome.Failed && reply.kind == FailureKind.UNAUTHORIZED) {
                    forget()
                    return@synchronized SessionResult.Failed(
                        SessionFailure.REMOTE_FAILURE, FailureKind.UNAUTHORIZED)
                }
                if (cancellation?.isCancelled == true)
                    return@synchronized SessionResult.Failed(SessionFailure.CANCELLED)
                if (consistentRead && current.workerRevision != captured.workerRevision)
                    return@synchronized SessionResult.Failed(SessionFailure.STALE_RESULT)
                update(reply, current)
            }
        } finally {
            // Clean up even when an injected adapter throws. Do not touch any
            // newer login which replaced this session while the call ran.
            if (mutation) synchronized(lock) {
                // Runs after success, failure, cancellation or unexpected fake
                // transport exception. The response might still have committed.
                writesOnWire -= 1
                publicReadRevision += 1
                active?.takeIf { it.version == captured.version }?.mutationInFlight = false
            }
        }
    }

    private fun <T> outcome(result: ApiOutcome<T>): SessionResult<T> = when (result) {
        is ApiOutcome.Ok -> SessionResult.Success(result.value)
        is ApiOutcome.Failed -> SessionResult.Failed(SessionFailure.REMOTE_FAILURE, result.kind)
    }

    /** A 404 means a valid account has not opted in yet, not an error state.
     * Network errors never grant or revoke worker status.
     */
    fun checkWorker(cancellation: CancellationSignal? = null): SessionResult<WorkerState> = withSession(
        call = { workers.myDraft(it) },
        cancellation = cancellation,
        consistentRead = true,
        update = { reply, current ->
            when (reply) {
                is ApiOutcome.Ok -> {
                    current.worker = WorkerState.DRAFT
                    current.workerRevision += 1
                    SessionResult.Success(WorkerState.DRAFT)
                }
                is ApiOutcome.Failed -> {
                    if (reply.kind == FailureKind.NOT_FOUND) {
                        current.worker = WorkerState.NO_DRAFT
                        current.workerRevision += 1
                        SessionResult.Success(WorkerState.NO_DRAFT)
                    } else SessionResult.Failed(SessionFailure.REMOTE_FAILURE, reply.kind)
                }
            }
        }
    )

    fun optIn(cancellation: CancellationSignal? = null): SessionResult<WorkerState> = withSession(
        call = { workers.optIn(it) },
        cancellation = cancellation,
        mutation = true,
        update = { reply, current ->
            when (reply) {
                is ApiOutcome.Ok -> {
                    current.worker = WorkerState.DRAFT
                    current.workerRevision += 1
                    SessionResult.Success(WorkerState.DRAFT)
                }
                is ApiOutcome.Failed -> SessionResult.Failed(SessionFailure.REMOTE_FAILURE, reply.kind)
            }
        }
    )

    fun myListings(cancellation: CancellationSignal? = null): SessionResult<List<OwnListing>> = withSession(
        call = { workers.myListings(it) },
        cancellation = cancellation,
        consistentRead = true,
        update = { reply, _ -> outcome(reply) }
    )

    /** The Category ID must have been explicitly confirmed outside this
     * layer. Server-side active-Category and worker checks remain authoritative.
     */
    fun publishExplicitCategory(
        confirmedCategoryId: String,
        cancellation: CancellationSignal? = null,
    ): SessionResult<PublicListing> =
        withSession(
            call = { workers.publishExplicitCategory(it, confirmedCategoryId) },
            cancellation = cancellation,
            update = { reply, _ -> outcome(reply) },
            needsWorker = true,
            mutation = true,
        )

    fun unpublish(listingId: String, cancellation: CancellationSignal? = null): SessionResult<Boolean> =
        withSession(
            call = { workers.unpublish(it, listingId) },
            cancellation = cancellation,
            update = { reply, _ -> outcome(reply) },
            needsWorker = true,
            mutation = true,
        )

    /** Drop local credentials synchronously BEFORE attempting remote revoke.
     * On offline/error the remote server may still accept the old token until
     * expiry: report uncertainty; never claim server logout succeeded.
     */
    fun logout(allDevices: Boolean = false): SessionResult<Boolean> {
        val (captured, missing) = synchronized(lock) {
            // Even a signed-out logout invalidates pending backend login replies.
            latestSignInAttempt += 1
            val current = active ?: return@synchronized null to SessionFailure.SIGNED_OUT
            val expired = expired(current)
            val lease = Lease(current.token, current.version, current.workerRevision)
            forget()
            if (expired) null to SessionFailure.EXPIRED
            else lease to SessionFailure.SIGNED_OUT
        }
        if (captured == null) return SessionResult.Failed(missing)
        val call = JodloRoutes.logout(captured.token, allDevices)
        val reply = performOnce(call, authSender::send) {
            JodloReplyDecoder.revoked(it, allDevices)
        }
        return outcome(reply)
    }
}
