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
    /** The ONLY extra field surfaced beyond the existing public Listing ID
     * and Category ID. This is an approved Catalog Category name, never an
     * unreviewed Worker description, experience, location, price or badge.
     */
    val approvedCategoryName: String? = null,
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
            if (value.language != requestedLanguage ||
                value.listing.id != selectedOwnRow.id ||
                value.listing.categoryId != selectedOwnRow.categoryId ||
                value.category.id != selectedOwnRow.categoryId ||
                value.category.name.isBlank()) {
                return WorkerCustomerServicePreview(
                    WorkerCustomerServicePreviewPhase.CANNOT_CONFIRM)
            }
            return WorkerCustomerServicePreview(
                WorkerCustomerServicePreviewPhase.PUBLIC_WHEN_CHECKED,
                value.category.name,
            )
        }
    }
}
