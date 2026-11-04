package com.rekixo.jodlo.core.network

/** Volatile public label lookup for exactly the IDs visible in one UI action.
 * No remote provider, account, contact, user preference or current-public
 * Listing state is inferred from an active Category's display name.
 *
 * Never persist this snapshot as an endorsement. The screen owns session/
 * selection generation checks before accepting an asynchronous result.
 */
data class ApprovedCategoryNameSnapshot private constructor(
    val language: Language,
    private val requested: Set<String>,
    private val names: Map<String, String>,
) {
    companion object {
        const val MAX_IDS = 50

        fun fromApprovedRows(
            requestedIds: List<String>,
            language: Language,
            rows: List<PublicCategory>,
        ): ApprovedCategoryNameSnapshot? {
            if (requestedIds.isEmpty() || requestedIds.size > MAX_IDS ||
                requestedIds.size != requestedIds.toSet().size ||
                rows.size > requestedIds.size ||
                rows.map { it.id }.toSet().size != rows.size ||
                rows.any { it.id !in requestedIds || it.name.isBlank() ||
                    it.name.codePointCount(0,it.name.length) > 160 ||
                    it.name.any { c -> Character.isISOControl(c) } }) return null
            if (requestedIds.any { !runCatching {
                JodloRoutes.requireCategoryId(it)
            }.isSuccess }) return null
            return ApprovedCategoryNameSnapshot(
                language,requestedIds.toSet(),rows.associate { it.id to it.name },
            )
        }
    }

    fun approvedName(id: String, currentLanguage: Language, visibleIds: List<String>): String? =
        if (currentLanguage == language && visibleIds.toSet() == requested &&
            visibleIds.size == requested.size && id in requested) names[id] else null

    /** An absent name means unknown/inactive/failed to resolve, NOT missing
     * or unpublished Worker service and NOT proof of caller availability.
     */
    fun hasApprovedName(id: String): Boolean = id in names
}
