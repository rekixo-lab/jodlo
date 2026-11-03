package com.rekixo.jodlo

import android.net.Uri
import com.rekixo.jodlo.core.network.ApiCall
import com.rekixo.jodlo.core.network.HttpMethod
import com.rekixo.jodlo.core.network.RequestSender
import com.rekixo.jodlo.core.network.TransportReply
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.util.Locale

/**
 * Explicit, DEBUG-ONLY offline Customer preview.
 *
 * Synthetic labels and opaque listing IDs are NOT reviewed live Categories,
 * actual Workers, approved public listings, verified identities or contacts.
 * This adapter can only supply read-only public DTOs to RemoteCatalogRepository;
 * it does not implement login, worker writes, Agora, GPS, payments or networking.
 *
 * Use the SAME strict production Kotlin API reply decoder and pagination guards
 * even in the demo. No duplicated production repository or HTTP stack.
 */
internal class DebugCustomerPreviewSender : RequestSender {
    private data class Category(
        val id: String, val slug: String, val en: String, val hi: String,
    ) {
        fun json(language: String) = JSONObject()
            .put("id", id)
            .put("slug", slug)
            .put("name", if (language == "hi") hi else en)
    }

    private val categories = listOf(
        Category("demo_plumbing", "plumbing", "Plumbing sample", "प्लंबिंग नमूना"),
        Category("demo_cleaning", "cleaning", "Cleaning sample", "सफ़ाई नमूना"),
        Category("demo_carpentry", "carpentry", "Carpentry sample", "बढ़ई कार्य नमूना"),
        Category("demo_painting", "painting", "Painting sample", "पेंटिंग नमूना"),
        Category("demo_gardening", "gardening", "Gardening sample", "बागवानी नमूना"),
        Category("demo_tailoring", "tailoring", "Tailoring sample", "सिलाई नमूना"),
        Category("demo_repair", "repair", "Repair sample", "मरम्मत नमूना"),
        Category("demo_tutoring", "tutoring", "Tutoring sample", "पढ़ाई नमूना"),
    ) + (9..31).map { number ->
        Category(
            "demo_service_${number.toString().padStart(2, '0')}",
            "sample-service-$number",
            "Sample service $number",
            "नमूना सेवा $number",
        )
    }

    override fun send(call: ApiCall): TransportReply {
        if (call.method != HttpMethod.GET ||
            call.headers().containsKey("Authorization") ||
            call.bodyUtf8() != null
        ) return unavailable()
        val uri = Uri.parse(call.resource)
        return when {
            uri.path == "/api/v1/catalog" -> browse(uri)
            uri.path == "/api/v1/catalog/search" -> search(uri)
            uri.path == "/api/v1/listings" ->
                if (uri.getQueryParameter("id") != null) listingDetail(uri)
                else listings(uri)
            else -> unavailable()
        }
    }

    /** Synthetic availability means sample listings exist, NOT real presence,
     * busy slots or call consent. Public API uses the same category-only facet.
     */
    private fun eligible(uri: Uri): List<Category> =
        if (uri.getQueryParameter("availableOnly") == "1") {
            categories.filter { demoListingIds(it.id).isNotEmpty() }
        } else categories

    private fun demoListingIds(categoryId: String): List<String> {
        val number = categoryId.removePrefix("demo_service_").toIntOrNull()
        val count = when {
            categoryId == "demo_plumbing" -> 27
            number != null && number >= 26 -> 0
            else -> 2
        }
        return (1..count).map { index ->
            "demo_listing_${categoryId}_${index.toString().padStart(2, '0')}"
        }
    }

    private fun browse(uri: Uri): TransportReply {
        val language = uri.getQueryParameter("lang")
        if (language !in listOf("hi", "en")) return invalid()
        val limit = pageSize(uri) ?: return invalid()
        val visible = eligible(uri)
        val start = cursorStart(uri.getQueryParameter("after"), visible)
            ?: return invalid()
        val selected = visible.drop(start).take(limit)
        val next = if (start + selected.size < visible.size) {
            categoryCursor(categories.indexOf(selected.last()))
        } else null
        return success(JSONObject()
            .put("language", language)
            .put("categories", JSONArray().apply {
                selected.forEach { put(it.json(language!!)) }
            })
            .put("nextCursor", next ?: JSONObject.NULL))
    }

    private fun search(uri: Uri): TransportReply {
        val language = uri.getQueryParameter("lang")
        val query = uri.getQueryParameter("q")?.trim()?.let {
            Normalizer.normalize(it, Normalizer.Form.NFC)
        }
        if (language !in listOf("hi", "en") || query == null ||
            query.codePointCount(0, query.length) !in 2..64 ||
            query.any { Character.isISOControl(it) }
        ) return invalid()
        val limit = pageSize(uri) ?: return invalid()
        val needle = query.lowercase(Locale.ROOT)
        val matches = eligible(uri).filter {
            val label = if (language == "hi") it.hi else it.en
            label.lowercase(Locale.ROOT).contains(needle) ||
                it.slug.lowercase(Locale.ROOT).contains(needle)
        }
        val cursorMode = uri.getQueryParameter("cursor") == "1"
        val offset = if (cursorMode) {
            cursorStart(uri.getQueryParameter("after"), matches) ?: return invalid()
        } else {
            uri.getQueryParameter("offset")?.toIntOrNull() ?: 0
        }
        if (offset !in 0..100) return invalid()
        val selected = matches.drop(offset).take(limit)
        val data = JSONObject()
            .put("language", language)
            .put("query", query)
            .put("categories", JSONArray().apply {
                selected.forEach { put(it.json(language!!)) }
            })
        if (cursorMode) {
            val next = if (offset + selected.size < matches.size) {
                // The cursor uses the globally ordered demo position, not a
                // search-result offset. That is the server keyset contract.
                val index = categories.indexOf(selected.last())
                categoryCursor(index)
            } else null
            data.put("nextCursor", next ?: JSONObject.NULL)
        } else {
            val next = if (offset + selected.size < matches.size) {
                offset + limit
            } else null
            data.put("nextOffset", next ?: JSONObject.NULL)
        }
        return success(data)
    }

    private fun listings(uri: Uri): TransportReply {
        val categoryId = uri.getQueryParameter("categoryId")
        if (categoryId == null || categories.none { it.id == categoryId }) return invalid()
        val limit = pageSize(uri) ?: return invalid()
        val all = demoListingIds(categoryId)
        val after = uri.getQueryParameter("after")
        val start = if (after == null) 0 else {
            val index = all.indexOf(after)
            if (index < 0) return invalid()
            index + 1
        }
        val selected = all.drop(start).take(limit)
        val next = if (start + selected.size < all.size) selected.last() else null
        return success(JSONObject()
            .put("listings", JSONArray().apply {
                selected.forEach { id ->
                    put(JSONObject().put("id", id).put("categoryId", categoryId))
                }
            })
            .put("nextCursor", next ?: JSONObject.NULL))
    }

    /** A fresh local sample lookup uses the production two-field DTO. It
     * does not imply a worker exists or that the synthetic listing is live.
     */
    private fun listingDetail(uri: Uri): TransportReply {
        if (uri.queryParameterNames != setOf("id") ||
            uri.getQueryParameters("id").size != 1) return invalid()
        val id = uri.getQueryParameter("id") ?: return invalid()
        val category = categories.firstOrNull { id in demoListingIds(it.id) }
            ?: return notFound()
        return success(JSONObject().put("listing",
            JSONObject().put("id", id).put("categoryId", category.id)))
    }

    private fun pageSize(uri: Uri): Int? =
        (uri.getQueryParameter("limit")?.toIntOrNull() ?: 20)
            .takeIf { it in 1..25 }

    private fun categoryCursor(index: Int): String =
        "${index + 1}:${categories[index].id}"

    /** An incoming category cursor is valid only when it identifies a known
     * row in the CURRENT selection, not an arbitrary integer position.
     */
    private fun cursorStart(after: String?, filtered: List<Category>): Int? {
        if (after == null) return 0
        val pos = categories.indexOfFirst { c ->
            after == "${categories.indexOf(c) + 1}:${c.id}"
        }
        if (pos < 0 || categories[pos] !in filtered) return null
        return filtered.indexOf(categories[pos]) + 1
    }

    private fun success(data: JSONObject): TransportReply =
        TransportReply(200, JSONObject().put("ok", true).put("data", data).toString())

    private fun invalid(): TransportReply =
        TransportReply(400, JSONObject().put("ok", false)
            .put("error", JSONObject().put("code", "INVALID_QUERY")
                .put("message", "Invalid local preview query")).toString())

    private fun notFound(): TransportReply =
        TransportReply(404, JSONObject().put("ok", false)
            .put("error", JSONObject().put("code", "NOT_FOUND")
                .put("message", "Synthetic listing not found")).toString())

    private fun unavailable(): TransportReply =
        TransportReply(503, JSONObject().put("ok", false)
            .put("error", JSONObject().put("code", "SERVICE_UNAVAILABLE")
                .put("message", "Preview is read-only")).toString())
}
