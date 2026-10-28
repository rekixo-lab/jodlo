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

/** Typed DTOs for the CURRENT public API. No worker trust, phone, location or permission fields. */
data class PublicCategory(val id: String, val slug: String, val name: String)
data class PublicListing(val id: String, val categoryId: String)
data class OwnListing(val id: String, val categoryId: String, val visible: Boolean)
/** The backend never returns a verified role from worker opt-in. */
data class WorkerDraft(val status: String)

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
    UNAUTHORIZED, FORBIDDEN, BAD_INPUT, NOT_FOUND, RATE_LIMITED,
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
            val root = json.parseToJsonElement(reply.body).obj()
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
    fun browse(reply: TransportReply): ApiOutcome<CatalogBrowse> = decode(reply) { data ->
        data.keysOnly(setOf("language", "categories"), setOf("nextCursor"))
        CatalogBrowse(language(data.required("language")),
            categories(data.required("categories"), 100), nextCursor(data))
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
    fun publicListings(reply: TransportReply): ApiOutcome<List<PublicListing>> = decode(reply) { data ->
        data.keysOnly(setOf("listings"))
        listings(data.required("listings"), 25)
    }
    fun published(reply: TransportReply): ApiOutcome<PublicListing> = decode(reply) { data ->
        data.keysOnly(setOf("listing"))
        listing(data.required("listing"))
    }
    fun ownListings(reply: TransportReply): ApiOutcome<List<OwnListing>> = decode(reply) { data ->
        data.keysOnly(setOf("listings"))
        val raw = data.required("listings").arr()
        if (raw.size > 100) bad()
        val rows = raw.map { element ->
            val row = element.obj()
            row.keysOnly(setOf("id", "categoryId", "visible"))
            val value = listing(JsonObject(mapOf(
                "id" to row.required("id"), "categoryId" to row.required("categoryId")
            )))
            OwnListing(value.id, value.categoryId, row.required("visible").bool())
        }
        if (rows.map { it.id }.toSet().size != rows.size) bad()
        rows
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
