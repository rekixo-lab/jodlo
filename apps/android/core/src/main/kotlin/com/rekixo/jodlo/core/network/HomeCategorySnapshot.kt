package com.rekixo.jodlo.core.network

/** Public-only, in-memory Home Category snapshot.
 * A Category's appearance is NOT proof that it has an available Worker.
 * Only the currently visible page with the matching language/filter may
 * create a navigation handoff. No account, device state or search history.
 */
data class HomeCategorySnapshot private constructor(
    val language: Language,
    val availableOnly: Boolean,
    val categories: List<PublicCategory>,
    val nextCursor: String?,
) {
    companion object {
        fun empty(language: Language, availableOnly: Boolean = false) =
            HomeCategorySnapshot(language, availableOnly, emptyList(), null)
    }

    /** Fail closed if a stale/overlapping page or different locale/filter is
     * mixed into the current display. The HTTP repository separately validates
     * real server cursor shape, ordering and public Catalog DTOs.
     */
    fun withVerifiedPage(
        requestedLanguage: Language,
        requestedAvailableOnly: Boolean,
        after: String?,
        rows: List<PublicCategory>,
        cursor: String?,
        limit: Int,
    ): HomeCategorySnapshot? {
        if (language != requestedLanguage ||
            availableOnly != requestedAvailableOnly ||
            limit !in 1..25 ||
            rows.size > limit ||
            rows.map { it.id }.toSet().size != rows.size ||
            (after == null && categories.isNotEmpty()) ||
            (after != null && (after != nextCursor || rows.isEmpty() ||
                rows.any { old -> categories.any { it.id == old.id } })) ||
            (cursor != null && (rows.size != limit ||
                rows.lastOrNull()?.id != cursor.substringAfter(':') ||
                !cursor.matches(Regex("(0|[1-9][0-9]{0,6}):[A-Za-z0-9_-]{1,64}")) ||
                !browseCursorAdvances(after, cursor)))) return null

        return HomeCategorySnapshot(
            language, availableOnly,
            if (after == null) rows.toList() else categories + rows,
            cursor,
        )
    }

    fun select(
        currentLanguage: Language,
        currentAvailableOnly: Boolean,
        candidate: PublicCategory,
    ): PublicCategory? =
        if (language == currentLanguage && availableOnly == currentAvailableOnly)
            categories.singleOrNull { it.id == candidate.id && it == candidate }
        else null
}
