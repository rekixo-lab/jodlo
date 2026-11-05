package com.rekixo.jodlo.core.network

/** A manually requested, ephemeral check of DEVICE-ONLY bookmarks. None of
 * these results is a durable visibility claim, a Worker availability signal,
 * a badge, an identity, a contact permission or a persisted phone record.
 *
 * One explicit tap may read at most 10 references, in saved order. The native
 * screen performs each anonymous approvedServiceDetail GET ONCE, sequentially,
 * without retry, account identity, background polling or parallel fan-out.
 */
enum class SavedServiceReviewStatus {
    PUBLIC_WHEN_CHECKED, NOT_PUBLIC_WHEN_CHECKED, CANNOT_CONFIRM,
}

class SavedServiceReview private constructor(
    private val original: List<PublicListing>,
    private val results: Map<String, SavedServiceReviewStatus>,
) {
    companion object {
        const val MAX_PER_TAP = 10
        fun start(saved: SavedPublicServices): SavedServiceReview =
            SavedServiceReview(saved.entries.toList(), emptyMap())
    }

    val checkedCount: Int get() = results.size
    val totalCount: Int get() = original.size
    val publicCount: Int get() = results.values.count {
        it == SavedServiceReviewStatus.PUBLIC_WHEN_CHECKED
    }
    val notPublicCount: Int get() = results.values.count {
        it == SavedServiceReviewStatus.NOT_PUBLIC_WHEN_CHECKED
    }
    val unknownCount: Int get() = results.values.count {
        it == SavedServiceReviewStatus.CANNOT_CONFIRM
    }

    /** Never send more than the next 10 unreviewed exact Saved IDs. A local
     * removal/addition/reorder invalidates the whole transient snapshot.
     */
    fun nextBatch(saved: SavedPublicServices): List<PublicListing> =
        if (saved.entries != original) emptyList()
        else original.filterNot { it.id in results }.take(MAX_PER_TAP)

    fun statusFor(saved: SavedPublicServices, listing: PublicListing): SavedServiceReviewStatus? =
        if (saved.entries == original && listing in original) results[listing.id] else null

    /** Only an exact approved current public detail proves a public result at
     * the time of that read. Exactly NOT_FOUND can prove non-public; network,
     * auth, 503, rate limit, malformed response or mismatched IDs = UNKNOWN.
     */
    fun record(
        saved: SavedPublicServices,
        listing: PublicListing,
        language: Language,
        reply: ApiOutcome<PublicApprovedServiceDetail>,
    ): SavedServiceReview {
        if (saved.entries != original || listing !in original ||
            listing.id in results) return this
        val status = when(reply) {
            is ApiOutcome.Ok -> {
                val value = reply.value
                if (value.language == language &&
                    value.listing == listing &&
                    value.category.id == listing.categoryId &&
                    value.category.name.isNotBlank()) {
                    SavedServiceReviewStatus.PUBLIC_WHEN_CHECKED
                } else SavedServiceReviewStatus.CANNOT_CONFIRM
            }
            is ApiOutcome.Failed ->
                if (reply.kind == FailureKind.NOT_FOUND)
                    SavedServiceReviewStatus.NOT_PUBLIC_WHEN_CHECKED
                else SavedServiceReviewStatus.CANNOT_CONFIRM
        }
        return SavedServiceReview(original, results + (listing.id to status))
    }
}
