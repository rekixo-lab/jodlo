package com.rekixo.jodlo.core.network

import java.text.Normalizer
import java.util.Locale

/**
 * Device-only display search and ordering. It does not persist search text,
 * mutate Saved/Hidden stores, consult a Worker account, or send HTTP calls.
 * Approved Category names are optional ephemeral labels, NOT proof that an
 * old Saved Listing is currently published or that a Worker can be contacted.
 */
object LocalPublicReferenceFinder {
    private const val MAX_QUERY_CODEPOINTS = 64

    private fun normalized(text: String, isQuery: Boolean = false): String? {
        // Only user input is limited to 64 code points. Existing valid IDs may
        // be 128 characters and already-approved Category labels up to 160.
        if ((isQuery && text.codePointCount(0, text.length) > MAX_QUERY_CODEPOINTS) ||
            text.any { Character.isISOControl(it) }) return null
        return Normalizer.normalize(text.trim(), Normalizer.Form.NFC)
            .lowercase(Locale.ROOT)
    }

    fun saved(
        entries: List<PublicListing>,
        query: String,
        oldestFirst: Boolean = false,
        approvedName: (String) -> String? = { null },
    ): List<PublicListing> {
        val needle = normalized(query, isQuery = true) ?: return emptyList()
        val matches = if (needle.isEmpty()) entries else entries.filter { row ->
            val category = normalized(row.categoryId).orEmpty()
            val name = approvedName(row.categoryId)?.let(::normalized).orEmpty()
            val id = normalized(row.id).orEmpty()
            needle in category || needle in name || needle in id
        }
        return if (oldestFirst) matches.asReversed().toList() else matches.toList()
    }

    fun hidden(
        ids: List<String>, query: String, oldestFirst: Boolean = false,
    ): List<String> {
        val needle = normalized(query, isQuery = true) ?: return emptyList()
        val matches = if (needle.isEmpty()) ids else ids.filter {
            needle in normalized(it).orEmpty()
        }
        return if (oldestFirst) matches.asReversed().toList() else matches.toList()
    }
}
