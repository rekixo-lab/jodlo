package com.rekixo.jodlo.core.network

/** Explicit device-local Customer hiding of opaque public Listing references.
 *
 * This is NOT a server block, report, moderation, account preference, Worker
 * exclusion, removal of Saved bookmarks or current-public status. There is
 * no account, category, location, contact, identity, reason or search history.
 * Treat local storage failures as failures and never silently claim a hide.
 */
data class HiddenPublicServices private constructor(val ids: List<String>) {
    companion object {
        const val MAX_ENTRIES = 100
        private const val MAX_BYTES = 10_240

        fun empty(): HiddenPublicServices = HiddenPublicServices(emptyList())

        /** Strict newline format. Corruption, duplicates, invalid IDs or
         * unexpected delimiters reset the set rather than partially trusting
         * a potentially tampered Android preference.
         */
        fun decode(value: String?): HiddenPublicServices {
            if (value.isNullOrEmpty()) return empty()
            if (value.toByteArray(Charsets.UTF_8).size > MAX_BYTES) return empty()
            val ids = value.split('\n')
            if (ids.size > MAX_ENTRIES || ids.any { !valid(it) } ||
                ids.toSet().size != ids.size) return empty()
            return HiddenPublicServices(ids)
        }

        private fun valid(id: String): Boolean =
            runCatching { JodloRoutes.requireListingId(id) }.isSuccess
    }

    fun contains(id: String): Boolean = id in ids

    /** Same listing ID remains locally hidden even if its Category changes. */
    fun hide(id: String): HiddenPublicServices =
        if (!valid(id) || contains(id) || ids.size >= MAX_ENTRIES) this
        else HiddenPublicServices(listOf(id) + ids)

    /** Non-destructive, bounded import; hidden IDs never leave this phone. */
    fun mergeFrom(incoming: HiddenPublicServices): HiddenPublicServices? {
        val known = ids.toSet()
        val additional = incoming.ids.filterNot { it in known }
        if (ids.size + additional.size > MAX_ENTRIES) return null
        return HiddenPublicServices(ids + additional)
    }

    fun unhide(id: String): HiddenPublicServices =
        if (!contains(id)) this
        else HiddenPublicServices(ids.filterNot { it == id })

    fun clear(): HiddenPublicServices = empty()

    /** Local presentation only. Do NOT send these IDs as exclusions to API. */
    fun visible(rows: List<PublicListing>): List<PublicListing> =
        rows.filterNot { contains(it.id) }

    fun encode(): String = ids.joinToString("\n")
}
