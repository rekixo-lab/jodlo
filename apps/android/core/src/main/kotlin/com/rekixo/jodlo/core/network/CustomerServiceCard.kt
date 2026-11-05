package com.rekixo.jodlo.core.network

/** Strictly public Customer-facing display data for ONE Service. No owner
 * identity, profile, area, phone, rates, verification or contact permission.
 * In particular, a public listing/page/saved bookmark is NOT a fresh check.
 */
enum class CustomerServiceCardEvidence {
    /** A public page/bookmark can be stale the instant it is received. */
    REFERENCE_ONLY,
    /** Exact current approved public Service+Category read, at read time only. */
    PUBLIC_WHEN_CHECKED,
}

data class CustomerServiceCard private constructor(
    val listing: PublicListing,
    val approvedCategoryName: String?,
    val evidence: CustomerServiceCardEvidence,
) {
    companion object {
        /** A name from a prior approved public lookup is only display text.
         * Without a fresh exact detail request, no current-public claim.
         */
        fun reference(
            listing: PublicListing, approvedCategoryName: String? = null,
        ): CustomerServiceCard = CustomerServiceCard(
            listing,
            approvedCategoryName?.takeIf { it.isNotBlank() },
            CustomerServiceCardEvidence.REFERENCE_ONLY,
        )

        /** This is the ONLY construction path for a checked-public badge.
         * Match the exact selected ID, original Category and requested
         * language. A stale/swapped detail or fabricated label cannot be
         * promoted to a currently public card. No saved or owner-only read
         * grants this state.
         */
        fun publicWhenChecked(
            selected: PublicListing, requestedLanguage: Language,
            detail: PublicApprovedServiceDetail?,
        ): CustomerServiceCard? {
            if (detail == null || detail.language != requestedLanguage ||
                detail.listing != selected ||
                detail.category.id != selected.categoryId ||
                detail.category.name.isBlank()) return null
            return CustomerServiceCard(
                selected, detail.category.name,
                CustomerServiceCardEvidence.PUBLIC_WHEN_CHECKED,
            )
        }
    }
}
