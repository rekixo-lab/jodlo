package com.rekixo.jodlo.core.network

import java.text.Normalizer
import java.util.Locale

/**
 * Private Worker list presentation only. This NEVER reads public endpoints,
 * changes publication or moderation, or treats a cached owner listing as
 * currently public or contactable. The screen passes only its already-loaded
 * authenticated owner rows and optional, explicitly fetched Category labels.
 */
enum class OwnServiceLocalGroup {
    ALL, OWNER_READ_VISIBLE, PUBLISHED_NOT_VISIBLE, PAUSED
}

object OwnServiceLocalFilter {
    private const val MAX_QUERY_CODEPOINTS = 64

    private fun normalized(text: String): String =
        Normalizer.normalize(text.trim(), Normalizer.Form.NFC)
            .lowercase(Locale.ROOT)

    fun apply(
        loaded: List<OwnListing>,
        query: String,
        group: OwnServiceLocalGroup = OwnServiceLocalGroup.ALL,
        approvedName: (String) -> String? = { null },
    ): List<OwnListing> {
        if (query.codePointCount(0,query.length)>MAX_QUERY_CODEPOINTS ||
            query.any { Character.isISOControl(it) }) return emptyList()
        val needle=normalized(query)
        return loaded.filter { row ->
            val groupMatches=when(group) {
                OwnServiceLocalGroup.ALL -> true
                OwnServiceLocalGroup.OWNER_READ_VISIBLE ->
                    row.publicationStatus==OwnPublicationStatus.PUBLISHED && row.visible
                OwnServiceLocalGroup.PUBLISHED_NOT_VISIBLE ->
                    row.publicationStatus==OwnPublicationStatus.PUBLISHED && !row.visible
                OwnServiceLocalGroup.PAUSED ->
                    row.publicationStatus==OwnPublicationStatus.UNPUBLISHED
            }
            if(!groupMatches) false
            else if(needle.isEmpty()) true
            else {
                val name=approvedName(row.categoryId)
                needle in normalized(row.id) ||
                    needle in normalized(row.categoryId) ||
                    (name!=null && !name.any { Character.isISOControl(it) } &&
                     needle in normalized(name))
            }
        }
    }
}
