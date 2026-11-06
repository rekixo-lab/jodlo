package com.rekixo.jodlo.core.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** User-directed portable copy of anonymous, device-only public references.
 *
 * This is not an account export or a public-status proof. It contains only
 * opaque saved Listing+Category IDs and hidden Listing IDs. Import is strict:
 * unknown keys, formats, values, duplicates, corrupt IDs and oversized files
 * fail closed. It never performs HTTP, auth, GPS, provider, file or log I/O.
 */
data class LocalPublicServiceBackup(
    val saved: SavedPublicServices,
    val hidden: HiddenPublicServices,
) {
    companion object {
        const val MAX_BYTES = 32_768
        private const val FORMAT = "jodlo-public-reference-backup"
        private const val VERSION = 1

        fun decode(text: String): LocalPublicServiceBackup? {
            if (text.isBlank() || text.toByteArray(Charsets.UTF_8).size > MAX_BYTES)
                return null
            val root = runCatching {
                val parsed = Json.parseToJsonElement(text)
                // Kotlin JSON object maps may silently keep the last value.
                // Reject every duplicate key, including escaped aliases, in
                // root and nested saved objects before trusting ANY field.
                if (hasDuplicateJsonObjectKeys(text, Json)) null
                else parsed as? JsonObject
            }.getOrNull() ?: return null
            if (root.keys != setOf("format", "version", "saved", "hidden")) return null
            val format = root["format"] as? JsonPrimitive ?: return null
            val version = root["version"] as? JsonPrimitive ?: return null
            if (!format.isString || format.content != FORMAT ||
                version.isString || version.content != VERSION.toString()) return null

            val savedArray = root["saved"] as? JsonArray ?: return null
            val hiddenArray = root["hidden"] as? JsonArray ?: return null
            if (savedArray.size > SavedPublicServices.MAX_ENTRIES ||
                hiddenArray.size > HiddenPublicServices.MAX_ENTRIES) return null

            val savedLines = ArrayList<String>(savedArray.size)
            for (item in savedArray) {
                val obj = item as? JsonObject ?: return null
                if (obj.keys != setOf("id", "categoryId")) return null
                val id = obj["id"] as? JsonPrimitive ?: return null
                val category = obj["categoryId"] as? JsonPrimitive ?: return null
                if (!id.isString || !category.isString) return null
                savedLines += "${id.content}|${category.content}"
            }
            val saved = if (savedLines.isEmpty()) SavedPublicServices.empty()
                else SavedPublicServices.decode(savedLines.joinToString("\n"))
            if (saved.entries.size != savedArray.size) return null

            val hiddenIds = ArrayList<String>(hiddenArray.size)
            for (item in hiddenArray) {
                val id = item as? JsonPrimitive ?: return null
                if (!id.isString) return null
                hiddenIds += id.content
            }
            val hidden = if (hiddenIds.isEmpty()) HiddenPublicServices.empty()
                else HiddenPublicServices.decode(hiddenIds.joinToString("\n"))
            if (hidden.ids.size != hiddenArray.size) return null
            return LocalPublicServiceBackup(saved, hidden)
        }
    }

    fun encode(): String = buildJsonObject {
        put("format", FORMAT)
        put("version", VERSION)
        put("saved", buildJsonArray {
            saved.entries.forEach { entry ->
                add(buildJsonObject {
                    put("id", entry.id)
                    put("categoryId", entry.categoryId)
                })
            }
        })
        put("hidden", buildJsonArray {
            hidden.ids.forEach { add(JsonPrimitive(it)) }
        })
    }.toString()
}
