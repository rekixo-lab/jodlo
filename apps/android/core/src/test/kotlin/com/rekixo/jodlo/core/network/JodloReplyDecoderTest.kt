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
    println("JODLO Kotlin reply decoder: typed pages, explicit choices, listing privacy and one-shot network safety OK")
}
