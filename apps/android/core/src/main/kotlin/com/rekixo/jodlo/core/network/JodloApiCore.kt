package com.rekixo.jodlo.core.network

import java.io.IOException
import java.io.InputStream
import java.net.URI
import java.net.URLEncoder
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.text.Normalizer
import javax.net.ssl.HttpsURLConnection

/** Headless, Android-compatible Kotlin protocol; not an APK or approved UI. */
enum class Language(val code: String) { EN("en"), HI("hi") }
enum class HttpMethod { GET, POST, DELETE }

class ApiCall private constructor(
    val method: HttpMethod,
    val resource: String,
    private val bearer: String? = null,
    private val json: String? = null,
) {
    init {
        require(resource.startsWith("/api/v1/") && !resource.contains('#') &&
                !resource.any { it == '\r' || it == '\n' }) { "Invalid resource" }
        require(bearer == null || TOKEN.matches(bearer)) { "Invalid bearer" }
        require(json == null || method == HttpMethod.POST) { "Body only for POST" }
    }

    fun headers(): Map<String, String> = buildMap {
        put("Accept", "application/json")
        if (json != null) put("Content-Type", "application/json")
        if (bearer != null) put("Authorization", "Bearer $bearer")
    }
    fun bodyUtf8(): ByteArray? = json?.toByteArray(StandardCharsets.UTF_8)
    override fun toString(): String =
        "ApiCall(method=$method, resource=<redacted>, bearer=<redacted>, body=<redacted>)"

    companion object {
        private val TOKEN = Regex("[A-Za-z0-9_-]{43}")
        fun get(path: String): ApiCall = ApiCall(HttpMethod.GET, path)
        fun getOwned(path: String, bearer: String): ApiCall = ApiCall(HttpMethod.GET, path, bearer)
        fun post(path: String, bearer: String, body: String? = null): ApiCall =
            ApiCall(HttpMethod.POST, path, bearer, body)
        fun delete(path: String, bearer: String): ApiCall =
            ApiCall(HttpMethod.DELETE, path, bearer)

        /** ONLY the existing Google proof exchange can POST without a bearer.
         * The ID token stays in the redacted body, never in the URL or logs.
         */
        internal fun googleExchangeBody(body: String): ApiCall =
            ApiCall(HttpMethod.POST, "/api/v1/auth/google", json = body)
    }
}

/** Builder for EXISTING server routes; no inferred publish, PII, GPS or new APIs. */
object JodloRoutes {
    private val CATEGORY = Regex("[A-Za-z0-9_-]{1,64}")
    private val LISTING = Regex("[A-Za-z0-9_-]{8,128}")
    private val CURSOR = Regex("(0|[1-9][0-9]{0,6}):([A-Za-z0-9_-]{1,64})")
    private val CONTROL = Regex("[\\u0000-\\u001f\\u007f-\\u009f]")
    private fun enc(s: String) = URLEncoder.encode(s, StandardCharsets.UTF_8.name())
    internal fun requireCategoryId(id: String) =
        require(CATEGORY.matches(id)) { "Invalid Category ID" }
    internal fun requireListingId(id: String) =
        require(LISTING.matches(id)) { "Invalid opaque Listing ID" }

    fun browse(lang: Language, availableOnly: Boolean = false,
               limit: Int? = null, after: String? = null): ApiCall {
        require(limit == null || limit in 1..25) { "Invalid page size" }
        require(after == null || (limit != null && CURSOR.matches(after) &&
                after.substringBefore(':').toInt() <= 1_000_000)) { "Invalid cursor" }
        val p = mutableListOf("lang=${lang.code}")
        if (availableOnly) p += "availableOnly=1"
        if (limit != null) p += "limit=$limit"
        if (after != null) p += "after=${enc(after)}"
        return ApiCall.get("/api/v1/catalog?${p.joinToString("&")}")
    }

    fun search(raw: String, lang: Language, availableOnly: Boolean = false,
               includeChoices: Boolean = false, limit: Int = 20, offset: Int = 0): ApiCall {
        val q = Normalizer.normalize(raw.trim(), Normalizer.Form.NFC)
        require(q.codePointCount(0, q.length) in 2..64 &&
                !CONTROL.containsMatchIn(q)) { "Invalid search query" }
        require(limit in 1..25 && offset in 0..100) { "Page out of bounds" }
        require(!includeChoices || offset == 0) { "Choices cannot be paged" }
        val p = mutableListOf("lang=${lang.code}", "q=${enc(q)}",
            "limit=$limit", "offset=$offset")
        if (availableOnly) p += "availableOnly=1"
        if (includeChoices) p += "includeChoices=1"
        return ApiCall.get("/api/v1/catalog/search?${p.joinToString("&")}")
    }

    /** Opt-in Search keyset for ALL already-active Categories. Distinct from
     * legacy offset/choice Search: one bounded, public-only page per call.
     * Caller passes only a previously returned cursor for the same filters.
     */
    fun searchCursor(raw: String, lang: Language, availableOnly: Boolean = false,
                     limit: Int = 20, after: String? = null): ApiCall {
        val q = Normalizer.normalize(raw.trim(), Normalizer.Form.NFC)
        require(q.codePointCount(0, q.length) in 2..64 &&
                !CONTROL.containsMatchIn(q)) { "Invalid search query" }
        require(limit in 1..25) { "Invalid Search page size" }
        require(after == null || (CURSOR.matches(after) &&
                after.substringBefore(':').toInt() <= 1_000_000)) {
            "Invalid Search cursor"
        }
        val p = mutableListOf("lang=${lang.code}", "q=${enc(q)}",
            "cursor=1", "limit=$limit")
        if (availableOnly) p += "availableOnly=1"
        if (after != null) p += "after=${enc(after)}"
        return ApiCall.get("/api/v1/catalog/search?${p.joinToString("&")}")
    }

    fun publicListings(categoryId: String): ApiCall {
        requireCategoryId(categoryId)
        return ApiCall.get("/api/v1/listings?categoryId=${enc(categoryId)}")
    }
    /** Existing opt-in server pagination; the cursor is an already public
     * Listing ID, not a private owner, timestamp, or client-provided rank.
     * This never creates a user/listing or alters the original unpaged call.
     */
    fun publicListingPage(categoryId: String, limit: Int = 20,
                          after: String? = null): ApiCall {
        requireCategoryId(categoryId)
        require(limit in 1..25) { "Invalid listing page size" }
        if (after != null) requireListingId(after)
        val params = mutableListOf("categoryId=${enc(categoryId)}", "limit=$limit")
        if (after != null) params += "after=${enc(after)}"
        return ApiCall.get("/api/v1/listings?${params.joinToString("&")}")
    }
    /** A Google ID token is client proof, NOT a JODLO session. The backend
     * verifies the Google signature, issuer, audience, lifetime and subject.
     * Match the server's exact one-field JSON contract; never log this proof.
     */
    fun googleExchange(idToken: String): ApiCall {
        require(idToken.length in 5..4096 &&
            GOOGLE_PROOF.matches(idToken)) { "Invalid Google proof shape" }
        return ApiCall.googleExchangeBody("""{"idToken":"$idToken"}""")
    }
    private val GOOGLE_PROOF = Regex("""[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+""")

    fun myListings(token: String): ApiCall = ApiCall.getOwned("/api/v1/me/listings", token)
    /** Owner-only, opt-in keyset continuation: limit 1..25, opaque listing ID.
     * Never place a bearer or personal identifiers in URL/query.
     */
    fun myListingPage(token: String, limit: Int = 20, after: String? = null): ApiCall {
        require(limit in 1..25) { "Invalid owner listing page size" }
        if (after != null) requireListingId(after)
        val path = "/api/v1/me/listings?limit=$limit" +
            (if (after != null) "&after=${enc(after)}" else "")
        return ApiCall.getOwned(path, token)
    }
    fun workerDraft(token: String): ApiCall =
        ApiCall.getOwned("/api/v1/me/worker-profile", token)
    fun optInWorker(token: String): ApiCall =
        ApiCall.post("/api/v1/me/worker-profile", token)

    /** ADR-0009: explicit user-selected ID only, verified by active D1 on server. */
    fun publishListing(token: String, categoryId: String): ApiCall {
        requireCategoryId(categoryId)
        return ApiCall.post("/api/v1/me/listings", token,
            "{\"categoryId\":\"$categoryId\"}")
    }
    fun unpublishListing(token: String, listingId: String): ApiCall {
        requireListingId(listingId)
        return ApiCall.delete("/api/v1/me/listings?id=${enc(listingId)}", token)
    }
    fun logout(token: String, allDevices: Boolean = false): ApiCall =
        ApiCall.post(if (allDevices) "/api/v1/auth/logout-all" else "/api/v1/auth/logout", token)
}

/** An invalid server body is NOT a network failure, even if the HTTP status is 200.
 * Do not include any attacker-controlled body bytes in exceptions or logs.
 */
internal class InvalidReplyBodyException : IOException("Invalid HTTP response body")

/** Bound bytes BEFORE buffering them. A strict decoder rejects malformed or
 * incomplete UTF-8 (including bytes split at the 4096-byte read boundary).
 * Transport I/O failures remain distinct from invalid server content.
 */
internal fun readBoundedUtf8Reply(stream: InputStream): String {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(4096)
    var size = 0
    while (true) {
        val n = stream.read(buffer)
        if (n < 0) break
        size += n
        if (size > 65_536) throw InvalidReplyBodyException()
        output.write(buffer, 0, n)
    }
    return try {
        StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(output.toByteArray())).toString()
    } catch (_: CharacterCodingException) {
        throw InvalidReplyBodyException()
    }
}

/** Blocking one-shot HTTPS adapter. Caller MUST run off Android's main thread.
 * No redirects, automatic retry, location, SDK, or remote deployment by default.
 */
class HttpsTransport(origin: String) {
    private val root: URI = URI.create(origin).also { u ->
        require(u.scheme == "https" && u.host != null && u.userInfo == null &&
            u.query == null && u.fragment == null &&
            (u.path == "" || u.path == "/") &&
            (u.port == -1 || u.port == 443)) { "HTTPS origin only" }
    }

    fun execute(request: ApiCall): TransportReply {
        check(Thread.currentThread().name != "main") { "Never run on main thread" }
        val c = root.resolve(request.resource).toURL().openConnection() as HttpsURLConnection
        try {
            c.instanceFollowRedirects = false
            c.connectTimeout = 10_000
            c.readTimeout = 10_000
            c.requestMethod = request.method.name
            for ((k,v) in request.headers()) c.setRequestProperty(k, v)
            val body = request.bodyUtf8()
            if (body != null) {
                val maxBody = if (request.resource == "/api/v1/auth/google") 8192 else 256
                require(body.size <= maxBody) { "Body over limit" }
                c.doOutput = true
                c.outputStream.use { it.write(body) }
            }
            val status = c.responseCode
            val stream = if (status in 200..399) c.inputStream else c.errorStream
            val text = stream?.use(::readBoundedUtf8Reply) ?: ""
            return TransportReply(status, text)
        } finally { c.disconnect() }
    }
}

class TransportReply(val status: Int, val body: String) {
    override fun toString(): String = "TransportReply(status=$status, body=<redacted>)"
}
