package com.rekixo.jodlo.core.network

/** Headless source-of-evidence tests for the Customer's shared Service card.
 * Only the exact current public detail DTO can promote a selected reference
 * to "public when checked". All saved/feed/browse rows remain unchecked.
 */
internal fun verifyCustomerServiceCards() {
    val selected = PublicListing(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "plumber")
    val approved = PublicCategory("plumber", "plumber", "प्लंबर")
    val detail = PublicApprovedServiceDetail(Language.HI, selected, approved)

    val page = CustomerServiceCard.reference(selected, approved.name)
    check(page.listing == selected)
    check(page.approvedCategoryName == "प्लंबर")
    check(page.evidence == CustomerServiceCardEvidence.REFERENCE_ONLY)

    // Even a locally saved ID with a known previously approved Category
    // cannot grant a fresh "currently public" badge.
    val saved = CustomerServiceCard.reference(selected)
    check(saved.approvedCategoryName == null)
    check(saved.evidence == CustomerServiceCardEvidence.REFERENCE_ONLY)
    check(CustomerServiceCard.reference(selected, " \t ").approvedCategoryName == null)

    val verified = CustomerServiceCard.publicWhenChecked(
        selected, Language.HI, detail)
    check(verified != null)
    check(verified.listing == selected)
    check(verified.approvedCategoryName == approved.name)
    check(verified.evidence == CustomerServiceCardEvidence.PUBLIC_WHEN_CHECKED)

    check(CustomerServiceCard.publicWhenChecked(selected, Language.HI, null) == null)
    // Exact same ID, original Category AND requested language required.
    check(CustomerServiceCard.publicWhenChecked(selected, Language.EN, detail) == null)
    check(CustomerServiceCard.publicWhenChecked(
        selected.copy(id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
        Language.HI, detail) == null)
    check(CustomerServiceCard.publicWhenChecked(
        selected.copy(categoryId="carpenter"),
        Language.HI, detail) == null)
    check(CustomerServiceCard.publicWhenChecked(selected, Language.HI,
        detail.copy(listing=selected.copy(id="cccccccc-cccc-4ccc-8ccc-cccccccccccc"))) == null)
    check(CustomerServiceCard.publicWhenChecked(selected, Language.HI,
        detail.copy(category=approved.copy(id="carpenter"))) == null)
    check(CustomerServiceCard.publicWhenChecked(selected, Language.HI,
        detail.copy(category=approved.copy(name="  "))) == null)
    // Existing English-approved names are permitted, not translated or
    // hallucinated from a slug or Worker supplied string.
    val en=CustomerServiceCard.publicWhenChecked(
        selected, Language.EN,
        PublicApprovedServiceDetail(Language.EN, selected,
            approved.copy(name="Plumber")))
    check(en?.approvedCategoryName == "Plumber")
    check(en.evidence == CustomerServiceCardEvidence.PUBLIC_WHEN_CHECKED)
}
