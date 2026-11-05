package com.rekixo.jodlo.core.network

/** Hierarchy is optional and independent from the established flat Catalog.
 * IDs are server-owned reviewed taxonomy references, never Worker identities.
 * No locally invented Group/Family names or implicit Catalog approval.
 */
enum class HierarchyLevel(val code: String) {
    GROUPS("groups"), FAMILIES("families"), CATEGORIES("categories");

    companion object {
        fun fromCode(code: String): HierarchyLevel? =
            entries.firstOrNull { it.code == code }
    }
}
data class HierarchyItem(val id: String, val name: String, val slug: String? = null)
data class HierarchyPage(
    val language: Language,
    val level: HierarchyLevel,
    val parentId: String?,
    val items: List<HierarchyItem>,
    val nextCursor: String?,
)

/** Used only after an exact fresh public hierarchy read. Showing a Category
 * never proves Worker presence, identity, availability or call permission.
 */
interface ApprovedHierarchyRepository {
    fun hierarchy(
        level: HierarchyLevel, parentId: String?, language: Language,
        availableOnly: Boolean = false, limit: Int = 20, after: String? = null,
    ): ApiOutcome<HierarchyPage>
}
