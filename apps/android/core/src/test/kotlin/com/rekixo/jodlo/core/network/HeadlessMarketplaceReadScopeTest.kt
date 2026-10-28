package com.rekixo.jodlo.core.network

import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

private const val ENTRY = "11111111-1111-4111-8111-111111111111"
private val TOKEN_1 = "a".repeat(43)
private val TOKEN_2 = "b".repeat(43)
private val PLUMBER = PublicCategory("plumber", "plumber", "प्लंबर")
private val CARPENTER = PublicCategory("carpenter", "carpenter", "बढ़ई")

private fun issued(token: String = TOKEN_1) = TransportReply(200,
    """{"ok":true,"data":{"accessToken":"$token","tokenType":"Bearer","expiresInSeconds":3600}}""")
private fun ok(payload: String) = TransportReply(200, """{"ok":true,"data":$payload}""")
private fun unauthorized() = TransportReply(401,
    """{"ok":false,"error":{"code":"UNAUTHORIZED","message":"server confidential"}}""")
private fun <T> async(block: () -> T) =
    FutureTask<T> { block() }.also { Thread(it, "jodlo-fake-network").start() }
private fun await(latch: CountDownLatch) =
    check(latch.await(5, TimeUnit.SECONDS)) { "Fake request did not start" }
private fun <T> finish(task: FutureTask<T>): T = task.get(5, TimeUnit.SECONDS)

private class FakeCatalog : CatalogRepository {
    var browseHandler: (Language) -> ApiOutcome<CatalogBrowse> = {
        ApiOutcome.Ok(CatalogBrowse(it, listOf(PLUMBER, CARPENTER), null))
    }
    var searchHandler: (String, Language) -> ApiOutcome<CatalogSearch> = { q, lang ->
        ApiOutcome.Ok(CatalogSearch(lang, q, emptyList(), null, true,
            listOf(PLUMBER, CARPENTER)))
    }
    var listingsHandler: (String) -> ApiOutcome<List<PublicListing>> = {
        ApiOutcome.Ok(listOf(PublicListing(ENTRY, it)))
    }
    override fun browse(language: Language, availableOnly: Boolean, limit: Int,
                        after: String?): ApiOutcome<CatalogBrowse> = browseHandler(language)
    override fun search(query: String, language: Language, availableOnly: Boolean,
                        includeChoices: Boolean, limit: Int,
                        offset: Int): ApiOutcome<CatalogSearch> = searchHandler(query, language)
    override fun listings(categoryId: String): ApiOutcome<List<PublicListing>> =
        listingsHandler(categoryId)
}
private fun scope(catalog: CatalogRepository, sender: RequestSender =
    RequestSender { unauthorized() }): Pair<HeadlessMarketplaceReadScope, InMemorySessionCoordinator> {
    val session = InMemorySessionCoordinator(RemoteWorkerRepository(sender), sender) { 0L }
    return HeadlessMarketplaceReadScope(catalog, session) to session
}

private fun testCustomerBrowseSearchAndExplicitSelection() {
    val (scope, session) = scope(FakeCatalog())
    check(scope.browse(Language.HI, limit = 20) == ReadCompletion.APPLIED)
    check(scope.search("नल और लकड़ी", Language.HI) == ReadCompletion.APPLIED)
    val search = scope.snapshot().search as ReadState.Ready
    check(search.value.needsChoice && search.value.choices.map { it.id } ==
        listOf("plumber", "carpenter"))
    check(scope.publicListings("carpenter") == ReadCompletion.APPLIED)
    check(scope.snapshot().browse == ReadState.Ready(
        CatalogBrowse(Language.HI, listOf(PLUMBER, CARPENTER), null)))
    check(scope.snapshot().publicListings ==
        ReadState.Ready(listOf(PublicListing(ENTRY, "carpenter"))))
    // Read scope contains NO method for publishing a Search choice.
    check(session.snapshot() == LoginState.SignedOut)
    scope.clearSearch()
    check(scope.snapshot().search == ReadState.Idle)
    check(scope.snapshot().publicListings is ReadState.Ready)
}

private fun testLatestSearchWinsWithoutCancellingBrowse() {
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val fake = FakeCatalog()
    fake.searchHandler = { q, lang ->
        if (q == "पुरानी खोज") {
            started.countDown()
            check(release.await(5, TimeUnit.SECONDS))
        }
        ApiOutcome.Ok(CatalogSearch(lang, q, listOf(PLUMBER), null, false, emptyList()))
    }
    val (scope, _) = scope(fake)
    val previous = async { scope.search("पुरानी खोज", Language.HI) }
    try {
        await(started)
        check(scope.snapshot().search == ReadState.Loading)
        check(scope.browse(Language.HI) == ReadCompletion.APPLIED)
        check(scope.search("नई खोज", Language.HI) == ReadCompletion.APPLIED)
    } finally {
        release.countDown()
    }
    check(finish(previous) == ReadCompletion.DISCARDED)
    check((scope.snapshot().search as ReadState.Ready).value.query == "नई खोज")
    check(scope.snapshot().browse is ReadState.Ready)
}

private fun testClosedScopeDiscardsSlowReadsAndClearsData() {
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val calls = AtomicInteger()
    val fake = FakeCatalog()
    fake.browseHandler = { language ->
        calls.incrementAndGet()
        started.countDown()
        check(release.await(5, TimeUnit.SECONDS))
        ApiOutcome.Ok(CatalogBrowse(language, listOf(PLUMBER), null))
    }
    val (scope, _) = scope(fake)
    check(scope.publicListings("plumber") == ReadCompletion.APPLIED)
    val prior = async { scope.browse(Language.HI) }
    try {
        await(started)
        scope.close()
        scope.close()
        val closed = scope.snapshot()
        check(closed.closed && closed.browse == ReadState.Idle)
        check(closed.publicListings == ReadState.Idle)
        check(scope.search("plumber", Language.EN) == ReadCompletion.DISCARDED)
        check(scope.browse(Language.EN) == ReadCompletion.DISCARDED)
    } finally {
        release.countDown()
    }
    check(finish(prior) == ReadCompletion.DISCARDED)
    check(calls.get() == 1)
}

private fun testClearSearchDiscardsPendingRequestAndRejectsInvalidInput() {
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val fake = FakeCatalog()
    fake.searchHandler = { q, lang ->
        started.countDown()
        check(release.await(5, TimeUnit.SECONDS))
        ApiOutcome.Ok(CatalogSearch(lang, q, emptyList(), null, false, emptyList()))
    }
    val (scope, _) = scope(fake)
    val prior = async { scope.search("carpenter", Language.EN) }
    try {
        await(started)
        check(runCatching { scope.search("x", Language.EN) }.isFailure)
        check(scope.snapshot().search == ReadState.Loading)
        scope.clearSearch()
    } finally {
        release.countDown()
    }
    check(finish(prior) == ReadCompletion.DISCARDED)
    check(scope.snapshot().search == ReadState.Idle)
}

private fun testErrorsAreTypedAndPrivateFieldsNeverCopied() {
    val fake = FakeCatalog()
    fake.listingsHandler = { ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false) }
    fake.browseHandler = { throw IllegalStateException("private diagnostics") }
    val (scope, _) = scope(fake)
    check(scope.browse(Language.EN) == ReadCompletion.APPLIED)
    check(scope.snapshot().browse == ReadState.ApiError(FailureKind.BAD_RESPONSE))
    check(!scope.snapshot().toString().contains("private diagnostics"))
    check(scope.publicListings("carpenter") == ReadCompletion.APPLIED)
    check(scope.snapshot().publicListings == ReadState.ApiError(FailureKind.BAD_RESPONSE))
}

private fun testWorkerSnapshotsResetOnAccountChange() {
    val sender = RequestSender { request ->
        check(request.method == HttpMethod.GET)
        when (request.resource) {
            "/api/v1/me/worker-profile" ->
                ok("""{"profile":{"status":"draft"}}""")
            "/api/v1/me/listings" -> {
                check(request.headers()["Authorization"] == "Bearer $TOKEN_1")
                ok("""{"listings":[{"id":"$ENTRY","categoryId":"carpenter","visible":true}]}""")
            }
            else -> throw IllegalStateException("Unexpected read")
        }
    }
    val (scope, session) = scope(FakeCatalog(), sender)
    check(session.acceptIssuedSession(issued(TOKEN_1)) is ApiOutcome.Ok)
    check(scope.checkWorker() == ReadCompletion.APPLIED)
    check(scope.ownListings() == ReadCompletion.APPLIED)
    check(scope.snapshot().worker == ReadState.Ready(WorkerState.DRAFT))
    check(scope.snapshot().ownListings is ReadState.Ready)
    check(session.acceptIssuedSession(issued(TOKEN_2)) is ApiOutcome.Ok)
    // No stale personal list from first session even if a future UI forgets close().
    check(scope.snapshot().worker == ReadState.Idle)
    check(scope.snapshot().ownListings == ReadState.Idle)
    check(scope.snapshot().browse == ReadState.Idle)
}

private fun testWorkerLogoutWhileReadInFlight() {
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
    val (scope, session) = scope(FakeCatalog(), sender)
    check(session.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    val prior = async { scope.checkWorker() }
    try {
        await(started)
        check(session.logout() == SessionResult.Success(true))
        check(scope.snapshot().worker == ReadState.Idle)
    } finally {
        release.countDown()
    }
    check(finish(prior) == ReadCompletion.DISCARDED)
    check(scope.snapshot().worker == ReadState.Idle)
    check(session.snapshot() == LoginState.SignedOut)
}

private fun testServer401InvalidatesCachedPrivateListings() {
    val sender = RequestSender { request ->
        when (request.resource) {
            "/api/v1/me/listings" ->
                ok("""{"listings":[{"id":"$ENTRY","categoryId":"carpenter","visible":true}]}""")
            "/api/v1/me/worker-profile" -> unauthorized()
            else -> throw IllegalStateException("Unexpected route")
        }
    }
    val (scope, session) = scope(FakeCatalog(), sender)
    check(session.acceptIssuedSession(issued()) is ApiOutcome.Ok)
    check(scope.ownListings() == ReadCompletion.APPLIED)
    check(scope.snapshot().ownListings is ReadState.Ready)
    // Authorization failure is authoritative even if the worker scope remains alive.
    check(scope.checkWorker() == ReadCompletion.DISCARDED)
    check(session.snapshot() == LoginState.SignedOut)
    check(scope.snapshot().ownListings == ReadState.Idle)
    check(scope.snapshot().worker == ReadState.Idle)
}

fun main() {
    testCustomerBrowseSearchAndExplicitSelection()
    testLatestSearchWinsWithoutCancellingBrowse()
    testClosedScopeDiscardsSlowReadsAndClearsData()
    testClearSearchDiscardsPendingRequestAndRejectsInvalidInput()
    testErrorsAreTypedAndPrivateFieldsNeverCopied()
    testWorkerSnapshotsResetOnAccountChange()
    testWorkerLogoutWhileReadInFlight()
    testServer401InvalidatesCachedPrivateListings()
    println("JODLO headless reads: latest search, lifecycle close, safe worker epoch and 401 invalidation OK")
}
