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
    val publishReviewOpen: Boolean = false,
    val pendingUnpublishId: String? = null,
    private val unpublishAccountGeneration: Long? = null,
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
            publishReviewOpen = false,
        ) else clearPublication()

    /** A separate deliberate review step before any owner POST is possible. */
    fun reviewPublication(accountGeneration: Long?): GuidedWorkerServiceActions =
        copy(publishReviewOpen = selectedCategory != null &&
            accountGeneration != null && accountGeneration == selectedAccountGeneration)

    fun cancelPublicationReview(): GuidedWorkerServiceActions =
        copy(publishReviewOpen = false)

    /** Caller must still use the authenticated WorkerWriteScope and check
     * loading/uncertain state. This method NEVER grants backend publication.
     */
    fun categoryConfirmedForPublish(
        accountGeneration: Long?, currentRows: List<PublicCategory>,
    ): String? =
        selectedCategory?.takeIf {
            publishReviewOpen && accountGeneration != null &&
                accountGeneration == selectedAccountGeneration && it in currentRows
        }?.id

    fun clearPublication(): GuidedWorkerServiceActions =
        copy(selectedCategory = null, selectedAccountGeneration = null,
            publishReviewOpen = false)

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

    fun reset(): GuidedWorkerServiceActions = GuidedWorkerServiceActions()
}
