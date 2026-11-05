package com.rekixo.jodlo.core.network

/**
 * Explicit, DEVICE-ONLY Customer bookmarks. Only existing anonymous public
 * Listing ID and Category ID are retained, never worker ID, contact, search
 * text, account ID, bearer, location, profile data or a visibility claim.
 *
 * This model does not contact the server: opening a saved entry MUST issue
 * a fresh public Listing detail GET. A saved ID is not proof that a service
 * remains published, approved or available for an Agora call.
 */
data class SavedPublicServices private constructor(val entries: List<PublicListing>) {
    companion object {
        const val MAX_ENTRIES = 50
        private const val MAX_BYTES = 10_240

        fun empty(): SavedPublicServices = SavedPublicServices(emptyList())

        /** Fail closed on any malformed/duplicated/oversized private-storage
         * value; never parse arbitrary JSON, owner metadata or external URLs.
         * The allowed IDs cannot contain the pipe or newline delimiters.
         */
        fun decode(value: String?): SavedPublicServices {
            if (value.isNullOrEmpty()) return empty()
            if (value.toByteArray(Charsets.UTF_8).size > MAX_BYTES) return empty()
            val lines = value.split('\n')
            if (lines.size > MAX_ENTRIES || lines.any { it.isEmpty() }) return empty()
            val rows = ArrayList<PublicListing>(lines.size)
            val ids = HashSet<String>()
            for (line in lines) {
                val fields = line.split('|')
                if (fields.size != 2 ||
                    !valid(fields[0], fields[1]) || !ids.add(fields[0])) return empty()
                rows += PublicListing(fields[0], fields[1])
            }
            return SavedPublicServices(rows)
        }

        private fun valid(id: String, categoryId: String): Boolean =
            runCatching {
                JodloRoutes.requireListingId(id)
                JodloRoutes.requireCategoryId(categoryId)
            }.isSuccess
    }

    /** Presentation-only subset. Hidden bookmark data stays unchanged:
     * unhide must restore the original local bookmark. Review/GET callers
     * must operate on this subset to avoid looking up hidden references.
     */
    fun withoutHidden(hidden: HiddenPublicServices): SavedPublicServices =
        SavedPublicServices(hidden.visible(entries))

    /** Non-destructive, validated, device-only import.
     * Existing IDs/categories remain authoritative; reject a conflicting
     * Category or overflow rather than altering a saved public reference.
     */
    fun mergeFrom(incoming: SavedPublicServices): SavedPublicServices? {
        val current = entries.associateBy { it.id }
        if (incoming.entries.any { row ->
            current[row.id]?.let { it.categoryId != row.categoryId } == true
        }) return null
        val additional = incoming.entries.filter { it.id !in current }
        if (entries.size + additional.size > MAX_ENTRIES) return null
        return SavedPublicServices(entries + additional)
    }

    fun contains(listing: PublicListing): Boolean =
        entries.any { it.id == listing.id && it.categoryId == listing.categoryId }

    /** A bookmark is immutable for an ID. If a listing changes Category,
     * the old bookmark remains only as a historical reference until the user
     * deliberately removes it; never silently update another Category.
     */
    fun toggle(listing: PublicListing): SavedPublicServices {
        if (!valid(listing.id, listing.categoryId)) return this
        val existing = entries.firstOrNull { it.id == listing.id }
        if (existing != null) {
            // Never replace an ID's Category from a stale/cross-source DTO.
            if (existing.categoryId != listing.categoryId) return this
            return SavedPublicServices(entries.filterNot { it.id == listing.id })
        }
        if (entries.size >= MAX_ENTRIES) return this
        return SavedPublicServices(listOf(listing) + entries)
    }

    fun remove(id: String): SavedPublicServices =
        if (entries.none { it.id == id }) this
        else SavedPublicServices(entries.filterNot { it.id == id })

    fun clear(): SavedPublicServices = empty()

    fun encode(): String =
        entries.joinToString("\n") { "${it.id}|${it.categoryId}" }
}
