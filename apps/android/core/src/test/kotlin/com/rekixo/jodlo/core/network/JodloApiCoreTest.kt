package com.rekixo.jodlo.core.network

import java.io.ByteArrayInputStream
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

private const val TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
private fun rejects(label: String, run: () -> Unit) {
    check(runCatching(run).isFailure) { "Expected to reject: $label" }
}

/** Runs as a real compiled Kotlin/JVM program; no Android SDK or live network. */
fun main() {
    check(TOKEN.length == 43)
    val hindi = JodloRoutes.search("मुझे नल की मरम्मत चाहिए", Language.HI,
        includeChoices = true)
    check(hindi.method == HttpMethod.GET && hindi.resource.contains("includeChoices=1"))
    check(hindi.resource.startsWith("/api/v1/catalog/search?lang=hi&q="))
    val encoded = hindi.resource.substringAfter("&q=").substringBefore("&")
    check(URLDecoder.decode(encoded, "UTF-8") == "मुझे नल की मरम्मत चाहिए")
    val real = JodloRoutes.search("tap repair", Language.EN, availableOnly = true,
        limit = 25, offset = 100)
    check(real.resource.endsWith("&limit=25&offset=100&availableOnly=1"))
    rejects("ambiguous choices cannot be paged") {
        JodloRoutes.search("tap repair", Language.EN, includeChoices = true, offset = 1)
    }
    rejects("empty search") { JodloRoutes.search(" ", Language.HI) }
    rejects("C0 control") { JodloRoutes.search("tap\u0000repair", Language.EN) }
    rejects("overlong Unicode") { JodloRoutes.search("न".repeat(65), Language.HI) }
    rejects("overwide pages") { JodloRoutes.search("tap", Language.EN, limit = 26) }
    rejects("offset out of range") { JodloRoutes.search("tap", Language.EN, offset = 101) }
    val composed = JodloRoutes.search("  e\u0301lectric  ", Language.EN)
    check(URLDecoder.decode(composed.resource.substringAfter("&q=").substringBefore("&"),
        "UTF-8") == "électric")

    // New opt-in keyset Search has NO offset/choice flag; the old route stays.
    val cursorSearch = JodloRoutes.searchCursor("  प्लंबर  ", Language.HI,
        availableOnly = true, limit = 25, after = "8:plumber")
    check(cursorSearch.method == HttpMethod.GET)
    check(cursorSearch.resource ==
        "/api/v1/catalog/search?lang=hi&q=%E0%A4%AA%E0%A5%8D%E0%A4%B2%E0%A4%82%E0%A4%AC%E0%A4%B0&cursor=1&limit=25&availableOnly=1&after=8%3Aplumber")
    check(!cursorSearch.resource.contains("offset=") &&
        !cursorSearch.resource.contains("includeChoices"))
    check(cursorSearch.headers()["Authorization"] == null)
    check(JodloRoutes.searchCursor("service", Language.EN).resource.contains("&cursor=1&limit=20"))
    for (badCursor in listOf("00:plumber", "1000001:plumber",
        "-1:plumber", "8:../private", "8:नल", "8:plumber%0A")) {
        rejects("unsafe Search cursor") {
            JodloRoutes.searchCursor("service", Language.EN, after = badCursor)
        }
    }
    rejects("zero cursor Search page") { JodloRoutes.searchCursor("service", Language.EN,limit=0) }
    rejects("oversized cursor Search page") {
        JodloRoutes.searchCursor("service", Language.EN,limit=26)
    }
    rejects("blank cursor Search query") { JodloRoutes.searchCursor(" ", Language.HI) }
    rejects("search query control") {
        JodloRoutes.searchCursor("plumb\u0000repair", Language.EN)
    }

    val browse = JodloRoutes.browse(Language.EN, availableOnly = true,
        limit = 20, after = "0:plumber")
    check(browse.resource == "/api/v1/catalog?lang=en&availableOnly=1&limit=20&after=0%3Aplumber")
    rejects("invalid cursor") { JodloRoutes.browse(Language.EN, limit = 10, after = "10:../secret") }
    rejects("cursor without limit") { JodloRoutes.browse(Language.EN, after = "0:plumber") }
    rejects("cursor out of range") {
        JodloRoutes.browse(Language.EN, limit = 10, after = "1000001:plumber")
    }

    val publish = JodloRoutes.publishListing(TOKEN, "plumber")
    check(publish.method == HttpMethod.POST && publish.resource == "/api/v1/me/listings")
    check(String(publish.bodyUtf8()!!, StandardCharsets.UTF_8) ==
        "{\"categoryId\":\"plumber\"}")
    check(publish.headers()["Authorization"] == "Bearer $TOKEN")
    check(!publish.toString().contains("plumber") && !publish.toString().contains(TOKEN))
    rejects("not a real category ID") { JodloRoutes.publishListing(TOKEN, "tap repair") }
    rejects("JSON injection") {
        JodloRoutes.publishListing(TOKEN, "plumber\",\"verified\":true")
    }
    rejects("invalid bearer") { JodloRoutes.publishListing("fake", "plumber") }
    check(JodloRoutes.optInWorker(TOKEN).bodyUtf8() == null)
    check(JodloRoutes.myListings(TOKEN).method == HttpMethod.GET)
    // Authenticated owner pages are distinct from legacy /me/listings reads.
    val ownPage = JodloRoutes.myListingPage(TOKEN, limit = 25,
        after = "11111111-1111-4111-8111-111111111111")
    check(ownPage.method == HttpMethod.GET)
    check(ownPage.resource == "/api/v1/me/listings?limit=25&after=11111111-1111-4111-8111-111111111111")
    check(ownPage.headers()["Authorization"] == "Bearer $TOKEN")
    check(ownPage.bodyUtf8() == null && !ownPage.toString().contains(TOKEN))
    check(JodloRoutes.myListingPage(TOKEN).resource == "/api/v1/me/listings?limit=20")
    check(JodloRoutes.myListings(TOKEN).resource == "/api/v1/me/listings")
    for (badLimit in listOf(0,-1,26,100)) {
        rejects("owner listing bad limit $badLimit") {
            JodloRoutes.myListingPage(TOKEN, limit = badLimit)
        }
    }
    for (badAfter in listOf("", "tiny", "../outside", "bad%0A", "bad:sort")) {
        rejects("owner listing bad cursor") {
            JodloRoutes.myListingPage(TOKEN, after = badAfter)
        }
    }
    rejects("owner listing needs a real bearer") { JodloRoutes.myListingPage("fake") }
    check(JodloRoutes.workerDraft(TOKEN).resource == "/api/v1/me/worker-profile")
    check(JodloRoutes.unpublishListing(TOKEN,
        "11111111-1111-4111-8111-111111111111").method == HttpMethod.DELETE)
    rejects("invalid listing") { JodloRoutes.unpublishListing(TOKEN, "tiny") }
    check(JodloRoutes.publicListings("plumber").headers()["Authorization"] == null)
    check(JodloRoutes.logout(TOKEN, allDevices = true).resource ==
        "/api/v1/auth/logout-all")
    rejects("no insecure HTTP") { HttpsTransport("http://example.com") }
    rejects("no URL credentials") { HttpsTransport("https://user:pw@example.com") }
    rejects("no arbitrary base path") { HttpsTransport("https://example.com/foreign") }
    rejects("no network on main thread") {
        HttpsTransport("https://example.com").execute(JodloRoutes.publicListings("plumber"))
    }
    // Read-limit and strict UTF-8 tests run without HTTPS, an Android SDK or credentials.
    val exactlyMax = "a".repeat(65_536).toByteArray(StandardCharsets.UTF_8)
    check(readBoundedUtf8Reply(ByteArrayInputStream(exactlyMax)).length == 65_536)
    val splitHindi = "a".repeat(4095) + "ह" // 3-byte UTF-8 crosses 4096-byte chunks.
    check(readBoundedUtf8Reply(ByteArrayInputStream(splitHindi.toByteArray(
        StandardCharsets.UTF_8))) == splitHindi)
    rejects("oversized streamed response is rejected before buffering") {
        readBoundedUtf8Reply(ByteArrayInputStream(ByteArray(65_537) { 'a'.code.toByte() }))
    }
    rejects("malformed server UTF-8 cannot be silently replaced") {
        readBoundedUtf8Reply(ByteArrayInputStream(byteArrayOf(0x7b, 0xc3.toByte(), 0x28, 0x7d)))
    }
    rejects("truncated multibyte UTF-8 is not a valid reply") {
        readBoundedUtf8Reply(ByteArrayInputStream(byteArrayOf(0x7b, 0xe0.toByte(), 0xa4.toByte())))
    }
    check(!TransportReply(200, "secret-user-data").toString().contains("secret-user-data"))
    println("JODLO Android headless Kotlin: bilingual Unicode, routes, privacy and publication safety OK")
}
