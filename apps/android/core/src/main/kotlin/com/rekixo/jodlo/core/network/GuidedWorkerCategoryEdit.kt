package com.rekixo.jodlo.core.network

/** Private, in-memory review state for an EXISTING worker service's Category.
 * No profile, GPS, phone, rate, PII, trust, media or user-selected actor ID.
 * The backend independently verifies the current authenticated owner.
 *
 * A change is only sent after the current owned row and the new approved
 * Category remain in the same live UI pages/account generation at review AND
 * final confirmation. A changed previous Category triggers backend conflict.
 */
data class GuidedWorkerCategoryEdit(
    val source: OwnListing? = null,
    private val accountGeneration: Long? = null,
    val destination: PublicCategory? = null,
    val reviewOpen: Boolean = false,
) {
    fun begin(
        row: OwnListing, currentOwnerRows: List<OwnListing>, generation: Long?,
    ): GuidedWorkerCategoryEdit =
        if (generation != null && row in currentOwnerRows)
            GuidedWorkerCategoryEdit(source = row, accountGeneration = generation)
        else GuidedWorkerCategoryEdit()

    fun chooseDestination(
        category: PublicCategory, currentApprovedRows: List<PublicCategory>,
        generation: Long?,
    ): GuidedWorkerCategoryEdit =
        if (source != null && generation != null && generation == accountGeneration &&
            category in currentApprovedRows && category.id != source.categoryId)
            copy(destination = category, reviewOpen = false)
        else copy(destination = null, reviewOpen = false)

    fun review(generation: Long?): GuidedWorkerCategoryEdit =
        copy(reviewOpen = source != null && destination != null &&
            generation != null && generation == accountGeneration)

    /** Returns no command for a stale/foreign owner listing, unsourced Category,
     * swapped session or same old/new Category. Cannot submit an arbitrary ID.
     */
    fun confirmed(
        currentOwnerRows: List<OwnListing>, currentApprovedRows: List<PublicCategory>,
        generation: Long?,
    ): CategoryEditCommand? {
        val old = source ?: return null
        val next = destination ?: return null
        if (!reviewOpen || generation == null || generation != accountGeneration ||
            old !in currentOwnerRows || next !in currentApprovedRows ||
            old.categoryId == next.id) return null
        return CategoryEditCommand(old.id,old.categoryId,next.id)
    }

    fun invalidateCategory(): GuidedWorkerCategoryEdit =
        copy(destination = null, reviewOpen = false)

    fun cancelReview(): GuidedWorkerCategoryEdit = copy(reviewOpen = false)

    fun reset(): GuidedWorkerCategoryEdit = GuidedWorkerCategoryEdit()
}

data class CategoryEditCommand(
    val listingId: String, val expectedCategoryId: String,
    val nextCategoryId: String,
)
