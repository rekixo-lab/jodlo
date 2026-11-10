package com.rekixo.jodlo.core.network

/** What an anonymous Customer can see from an explicitly selected Worker
 * Service, never a private Worker profile or a service-availability badge.
 * The native screen additionally checks its active session generation,
 * selected owned row, requested locale and read generation before accepting
 * this result. All displayed data is from the same current PUBLIC SQL read.
 */
enum class WorkerCustomerServicePreviewPhase {
    UNCHECKED, PUBLIC_WHEN_CHECKED, NOT_PUBLIC_WHEN_CHECKED, CANNOT_CONFIRM,
}

data class WorkerCustomerServicePreview private constructor(
    val phase: WorkerCustomerServicePreviewPhase,
    /** Approved Catalog label from the same exact anonymous public read. */
    val approvedCategoryName: String? = null,
    /** The strict Customer public-card projection, NOT an owner draft or a
     * contact permission. Absent on 404, transport failure or any ID/locale
     * mismatch. Reviewed details/photos still require independent approval.
     */
    val checkedCard: CustomerServiceCard? = null,
) {
    companion object {
        fun unchecked() = WorkerCustomerServicePreview(
            WorkerCustomerServicePreviewPhase.UNCHECKED)

        /** This classification is read-only. An owner row being 'published'
         * or 'visible' is NOT enough: require one exact fresh anonymous
         * approved Service detail response for the same ID/Category/locale.
         * A plain 404 means currently not public; transient, malformed,
         * revoked transport and mismatched responses are unconfirmed.
         */
        fun fromPublicRead(
            selectedOwnRow: OwnListing,
            requestedLanguage: Language,
            reply: ApiOutcome<PublicApprovedServiceDetail>,
        ): WorkerCustomerServicePreview {
            if (reply is ApiOutcome.Failed) {
                return WorkerCustomerServicePreview(
                    if (reply.kind == FailureKind.NOT_FOUND)
                        WorkerCustomerServicePreviewPhase.NOT_PUBLIC_WHEN_CHECKED
                    else WorkerCustomerServicePreviewPhase.CANNOT_CONFIRM)
            }
            val value = (reply as ApiOutcome.Ok).value
            // Use exactly the same public-card constructor as Customer Browse,
            // Feed and Saved. The private owner row is ONLY the requested ID
            // and Category, never a source for public profile/area/photo data.
            val card = CustomerServiceCard.publicWhenChecked(
                PublicListing(selectedOwnRow.id, selectedOwnRow.categoryId),
                requestedLanguage, value,
            ) ?: return WorkerCustomerServicePreview(
                WorkerCustomerServicePreviewPhase.CANNOT_CONFIRM)
            return WorkerCustomerServicePreview(
                WorkerCustomerServicePreviewPhase.PUBLIC_WHEN_CHECKED,
                card.approvedCategoryName,
                card,
            )
        }
    }
}
