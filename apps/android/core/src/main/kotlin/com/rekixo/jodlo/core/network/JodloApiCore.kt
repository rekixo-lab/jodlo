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
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import javax.net.ssl.HttpsURLConnection

/** Headless, Android-compatible Kotlin protocol; not an APK or approved UI. */
enum class Language(val code: String) { EN("en"), HI("hi") }
enum class HttpMethod { GET, POST, PUT, DELETE }

class ApiCall private constructor(
    val method: HttpMethod,
    val resource: String,
    private val bearer: String? = null,
    private val json: String? = null,
    private val idempotencyKey: String? = null,
) {
    init {
        require(resource.startsWith("/api/v1/") && !resource.contains('#') &&
                !resource.any { it == '\r' || it == '\n' }) { "Invalid resource" }
        require(bearer == null || TOKEN.matches(bearer)) { "Invalid bearer" }
        require(json == null || method == HttpMethod.POST || method == HttpMethod.PUT) { "Body only for POST or PUT" }
    }

    fun headers(): Map<String, String> = buildMap {
        put("Accept", "application/json")
        if (json != null) put("Content-Type", "application/json")
        if (bearer != null) put("Authorization", "Bearer $bearer")
        if (idempotencyKey != null) put("Idempotency-Key", idempotencyKey)
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
        internal fun callInvitation(path: String, bearer: String, attemptKey: String): ApiCall {
            require(Regex("[A-Za-z0-9_-]{12,80}").matches(attemptKey))
            return ApiCall(HttpMethod.POST, path, bearer, idempotencyKey = attemptKey)
        }
        fun put(path: String, bearer: String, body: String? = null): ApiCall =
            ApiCall(HttpMethod.PUT, path, bearer, body)
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
               limit: Int? = null, after: String? = null,
               city: NearbyPilotCity? = null): ApiCall {
        require(limit == null || limit in 1..25) { "Invalid page size" }
        require(after == null || (limit != null && CURSOR.matches(after) &&
                after.substringBefore(':').toInt() <= 1_000_000)) { "Invalid cursor" }
        require(city == null || (availableOnly && limit != null)) {
            "City browse needs explicit available-only bounded page"
        }
        val p = mutableListOf("lang=${lang.code}")
        if (availableOnly) p += "availableOnly=1"
        if (limit != null) p += "limit=$limit"
        if (after != null) p += "after=${enc(after)}"
        if (city != null) p += "city=${city.wire}"
        return ApiCall.get("/api/v1/catalog?${p.joinToString("&")}")
    }

    /** Opt-in approved Group -> Family -> Category, no historical data seed.
     * Required level and parent scope, a bounded ID-only cursor, no account,
     * location, Worker, GPS or authentication data.
     */
    fun hierarchy(level: HierarchyLevel, parentId: String?, lang: Language,
                  availableOnly: Boolean = false, limit: Int = 20,
                  after: String? = null): ApiCall {
        require(limit in 1..25) { "Invalid hierarchy page size" }
        if (level == HierarchyLevel.GROUPS) {
            require(parentId == null) { "Groups have no parent" }
        } else {
            require(parentId != null) { "Missing hierarchy parent" }
            requireCategoryId(parentId)
        }
        if (after != null) requireCategoryId(after)
        val params = mutableListOf(
            "level=${level.code}", "lang=${lang.code}", "limit=$limit",
        )
        if (parentId != null) params += "parentId=${enc(parentId)}"
        if (availableOnly) params += "availableOnly=1"
        if (after != null) params += "after=${enc(after)}"
        return ApiCall.get("/api/v1/catalog/hierarchy?${params.joinToString("&")}")
    }

    /** Exact already-approved category name lookup; never carries a bearer,
     * Worker identifier, Saved Listing ID, or availability status.
     */
    fun approvedCategoryNames(ids: List<String>, lang: Language): ApiCall {
        require(ids.isNotEmpty() && ids.size <= 20 &&
            ids.toSet().size == ids.size) { "Invalid Category ID batch" }
        ids.forEach(::requireCategoryId)
        return ApiCall.get("/api/v1/catalog?lang=${lang.code}&ids=${enc(ids.joinToString(","))}")
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
                     limit: Int = 20, after: String? = null, city: NearbyPilotCity? = null): ApiCall {
        val q = Normalizer.normalize(raw.trim(), Normalizer.Form.NFC)
        require(q.codePointCount(0, q.length) in 2..64 &&
                !CONTROL.containsMatchIn(q)) { "Invalid search query" }
        require(limit in 1..25) { "Invalid Search page size" }
        require(after == null || (CURSOR.matches(after) &&
                after.substringBefore(':').toInt() <= 1_000_000)) {
            "Invalid Search cursor"
        }
        require(city == null || availableOnly) { "City search requires real public Listings" }
        val p = mutableListOf("lang=${lang.code}", "q=${enc(q)}",
            "cursor=1", "limit=$limit")
        if (availableOnly) p += "availableOnly=1"
        if (after != null) p += "after=${enc(after)}"
        if (city != null) p += "city=${city.wire}"
        return ApiCall.get("/api/v1/catalog/search?${p.joinToString("&")}")
    }

    /** Detail is an anonymous fresh public D1 read. No client-supplied owner
     * account, worker bearer, location or calling permission is accepted.
     */
    fun publicListingDetail(listingId: String): ApiCall {
        requireListingId(listingId)
        return ApiCall.get("/api/v1/listings?id=${enc(listingId)}")
    }

    /** Exact, anonymous opt-in approved-category Service information.
     * This request contains NO Worker ID, account, phone, location or bearer.
     */
    fun approvedServiceDetail(
        listingId: String, language: Language, city: NearbyPilotCity? = null, includeProfile: Boolean = false,
    ): ApiCall {
        requireListingId(listingId)
        val path = "/api/v1/listings?id=${enc(listingId)}&view=service&lang=${language.code}"
        return ApiCall.get(path + (if (city == null) "" else "&city=${city.wire}") +
            (if (includeProfile) "&profile=1" else ""))
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
    /** Explicit anonymous all-Category feed, optionally with approved labels. No owner, location,
     * Worker identity or personal filters; the backend rechecks every row.
     * Cursor is one still-public opaque Listing ID from this exact feed.
     */
    fun publicAllListingPage(
        limit: Int = 20, after: String? = null, language: Language? = null,
        categoryId: String? = null, city: NearbyPilotCity? = null,
    ): ApiCall {
        require(limit in 1..25) { "Invalid public feed page size" }
        if (categoryId != null) {
            require(language != null)
            requireCategoryId(categoryId)
        }
        require(city == null || language != null)
        if (after != null) requireListingId(after)
        val mode = if (language == null) "all" else "service"
        val path = "/api/v1/listings?feed=$mode&limit=$limit" +
            (if (after != null) "&after=${enc(after)}" else "") +
            (if (language != null) "&lang=${language.code}" else "") +
            (if (categoryId != null) "&categoryId=${enc(categoryId)}" else "") +
            (if (city != null) "&city=${city.wire}" else "")
        return ApiCall.get(path)
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

    private fun servicePhotoPath(listingId: String): String {
        requireListingId(listingId)
        return "/api/v1/me/service-photo?id=${enc(listingId)}"
    }

    fun ownServicePhoto(token: String, listingId: String, download: Boolean = false): ApiCall =
        ApiCall.getOwned(servicePhotoPath(listingId) + if (download) "&download=1" else "", token)

    fun changeServicePhoto(token: String, listingId: String, revision: Long, jpeg: String?): ApiCall {
        require(revision in 0..2147483646L)
        val path = servicePhotoPath(listingId) + "&revision=$revision"
        if (jpeg == null) return ApiCall.delete(path, token)
        require(jpeg.length in 4..57344 && jpeg.length % 4 == 0 && Regex("[A-Za-z0-9+/]+={0,2}").matches(jpeg))
        return ApiCall.put(path, token, """{"jpeg":"$jpeg"}""")
    }

    fun publicServicePhoto(listingId: String, categoryId: String, city: NearbyPilotCity?): ApiCall {
        requireListingId(listingId)
        requireCategoryId(categoryId)
        val path = "/api/v1/listings/photo?id=${enc(listingId)}&categoryId=${enc(categoryId)}"
        return ApiCall.get(path + if (city == null) "" else "&city=${city.wire}")
    }

    private fun serviceDetailsPath(listingId: String): String {
        requireListingId(listingId)
        return "/api/v1/me/service-details?id=${enc(listingId)}"
    }

    fun ownServiceDetails(token: String, listingId: String): ApiCall =
        ApiCall.getOwned(serviceDetailsPath(listingId), token)

    fun changeServiceDetails(
        token: String, listingId: String, revision: Long, profile: ServiceProfile?,
    ): ApiCall {
        require(revision in 0..2147483646L)
        val path = serviceDetailsPath(listingId) + "&revision=$revision"
        if (profile == null) return ApiCall.delete(path, token)
        val body = buildJsonObject {
            put("displayName", JsonPrimitive(profile.displayName))
            put("description", JsonPrimitive(profile.description))
            put("experienceYears", profile.experienceYears?.let { JsonPrimitive(it) } ?: JsonNull)
            put("visitRateInr", profile.visitRateInr?.let { JsonPrimitive(it) } ?: JsonNull)
        }
        return ApiCall.put(path, token, body.toString())
    }

    private fun serviceAreaPath(listingId: String): String {
        requireListingId(listingId)
        return "/api/v1/me/service-area?id=${enc(listingId)}"
    }

    fun ownServiceArea(token: String, listingId: String): ApiCall =
        ApiCall.getOwned(serviceAreaPath(listingId), token)

    fun changeServiceArea(token: String, listingId: String, city: NearbyPilotCity?, revision: Long): ApiCall {
        require(revision in 0..2147483646L)
        val value = city?.wire ?: "none"
        return ApiCall.put(serviceAreaPath(listingId) + "&revision=$revision", token,
            """{"city":"$value"}""")
    }

    private fun serviceCaseListingPath(base: String, listingId: String): String {
        requireListingId(listingId)
        return "$base?listingId=${enc(listingId)}"
    }

    fun serviceReport(token: String, listingId: String, reason: ServiceReportReason?): ApiCall {
        val path = serviceCaseListingPath("/api/v1/me/service-report", listingId)
        return if (reason == null) ApiCall.getOwned(path, token)
            else ApiCall.post(path, token, """{"reason":"${reason.wire}"}""")
    }

    fun serviceAppealCase(token: String, listingId: String): ApiCall =
        ApiCall.getOwned(serviceCaseListingPath("/api/v1/me/service-appeal", listingId), token)

    fun appealServiceCase(token: String, id: String, revision: Long, reason: ServiceAppealReason): ApiCall {
        requireListingId(id)
        require(revision in 1..2147483646L)
        return ApiCall.post("/api/v1/me/service-appeal?id=${enc(id)}&revision=$revision", token,
            """{"reason":"${reason.wire}"}""")
    }

    private fun contactBlockPath(listingId: String): String {
        requireListingId(listingId)
        return "/api/v1/me/contact-block?listingId=${enc(listingId)}"
    }

    fun contactBlock(token: String, listingId: String): ApiCall =
        ApiCall.getOwned(contactBlockPath(listingId), token)

    fun changeContactBlock(token: String, listingId: String, blocked: Boolean): ApiCall {
        val path = contactBlockPath(listingId)
        return if (blocked) ApiCall.post(path, token) else ApiCall.delete(path, token)
    }

    private val CONTACT_BLOCK_ID = Regex("[a-f0-9]{32}")

    fun contactBlocks(token: String, language: Language, after: String?): ApiCall {
        require(after == null || CONTACT_BLOCK_ID.matches(after))
        val path = "/api/v1/me/contact-blocks?lang=${language.code}" +
            (if (after == null) "" else "&after=$after")
        return ApiCall.getOwned(path, token)
    }

    fun removeContactBlock(token: String, id: String): ApiCall {
        require(CONTACT_BLOCK_ID.matches(id))
        return ApiCall.delete("/api/v1/me/contact-blocks?id=$id", token)
    }

    private const val ACCOUNT_ERASURE = "/api/v1/me/account-erasure"
    private val COMPACT_JWT = Regex("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+")

    fun prepareAccountErasure(token: String): ApiCall = ApiCall.post(ACCOUNT_ERASURE, token)

    fun eraseAccount(token: String, challenge: String, googleProof: String): ApiCall {
        require(challenge.length <= 1024 && COMPACT_JWT.matches(challenge))
        require(googleProof.length <= 4096 && COMPACT_JWT.matches(googleProof))
        return ApiCall.put(ACCOUNT_ERASURE, token,
            """{"challenge":"$challenge","googleProof":"$googleProof"}""")
    }

    /** Private, current-account overview; no owner ID in path, query or body. */
    fun accountOverview(token: String): ApiCall =
        ApiCall.getOwned("/api/v1/me/overview", token)

    /** Read-only, session-bound device status; token never enters URL or UI. */
    fun ownCallDevice(token: String): ApiCall =
        ApiCall.getOwned("/api/v1/me/call-device", token)

    fun callDevice(token: String, registrationToken: String?): ApiCall {
        val path = "/api/v1/me/call-device"
        if (registrationToken == null) return ApiCall.delete(path, token)
        require(registrationToken.length in 1..4096 && registrationToken.all { it in '!'..'~' })
        return ApiCall.put(path, token, buildJsonObject {
            put("registrationToken", JsonPrimitive(registrationToken))
        }.toString())
    }

    fun startCall(token: String, listingId: String, attemptKey: String): ApiCall {
        requireListingId(listingId)
        return ApiCall.callInvitation("/api/v1/me/call-invitation?listingId=$listingId", token, attemptKey)
    }

    fun callHistory(token: String, after: String?): ApiCall {
        if (after != null) requireListingId(after)
        val path = "/api/v1/me/call-history"
        return ApiCall.getOwned(if (after == null) path else "$path?after=$after", token)
    }

    /** Early call-history erasure: explicit account action, never automatic. */
    fun clearCallHistory(token: String): ApiCall =
        ApiCall.delete("/api/v1/me/call-history", token)

    fun callAudioGrant(token: String, id: String): ApiCall {
        requireListingId(id)
        return ApiCall.post("/api/v1/me/call-media?id=$id", token)
    }

    fun callSignal(token: String, id: String, action: CallAction? = null): ApiCall {
        requireListingId(id)
        val path = "/api/v1/me/call?id=$id"
        return if (action == null) ApiCall.getOwned(path, token)
        else ApiCall.put("$path&action=${action.wire}", token)
    }

    private fun callPreferencePath(availability: Boolean) =
        if (availability) "/api/v1/me/call-availability" else "/api/v1/me/call-preference"

    fun callPreference(token: String, availability: Boolean = false): ApiCall =
        ApiCall.getOwned(callPreferencePath(availability), token)

    fun changeCallPreference(token: String, enabled: Boolean, revision: Long, availability: Boolean = false): ApiCall {
        require(revision in 0 until 2147483647L)
        val value = if (enabled) 1 else 0
        return ApiCall.post("${callPreferencePath(availability)}?enabled=$value&revision=$revision", token)
    }

    /** Explicit owner data portability; carries bearer in header only.
     * The API response is private, and no export is fetched before a user action.
     */
    fun accountDataExport(token: String, version: Int = 1): ApiCall {
        require(version in 1..3)
        return ApiCall.getOwned("/api/v1/me/data-export" + if (version > 1) "?version=$version" else "", token)
    }

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
    /** Private, explicit management-only page. Legacy owner pages and all
     * Customer GETs remain byte-for-byte unchanged. Never expose the bearer
     * in URL params or infer paused status from 'visible=false'.
     */
    fun managedOwnListingPage(
        token: String, limit: Int = 20, after: String? = null,
    ): ApiCall {
        require(limit in 1..25) { "Invalid managed owner page size" }
        if (after != null) requireListingId(after)
        val path = "/api/v1/me/listings?limit=$limit&view=management" +
            (if (after != null) "&after=${enc(after)}" else "")
        return ApiCall.getOwned(path, token)
    }

    fun exactManagedOwnListingByCategory(token: String, categoryId: String): ApiCall {
        requireCategoryId(categoryId)
        return ApiCall.getOwned("/api/v1/me/listings?view=management&categoryId=${enc(categoryId)}", token)
    }

    /** Exact current OWNER service, after deliberate selection only.
     * Authentication stays in the header; no arbitrary account or PII in
     * the URI. The API checks ownership and returns generic 404 otherwise.
     */
    fun exactManagedOwnListing(token: String, listingId: String): ApiCall {
        requireListingId(listingId)
        return ApiCall.getOwned(
            "/api/v1/me/listings?id=${enc(listingId)}&view=management", token)
    }

    /** Strict opt-in owner-only revision snapshot, never a public profile or
     * worker identity. Older servers fail explicitly rather than downgrading.
     */
    fun exactVersionedOwnListing(token: String, listingId: String): ApiCall {
        requireListingId(listingId)
        return ApiCall.getOwned(
            "/api/v1/me/listings?id=${enc(listingId)}&view=revision", token)
    }

    /** Fresh owner revision must come from this authenticated session; no
     * arbitrary account ID or client-generated revision can bypass server CAS.
     * Old unversioned Category editing route remains wire-compatible.
     */
    fun editListingCategoryVersioned(
        token: String, listingId: String,
        expectedCategoryId: String, nextCategoryId: String,
        expectedRevision: Long,
    ): ApiCall {
        requireListingId(listingId)
        requireCategoryId(expectedCategoryId)
        requireCategoryId(nextCategoryId)
        require(expectedCategoryId != nextCategoryId)
        require(expectedRevision in 0..2147483646L) { "Invalid Service revision" }
        return ApiCall.put("/api/v1/me/listings?revision=1", token,
            """{"listingId":"$listingId","expectedCategoryId":"$expectedCategoryId","nextCategoryId":"$nextCategoryId","expectedRevision":$expectedRevision}""")
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
    fun createOwnListing(token: String, categoryId: String): ApiCall {
        requireCategoryId(categoryId)
        return ApiCall.post("/api/v1/me/listings?create=1", token,
            """{"categoryId":"$categoryId"}""")
    }

    /** Exact owner Listing resume, never a new upsert. The current server
     * checks paused status, owner, moderation, active account and Category in
     * one atomic UPDATE before returning the same public two-field DTO.
     * Never retry a lost acknowledgement automatically.
     */
    fun resumeOwnListing(
        token: String, listingId: String, expectedCategoryId: String,
    ): ApiCall {
        requireListingId(listingId)
        requireCategoryId(expectedCategoryId)
        return ApiCall.post("/api/v1/me/listings?resume=1", token,
            """{"listingId":"$listingId","expectedCategoryId":"$expectedCategoryId"}""")
    }

    fun changeOwnListingPublication(token: String, review: VersionedOwnListing): ApiCall {
        val row = review.row
        requireListingId(row.id)
        requireCategoryId(row.categoryId)
        require(review.revision in 0..2147483646L)
        val action = when (row.publicationStatus) {
            OwnPublicationStatus.PUBLISHED -> "pause"
            OwnPublicationStatus.UNPUBLISHED -> "resume"
            null -> error("Publication status required")
        }
        return ApiCall.put("/api/v1/me/listings?publication=$action", token,
            """{"listingId":"${row.id}","expectedCategoryId":"${row.categoryId}","expectedRevision":${review.revision}}""")
    }

    /** Existing Listing ID is preserved; old Category compare-and-swap.
     * No owner field, token in URL, GPS, price or public metadata change.
     * An ambiguous PUT response must never be automatically retried.
     */
    fun editListingCategory(
        token: String, listingId: String,
        expectedCategoryId: String, nextCategoryId: String,
    ): ApiCall {
        requireListingId(listingId)
        requireCategoryId(expectedCategoryId)
        requireCategoryId(nextCategoryId)
        require(expectedCategoryId != nextCategoryId) { "No category change" }
        return ApiCall.put("/api/v1/me/listings", token,
            """{"listingId":"$listingId","expectedCategoryId":"$expectedCategoryId","nextCategoryId":"$nextCategoryId"}""")
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
/**
 * Total reply-read budget independent of individual socket readTimeout.
 * A peer can trickle bytes indefinitely while never triggering a socket
 * read timeout. The 10-second HttpsURLConnection readTimeout separately
 * bounds a *blocking* read; this monotonic budget is observed before/after
 * each read, so it is not an asynchronous interruption mechanism.
 *
 * An abnormal InputStream may also return 0 for a nonempty buffer, causing
 * an otherwise infinite busy loop. Tolerate at most eight zero-byte reads
 * in the entire reply, even when interleaved with productive bytes.
 */
internal const val REPLY_READ_BUDGET_NANOS = 20_000_000_000L
internal const val MAX_EMPTY_REPLY_READS = 8
internal fun readBoundedUtf8Reply(
    stream: InputStream,
    monotonicNanos: () -> Long = { System.nanoTime() },
): String {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(4096)
    val started = monotonicNanos()
    var size = 0
    var emptyReads = 0

    fun enforceDeadline() {
        val elapsed = monotonicNanos() - started
        if (elapsed < 0 || elapsed >= REPLY_READ_BUDGET_NANOS) {
            throw InvalidReplyBodyException()
        }
    }
    while (true) {
        enforceDeadline()
        val n = stream.read(buffer)
        enforceDeadline()
        if (n < 0) break
        if (n == 0) {
            if (++emptyReads > MAX_EMPTY_REPLY_READS) throw InvalidReplyBodyException()
            continue
        }
        if (n > buffer.size || size > 65_536 - n) throw InvalidReplyBodyException()
        size += n
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
                val maxBody = when {
                    request.resource == "/api/v1/auth/google" -> 8192
                    request.method == HttpMethod.PUT -> 512
                    else -> 256
                }
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
