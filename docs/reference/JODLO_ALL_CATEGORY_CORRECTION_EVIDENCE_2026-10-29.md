# JODLO — Full 889-Category correction evidence intake (2026-10-29)

**Offline review only.** Source of truth: [ADR-0011](../decisions/0011-all-category-coverage-smart-discovery.md), [the 45 existing review packets](JODLO_CATEGORY_HUMAN_REVIEW_PACKETS_2026-10-28.md) and [the all-889 D1 mapping audit](JODLO_ALL_CATEGORY_MAPPING_READINESS_2026-10-29.md). No Category gets approved, activated, indexed, seeded, auto-translated or published by these commands.

## Why and who this covers

JODLO serves **all legitimate work**, not only the old ten review candidates. All **889** original Categories already appear **exactly once** in **45 packets**. Each original packet now contains Category ID/slug and title compatibility issues alongside Group/Family lineage, source Service examples and ambiguity counts. This tool lets a reviewer **submit a specific correction proposal with a traceable PR evidence link**, without editing the pinned historical archive or pretending a proposed correction has been checked by a human.

It is **not** the existing [17 scope-bound occupational/legal reviewer-signoff intake](JODLO_M005_SCOPE_BOUND_EVIDENCE_INTAKE_2026-10-28.md). That separate process remains relevant to safety. A correction proposal here is **only** the unverified ID/slug/label change metadata; it does not certify legal work scope, qualification, risk, moderation or the final source-to-JODLO mapping.

## Existing workflow, with one additional optional step

```bash
npm run catalog:review-packets
npm run catalog:review-packet -- --packet=1
npm run catalog:correction-summary
npm run catalog:correction-template -- --packet=1 > catalog-corrections-untracked.json
npm run catalog:correction-template -- --validate-file=catalog-corrections-untracked.json
npm run reference:check
npm test
```

Change `--packet=1` to any **1..45**. For an intended Category correction, modify only that record's `proposedCorrections` fields (`categoryId`, `slug`, `nameEn`, `nameHi`), change its `status` to `EVIDENCE_LINKED_UNVERIFIED`, and supply `evidenceUrl` pointing to a relevant **`https://github.com/rekixo-lab/jodlo/pull/N`** or corresponding PR comment. All other records remain `NOT_SUBMITTED` with all-null corrections and null links. A submitted correction must actually differ from the original value.

The generated Category record includes the unmodified `sourceCategoryId` and an **SHA-256 fingerprint of that exact source packet record**. If the historical evidence, row order, packet source, relevant Category name/flags or review state changes, the previous evidence package fails validation and should be regenerated/re-reviewed. All 20 (or final 9) original rows must remain present in their original order, even with no submitted corrections. This is how no legitimate trade gets silently dropped.

## Strict safety / quality boundary

- Correction IDs satisfy current D1 Category-ID syntax; slugs satisfy the separate lower-case D1 slug rule; corrected English titles contain English/Latin writing without Devanagari, and corrected Hindi titles contain Devanagari without Latin letters. Names are trimmed, NFKC canonical, free of controls and at most 120 Unicode code points. **This is syntax validation, not translation/editorial certification.**
- Proposed IDs cannot collide with **any** existing Category source ID or syntax-compatible current ID across all 889. Proposed slugs cannot collide with the existing source-compatible slugs of any of the 889 Categories. Duplicate proposed IDs/slugs within a packet fail. **Future human review of all correction submissions together must still check cross-packet proposed-to-proposed collisions**; validating isolated packet drafts is not global mapping acceptance.
- PR links are **not checked for existence, authorship, expertise or content**. Even a link referencing all four reviewer roles is still `EVIDENCE_LINKED_UNVERIFIED`. The validator reports `humanReviewAuthenticated: 0`, `founderCategoryApprovalsAuthenticated: 0`, `categoriesAuthorizedForActivation: 0`, `activatedCategories: 0` **regardless of links**.
- Extra `approved`, `is_active`, `seed`, `SQL`, contact, personal data, language modes or changed source digests cause rejection; never paste credentials, licensing documents, customer identities, device locations or contact details into these JSON drafts or PR comments.
- The original `farmer-helper-मजदूर` Category stays in one original packet. A reviewer may propose a suitable ASCII ID and slug **with evidence**, but the tool never silently transliterates or rewrites it.
- No new API route, D1 table/migration, public service synonyms, Category seed, Android UI, Cloudflare resource or Finworkar write is made by this work.

**Still gated:** full human occupational/legal review, meaning/quality of Hindi and English labels, final collision-free mappings and founder's precise M-005 Category/Contact/moderation approval, then separate M-003 privacy, M-004 design and M-007 controlled production release. Full catalog coverage is the approved **goal**, not a claim that 889 Categories are already active.
