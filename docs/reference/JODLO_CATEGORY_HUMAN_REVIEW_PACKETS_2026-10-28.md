# JODLO — Human-sized review packets for all 889 old Categories (2026-10-28)

**Founder correction (2026-10-29, ADR-0011):** All 45 packets/889 Categories are in the intended full-catalog review scope, **not** an instruction to launch only ten categories or to stagger public category activation by packet. Review packets are an efficient human QA process; any legally unsafe/regulated source work still needs a category-specific policy/verification, and none of these packets by itself enables D1. [Binding decision](../decisions/0011-all-category-coverage-smart-discovery.md).

**Review-only. No actual Categories approved, inserted, indexed or activated.** This workflow makes the next Founder M-005 decision actionable, without turning the historical Finworkar snapshot into a launch catalog.

## Commands (local only)

- `npm run catalog:review-summary`: 889 historical Categories / 45 review packets (20 each, final 9), all pending human/founder approval
- `npm run catalog:review-packets`: a compact **45-packet manifest** with original Group IDs, boundaries, and diagnostic counts; not 889 cards on one screen
- `npm run catalog:review-packet -- --packet=1`: the first complete packet of 20 Category work items (change 1 to 2..45); no network, no public route
- `npm run reference:check`: source SHA-256, previous category/service/phrase/preflight integrity and this review packet coverage validator

Packets sort by **original Group → Family → Category**. A packet can cross Group boundaries at a size limit; Group IDs remain explicitly recorded. Every Category appears **exactly once**, including the one with an incompatible legacy Category ID. Its original ID is never silently fixed, dropped or approved.

## 2026-10-29 — D1 mapping readiness shown inside all 45 existing review packets

[PR #94's full-889 mapping compatibility audit](JODLO_ALL_CATEGORY_MAPPING_READINESS_2026-10-29.md) is now **reused by this existing 45-packet generator**, not copied into a second review process. `npm run catalog:review-packet -- --packet=N` includes a `mappingCompatibility` field alongside each original Category's source evidence:

- `categoryIdCandidate`: unchanged source ID only if its **syntax** is compatible with the current D1 Category ID rule; otherwise `null`
- `slugCandidate`: unchanged source ID only if it meets the stricter public slug syntax; otherwise `null`
- `syntaxIssues`: exact reasons for manual ID, slug or bilingual Category-title correction, without automatic rewriting
- `reviewState`: `HUMAN_ID_SLUG_LABEL_AND_SAFETY_REVIEW_REQUIRED` for **every** Category, including those with no flagged syntax issues

The existing packet manifest and per-packet summaries now count Categories with ID, slug and Category-title syntax issues, plus the **union** of any such problems. These counts are recomputed from actual per-Category rows and checked against the independent mapping audit so missing work cannot be silently hidden. The known historical `farmer-helper-मजदूर` ID remains in one of the 45 packets with **null ID/slug candidates**, never auto-transliterated or removed.

**No category is approved or activated** by a non-null syntax candidate. The previous safety, language, regulated-work, full Service-leaf review, source lineage, original ambiguity, and four human/founder M-005 gates remain. Human reviewers can now resolve mapping compatibility while reading the **same** old-category packet instead of reconciling two independently maintained queues. No live D1 seed, SQL generation, search alias activation, Android UI or Cloudflare deployment.

## 2026-10-29 — Optional correction-evidence intake for every packet

[The all-889 Category correction-evidence CLI](JODLO_ALL_CATEGORY_CORRECTION_EVIDENCE_2026-10-29.md) now creates source-fingerprinted, **unapproved** correction templates for **any existing packet 1..45**. It can check proposed corrected ID, slug, English/Hindi Category title and JODLO PR evidence link against each original Category, without altering the old packet, historical data or D1. Run `npm run catalog:correction-template -- --packet=N` for a template and `npm run catalog:correction-template -- --validate-file=RELATIVE_PATH` for a local submitted copy. It does not authenticate a reviewer and cannot approve or activate even one Category. This is **not** the separate 17-category occupational/legal evidence signoff process.

## Per-Category task evidence

Every review item includes pinned source Group, Family, Category ID; historical English and Hindi display names; historical safety tier as **non-authoritative evidence only**; child Service count; existing quality flags; count of Hindi Service labels containing Latin letters; count of ambiguous Service phrases spanning distinct Categories; up to **three original service-label examples** and **three cross-Category phrase examples** preserving the other possible parent IDs; and all four mandatory Founder/human review gates from the preceding [all-Category preflight](JODLO_CATEGORY_EXPANSION_PREFLIGHT_2026-10-28.md).

Examples are navigation clues, **not complete category language or risk review**. For all 7,267 source Service records run `npm run reference:services`, and for complete 14,534 language occurrences run `npm run reference:phrases`; do not infer that the first three samples prove correctness.

## Correct human process

Review in practical batches while keeping legitimate work eligible for consideration: editors examine category meaning and occupational risks (including regulated/licensed/illegal work); correct Hindi/English labels and IDs, inspect entire leaf vocabulary when flags exist, and resolve Service phrases shared between trades *by their parent context*. Under M-005 the Founder must then approve a precise category eligibility policy and individual IDs. An editor or a clean mechanical flag count does **not** activate a Category. The current draft outputs contain no approval, published status, D1 seed/SQL or runtime Search import.

This is not a new UI and it never writes to Cloudflare or old Finworkar. M-003 location/consent, M-004 visible UX, M-005 real safe category activation and M-007 production release remain separately gated. ADR-0008 Hindi+English and ADR-0009 immediate self-publication only in **previously approved-active** Categories remain in force. These packets are implementation preparation, not language/safety certification.

Exact PR and separately merged-main CI green required before completion claims.
