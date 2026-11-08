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
enum class ServiceReportReason(val wire: String) {
    MISLEADING("misleading"), UNSAFE("unsafe"), PRIVACY("privacy"), SPAM("spam"),
}
enum class ServiceAppealReason(val wire: String) {
    CORRECTED("corrected"), MISTAKEN("mistaken"),
}
enum class ServiceCaseStatus(val wire: String) {
    UPHELD("upheld"), APPEALED("appealed"), RESTORED("restored"), APPEAL_DENIED("appeal_denied"),
}
data class OwnServiceCase(
    val id: String, val reason: ServiceReportReason, val status: ServiceCaseStatus, val revision: Long,
)

class AccountErasureChallenge(val challenge: String, val nonce: String)

data class PublicCategory(val id: String, val slug: String, val name: String)
data class PublicListing(val id: String, val categoryId: String)
data class ServiceProfile(
    val displayName: String, val description: String,
    val experienceYears: Int?, val visitRateInr: Int?,
)
enum class ServiceProfileStatus { PENDING, APPROVED, REJECTED }
data class OwnServiceDetails(
    val profile: ServiceProfile?, val status: ServiceProfileStatus?, val revision: Long,
)
/** Fresh public-only service information: a listing and its SAME approved
 * Category label in the explicitly requested language. No Worker metadata.
 */
data class PublicApprovedServiceDetail(
    val language: Language,
    val listing: PublicListing,
    val category: PublicCategory,
    val city: NearbyPilotCity? = null,
    val profile: ServiceProfile? = null,
    val hasPhoto: Boolean = false,
)
enum class ServicePhotoStatus { CLEARED, PENDING, APPROVED, REJECTED }
class ServicePhoto(val jpeg: String)
class OwnServicePhoto(val status: ServicePhotoStatus, val revision: Long, val photo: ServicePhoto?)

/** Optional public Listing pagination: no owner, timestamp, location or contact. */
data class PublicListingPage(val listings: List<PublicListing>, val nextCursor: String?)
data class LocalizedPublicListingPage(
    val page: PublicListingPage,
    val language: Language,
    val categoryNames: Map<String, String>,
    val city: NearbyPilotCity? = null,
)
data class OwnServiceArea(val city: NearbyPilotCity?, val revision: Long)
/** Private publication intent for authenticated owner Management pages only.
 * Not a Worker moderation reason, public status, approval or contact grant.
 * null means a legacy/read-only reply that cannot authorize management UI.
 */
enum class OwnPublicationStatus { PUBLISHED, UNPUBLISHED }
data class OwnListing(
    val id: String, val categoryId: String, val visible: Boolean,
    val publicationStatus: OwnPublicationStatus? = null,
)
/** Only an exact authenticated OWNER revision read can supply this value.
 * Not a public Worker field, login generation or proof of live visibility.
 */
data class VersionedOwnListing(val row: OwnListing, val revision: Long)
data class VersionedCategoryEditReceipt(val listing: PublicListing, val revision: Long)

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

data class OwnCallPreference(val enabled: Boolean, val revision: Long)

data class OwnContactBlock(val id: String, val categoryName: String?)
data class OwnContactBlocks(val items: List<OwnContactBlock>, val nextCursor: String?)

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
 * Both network replies and user-selected JSON files must be strictly parsed
 * and size-capped BEFORE calling this shared duplicate-key scanner.
 * This is an integrity check, not verification of server/TLS identity.
 */
private data class JsonKeyFrame(
    val keys: MutableSet<String>?,
    var expectsKey: Boolean = false,
)

internal fun hasDuplicateJsonObjectKeys(source: String, parser: Json): Boolean {
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
        val name = categoryName(p.required("name"))
        if (!categoryId.matches(id) || !categoryId.matches(slug)) bad()
        return PublicCategory(id, slug, name)
    }
    private fun categoryName(input: JsonElement): String {
        val name = input.str()
        if (name.isBlank() || name.codePointCount(0, name.length) > 160 ||
            name.any { Character.isISOControl(it) }) bad()
        return name
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
            if (hasDuplicateJsonObjectKeys(reply.body, json)) bad()
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
            data.keysOnly(setOf("language", "listing", "category"), setOf("city", "profile", "hasPhoto"))
            val lang = language(data.required("language"))
            val current = listing(data.required("listing"))
            val approved = category(data.required("category"))
            if (current.categoryId != approved.id) bad()
            PublicApprovedServiceDetail(lang, current, approved, data["city"]?.let(::serviceCity),
                data["profile"]?.takeUnless { it == JsonNull }?.obj()?.let(::serviceProfile),
                data["hasPhoto"]?.bool() ?: false)
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
        listingPage(data)
    }

    fun localizedPublicListingPage(reply: TransportReply): ApiOutcome<LocalizedPublicListingPage> =
        decode(reply) { data ->
            data.keysOnly(setOf("listings", "nextCursor", "language", "categoryNames"), setOf("city"))
            val page = listingPage(data)
            val categoryIds = page.listings.mapTo(mutableSetOf()) { it.categoryId }
            val names = data.required("categoryNames").obj()
            if (!categoryIds.containsAll(names.keys)) bad()
            LocalizedPublicListingPage(
                page, language(data.required("language")), names.mapValues { categoryName(it.value) },
                data["city"]?.let(::serviceCity),
            )
        }

    private fun listingPage(data: JsonObject): PublicListingPage {
        val rows = listings(data.required("listings"), 25)
        val after = data.optionalString("nextCursor")
        if (after != null && !opaqueId.matches(after)) bad()
        return PublicListingPage(rows, after)
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

    private fun readRevision(element: JsonElement): Long {
        val raw = element.jsonPrimitive
        if (raw.isString || !Regex("(?:0|[1-9][0-9]{0,9})").matches(raw.content)) bad()
        val value = raw.longOrNull ?: bad()
        if (value !in 0..2147483647L) bad()
        return value
    }

    /** V2 PRIVATE one-row owner status. Older four-field DTOs are rejected
     * here; the original parsers keep their unchanged exact allowlists.
     */
    fun exactVersionedOwnListing(reply: TransportReply): ApiOutcome<VersionedOwnListing> =
        decode(reply) { data ->
            data.keysOnly(setOf("listing"))
            val raw = data.required("listing").obj()
            raw.keysOnly(setOf("id","categoryId","visible","publicationStatus","revision"))
            val revision = readRevision(raw.required("revision"))
            val row = managedOwnRow(JsonObject(raw.filterKeys { it != "revision" }))
            VersionedOwnListing(row,revision)
        }

    /** A positive v2 CAS response confirms one specific write only. The
     * client never assumes this is a fresh snapshot after a second-device
     * mutation; another read is necessary before a later edit.
     */
    fun versionedEditReceipt(reply: TransportReply): ApiOutcome<VersionedCategoryEditReceipt> =
        decode(reply) { data ->
            data.keysOnly(setOf("listing"))
            val raw = data.required("listing").obj()
            raw.keysOnly(setOf("id","categoryId","revision"))
            val revision=readRevision(raw.required("revision"))
            val listing=listing(JsonObject(raw.filterKeys { it != "revision" }))
            VersionedCategoryEditReceipt(listing,revision)
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
    private fun servicePhoto(value: JsonElement): ServicePhoto {
        val jpeg = value.str()
        if (jpeg.length !in 4..57344 || jpeg.length % 4 != 0 ||
            !Regex("[A-Za-z0-9+/]+={0,2}").matches(jpeg)) bad()
        return ServicePhoto(jpeg)
    }

    fun publicServicePhoto(reply: TransportReply): ApiOutcome<ServicePhoto> = decode(reply) { data ->
        data.keysOnly(setOf("jpeg"))
        servicePhoto(data.required("jpeg"))
    }

    fun ownServicePhoto(reply: TransportReply): ApiOutcome<OwnServicePhoto> = decode(reply) { data ->
        data.keysOnly(setOf("status", "revision"), setOf("jpeg"))
        val status = when (data.required("status").str()) {
            "cleared" -> ServicePhotoStatus.CLEARED
            "pending" -> ServicePhotoStatus.PENDING
            "approved" -> ServicePhotoStatus.APPROVED
            "rejected" -> ServicePhotoStatus.REJECTED
            else -> bad()
        }
        val revision = readRevision(data.required("revision"))
        val photo = data["jpeg"]?.takeUnless { it == JsonNull }?.let(::servicePhoto)
        if (status == ServicePhotoStatus.CLEARED && photo != null ||
            status != ServicePhotoStatus.CLEARED && revision < 1) bad()
        OwnServicePhoto(status, revision, photo)
    }

    private fun serviceProfile(data: JsonObject): ServiceProfile {
        data.keysOnly(setOf("displayName", "description", "experienceYears", "visitRateInr"))
        val name = data.required("displayName").str()
        val description = data.required("description").str()
        if (name.codePointCount(0, name.length) !in 2..60 ||
            description.codePointCount(0, description.length) !in 10..400 ||
            name.any { Character.isISOControl(it) } ||
            description.any { Character.isISOControl(it) }) bad()
        val years = data.required("experienceYears").takeUnless { it == JsonNull }?.number()
        val rate = data.required("visitRateInr").takeUnless { it == JsonNull }?.number()
        if (years != null && years !in 0..80 || rate != null && rate !in 1..10_000_000) bad()
        return ServiceProfile(name, description, years, rate)
    }

    fun ownServiceDetails(reply: TransportReply): ApiOutcome<OwnServiceDetails> = decode(reply) { data ->
        data.keysOnly(setOf("details", "revision"))
        val revision = readRevision(data.required("revision"))
        val details = data.required("details")
        if (details == JsonNull) {
            OwnServiceDetails(null, null, revision)
        } else {
            val row = details.obj()
            val status = when (row.required("status").str()) {
                "pending" -> ServiceProfileStatus.PENDING
                "approved" -> ServiceProfileStatus.APPROVED
                "rejected" -> ServiceProfileStatus.REJECTED
                else -> bad()
            }
            if (revision < 1 || readRevision(row.required("revision")) != revision) bad()
            OwnServiceDetails(serviceProfile(JsonObject(row - setOf("status", "revision"))), status, revision)
        }
    }

    private fun serviceCity(input: JsonElement): NearbyPilotCity {
        val wire = input.str()
        return NearbyPilotCity.entries.firstOrNull { it.wire == wire } ?: bad()
    }

    fun ownServiceArea(reply: TransportReply): ApiOutcome<OwnServiceArea> = decode(reply) { data ->
        data.keysOnly(setOf("city", "revision"))
        val city = data.required("city")
        OwnServiceArea(if (city == JsonNull) null else serviceCity(city),
            readRevision(data.required("revision")))
    }

    fun serviceReport(reply: TransportReply): ApiOutcome<Boolean> = decode(reply) { data ->
        data.keysOnly(setOf("received"))
        data.required("received").bool()
    }

    fun serviceAppealCase(reply: TransportReply): ApiOutcome<OwnServiceCase?> = decode(reply) { data ->
        data.keysOnly(setOf("case"))
        val entry = data.required("case")
        if (entry == JsonNull) null else {
            val row = entry.obj()
            row.keysOnly(setOf("id", "reason", "status", "revision"))
            val id = row.required("id").str()
            val reason = row.required("reason").str()
            val status = row.required("status").str()
            val revision = readRevision(row.required("revision"))
            if (!opaqueId.matches(id) || revision < 1) bad()
            OwnServiceCase(
                id, ServiceReportReason.entries.firstOrNull { it.wire == reason } ?: bad(),
                ServiceCaseStatus.entries.firstOrNull { it.wire == status } ?: bad(), revision,
            )
        }
    }

    fun contactBlock(reply: TransportReply): ApiOutcome<Boolean> = decode(reply) { data ->
        data.keysOnly(setOf("blocked"))
        data.required("blocked").bool()
    }

    fun contactBlocks(reply: TransportReply): ApiOutcome<OwnContactBlocks> = decode(reply) { data ->
        data.keysOnly(setOf("items", "nextCursor"))
        val idPattern = Regex("[a-f0-9]{32}")
        val raw = data.required("items") as? JsonArray ?: bad()
        if (raw.size > 20) bad()
        val items = raw.map { element ->
            val row = element as? JsonObject ?: bad()
            row.keysOnly(setOf("id", "categoryName"))
            val id = row.required("id").str()
            val name = row.optionalString("categoryName")
            if (!idPattern.matches(id) || (name != null && (name.isBlank() || name.length > 240))) bad()
            OwnContactBlock(id, name)
        }
        if (items.zipWithNext().any { (left, right) -> left.id >= right.id }) bad()
        val nextCursor = data.optionalString("nextCursor")
        if (nextCursor != null && (items.size != 20 || nextCursor != items.last().id)) bad()
        OwnContactBlocks(items, nextCursor)
    }

    fun accountErasureChallenge(reply: TransportReply): ApiOutcome<AccountErasureChallenge> =
        decode(reply) { data ->
            data.keysOnly(setOf("challenge", "nonce"))
            val challenge = data.required("challenge").str()
            val nonce = data.required("nonce").str()
            if (challenge.length > 1024 ||
                !Regex("""[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+""").matches(challenge) ||
                !Regex("jodlo_erase_[0-9a-f-]{36}").matches(nonce)) bad()
            AccountErasureChallenge(challenge, nonce)
        }

    fun accountErased(reply: TransportReply): ApiOutcome<Boolean> = decode(reply) { data ->
        data.keysOnly(setOf("erased"))
        if (!data.required("erased").bool()) bad()
        true
    }

    fun callDevice(reply: TransportReply): ApiOutcome<Boolean> = decode(reply) { data ->
        data.keysOnly(setOf("registered"))
        data.required("registered").bool()
    }

    private fun callDeadline(data: JsonObject): Long {
        val value = data.required("ringDeadlineMs") as? JsonPrimitive ?: bad()
        return value.content.toLongOrNull()?.takeIf { !value.isString && it > 0 } ?: bad()
    }

    fun callInvitation(reply: TransportReply): ApiOutcome<CallInvitation> = decode(reply) { data ->
        data.keysOnly(setOf("id", "ringDeadlineMs"))
        val id = data.required("id").str()
        if (!Regex("[A-Za-z0-9_-]{8,128}").matches(id)) bad()
        CallInvitation(id, callDeadline(data))
    }

    fun callHistory(reply: TransportReply): ApiOutcome<CallHistoryPage> = decode(reply) { data ->
        data.keysOnly(setOf("items", "nextCursor"))
        val items = data.required("items") as? JsonArray ?: bad()
        if (items.size > 25) bad()
        val ids = mutableSetOf<String>()
        val entries = items.map { item ->
            val row = item as? JsonObject ?: bad()
            row.keysOnly(setOf("id", "direction", "outcome", "endedAt", "connectedSeconds"))
            val id = row.required("id").str()
            val direction = row.required("direction").str()
            val outcome = CallHistoryOutcome.entries.firstOrNull {
                it.wire == row.required("outcome").str()
            } ?: bad()
            val endedAt = (row.required("endedAt") as? JsonPrimitive)?.takeUnless { it.isString }
                ?.content?.toLongOrNull() ?: bad()
            val duration = row.required("connectedSeconds").number()
            if (!Regex("[A-Za-z0-9_-]{8,128}").matches(id) || !ids.add(id) ||
                direction !in setOf("incoming", "outgoing") || endedAt !in 1..253402300799L ||
                duration < 0 || (outcome != CallHistoryOutcome.ENDED && duration != 0)
            ) bad()
            CallHistoryEntry(id, direction == "incoming", outcome, endedAt)
        }
        val cursor = data.optionalString("nextCursor")
        if (cursor != null && (entries.size != 25 || cursor != entries.last().id)) bad()
        CallHistoryPage(entries, cursor)
    }

    fun callAudioGrant(reply: TransportReply, invitationId: String): ApiOutcome<CallAudioGrant> =
        decode(reply) { data ->
            data.keysOnly(setOf("appId", "channel", "uid", "token", "expiresInSeconds"))
            val appId = data.required("appId").str()
            val channel = data.required("channel").str()
            val uid = data.required("uid").number()
            val token = data.required("token").str()
            val expires = data.required("expiresInSeconds").number()
            if (!Regex("[a-fA-F0-9]{32}").matches(appId) || channel != "jodlo-$invitationId" ||
                uid !in 1..2 || expires !in 1..60 || !Regex("007[A-Za-z0-9+/]{1,4093}={0,2}").matches(token)
            ) bad()
            CallAudioGrant(appId, channel, uid, token, expires)
        }

    fun callSignal(reply: TransportReply): ApiOutcome<CallSignal> = decode(reply) { data ->
        data.keysOnly(setOf("role", "phase", "ringDeadlineMs"))
        val role = CallRole.entries.firstOrNull { it.wire == data.required("role").str() } ?: bad()
        val phase = CallPhase.entries.firstOrNull { it.wire == data.required("phase").str() } ?: bad()
        CallSignal(role, phase, callDeadline(data))
    }

    fun callPreference(reply: TransportReply): ApiOutcome<OwnCallPreference> = decode(reply) { data ->
        data.keysOnly(setOf("enabled", "revision"))
        val enabled = data.required("enabled").bool()
        val revision = readRevision(data.required("revision"))
        if (enabled && revision == 0L) bad()
        OwnCallPreference(enabled, revision)
    }

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
            val version = data.required("schemaVersion").number()
            if (version !in 1..3) bad()
            data.keysOnly(setOf(
                "schemaVersion", "account", "identity", "services",
                "callPreferences", "availabilityPreferences", "blocksMade",
                "abuseCounters", "sessions", "limitations",
            ) + if (version == 3) setOf("serviceDetails") else emptySet(),
                if (version == 3) setOf("servicePhotos", "serviceReports", "serviceAppeals") else emptySet())
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
                val fields = setOf("id", "categoryId", "status", "moderationStatus", "createdAt")
                row.keysOnly(if (version >= 2) fields + "city" else fields)
                if (version >= 2 && row.required("city") != JsonNull) serviceCity(row.required("city"))
                if (!opaqueId.matches(row.required("id").str()) ||
                    !categoryId.matches(row.required("categoryId").str()) ||
                    row.required("status").str() !in setOf("published", "unpublished") ||
                    row.required("moderationStatus").str() !in setOf("allowed", "hidden")) bad()
                safeText(row.required("createdAt"), 10, 48)
            }
            if (version == 3) rows("serviceDetails", 1000) { row ->
                if (!opaqueId.matches(row.required("listingId").str()) ||
                    !categoryId.matches(row.required("categoryId").str()) ||
                    row.required("status").str() !in setOf("pending", "approved", "rejected")) bad()
                positiveRevision(row.required("revision"))
                serviceProfile(JsonObject(row - setOf("listingId", "categoryId", "status", "revision")))
            }
            if (version == 3 && "servicePhotos" in data) rows("servicePhotos", 1000) { row ->
                row.keysOnly(setOf("listingId", "status", "revision"))
                if (!opaqueId.matches(row.required("listingId").str()) ||
                    row.required("status").str() !in setOf("pending", "approved", "rejected")) bad()
                positiveRevision(row.required("revision"))
            }
            if (version == 3 && "serviceReports" in data) rows("serviceReports", 1000) { row ->
                row.keysOnly(setOf("listingId", "reason", "receivedAt"))
                if (!opaqueId.matches(row.required("listingId").str()) ||
                    ServiceReportReason.entries.none { it.wire == row.required("reason").str() } ||
                    row.required("receivedAt").longValue() < 0L) bad()
            }
            if (version == 3 && "serviceAppeals" in data) rows("serviceAppeals", 1000) { row ->
                row.keysOnly(setOf("listingId", "reason", "status", "appealReason"))
                val appeal = row.optionalString("appealReason")
                if (!opaqueId.matches(row.required("listingId").str()) ||
                    ServiceReportReason.entries.none { it.wire == row.required("reason").str() } ||
                    ServiceCaseStatus.entries.none { it.wire == row.required("status").str() } ||
                    appeal != null && ServiceAppealReason.entries.none { it.wire == appeal }) bad()
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
