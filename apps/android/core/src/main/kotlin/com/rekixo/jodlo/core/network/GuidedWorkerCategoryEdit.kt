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
    // Only a fresh authenticated owner-only revision snapshot may set this.
    // An old first-100/management row alone never authorizes v2 editing.
    private val expectedRevision: Long? = null,
) {
    fun begin(
        row: OwnListing, currentOwnerRows: List<OwnListing>, generation: Long?,
    ): GuidedWorkerCategoryEdit =
        if (generation != null && row in currentOwnerRows)
            GuidedWorkerCategoryEdit(source = row, accountGeneration = generation)
        else GuidedWorkerCategoryEdit()

    fun beginVersioned(
        snapshot: VersionedOwnListing,
        currentOwnerRows: List<OwnListing>, generation: Long?,
    ): GuidedWorkerCategoryEdit =
        if (generation != null && snapshot.row in currentOwnerRows &&
            snapshot.revision in 0..2147483646L)
            GuidedWorkerCategoryEdit(
                source = snapshot.row,
                accountGeneration = generation,
                expectedRevision = snapshot.revision,
            )
        else GuidedWorkerCategoryEdit()

    /** An old Category-only owner row or an unversioned code path cannot
     * yield a revision token. Final review repeats account/owner/approved
     * Category checks before building one explicit CAS-only command.
     */
    fun confirmedVersioned(
        currentOwnerRows: List<OwnListing>,
        currentApprovedRows: List<PublicCategory>,
        generation: Long?,
    ): VersionedCategoryEditCommand? {
        val basic = confirmed(currentOwnerRows,currentApprovedRows,generation)
            ?: return null
        val revision = expectedRevision ?: return null
        if (revision !in 0..2147483646L) return null
        return VersionedCategoryEditCommand(
            basic.listingId,basic.expectedCategoryId,basic.nextCategoryId,revision)
    }

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

/** Versioned edit command is never constructed by an old unversioned page.
 * The server requires expected revision and Category in the same D1 CAS.
 */
data class VersionedCategoryEditCommand(
    val listingId:String,val expectedCategoryId:String,
    val nextCategoryId:String,val expectedRevision:Long,
)
