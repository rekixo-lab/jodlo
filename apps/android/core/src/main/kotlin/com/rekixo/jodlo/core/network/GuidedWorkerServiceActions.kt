package com.rekixo.jodlo.core.network

/** A native Guided Post review boundary around the EXISTING category-only
 * owner listing API. No GPS, price, experience, images, contact or verification
 * field is invented or persisted. The server still decides who may publish.
 *
 * Every confirmed action requires the SAME live account generation and the
 * selected row to still exist in a CURRENT, approved Category/owner page.
 * No network call occurs here. Compose merely renders this immutable state.
 */
data class GuidedWorkerServiceActions(
    val selectedCategory: PublicCategory? = null,
    private val selectedAccountGeneration: Long? = null,
    /** Explicit disclosure step: existing Category/reference ONLY. */
    val publishScopeReviewOpen: Boolean = false,
    val publishReviewOpen: Boolean = false,
    val pendingUnpublishId: String? = null,
    private val unpublishAccountGeneration: Long? = null,
    val pendingResume: OwnListing? = null,
    private val resumeAccountGeneration: Long? = null,
    val resumeReviewOpen: Boolean = false,
) {
    /** Only allow explicitly tapped returned Categories, never free text IDs.
     * Choosing another row invalidates any previous publication review.
     */
    fun chooseCategory(
        chosen: PublicCategory, currentRows: List<PublicCategory>,
        accountGeneration: Long?,
    ): GuidedWorkerServiceActions =
        if (accountGeneration != null && chosen in currentRows) copy(
            selectedCategory = chosen,
            selectedAccountGeneration = accountGeneration,
            publishScopeReviewOpen = false,
            publishReviewOpen = false,
        ) else clearPublication()

    /** Step 2: disclose exactly the Category-only public scope.
     * This is not approval to collect or publish any Worker personal fields.
     * A stale Category page or account epoch cannot reach final review.
     */
    fun reviewPublicationScope(
        accountGeneration: Long?, currentRows: List<PublicCategory>,
        currentOwnedRows: List<OwnListing> = emptyList(),
    ): GuidedWorkerServiceActions =
        copy(
            publishScopeReviewOpen = selectedCategory != null &&
                accountGeneration != null && accountGeneration == selectedAccountGeneration &&
                selectedCategory in currentRows &&
                currentOwnedRows.none { it.categoryId == selectedCategory.id },
            publishReviewOpen = false,
        )

    /** Step 3: a distinct final review before any owner POST is possible. */
    fun reviewPublication(accountGeneration: Long?): GuidedWorkerServiceActions =
        copy(publishReviewOpen = publishScopeReviewOpen &&
            selectedCategory != null && accountGeneration != null &&
            accountGeneration == selectedAccountGeneration)

    fun cancelPublicationReview(): GuidedWorkerServiceActions =
        copy(publishReviewOpen = false)

    /** Caller must still use the authenticated WorkerWriteScope and check
     * loading/uncertain state. This method NEVER grants backend publication.
     */
    fun categoryConfirmedForPublish(
        accountGeneration: Long?, currentRows: List<PublicCategory>,
        currentOwnedRows: List<OwnListing> = emptyList(),
    ): String? =
        selectedCategory?.takeIf {
            publishScopeReviewOpen && publishReviewOpen &&
                accountGeneration != null &&
                accountGeneration == selectedAccountGeneration &&
                it in currentRows &&
                currentOwnedRows.none { own -> own.categoryId == it.id }
        }?.id

    fun clearPublication(): GuidedWorkerServiceActions =
        copy(selectedCategory = null, selectedAccountGeneration = null,
            publishScopeReviewOpen = false, publishReviewOpen = false)

    /** Unpublish is a distinct destructive action: reviewing a current owner
     * row never implies permission to remove a different row or account.
     */
    fun reviewUnpublish(
        chosen: OwnListing, currentRows: List<OwnListing>,
        accountGeneration: Long?,
    ): GuidedWorkerServiceActions =
        if (accountGeneration != null && chosen in currentRows) copy(
            pendingUnpublishId = chosen.id,
            unpublishAccountGeneration = accountGeneration,
        ) else cancelUnpublish()

    fun unpublishConfirmed(
        accountGeneration: Long?, currentRows: List<OwnListing>,
    ): String? = pendingUnpublishId?.takeIf { id ->
        accountGeneration != null && accountGeneration == unpublishAccountGeneration &&
            currentRows.any { it.id == id }
    }

    fun cancelUnpublish(): GuidedWorkerServiceActions =
        copy(pendingUnpublishId = null, unpublishAccountGeneration = null)

    /** Only an explicit, authenticated Management row with publicationStatus
     * UNPUBLISHED may begin the resume review. Public visibility alone is
     * never a pause signal; the server still atomically rechecks moderation,
     * current owner and Category on confirmation.
     */
    fun beginResume(
        chosen: OwnListing, currentRows: List<OwnListing>,
        accountGeneration: Long?,
    ): GuidedWorkerServiceActions =
        if (accountGeneration != null &&
            chosen.publicationStatus == OwnPublicationStatus.UNPUBLISHED &&
            !chosen.visible && chosen in currentRows) copy(
                pendingResume = chosen,
                resumeAccountGeneration = accountGeneration,
                resumeReviewOpen = false,
            ) else cancelResume()

    fun reviewResume(accountGeneration: Long?): GuidedWorkerServiceActions =
        copy(resumeReviewOpen = pendingResume != null &&
            accountGeneration != null && accountGeneration == resumeAccountGeneration)

    fun resumeConfirmed(
        accountGeneration: Long?, currentRows: List<OwnListing>,
    ): ResumeOwnListingCommand? {
        val selected = pendingResume ?: return null
        if (!resumeReviewOpen || accountGeneration == null ||
            accountGeneration != resumeAccountGeneration ||
            selected.visible ||
            selected.publicationStatus != OwnPublicationStatus.UNPUBLISHED ||
            selected !in currentRows) return null
        return ResumeOwnListingCommand(selected.id, selected.categoryId)
    }

    fun cancelResume(): GuidedWorkerServiceActions = copy(
        pendingResume = null, resumeAccountGeneration = null,
        resumeReviewOpen = false,
    )

    fun reset(): GuidedWorkerServiceActions = GuidedWorkerServiceActions()
}

/** Exact owner Listing identity and CURRENT expected Category only;
 * never a profile, owner account ID or visibility status claim.
 */
data class ResumeOwnListingCommand(
    val listingId: String, val expectedCategoryId: String,
)
