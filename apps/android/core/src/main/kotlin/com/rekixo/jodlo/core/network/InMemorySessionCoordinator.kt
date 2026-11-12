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

    /** Non-secret optional contract capability, not an authorization check.
     * Legacy WorkerRepository fakes cannot run the paged diagnostic, so a
     * headless Dashboard should not advertise its action hint to them.
     */
    internal fun supportsOwnerListingPages(): Boolean =
        workers is OwnListingPageRepository

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

    /** Temporary non-secret marker for a user-selected Android data-export
     * picker. A late document selection must not save bytes from a previously
     * logged-out/replaced account. No token or stable account ID leaves Core.
     */
    fun accountExportSessionMarker(): Long? = synchronized(lock) {
        readableActive()?.let { generation }
    }

    /** Private Account presentation/export fence. An attempted Worker write
     * changes writeRevision even if the reply is lost or cancelled. Return
     * nothing while an authenticated mutation is in flight. No secret or ID.
     */
    fun accountPrivateReadMarker(): AccountPrivateReadMarker? = synchronized(lock) {
        val owner = readableActive() ?: return@synchronized null
        if (owner.mutationInFlight) null
        else AccountPrivateReadMarker(generation, owner.writeRevision)
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
        expectedOwner: AccountPrivateReadMarker?,
    ): Pair<Lease?, SessionFailure> = synchronized(lock) {
        val current = active ?: return@synchronized null to SessionFailure.SIGNED_OUT
        if (expired(current)) {
            forget()
            return@synchronized null to SessionFailure.EXPIRED
        }
        if ((mutation || consistentRead) && current.mutationInFlight)
            return@synchronized null to SessionFailure.OPERATION_IN_PROGRESS
        if (expectedOwner != null &&
            expectedOwner != AccountPrivateReadMarker(generation, current.writeRevision))
            return@synchronized null to SessionFailure.STALE_RESULT
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
        expectedOwner: AccountPrivateReadMarker? = null,
    ): SessionResult<R> {
        if (cancellation?.isCancelled == true)
            return SessionResult.Failed(SessionFailure.CANCELLED)
        val (captured, absent) = lease(needsWorker, mutation, consistentRead, expectedOwner)
        if (captured == null) {
            return if (expectedOwner != null && absent == SessionFailure.STALE_RESULT)
                SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.CONFLICT)
            else SessionResult.Failed(absent)
        }
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

    fun ownServicePhoto(
        owner: AccountPrivateReadMarker, listingId: String, download: Boolean = false,
    ): SessionResult<OwnServicePhoto> = withSession(
        call = { token -> performOnce(JodloRoutes.ownServicePhoto(token, listingId, download),
            authSender::send, JodloReplyDecoder::ownServicePhoto) },
        update = { reply, _ -> outcome(reply) },
        needsWorker = true, consistentRead = true, expectedOwner = owner,
    )

    fun changeServicePhoto(
        owner: AccountPrivateReadMarker, listingId: String, revision: Long, jpeg: String?,
    ): SessionResult<OwnServicePhoto> = withSession(
        call = { token -> performOnce(JodloRoutes.changeServicePhoto(token, listingId, revision, jpeg),
            authSender::send, JodloReplyDecoder::ownServicePhoto) },
        update = { reply, _ ->
            val expected = if (jpeg == null) ServicePhotoStatus.CLEARED else ServicePhotoStatus.PENDING
            if (reply is ApiOutcome.Ok && (reply.value.revision != revision + 1 || reply.value.status != expected))
                SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.BAD_RESPONSE)
            else outcome(reply)
        },
        needsWorker = true, mutation = true, expectedOwner = owner,
    )

    fun ownServiceDetails(owner: AccountPrivateReadMarker, listingId: String): SessionResult<OwnServiceDetails> =
        withSession(
            call = { token -> performOnce(JodloRoutes.ownServiceDetails(token, listingId),
                authSender::send, JodloReplyDecoder::ownServiceDetails) },
            update = { reply, _ -> outcome(reply) },
            needsWorker = true, consistentRead = true, expectedOwner = owner,
        )

    fun changeServiceDetails(
        owner: AccountPrivateReadMarker, listingId: String, revision: Long, profile: ServiceProfile?,
    ): SessionResult<OwnServiceDetails> = withSession(
        call = { token -> performOnce(JodloRoutes.changeServiceDetails(token, listingId, revision, profile),
            authSender::send, JodloReplyDecoder::ownServiceDetails) },
        update = { reply, _ ->
            if (reply is ApiOutcome.Ok && (reply.value.revision != revision + 1 ||
                (profile == null && reply.value.profile != null) ||
                (profile != null && reply.value.status != ServiceProfileStatus.PENDING)))
                SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.BAD_RESPONSE)
            else outcome(reply)
        },
        needsWorker = true, mutation = true, expectedOwner = owner,
    )

    fun ownServiceArea(owner: AccountPrivateReadMarker, listingId: String): SessionResult<OwnServiceArea> =
        withSession(
            call = { token -> performOnce(JodloRoutes.ownServiceArea(token, listingId),
                authSender::send, JodloReplyDecoder::ownServiceArea) },
            update = { reply, _ -> outcome(reply) },
            needsWorker = true, consistentRead = true, expectedOwner = owner,
        )

    fun changeServiceArea(
        owner: AccountPrivateReadMarker, listingId: String, city: NearbyPilotCity?, revision: Long,
    ): SessionResult<OwnServiceArea> = withSession(
        call = { token -> performOnce(JodloRoutes.changeServiceArea(token, listingId, city, revision),
            authSender::send, JodloReplyDecoder::ownServiceArea) },
        update = { reply, _ ->
            if (reply is ApiOutcome.Ok && (reply.value.city != city || reply.value.revision != revision + 1))
                SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.BAD_RESPONSE)
            else outcome(reply)
        },
        needsWorker = true, mutation = true, expectedOwner = owner,
    )

    fun serviceReport(
        owner: AccountPrivateReadMarker, listingId: String, reason: ServiceReportReason? = null,
    ): SessionResult<Boolean> = withSession(
        call = { token -> performOnce(JodloRoutes.serviceReport(token, listingId, reason),
            authSender::send, JodloReplyDecoder::serviceReport) },
        update = { reply, _ ->
            if (reason != null && reply is ApiOutcome.Ok && !reply.value)
                SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.BAD_RESPONSE)
            else outcome(reply)
        },
        consistentRead = reason == null, mutation = reason != null, expectedOwner = owner,
    )

    fun ownServiceAppealCase(owner: AccountPrivateReadMarker, listingId: String): SessionResult<OwnServiceCase?> =
        withSession(
            call = { token -> performOnce(JodloRoutes.serviceAppealCase(token, listingId),
                authSender::send, JodloReplyDecoder::serviceAppealCase) },
            update = { reply, _ -> outcome(reply) },
            needsWorker = true, consistentRead = true, expectedOwner = owner,
        )

    fun appealServiceCase(
        owner: AccountPrivateReadMarker, case: OwnServiceCase, reason: ServiceAppealReason,
    ): SessionResult<OwnServiceCase?> = withSession(
        call = { token -> performOnce(JodloRoutes.appealServiceCase(token, case.id, case.revision, reason),
            authSender::send, JodloReplyDecoder::serviceAppealCase) },
        update = { reply, _ ->
            val updated = if (reply is ApiOutcome.Ok) reply.value else null
            if (reply is ApiOutcome.Ok && (updated == null || updated.id != case.id ||
                updated.revision != case.revision + 1 || updated.status != ServiceCaseStatus.APPEALED))
                SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.BAD_RESPONSE)
            else outcome(reply)
        },
        needsWorker = true, mutation = true, expectedOwner = owner,
    )

    fun contactBlock(
        owner: AccountPrivateReadMarker, listingId: String,
    ): SessionResult<Boolean> = withSession(
        call = { token ->
            performOnce(JodloRoutes.contactBlock(token, listingId), authSender::send,
                JodloReplyDecoder::contactBlock)
        },
        update = { reply, _ -> outcome(reply) },
        consistentRead = true, expectedOwner = owner,
    )

    fun changeContactBlock(
        owner: AccountPrivateReadMarker, listingId: String, blocked: Boolean,
    ): SessionResult<Boolean> = withSession(
        call = { token ->
            performOnce(JodloRoutes.changeContactBlock(token, listingId, blocked), authSender::send,
                JodloReplyDecoder::contactBlock)
        },
        update = { reply, _ ->
            if (reply is ApiOutcome.Ok && reply.value != blocked)
                SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.BAD_RESPONSE)
            else outcome(reply)
        },
        mutation = true, expectedOwner = owner,
    )

    fun contactBlocks(
        owner: AccountPrivateReadMarker, language: Language, after: String?,
    ): SessionResult<OwnContactBlocks> = withSession(
        call = { token -> performOnce(JodloRoutes.contactBlocks(token, language, after),
            authSender::send, JodloReplyDecoder::contactBlocks) },
        update = { reply, _ ->
            if (reply is ApiOutcome.Ok && after != null && reply.value.items.any { it.id <= after })
                SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.BAD_RESPONSE)
            else outcome(reply)
        },
        consistentRead = true, expectedOwner = owner,
    )

    fun removeContactBlock(owner: AccountPrivateReadMarker, id: String): SessionResult<Boolean> = withSession(
        call = { token -> performOnce(JodloRoutes.removeContactBlock(token, id),
            authSender::send, JodloReplyDecoder::contactBlock) },
        update = { reply, _ ->
            if (reply is ApiOutcome.Ok && reply.value)
                SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.BAD_RESPONSE)
            else outcome(reply)
        },
        mutation = true, expectedOwner = owner,
    )

    fun prepareAccountErasure(owner: AccountPrivateReadMarker): SessionResult<AccountErasureChallenge> =
        withSession(
            call = { token ->
                performOnce(JodloRoutes.prepareAccountErasure(token), authSender::send,
                    JodloReplyDecoder::accountErasureChallenge)
            },
            update = { reply, _ -> outcome(reply) },
            consistentRead = true, expectedOwner = owner,
        )

    fun eraseAccount(
        owner: AccountPrivateReadMarker, challenge: AccountErasureChallenge, googleProof: String,
    ): SessionResult<Boolean> = withSession(
        call = { token ->
            performOnce(JodloRoutes.eraseAccount(token, challenge.challenge, googleProof),
                authSender::send, JodloReplyDecoder::accountErased)
        },
        update = { reply, _ ->
            if (reply is ApiOutcome.Ok) forget()
            outcome(reply)
        },
        mutation = true, expectedOwner = owner,
    )

    /** Current session and private read epoch guard an account overview.
     * A response overtaken by logout, account replacement or a Worker write
     * cannot be accepted in the UI.
     */
    /** Manual, read-only diagnostic of the current session's FCM device row.
     * This cannot prove Android delivery, FCM transport or receiver presence.
     */
    fun ownCallDevice(owner: AccountPrivateReadMarker): SessionResult<Boolean> =
        withSession(
            call = { token -> performOnce(JodloRoutes.ownCallDevice(token), authSender::send,
                JodloReplyDecoder::callDevice) },
            update = { reply, _ -> outcome(reply) },
            consistentRead = true, expectedOwner = owner,
        )

    fun setCallDevice(owner: AccountPrivateReadMarker, registrationToken: String?): SessionResult<Boolean> =
        withSession(
            call = { token -> performOnce(JodloRoutes.callDevice(token, registrationToken), authSender::send,
                JodloReplyDecoder::callDevice) },
            update = { reply, _ -> outcome(reply) },
            mutation = true, expectedOwner = owner,
        )

    fun startCall(owner: AccountPrivateReadMarker, listingId: String, attemptKey: String): SessionResult<CallInvitation> =
        withSession(
            call = { token -> performOnce(JodloRoutes.startCall(token, listingId, attemptKey), authSender::send,
                JodloReplyDecoder::callInvitation) },
            update = { reply, _ -> outcome(reply) },
            mutation = true, expectedOwner = owner,
        )

    fun callHistory(owner: AccountPrivateReadMarker, after: String? = null): SessionResult<CallHistoryPage> =
        withSession(
            call = { token -> performOnce(JodloRoutes.callHistory(token, after), authSender::send,
                JodloReplyDecoder::callHistory) },
            update = { reply, _ -> outcome(reply) },
            consistentRead = true, expectedOwner = owner,
        )

    /** One deliberate, owner-bound deletion. A lost reply is uncertain:
     * NEVER automatically retry; user may explicitly refresh their history.
     * Current account/write revision changes fence stale in-flight reads.
     */
    fun clearCallHistory(owner: AccountPrivateReadMarker): SessionResult<Boolean> =
        withSession(
            call = { token -> performOnce(JodloRoutes.clearCallHistory(token), authSender::send,
                JodloReplyDecoder::callHistoryCleared) },
            update = { reply, _ -> outcome(reply) },
            mutation = true, expectedOwner = owner,
        )

    fun callAudioGrant(owner: AccountPrivateReadMarker, id: String): SessionResult<CallAudioGrant> =
        withSession(
            call = { token -> performOnce(JodloRoutes.callAudioGrant(token, id), authSender::send) {
                JodloReplyDecoder.callAudioGrant(it, id)
            } },
            update = { reply, _ -> outcome(reply) },
            consistentRead = true, expectedOwner = owner,
        )

    fun callSignal(owner: AccountPrivateReadMarker, id: String, action: CallAction? = null): SessionResult<CallSignal> =
        withSession(
            call = { token -> performOnce(JodloRoutes.callSignal(token, id, action), authSender::send,
                JodloReplyDecoder::callSignal) },
            update = { reply, _ -> outcome(reply) },
            mutation = action != null, consistentRead = action == null, expectedOwner = owner,
        )

    fun callPreference(owner: AccountPrivateReadMarker, availability: Boolean = false): SessionResult<OwnCallPreference> = withSession(
        call = { token -> performOnce(JodloRoutes.callPreference(token, availability), authSender::send,
            JodloReplyDecoder::callPreference) },
        update = { reply, _ -> outcome(reply) },
        consistentRead = true, expectedOwner = owner,
    )

    fun changeCallPreference(
        owner: AccountPrivateReadMarker, preference: OwnCallPreference, availability: Boolean = false,
    ): SessionResult<OwnCallPreference> = withSession(
        call = { token -> performOnce(
            JodloRoutes.changeCallPreference(token, !preference.enabled, preference.revision, availability),
            authSender::send, JodloReplyDecoder::callPreference) },
        update = { reply, _ ->
            if (reply is ApiOutcome.Ok &&
                (reply.value.enabled == preference.enabled || reply.value.revision != preference.revision + 1))
                SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.BAD_RESPONSE)
            else outcome(reply)
        },
        mutation = true, expectedOwner = owner,
    )

    fun accountOverview(
        cancellation: CancellationSignal? = null,
    ): SessionResult<OwnAccountOverview> = withSession(
        call = { token ->
            performOnce(JodloRoutes.accountOverview(token), authSender::send,
                JodloReplyDecoder::accountOverview)
        },
        consistentRead = true,
        cancellation = cancellation,
        update = { reply, _ -> outcome(reply) },
    )

    fun myListings(cancellation: CancellationSignal? = null): SessionResult<List<OwnListing>> = withSession(
        call = { workers.myListings(it) },
        cancellation = cancellation,
        consistentRead = true,
        update = { reply, _ -> outcome(reply) }
    )

    /** Private owner data export, requested only from Account UI. The token
     * stays inside Core; the returned byte-bounded JSON never enters logs or
     * Android saved-state. Session replacement, expiry and concurrent Worker
     * mutation invalidate a late read through the existing withSession gate.
     */
    fun accountDataExport(
        cancellation: CancellationSignal? = null, version: Int = 1,
    ): SessionResult<OwnAccountDataExport> = withSession(
        call = { token ->
            var requested = version
            var result = performOnce(JodloRoutes.accountDataExport(token, requested), authSender::send,
                JodloReplyDecoder::accountDataExport)
            while (requested > 1 && result is ApiOutcome.Failed && result.kind == FailureKind.BAD_INPUT) {
                requested--
                result = performOnce(JodloRoutes.accountDataExport(token, requested), authSender::send,
                    JodloReplyDecoder::accountDataExport)
            }
            result
        },
        consistentRead = true,
        cancellation = cancellation,
        update = { reply, _ -> outcome(reply) },
    )

    /** Optional PRIVATE listing pagination behind the existing session gate.
     * The old WorkerRepository contract remains unchanged; only workers with
     * the opt-in paging interface can read this route. No bearer escapes.
     * Concurrent local worker writes block this read; a result overtaken by
     * logout, replacement, expiry or a write cannot be accepted.
     */
    fun pageMyListings(
        limit: Int = 20, after: String? = null,
        cancellation: CancellationSignal? = null,
    ): SessionResult<OwnListingPage> {
        require(limit in 1..25) { "Invalid private page size" }
        if (after != null) JodloRoutes.requireListingId(after)
        val pages = workers as? OwnListingPageRepository
            ?: return SessionResult.Failed(
                SessionFailure.REMOTE_FAILURE, FailureKind.SERVICE_UNAVAILABLE,
            )
        return withSession(
            call = { pages.pageMyListings(it, limit, after) },
            update = { reply, _ -> outcome(reply) },
            consistentRead = true,
            cancellation = cancellation,
        )
    }

    /** PRIVATE management read, independently opted into the repository and
     * protected by the same active session epoch/write fence as owner paging.
     * Old fake WorkerRepository implementations remain compatible.
     */
    fun pageManagedOwnListings(
        limit: Int = 20, after: String? = null,
        cancellation: CancellationSignal? = null,
    ): SessionResult<OwnListingPage> {
        require(limit in 1..25) { "Invalid managed owner page size" }
        if (after != null) JodloRoutes.requireListingId(after)
        val pages = workers as? ManagedOwnListingPageRepository
            ?: return SessionResult.Failed(
                SessionFailure.REMOTE_FAILURE, FailureKind.SERVICE_UNAVAILABLE,
            )
        return withSession(
            call = { pages.managedOwnListingPage(it, limit, after) },
            update = { reply, _ -> outcome(reply) },
            consistentRead = true,
            cancellation = cancellation,
        )
    }

    /** One explicit, current, authenticated owner Service GET.
     * Current-session and Worker write generation fence both the reply and
     * any future edit review. 404 is generic absence, never verification
     * that a prior uncertain write did or did not commit.
     */
    fun exactManagedOwnListing(
        listingId: String, cancellation: CancellationSignal? = null,
    ): SessionResult<OwnListing> {
        JodloRoutes.requireListingId(listingId)
        val exact = workers as? ExactManagedOwnListingRepository
            ?: return SessionResult.Failed(
                SessionFailure.REMOTE_FAILURE, FailureKind.SERVICE_UNAVAILABLE)
        return withSession(
            call = { exact.exactManagedOwnListing(it, listingId) },
            update = { reply, _ -> outcome(reply) },
            consistentRead = true,
            cancellation = cancellation,
        )
    }

    /** One private, fresh, exact owner revision read. The session and
     * worker mutation epoch reject replaced/logout/late snapshots. No old
     * API fallback, no revision generated by the client, no automatic reads.
     */
    fun exactVersionedOwnListing(
        listingId: String, cancellation: CancellationSignal? = null,
    ): SessionResult<VersionedOwnListing> {
        JodloRoutes.requireListingId(listingId)
        val versioned=workers as? VersionedOwnListingRepository
            ?: return SessionResult.Failed(
                SessionFailure.REMOTE_FAILURE, FailureKind.SERVICE_UNAVAILABLE)
        return withSession(
            call={versioned.exactVersionedOwnListing(it, listingId)},
            update={reply, _ -> outcome(reply)},
            consistentRead=true,cancellation=cancellation)
    }

    /** Revision is from the same-session exact snapshot. Server checks it in
     * ONE atomic UPDATE; a stale/ABA/foreign ID gets an ordinary conflict.
     */
    fun editListingCategoryVersioned(
        listingId:String,expectedCategoryId:String,nextCategoryId:String,
        expectedRevision:Long,cancellation:CancellationSignal?=null,
        expectedOwner: AccountPrivateReadMarker? = null,
    ): SessionResult<VersionedCategoryEditReceipt> {
        JodloRoutes.requireListingId(listingId)
        JodloRoutes.requireCategoryId(expectedCategoryId)
        JodloRoutes.requireCategoryId(nextCategoryId)
        require(expectedRevision in 0..2147483646L)
        val versioned=workers as? VersionedOwnListingRepository
            ?: return SessionResult.Failed(
                SessionFailure.REMOTE_FAILURE, FailureKind.SERVICE_UNAVAILABLE)
        return withSession(
            call={versioned.editCategoryVersioned(it,listingId,
                expectedCategoryId,nextCategoryId,expectedRevision)},
            update={reply, _ -> outcome(reply)},
            needsWorker=true,mutation=true,cancellation=cancellation,expectedOwner=expectedOwner)
    }

    internal fun exactManagedOwnListingByCategory(
        categoryId: String, cancellation: CancellationSignal,
    ): SessionResult<OwnListing> {
        val creation = workers as? OwnListingCreationRepository
            ?: return SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.SERVICE_UNAVAILABLE)
        return withSession(
            call = { creation.exactManagedOwnListingByCategory(it, categoryId) },
            update = { reply, _ -> outcome(reply) },
            consistentRead = true, cancellation = cancellation,
        )
    }

    internal fun createListing(
        categoryId: String, owner: AccountPrivateReadMarker, cancellation: CancellationSignal,
    ): SessionResult<PublicListing> {
        val creation = workers as? OwnListingCreationRepository
            ?: return SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.SERVICE_UNAVAILABLE)
        return withSession(
            call = { creation.createListing(it, categoryId) },
            update = { reply, _ -> outcome(reply) },
            needsWorker = true, mutation = true, cancellation = cancellation,
            expectedOwner = owner,
        )
    }

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

    internal fun changeListingPublication(
        review: VersionedOwnListing, owner: AccountPrivateReadMarker,
        cancellation: CancellationSignal,
    ): SessionResult<PublicListing> {
        val publication = workers as? VersionedOwnPublicationRepository
            ?: return SessionResult.Failed(SessionFailure.REMOTE_FAILURE, FailureKind.SERVICE_UNAVAILABLE)
        return withSession(
            call = { publication.changePublication(it, review) },
            update = { reply, _ -> outcome(reply) },
            needsWorker = true, mutation = true, cancellation = cancellation,
            expectedOwner = owner,
        )
    }

    /** Explicit, CAS-protected reactivation of a previously unpublished OWN
     * listing. Session/lifecycle write fencing and worker opt-in are identical
     * to Publish; never place a user account ID in the wire request.
     */
    fun resumeOwnListing(
        listingId: String, expectedCategoryId: String,
        cancellation: CancellationSignal? = null,
    ): SessionResult<PublicListing> {
        val resumes = workers as? OwnListingResumeRepository ?: return SessionResult.Failed(
            SessionFailure.REMOTE_FAILURE, FailureKind.SERVICE_UNAVAILABLE,
        )
        return withSession(
            call = { resumes.resume(it, listingId, expectedCategoryId) },
            cancellation = cancellation,
            update = { reply, _ -> outcome(reply) },
            needsWorker = true, mutation = true,
        )
    }

    /** Explicit owner Category edit inherits the same epoch, mutation lock,
     * public-read invalidation and single-shot no-replay semantics as publish.
     */
    fun editListingCategory(
        listingId: String, expectedCategoryId: String, nextCategoryId: String,
        cancellation: CancellationSignal? = null,
    ): SessionResult<PublicListing> {
        val edits = workers as? OwnListingCategoryEditRepository ?: return SessionResult.Failed(
            SessionFailure.REMOTE_FAILURE, FailureKind.SERVICE_UNAVAILABLE)
        return withSession(
            call = { edits.editCategory(it, listingId, expectedCategoryId, nextCategoryId) },
            cancellation = cancellation,
            update = { reply, _ -> outcome(reply) },
            needsWorker = true, mutation = true,
        )
    }

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
