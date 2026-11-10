package com.rekixo.jodlo.core.network

import java.io.ByteArrayInputStream
import java.io.IOException

private fun eq(actual: Any?, expected: Any?) {
    check(actual == expected) { "Reply DTO contract mismatch" }
}
private fun rejects(body: String, status: Int = 200,
                    parse: (TransportReply) -> ApiOutcome<*>) {
    eq(parse(TransportReply(status, body)), ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false))
}
private fun envelope(s: String) = """{"ok":true,"data":$s}"""
private const val plumber = """{"id":"plumber","slug":"plumber","name":"प्लंबर"}"""
private const val carpenter = """{"id":"carpenter","slug":"carpenter","name":"बढ़ई"}"""
private const val listing = """{"id":"11111111-1111-4111-8111-111111111111","categoryId":"plumber"}"""

fun main() {
    // Strict JSON DTOs must not silently resolve duplicate object fields:
    // some JSON parsers map later keys over earlier ones. Detect duplicates
    // recursively, even when a key is escaped on the wire.
    val repeatedBrowseKeys = listOf(
        """{"ok":true,"ok":true,"data":{"language":"hi","categories":[]}}""",
        """{"ok":true,"data":{"language":"hi","language":"en","categories":[]}}""",
        """{"ok":true,"data":{"language":"hi","categories":[{"id":"plumber","id":"carpenter","slug":"plumber","name":"प्लंबर"}]}}""",
        """{"ok":true,"data":{"language":"hi","categories":[{"id":"plumber","slug":"plumber","name":"प्लंबर","name":"electrician"}]}}""",
        """{"\u006f\u006b":true,"ok":true,"data":{"language":"hi","categories":[]}}""",
        """{"ok":true,"data":{"language":"hi","categories":[{"id":"plumber","\u0069d":"plumber","slug":"plumber","name":"प्लंबर"}]}}""",
        """{"ok":true,"data":{"language":"hi","categories":[{"id":"plumber","slug":"plumber","name":"प्लंबर"},{"id":"carpenter","slug":"carpenter","name":"बढ़ई","name":"duplicate"}]}}""",
    )
    for (payload in repeatedBrowseKeys) {
        rejects(payload, parse = JodloReplyDecoder::browse)
    }

    // Sibling objects may each have their own "id" key; this is not a
    // duplicate within the same object. String contents containing JSON-like
    // punctuation and escaped quotes must never be interpreted as field names.
    val siblingFields = JodloReplyDecoder.browse(TransportReply(200,
        """{"ok":true,"data":{"language":"en","categories":[{"id":"plumber","slug":"plumber","name":"word: \"id\", {x} [y]"},{"id":"carpenter","slug":"carpenter","name":"Carpenter"}]}}"""))
    check(siblingFields is ApiOutcome.Ok && siblingFields.value.categories.size == 2)
    eq(siblingFields.value.categories.first().name, "word: \"id\", {x} [y]")
    eq(JodloReplyDecoder.browse(TransportReply(200,
        """{"\u006f\u006b":true,"data":{"language":"hi","categories":[]}}""")),
        ApiOutcome.Ok(CatalogBrowse(Language.HI, emptyList(), null)))

    // Login tokens cannot be interpreted from ambiguous object keys. The
    // decoder must neither install a session nor echo any token or server text.
    val tokenA = "a".repeat(43)
    val tokenB = "b".repeat(43)
    rejects("""{"ok":true,"data":{"accessToken":"$tokenA","accessToken":"$tokenB","tokenType":"Bearer","expiresInSeconds":3600}}""",
        parse = JodloReplyDecoder::issuedSession)
    rejects("""{"ok":true,"data":{"accessToken":"$tokenA","tokenType":"Bearer","expiresInSeconds":3600,"\u0061ccessToken":"$tokenB"}}""",
        parse = JodloReplyDecoder::issuedSession)
    rejects("""{"ok":false,"error":{"code":"UNAUTHORIZED","code":"FORBIDDEN","message":"never log me"}}""",
        status = 401, parse = JodloReplyDecoder::issuedSession)
    val ambiguousLogin = performOnce(JodloRoutes.googleExchange("a.b.c"),
        { TransportReply(200,
            """{"ok":true,"data":{"accessToken":"$tokenA","accessToken":"$tokenB","tokenType":"Bearer","expiresInSeconds":3600}}""") },
        JodloReplyDecoder::issuedSession)
    eq(ambiguousLogin, ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false))
    check(!ambiguousLogin.toString().contains(tokenA) && !ambiguousLogin.toString().contains(tokenB))

    val browse = JodloReplyDecoder.browse(TransportReply(200,
        envelope("""{"language":"hi","categories":[$plumber],"nextCursor":"10:plumber"}""")))
    check(browse is ApiOutcome.Ok)
    eq(browse.value.categories, listOf(PublicCategory("plumber","plumber","प्लंबर")))
    eq(browse.value.nextCursor, "10:plumber")
    eq(browse.value.language, Language.HI)
    val legacy = JodloReplyDecoder.browse(TransportReply(200,
        envelope("""{"language":"en","categories":[]}""")))
    check(legacy is ApiOutcome.Ok && legacy.value.nextCursor == null)

    val empty = JodloReplyDecoder.search(TransportReply(200,
        envelope("""{"language":"hi","query":"काम","categories":[],"nextOffset":null}""")))
    check(empty is ApiOutcome.Ok && !empty.value.needsChoice)
    val ambiguous = JodloReplyDecoder.search(TransportReply(200,
        envelope("""{"language":"hi","query":"मुझे नल और लकड़ी","categories":[],"nextOffset":null,"needsChoice":true,"choices":[$plumber,$carpenter]}""")))
    check(ambiguous is ApiOutcome.Ok)
    eq(ambiguous.value.choices.map { it.id }, listOf("plumber","carpenter"))
    check(ambiguous.value.needsChoice && ambiguous.value.categories.isEmpty())

    val validLastSearchOffset = JodloReplyDecoder.search(TransportReply(200,
        envelope("""{"language":"en","query":"fixture","categories":[$plumber],"nextOffset":100}""")))
    check(validLastSearchOffset is ApiOutcome.Ok &&
        validLastSearchOffset.value.nextOffset == 100)

    val keyset = JodloReplyDecoder.searchCursor(TransportReply(200,
        envelope("""{"language":"hi","query":"मरम्मत","categories":[$plumber],"nextCursor":"8:plumber"}""")))
    check(keyset is ApiOutcome.Ok)
    eq(keyset.value, CatalogSearchCursorPage(Language.HI, "मरम्मत",
        listOf(PublicCategory("plumber","plumber","प्लंबर")), "8:plumber"))
    val done = JodloReplyDecoder.searchCursor(TransportReply(200,
        envelope("""{"language":"en","query":"repair","categories":[],"nextCursor":null}""")))
    check(done is ApiOutcome.Ok && done.value.nextCursor == null)
    // Legacy and cursor Search are different strict protocols.
    rejects(envelope("""{"language":"hi","query":"मरम्मत","categories":[],"nextCursor":null}"""),
        parse=JodloReplyDecoder::search)
    rejects(envelope("""{"language":"en","query":"repair","categories":[],"nextOffset":null}"""),
        parse=JodloReplyDecoder::searchCursor)
    for (data in listOf(
        """{"language":"en","query":"repair","categories":[]}""",
        """{"language":"en","query":"repair","categories":[],"nextCursor":"8:../../private"}""",
        """{"language":"en","query":"repair","categories":[],"nextCursor":"1000001:plumber"}""",
        """{"language":"en","query":"repair","categories":[],"nextCursor":null,"nextOffset":0}""",
        """{"language":"en","query":"repair","categories":[],"nextCursor":null,"choices":[$plumber]}""",
        """{"language":"en","query":"repair","categories":[],"nextCursor":null,"needsChoice":true}""",
        """{"language":"hi-Latn","query":"repair","categories":[],"nextCursor":null}""",
        """{"language":"en","query":"repair","categories":[$plumber,$plumber],"nextCursor":null}""",
        """{"language":"en","query":"repair","categories":[{"id":"plumber","slug":"plumber","name":"Plumber","phone":"private"}],"nextCursor":null}""",
    )) rejects(envelope(data),parse=JodloReplyDecoder::searchCursor)

    val public = JodloReplyDecoder.publicListings(TransportReply(200,
        envelope("""{"listings":[$listing]}""")))
    check(public is ApiOutcome.Ok)
    eq(public.value.single().categoryId, "plumber")
    val published = JodloReplyDecoder.published(TransportReply(200,
        envelope("""{"listing":$listing}""")))
    check(published is ApiOutcome.Ok)
    eq(published.value.id, "11111111-1111-4111-8111-111111111111")
    val owner = JodloReplyDecoder.ownListings(TransportReply(200,
        envelope("""{"listings":[{"id":"11111111-1111-4111-8111-111111111111","categoryId":"plumber","visible":false}]}""")))
    check(owner is ApiOutcome.Ok && !owner.value.single().visible)
    val ownedRow = """{"id":"11111111-1111-4111-8111-111111111111","categoryId":"plumber","visible":false}"""
    val ownerPage = JodloReplyDecoder.ownListingPage(TransportReply(200,
        envelope("""{"listings":[$ownedRow],"nextCursor":"11111111-1111-4111-8111-111111111111"}""")))
    eq(ownerPage, ApiOutcome.Ok(OwnListingPage(listOf(
        OwnListing("11111111-1111-4111-8111-111111111111","plumber",false)),
        "11111111-1111-4111-8111-111111111111")))
    eq(JodloReplyDecoder.ownListingPage(TransportReply(200,
        envelope("""{"listings":[],"nextCursor":null}"""))),
        ApiOutcome.Ok(OwnListingPage(emptyList(),null)))

    // The old and new owner replies deliberately have INCOMPATIBLE shapes.
    rejects(envelope("""{"listings":[$ownedRow]}"""),parse=JodloReplyDecoder::ownListingPage)
    rejects(envelope("""{"listings":[$ownedRow],"nextCursor":null}"""),
        parse=JodloReplyDecoder::ownListings)
    for (data in listOf(
        """{"listings":[$ownedRow],"nextCursor":"../escape"}""",
        """{"listings":[$ownedRow],"nextCursor":123}""",
        """{"listings":[$ownedRow,$ownedRow],"nextCursor":null}""",
        """{"listings":[{"id":"11111111-1111-4111-8111-111111111111","categoryId":"plumber","visible":"true"}],"nextCursor":null}""",
        """{"listings":[{"id":"11111111-1111-4111-8111-111111111111","categoryId":"plumber","visible":true,"phone":"private"}],"nextCursor":null}""",
        """{"listings":[$ownedRow],"nextCursor":null,"ownerAccountId":"private"}""",
        """{"listings":[$ownedRow],"nextCursor":null,"verified":true}""",
        """{"listings":"wrong","nextCursor":null}""",
        """{"listings":[$ownedRow],"nextCursor":null,"nextOffset":1}""",
        """{"listings":[${List(26){ownedRow}.joinToString(",")}],"nextCursor":null}""",
    )) rejects(envelope(data),parse=JodloReplyDecoder::ownListingPage)
    eq(JodloReplyDecoder.unpublished(TransportReply(200,
        envelope("""{"unpublished":true}"""))), ApiOutcome.Ok(true))

    for ((status, code, kind) in listOf(
        Triple(401,"UNAUTHORIZED",FailureKind.UNAUTHORIZED),
        Triple(403,"FORBIDDEN",FailureKind.FORBIDDEN),
        Triple(400,"INVALID_QUERY",FailureKind.BAD_INPUT),
        Triple(404,"NOT_FOUND",FailureKind.NOT_FOUND),
        Triple(429,"RATE_LIMITED",FailureKind.RATE_LIMITED),
        Triple(503,"SERVICE_UNAVAILABLE",FailureKind.SERVICE_UNAVAILABLE),
    )) {
        val message = """{"ok":false,"error":{"code":"$code","message":"private-server-token"}}"""
        val result = JodloReplyDecoder.search(TransportReply(status,message))
        check(result is ApiOutcome.Failed)
        eq(result.kind,kind)
        eq(result.retryable,false)
        check(!result.toString().contains("private-server-token"))
    }

    for (data in listOf(
        """{"language":"hi","categories":[{"id":"plumber","slug":"plumber","name":"प्लंबर","phone":"12345"}]}""",
        """{"language":"hi","categories":[$plumber,$plumber]}""",
        """{"language":"hi","categories":[],"nextCursor":"../../home"}""",
        """{"language":"hi-Latn","categories":[]}""",
        """{"language":"hi","categories":"wrong-type"}""",
        """{"language":"hi","categories":[{"id":"plumber","slug":"plumber","name":123}]}""",
    )) rejects(envelope(data),parse=JodloReplyDecoder::browse)
    for (data in listOf(
        """{"language":"en","query":"tap repair","categories":[$plumber],"nextOffset":null,"needsChoice":true,"choices":[$carpenter]}""",
        """{"language":"en","query":"tap repair","categories":[],"nextOffset":5,"needsChoice":true,"choices":[$carpenter]}""",
        """{"language":"en","query":"tap repair","categories":[],"nextOffset":null,"choices":[$carpenter]}""",
        """{"language":"en","query":"tap repair","categories":[],"nextOffset":null,"needsChoice":false}""",
        """{"language":"en","query":"tap repair","categories":[],"nextOffset":400}""",
        """{"language":"en","query":"tap repair","categories":[],"nextOffset":125}""",
        """{"language":"en","query":"tap repair","categories":[],"nextOffset":null,"workerPhone":"secret"}""",
    )) rejects(envelope(data),parse=JodloReplyDecoder::search)

    rejects("""{"ok":true,"data":{"listings":[$listing],"workerId":"secret"}}""",
        parse=JodloReplyDecoder::publicListings)
    rejects(envelope("""{"unpublished":false}"""),parse=JodloReplyDecoder::unpublished)
    rejects(envelope("""{"language":"en","categories":[]}"""),status=500,
        parse=JodloReplyDecoder::browse)
    rejects("""{"ok":false,"error":{"code":"UNAUTHORIZED","message":"bad"}}""",
        status=200,parse=JodloReplyDecoder::browse)
    rejects("""{"ok":false,"error":{"code":"UNAUTHORIZED","message":"bad"}}""",
        status=503,parse=JodloReplyDecoder::browse)
    rejects("""{"ok":false,"error":{"code":"UNKNOWN","message":"bad"}}""",
        status=400,parse=JodloReplyDecoder::browse)
    eq(JodloReplyDecoder.browse(TransportReply(302,"redirect")),
        ApiOutcome.Failed(FailureKind.BAD_RESPONSE,false))
    eq(JodloReplyDecoder.browse(TransportReply(200,"a".repeat(65_537))),
        ApiOutcome.Failed(FailureKind.BAD_RESPONSE,false))

    var sent = 0
    val call = JodloRoutes.publishListing("a".repeat(43),"plumber")
    val failed = performOnce(call,{ _ ->
        sent++
        throw IOException("sensitive network detail")
    },JodloReplyDecoder::published)
    eq(sent,1)
    eq(failed,ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT,false))
    check(!failed.toString().contains("sensitive"))

    // A malformed/oversized HTTPS response is BAD_RESPONSE rather than a
    // crashing IllegalArgumentException or a misleading offline status.
    for (bytes in listOf(
        ByteArray(65_537) { 'a'.code.toByte() },
        byteArrayOf(0x7b, 0xc3.toByte(), 0x28, 0x7d),
        byteArrayOf(0xe0.toByte(), 0xa4.toByte()),
    )) {
        var replyAttempts = 0
        val invalid = performOnce(call, { _ ->
            replyAttempts++
            TransportReply(200, readBoundedUtf8Reply(ByteArrayInputStream(bytes)))
        }, JodloReplyDecoder::published)
        eq(invalid, ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false))
        eq(replyAttempts, 1)
    }
    // Owner-only export contains personal fields. Only an explicit versioned,
    // tightly typed envelope can be turned into a memory-only JSON document.
    val ownExportData = """{"schemaVersion":1,
        "account":{"accountId":"account-identity-a111","createdAt":"2026-11-04T00:00:00.000Z",
        "workerEnabled":false,"workerSince":null,"totalServices":0,
        "publishedServices":0,"visibleServices":0,"activeSessions":1,"receivesCalls":false},
        "identity":[{"googleSub":"private-google-sub-123"}],
        "services":[],"callPreferences":[],"availabilityPreferences":[],
        "blocksMade":[{"blockedAccountId":"blocked-account-b222"}],
        "abuseCounters":[],
        "sessions":[{"createdAt":1783200000,"expiresAt":1783203600}],
        "limitations":["JODLO-owned D1 rows only"]}""".trimIndent()
    val exported = JodloReplyDecoder.accountDataExport(
        TransportReply(200, envelope(ownExportData)))
    check(exported is ApiOutcome.Ok)
    check(exported.value.json.contains("private-google-sub-123"))
    check(!exported.value.json.contains("\"ok\""))
    check(!exported.toString().contains("private-google-sub-123"))
    check(!exported.value.toString().contains("private-google-sub-123"))
    val cityExport = ownExportData.replace("\"schemaVersion\":1", "\"schemaVersion\":2")
    check(JodloReplyDecoder.accountDataExport(TransportReply(200, envelope(cityExport))) is ApiOutcome.Ok)
    val serviceExport = cityExport.replace("\"schemaVersion\":2", "\"schemaVersion\":3")
        .replace("\"services\":[]", "\"services\":[],\"serviceDetails\":[],\"servicePhotos\":[],\"serviceReports\":[],\"serviceAppeals\":[]")
    check(JodloReplyDecoder.accountDataExport(TransportReply(200, envelope(serviceExport))) is ApiOutcome.Ok)
    for (badExport in listOf(
        ownExportData.replace("\"schemaVersion\":1", "\"schemaVersion\":4"),
        cityExport.replace("\"schemaVersion\":2", "\"schemaVersion\":3"),
        ownExportData.replace("\"googleSub\":", "\"email\":\"private@example.com\",\"googleSub\":"),
        ownExportData.replace("\"createdAt\":1783200000",
            "\"tokenHash\":\"secret\",\"createdAt\":1783200000"),
        ownExportData.replace("\"blockedAccountId\":",
            "\"blockedAccountId\":\"bad\",\"other\":"),
        ownExportData.replace("\"schemaVersion\":1",
            "\"schemaVersion\":1,\"schemaVersion\":1"),
        ownExportData.replace("\"expiresAt\":1783203600",
            "\"expiresAt\":1783200000"),
        ownExportData.replace("\"limitations\":[",
            "\"inboundBlockerIds\":[],\"limitations\":["),
    )) rejects(envelope(badExport),parse=JodloReplyDecoder::accountDataExport)

    // Actual Account Call History "More" must append, not replace the first
    // 25 rows; network error, stale cursor, duplicate and reordered results
    // must leave the last valid private page on the screen.
    fun historyEntry(n: Int): CallHistoryEntry = CallHistoryEntry(
        "00000000-0000-4000-8000-" + n.toString().padStart(12, '0'),
        incoming = n % 2 == 0,
        outcome = CallHistoryOutcome.ENDED,
        endedAtSeconds = 2_000_000_000L - n,
    )
    fun decodedHistory(rows: List<CallHistoryEntry>, next: String?): CallHistoryPage {
        val entries = rows.joinToString(",") {
            """{"id":"${it.id}","direction":"${if (it.incoming) "incoming" else "outgoing"}","outcome":"ended","endedAt":${it.endedAtSeconds},"connectedSeconds":5}"""
        }
        val cursor = next?.let { "\\"" + it + "\\"" } ?: "null"
        val response = JodloReplyDecoder.callHistory(TransportReply(200,
            envelope("""{"items":[$entries],"nextCursor":$cursor}""")))
        check(response is ApiOutcome.Ok)
        return response.value
    }
    val firstHistory = decodedHistory((1..25).map(::historyEntry), historyEntry(25).id)
    val olderHistory = decodedHistory((26..30).map(::historyEntry), null)
    val firstTimeline = CallHistoryTimeline.merge(null, null, firstHistory)
    eq(firstTimeline, firstHistory)
    val fullTimeline = CallHistoryTimeline.merge(firstTimeline, firstHistory.nextCursor, olderHistory)
    eq(fullTimeline, CallHistoryPage((1..30).map(::historyEntry), null))
    eq(CallHistoryTimeline.merge(firstTimeline, "wrong-cursor", olderHistory), null)
    eq(CallHistoryTimeline.merge(null, firstHistory.nextCursor, olderHistory), null)
    eq(CallHistoryTimeline.merge(firstTimeline, firstHistory.nextCursor,
        CallHistoryPage(emptyList(), null)), null)
    eq(CallHistoryTimeline.merge(firstTimeline, firstHistory.nextCursor,
        CallHistoryPage(listOf(historyEntry(25)) + (27..30).map(::historyEntry), null)), null)
    eq(CallHistoryTimeline.merge(firstTimeline, firstHistory.nextCursor,
        CallHistoryPage(olderHistory.items.reversed(), null)), null)
    eq(CallHistoryTimeline.merge(null, null,
        CallHistoryPage(firstHistory.items, "incorrect-last-row")), null)
    eq(CallHistoryTimeline.merge(null, null,
        CallHistoryPage((1..26).map(::historyEntry), null)), null)
    // Explicit refresh starts fresh rather than mixing old and new result sets.
    eq(CallHistoryTimeline.merge(fullTimeline, null,
        decodedHistory(listOf(historyEntry(1)), null)),
        CallHistoryPage(listOf(historyEntry(1)), null))
    for (badHistory in listOf(
        """{"items":[],"nextCursor":"fake"}""",
        """{"items":[{"id":"${historyEntry(1).id}","direction":"outgoing","outcome":"ended","endedAt":1999999999,"connectedSeconds":1,"phone":"private"}],"nextCursor":null}""",
    )) rejects(envelope(badHistory),parse=JodloReplyDecoder::callHistory)

    println("JODLO Kotlin reply decoder: typed pages, explicit choices, listing privacy and one-shot network safety OK")
}
