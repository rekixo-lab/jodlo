package com.rekixo.jodlo.core.network

import java.io.IOException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import java.nio.charset.StandardCharsets
import kotlinx.serialization.json.jsonPrimitive

/** Typed DTOs for the CURRENT public API. No worker trust, phone, location or permission fields. */
data class PublicCategory(val id: String, val slug: String, val name: String)
data class PublicListing(val id: String, val categoryId: String)
/** Fresh public-only service information: a listing and its SAME approved
 * Category label in the explicitly requested language. No Worker metadata.
 */
data class PublicApprovedServiceDetail(
    val language: Language,
    val listing: PublicListing,
    val category: PublicCategory,
)
/** Optional public Listing pagination: no owner, timestamp, location or contact. */
data class PublicListingPage(val listings: List<PublicListing>, val nextCursor: String?)
/** Private publication intent for authenticated owner Management pages only.
 * Not a Worker moderation reason, public status, approval or contact grant.
 * null means a legacy/read-only reply that cannot authorize management UI.
 */
enum class OwnPublicationStatus { PUBLISHED, UNPUBLISHED }
data class OwnListing(
    val id: String, val categoryId: String, val visible: Boolean,
    val publicationStatus: OwnPublicationStatus? = null,
)
/** Separate opt-in PRIVATE owner page. No worker account or moderation fields. */
data class OwnListingPage(val listings: List<OwnListing>, val nextCursor: String?)
/** Public Search keyset page (not a Category approval, alias or choice).
 * Separate from legacy Search's nextOffset to avoid a silent DTO migration.
 */
data class CatalogSearchCursorPage(
    val language: Language, val query: String,
    val categories: List<PublicCategory>, val nextCursor: String?,
)

/** The backend never returns a verified role from worker opt-in. */
data class WorkerDraft(val status: String)

/** Own-only account overview. No account ID, Google subject, bearer or PII. */
data class OwnAccountOverview(
    val createdAt: String,
    val workerEnabled: Boolean,
    val workerSince: String?,
    val totalServices: Int,
    val publishedServices: Int,
    val visibleServices: Int,
    val activeSessions: Int,
    val receivesCalls: Boolean,
)

/** An explicitly requested owner-only export. Contents can include a Google
 * subject, account references and block relationships. Never place them in
 * logs, Compose text, SavedStateHandle, bundles or persistent app storage.
 * The only intended destination is a user-selected Android document URI.
 */
class OwnAccountDataExport internal constructor(val json: String) {
    override fun toString(): String = "OwnAccountDataExport(<private>)"
}

/** A verified BACKEND-issued session response, not a verified Google identity
 * from client input. Its token must not enter loggers, UI state or disk.
 * Kotlin Strings cannot be securely zeroized; this is memory-only.
 */
class IssuedSession internal constructor(
    internal val accessToken: String,
    val expiresInSeconds: Int,
) {
    override fun toString(): String = "IssuedSession(token=<redacted>, expiresInSeconds=$expiresInSeconds)"
}

data class CatalogBrowse(val language: Language, val categories: List<PublicCategory>, val nextCursor: String?)
data class CatalogSearch(
    val language: Language, val query: String,
    val categories: List<PublicCategory>, val nextOffset: Int?,
    val needsChoice: Boolean, val choices: List<PublicCategory>,
)

/** Never retain the raw body, URL, bearer or server-supplied error message in failures. */
enum class FailureKind {
    UNAUTHORIZED, FORBIDDEN, BAD_INPUT, NOT_FOUND, CONFLICT, RATE_LIMITED,
    SERVICE_UNAVAILABLE, OFFLINE_OR_TIMEOUT, BAD_RESPONSE,
}
sealed class ApiOutcome<out T> {
    data class Ok<T>(val value: T) : ApiOutcome<T>()
    data class Failed(val kind: FailureKind, val retryable: Boolean) : ApiOutcome<Nothing>()
}

/** One attempt only. A timed-out POST may already have committed: never replay it. */
fun <T> performOnce(call: ApiCall, send: (ApiCall) -> TransportReply,
                    decode: (TransportReply) -> ApiOutcome<T>): ApiOutcome<T> =
    try {
        decode(send(call))
    } catch (_: InvalidReplyBodyException) {
        ApiOutcome.Failed(FailureKind.BAD_RESPONSE, retryable = false)
    } catch (_: IOException) {
        ApiOutcome.Failed(FailureKind.OFFLINE_OR_TIMEOUT, retryable = false)
    }

/**
 * A JSON object with repeated keys is ambiguous even if the JSON library
 * silently keeps only one value. Run this scanner ONLY AFTER the strict JSON
 * parser has verified the complete input grammar, so braces, commas and
 * quote escapes can be tracked without a second full JSON parser.
 *
 * Every object has an independent key set, including objects inside arrays
 * and nested error/session/listing payloads. Decode escaped key names with
 * the SAME JSON parser: "id" and "\u0069d" are the same property.
 *
 * Responses are already capped at 65,536 UTF-8 bytes before this runs.
 * This is a response-integrity check, not verification of server/TLS identity.
 */
private data class JsonKeyFrame(
    val keys: MutableSet<String>?,
    var expectsKey: Boolean = false,
)

private fun hasDuplicateReplyObjectKeys(source: String, parser: Json): Boolean {
    val stack = java.util.ArrayDeque<JsonKeyFrame>()
    var i = 0
    while (i < source.length) {
        when (source[i]) {
            '{' -> stack.addLast(JsonKeyFrame(hashSetOf(), expectsKey = true))
            '[' -> stack.addLast(JsonKeyFrame(null))
            '}', ']' -> stack.removeLast()
            ',' -> stack.peekLast()?.let { if (it.keys != null) it.expectsKey = true }
            '"' -> {
                val start = i
                i += 1
                while (i < source.length) {
                    if (source[i] == '\\') {
                        i += 2 // Skip escaped quote/backslash or escape prefix.
                    } else if (source[i] == '"') {
                        i += 1
                        break
                    } else {
                        i += 1
                    }
                }
                val frame = stack.peekLast()
                val keys = frame?.keys
                if (frame != null && keys != null && frame.expectsKey) {
                    val rawKey = source.substring(start, i)
                    val key = if ('\\' in rawKey) {
                        parser.parseToJsonElement(rawKey).jsonPrimitive.content
                    } else {
                        rawKey.substring(1, rawKey.length - 1)
                    }
                    if (!keys.add(key)) return true
                    frame.expectsKey = false
                }
                continue
            }
        }
        i += 1
    }
    return false
}

object JodloReplyDecoder {
    private val json = Json { isLenient = false }
    private val categoryId = Regex("[A-Za-z0-9_-]{1,64}")
    private val opaqueId = Regex("[A-Za-z0-9_-]{8,128}")
    private val cursor = Regex("(0|[1-9][0-9]{0,6}):[A-Za-z0-9_-]{1,64}")
    private val codes = mapOf(
        "UNAUTHORIZED" to FailureKind.UNAUTHORIZED,
        "FORBIDDEN" to FailureKind.FORBIDDEN,
        "INVALID_QUERY" to FailureKind.BAD_INPUT,
        "NOT_FOUND" to FailureKind.NOT_FOUND,
        "CONFLICT" to FailureKind.CONFLICT,
        "METHOD_NOT_ALLOWED" to FailureKind.BAD_INPUT,
        "RATE_LIMITED" to FailureKind.RATE_LIMITED,
        "SERVICE_UNAVAILABLE" to FailureKind.SERVICE_UNAVAILABLE,
    )
    private class InvalidProtocol : Exception()
    private fun bad(): Nothing = throw InvalidProtocol()
    private fun JsonElement.obj(): JsonObject = this as? JsonObject ?: bad()
    private fun JsonElement.arr(): JsonArray = this as? JsonArray ?: bad()
    private fun JsonElement.str(): String = (this as? JsonPrimitive)
        ?.takeIf { it.isString }?.content ?: bad()
    private fun JsonElement.bool(): Boolean = (this as? JsonPrimitive)
        ?.takeUnless { it.isString }?.booleanOrNull ?: bad()
    private fun JsonElement.number(): Int = (this as? JsonPrimitive)
        ?.takeUnless { it.isString }?.intOrNull ?: bad()
    private fun JsonObject.keysOnly(required: Set<String>, optional: Set<String> = emptySet()) {
        if (!keys.containsAll(required) || !keys.all { it in required || it in optional }) bad()
    }
    private fun JsonObject.required(name: String): JsonElement = get(name) ?: bad()
    private fun JsonObject.optionalString(name: String): String? = when (val v = this[name]) {
        null, JsonNull -> null
        else -> v.str()
    }
    private fun language(input: JsonElement): Language = when (input.str()) {
        "hi" -> Language.HI
        "en" -> Language.EN
        else -> bad()
    }
    private fun category(input: JsonElement): PublicCategory {
        val p = input.obj()
        p.keysOnly(setOf("id", "slug", "name"))
        val id = p.required("id").str()
        val slug = p.required("slug").str()
        val name = p.required("name").str()
        if (!categoryId.matches(id) || !categoryId.matches(slug) ||
            name.isBlank() || name.codePointCount(0, name.length) > 160 ||
            name.any { Character.isISOControl(it) }) bad()
        return PublicCategory(id, slug, name)
    }
    private fun categories(value: JsonElement, max: Int): List<PublicCategory> {
        val arr = value.arr()
        if (arr.size > max) bad()
        val mapped = arr.map(::category)
        if (mapped.map { it.id }.toSet().size != mapped.size) bad()
        return mapped
    }
    private fun listing(value: JsonElement): PublicListing {
        val p = value.obj()
        p.keysOnly(setOf("id", "categoryId"))
        val id = p.required("id").str()
        val cat = p.required("categoryId").str()
        if (!opaqueId.matches(id) || !categoryId.matches(cat)) bad()
        return PublicListing(id, cat)
    }
    private fun listings(value: JsonElement, max: Int): List<PublicListing> {
        val arr = value.arr()
        if (arr.size > max) bad()
        val mapped = arr.map(::listing)
        if (mapped.map { it.id }.toSet().size != mapped.size) bad()
        return mapped
    }
    private fun nextCursor(p: JsonObject): String? {
        val value = p.optionalString("nextCursor")
        if (value != null && (!cursor.matches(value) ||
            (value.substringBefore(':').toLongOrNull() ?: Long.MAX_VALUE) > 1_000_000)) bad()
        return value
    }
    /** Fail closed on redirects, HTTP/JSON mismatches, private fields and oversized results. */
    private fun <T> decode(reply: TransportReply, parse: (JsonObject) -> T): ApiOutcome<T> {
        if (reply.status !in 200..599 || reply.body.toByteArray(Charsets.UTF_8).size > 65_536)
            return ApiOutcome.Failed(FailureKind.BAD_RESPONSE, false)
        return try {
            val parsed = json.parseToJsonElement(reply.body)
            // JSON object maps can discard an earlier value of a repeated key.
            // Reject ambiguous root, nested, escaped and array-object fields.
            if (hasDuplicateReplyObjectKeys(reply.body, json)) bad()
            val root = parsed.obj()
            val ok = root.required("ok").bool()
            if (reply.status == 200 && ok) {
                root.keysOnly(setOf("ok", "data"))
                ApiOutcome.Ok(parse(root.required("data").obj()))
            } else if (reply.status in 400..599 && !ok) {
                root.keysOnly(setOf("ok", "error"))
                val error = root.required("error").obj()
                error.keysOnly(setOf("code", "message"))
                val code = error.required("code").str()
                // Never display/store the untrusted message returned by the service.
                error.required("message").str()
                val kind = codes[code] ?: bad()
                val statusMatches = when (kind) {
                    FailureKind.UNAUTHORIZED -> reply.status == 401
                    FailureKind.FORBIDDEN -> reply.status == 403
                    FailureKind.BAD_INPUT -> reply.status == 400 || reply.status == 405
                    FailureKind.NOT_FOUND -> reply.status == 404
                    FailureKind.CONFLICT -> reply.status == 409
                    FailureKind.RATE_LIMITED -> reply.status == 429
                    FailureKind.SERVICE_UNAVAILABLE -> reply.status == 503
                    else -> false
                }
                if (!statusMatches) bad()
                // No generic retry permission: the original request may be POST/DELETE.
                ApiOutcome.Failed(kind, retryable = false)
            } else bad()
        } catch (_: Exception) {
            ApiOutcome.Failed(FailureKind.BAD_RESPONSE, retryable = false)
        }
    }
    /** Strict, optional reviewed-hierarchy response. No private or extra
     * field may enter the UI; duplicate JSON keys are rejected by decode().
     */
    fun hierarchy(reply: TransportReply): ApiOutcome<HierarchyPage> =
        decode(reply) { data ->
            data.keysOnly(setOf("language", "level", "parentId", "items", "nextCursor"))
            val language = language(data.required("language"))
            val level = HierarchyLevel.fromCode(data.required("level").str()) ?: bad()
            val parent = data.optionalString("parentId")
            if ((level == HierarchyLevel.GROUPS) != (parent == null) ||
                (parent != null && !categoryId.matches(parent))) bad()
            val nodes = data.required("items").arr()
            if (nodes.size > 25) bad()
            val items = nodes.map { element ->
                val node = element.obj()
                val leaf = level == HierarchyLevel.CATEGORIES
                node.keysOnly(if (leaf) setOf("id", "name", "slug")
                    else setOf("id", "name"))
                val id = node.required("id").str()
                val name = node.required("name").str()
                val slug = if (leaf) node.required("slug").str() else null
                if (!categoryId.matches(id) ||
                    (slug != null && !categoryId.matches(slug)) ||
                    name.isBlank() || name.codePointCount(0, name.length) > 160 ||
                    name.any { Character.isISOControl(it) }) bad()
                HierarchyItem(id, name, slug)
            }
            if (items.map { it.id }.toSet().size != items.size) bad()
            val cursor = data.optionalString("nextCursor")
            if (cursor != null && (!categoryId.matches(cursor) ||
                items.lastOrNull()?.id != cursor)) bad()
            HierarchyPage(language, level, parent, items, cursor)
        }

    fun browse(reply: TransportReply): ApiOutcome<CatalogBrowse> = decode(reply) { data ->
        data.keysOnly(setOf("language", "categories"), setOf("nextCursor"))
        CatalogBrowse(language(data.required("language")),
            categories(data.required("categories"), 100), nextCursor(data))
    }
    /** No offset/needsChoice/choices accepted in cursor Search mode. Require
     * server's explicit nextCursor (null marks end), never an omitted token.
     */
    fun searchCursor(reply: TransportReply): ApiOutcome<CatalogSearchCursorPage> =
        decode(reply) { data ->
            data.keysOnly(setOf("language", "query", "categories", "nextCursor"))
            val q = data.required("query").str()
            if (q.codePointCount(0, q.length) !in 2..64 ||
                q.any { Character.isISOControl(it) }) bad()
            val selected = categories(data.required("categories"), 25)
            CatalogSearchCursorPage(
                language(data.required("language")), q, selected, nextCursor(data),
            )
        }

    fun search(reply: TransportReply): ApiOutcome<CatalogSearch> = decode(reply) { data ->
        data.keysOnly(setOf("language", "query", "categories", "nextOffset"),
            setOf("needsChoice", "choices"))
        val q = data.required("query").str()
        if (q.codePointCount(0, q.length) !in 2..64 ||
            q.any { Character.isISOControl(it) }) bad()
        val selected = categories(data.required("categories"), 25)
        val next = when (val raw = data.required("nextOffset")) {
            JsonNull -> null
            // The matching JodloRoutes.search API accepts offset at most 100.
            else -> raw.number().also { if (it !in 0..100) bad() }
        }
        val confirmation = data["needsChoice"]?.bool() ?: false
        val choices = data["choices"]?.let { categories(it, 10) } ?: emptyList()
        if (confirmation) {
            if (!data.containsKey("choices") || selected.isNotEmpty() || next != null) bad()
        } else if (data.containsKey("choices") || data.containsKey("needsChoice")) bad()
        CatalogSearch(language(data.required("language")), q, selected, next,
            confirmation, choices)
    }
    /** The detail cannot return private Worker/account identity, status,
     * contact, location, badges or media: reuse exact public listing allowlist.
     */
    fun publicListingDetail(reply: TransportReply): ApiOutcome<PublicListing> =
        decode(reply) { data ->
            data.keysOnly(setOf("listing"))
            listing(data.required("listing"))
        }

    /** Strict opt-in public Service detail. The approved name is read from
     * the SAME current server visibility SQL as the Listing, not a stale
     * feed cache or a Worker-submitted biography/price/verified claim.
     */
    fun approvedServiceDetail(reply: TransportReply): ApiOutcome<PublicApprovedServiceDetail> =
        decode(reply) { data ->
            data.keysOnly(setOf("language", "listing", "category"))
            val lang = language(data.required("language"))
            val current = listing(data.required("listing"))
            val approved = category(data.required("category"))
            if (current.categoryId != approved.id) bad()
            PublicApprovedServiceDetail(lang, current, approved)
        }

    fun publicListings(reply: TransportReply): ApiOutcome<List<PublicListing>> = decode(reply) { data ->
        data.keysOnly(setOf("listings"))
        listings(data.required("listings"), 25)
    }
    /** Separate from legacy publicListings: pagination MUST use its own
     * exact wire DTO, never silently accept a missing/extra cursor field.
     */
    fun publicListingPage(reply: TransportReply): ApiOutcome<PublicListingPage> = decode(reply) { data ->
        data.keysOnly(setOf("listings", "nextCursor"))
        val rows = listings(data.required("listings"), 25)
        val after = data.optionalString("nextCursor")
        if (after != null && !opaqueId.matches(after)) bad()
        PublicListingPage(rows, after)
    }
    fun published(reply: TransportReply): ApiOutcome<PublicListing> = decode(reply) { data ->
        data.keysOnly(setOf("listing"))
        listing(data.required("listing"))
    }
    /** Reuse the exact owner row validation in BOTH legacy and paged replies;
     * hidden/unpublished records remain private visible=false values.
     */
    private fun ownerRows(input: JsonElement, max: Int): List<OwnListing> {
        val raw = input.arr()
        if (raw.size > max) bad()
        val rows = raw.map { element ->
            val row = element.obj()
            row.keysOnly(setOf("id", "categoryId", "visible"))
            val value = listing(JsonObject(mapOf(
                "id" to row.required("id"), "categoryId" to row.required("categoryId")
            )))
            OwnListing(value.id, value.categoryId, row.required("visible").bool())
        }
        if (rows.map { it.id }.toSet().size != rows.size) bad()
        return rows
    }
    fun ownListings(reply: TransportReply): ApiOutcome<List<OwnListing>> = decode(reply) { data ->
        data.keysOnly(setOf("listings"))
        ownerRows(data.required("listings"), 100)
    }
    /** Mandatory nextCursor key only on opt-in page; the backend uses an
     * opaque Listing ID, NOT the public Category sort-order:id cursor.
     */
    fun ownListingPage(reply: TransportReply): ApiOutcome<OwnListingPage> = decode(reply) { data ->
        data.keysOnly(setOf("listings", "nextCursor"))
        val rows = ownerRows(data.required("listings"), 25)
        val next = data.optionalString("nextCursor")
        if (next != null && !opaqueId.matches(next)) bad()
        OwnListingPage(rows, next)
    }
    /** Shared exact owner-only projection; unpublished is a Worker intent,
     * not a disclosure of moderation reasons, worker account or location.
     */
    private fun managedOwnRow(element: JsonElement): OwnListing {
        val row = element.obj()
        row.keysOnly(setOf("id", "categoryId", "visible", "publicationStatus"))
        val value = listing(JsonObject(mapOf(
            "id" to row.required("id"), "categoryId" to row.required("categoryId"),
        )))
        val visible = row.required("visible").bool()
        val publication = when (row.required("publicationStatus").str()) {
            "published" -> OwnPublicationStatus.PUBLISHED
            "unpublished" -> OwnPublicationStatus.UNPUBLISHED
            else -> bad()
        }
        if (visible && publication != OwnPublicationStatus.PUBLISHED) bad()
        return OwnListing(value.id, value.categoryId, visible, publication)
    }

    /** Exact owner GET accepts one row ONLY, never a page fallback or
     * omitted revision/worker account. Decoder forbids private extra keys.
     */
    fun exactManagedOwnListing(reply: TransportReply): ApiOutcome<OwnListing> =
        decode(reply) { data ->
            data.keysOnly(setOf("listing"))
            managedOwnRow(data.required("listing"))
        }

    /** Explicit MANAGEMENT owner page: the extra status is required here
     * and forbidden in every legacy/public parser. 'published' but invisible
     * is possible after Category/moderation changes; it must NOT be presented
     * as Worker-paused. No moderation verdict or owner identity is returned.
     */
    fun managedOwnListingPage(reply: TransportReply): ApiOutcome<OwnListingPage> =
        decode(reply) { data ->
            data.keysOnly(setOf("listings", "nextCursor"))
            val raw = data.required("listings").arr()
            if (raw.size > 25) bad()
            val rows = raw.map(::managedOwnRow)
            if (rows.map { it.id }.toSet().size != rows.size) bad()
            val next = data.optionalString("nextCursor")
            if (next != null && !opaqueId.matches(next)) bad()
            OwnListingPage(rows, next)
        }

    /** Only the exact private overview projection is accepted. Refuse any
     * unexpected identity, contact, location, verification or token fields.
     */
    fun accountOverview(reply: TransportReply): ApiOutcome<OwnAccountOverview> =
        decode(reply) { data ->
            data.keysOnly(setOf(
                "createdAt", "workerEnabled", "workerSince", "totalServices",
                "publishedServices", "visibleServices", "activeSessions", "receivesCalls",
            ))
            val created = data.required("createdAt").str()
            val worker = data.required("workerEnabled").bool()
            val workerSince = data.optionalString("workerSince")
            val total = data.required("totalServices").number()
            val published = data.required("publishedServices").number()
            val visible = data.required("visibleServices").number()
            val sessions = data.required("activeSessions").number()
            if (created.length !in 10..40 || created.any { Character.isISOControl(it) } ||
                (workerSince != null &&
                    (workerSince.length !in 10..40 ||
                        workerSince.any { Character.isISOControl(it) })) ||
                worker != (workerSince != null) ||
                total !in 0..100000 || published !in 0..total ||
                visible !in 0..published || sessions !in 0..6) bad()
            OwnAccountOverview(
                created, worker, workerSince, total, published, visible, sessions,
                data.required("receivesCalls").bool(),
            )
        }

    /** Strict versioned owner-export contract; unlike a public listing
     * projection, this is allowed to contain the requesting owner's personal
     * fields only after authenticated D1 lookup and explicit user action.
     * Unknown fields, overlarge arrays and mismatched types fail closed.
     */
    fun accountDataExport(reply: TransportReply): ApiOutcome<OwnAccountDataExport> =
        decode(reply) { data ->
            data.keysOnly(setOf(
                "schemaVersion", "account", "identity", "services",
                "callPreferences", "availabilityPreferences", "blocksMade",
                "abuseCounters", "sessions", "limitations",
            ))
            if (data.required("schemaVersion").number() != 1) bad()
            val account = data.required("account").obj()
            account.keysOnly(setOf(
                "accountId", "createdAt", "workerEnabled", "workerSince",
                "totalServices", "publishedServices", "visibleServices",
                "activeSessions", "receivesCalls",
            ))
            val accountId = account.required("accountId").str()
            if (!opaqueId.matches(accountId)) bad()
            val ownOverview = JsonObject(account - "accountId")
            val overviewReply = TransportReply(200,
                """{"ok":true,"data":${ownOverview}}""")
            if (accountOverview(overviewReply) !is ApiOutcome.Ok) bad()

            fun rows(name: String, max: Int, check: (JsonObject) -> Unit) {
                val list = data.required(name).arr()
                if (list.size > max) bad()
                list.forEach { check(it.obj()) }
            }
            fun safeText(element: JsonElement, min: Int = 1, max: Int = 255): String {
                val value = element.str()
                if (value.length !in min..max ||
                    value.any { Character.isISOControl(it) }) bad()
                return value
            }
            fun positiveRevision(element: JsonElement): Int =
                element.number().also { if (it !in 1..2147483647) bad() }
            fun JsonElement.longValue(): Long = (this as? JsonPrimitive)
                ?.takeUnless { it.isString }?.longOrNull ?: bad()

            rows("identity", 1) { row ->
                row.keysOnly(setOf("googleSub"))
                safeText(row.required("googleSub"))
            }
            rows("services", 1000) { row ->
                row.keysOnly(setOf("id", "categoryId", "status", "moderationStatus", "createdAt"))
                if (!opaqueId.matches(row.required("id").str()) ||
                    !categoryId.matches(row.required("categoryId").str()) ||
                    row.required("status").str() !in setOf("published", "unpublished") ||
                    row.required("moderationStatus").str() !in setOf("allowed", "hidden")) bad()
                safeText(row.required("createdAt"), 10, 48)
            }
            rows("callPreferences", 1) { row ->
                row.keysOnly(setOf("callsEnabled", "revision"))
                if (row.required("callsEnabled").number() !in 0..1) bad()
                positiveRevision(row.required("revision"))
            }
            rows("availabilityPreferences", 1) { row ->
                row.keysOnly(setOf("acceptingCalls", "revision"))
                if (row.required("acceptingCalls").number() !in 0..1) bad()
                positiveRevision(row.required("revision"))
            }
            rows("blocksMade", 1000) { row ->
                row.keysOnly(setOf("blockedAccountId"))
                if (!opaqueId.matches(row.required("blockedAccountId").str())) bad()
            }
            rows("abuseCounters", 1) { row ->
                row.keysOnly(setOf(
                    "scope", "windowStartMs", "expiresAtMs", "attemptCount", "revision",
                ))
                if (row.required("scope").str() != "invite") bad()
                val start = row.required("windowStartMs").longValue()
                val end = row.required("expiresAtMs").longValue()
                if (start < 0L || end <= start ||
                    row.required("attemptCount").number() !in 0..2147483647) bad()
                positiveRevision(row.required("revision"))
            }
            rows("sessions", 1000) { row ->
                row.keysOnly(setOf("createdAt", "expiresAt"))
                val start = row.required("createdAt").longValue()
                val expiry = row.required("expiresAt").longValue()
                if (start < 0L || expiry <= start) bad()
            }
            val limitations = data.required("limitations").arr()
            if (limitations.isEmpty() || limitations.size > 8) bad()
            limitations.forEach { safeText(it, 1, 250) }
            val serialized = data.toString() // JSON data only, not the API envelope.
            if (serialized.toByteArray(StandardCharsets.UTF_8).size > 60_000) bad()
            OwnAccountDataExport(serialized)
        }

    /** Exact /auth/google success body, only for a trusted HTTPS exchange. */
    fun issuedSession(reply: TransportReply): ApiOutcome<IssuedSession> = decode(reply) { data ->
        data.keysOnly(setOf("accessToken", "tokenType", "expiresInSeconds"))
        val token = data.required("accessToken").str()
        if (!Regex("[A-Za-z0-9_-]{43}").matches(token) ||
            data.required("tokenType").str() != "Bearer") bad()
        val ttl = data.required("expiresInSeconds").number()
        if (ttl !in 1..3600) bad()
        IssuedSession(token, ttl)
    }
    /** /auth/logout and /auth/logout-all are NOT interchangeable. */
    fun revoked(reply: TransportReply, allDevices: Boolean): ApiOutcome<Boolean> = decode(reply) { data ->
        if (allDevices) data.keysOnly(setOf("revoked", "allDevices"))
        else data.keysOnly(setOf("revoked"))
        if (!data.required("revoked").bool() ||
            (allDevices && data.required("allDevices").bool() != true)) bad()
        true
    }
    fun workerDraft(reply: TransportReply): ApiOutcome<WorkerDraft> = decode(reply) { data ->
        data.keysOnly(setOf("profile"))
        val profile = data.required("profile").obj()
        profile.keysOnly(setOf("status"))
        val status = profile.required("status").str()
        if (status != "draft") bad()
        WorkerDraft(status)
    }
    fun unpublished(reply: TransportReply): ApiOutcome<Boolean> = decode(reply) { data ->
        data.keysOnly(setOf("unpublished"))
        if (data.required("unpublished").bool() != true) bad()
        true
    }
}
