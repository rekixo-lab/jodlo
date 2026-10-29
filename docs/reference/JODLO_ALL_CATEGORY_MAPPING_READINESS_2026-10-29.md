# JODLO — Offline ID, slug and bilingual-label readiness for all 889 Categories

**2026-10-29 · ADR-0011 · source-only, strictly NON-AUTHORIZING.**

## Why this exists

JODLO's founder approved **all legitimate Category coverage** rather than a ten-trade launch cap. The pinned historical catalog already covers **28 Groups, 206 Families, 889 Categories, 7,267 Services**, and the existing 45 review packets cover every Category. This companion closes a distinct engineering gap: a **single reproducible compatibility check** against the **actual D1 `categories` schema** in [migration 0001](../../infra/migrations/0001_public_catalog.sql) before any human-reviewed category import can be proposed. The compatibility check does **not** convert the source archive into an approved catalog.

## Run without deployment

```bash
npm run catalog:mapping-summary
npm run catalog:mapping-review > category-mapping-review-only.json
npm run reference:check
npm test
```

The read-only commands load the exact SHA-256-pinned original archive through the existing [889-category expansion preflight](JODLO_CATEGORY_EXPANSION_PREFLIGHT_2026-10-28.md). They output source IDs and Group/Family lineage for **all 889** (not ten), original historical Hindi/English Category names, D1-syntax-only Category ID and slug candidates, compatibility issues, original review flags and all **four pending human/founder gates**. The report also totals Category coverage by original Group/Family for reviewer completeness.

**Schema checks:** D1 Category IDs use bounded ASCII `[A-Za-z0-9_-]`; public slugs require 2–64 characters, lower-case ASCII letter first, then lower-case letters/digits/hyphens; bilingual `name_en`/`name_hi` fields are bounded by D1's 120 Unicode-character SQL check. The script identifies overlength/control-character Category labels, unexpected Latin characters in historical Hindi Category titles, invalid source IDs and incompatible slug shapes. This intentionally checks **Category display names only**, not the 7,267 Service-leaf strings (4,928 previously flagged Hindi leaves remain a separate editorial backlog).

A non-null `categoryIdCandidate` or `slugCandidate` means only that **reusing the unchanged source ID passes the corresponding D1 syntax constraint**. It is *not* a final mapping, a linguistically reviewed label, an approved trade, a verification status or a publish permission. Null candidates must be resolved by an authorized human-reviewed reversible mapping. The known source `farmer-helper-मजदूर` is **kept** as a review row with null candidates, not silently dropped, transliterated or rewritten. IDs with uppercase/underscore or other incompatible slug shapes require explicit slug review; no guessing or normalization.

## Fail-closed invariants

- The exact archive checksum, `en|hi` language list, full preflight row shape/state, ID/Group/Family lineage, source flags, and the original four mandatory human/founder checks are verified. Added `is_active`, `approved`, `seed`, `SQL` or modified output fails the verifier.
- Every source ID occurs exactly once, ordered deterministically; independent Group/Family totals help catch omissions. The pinned real archive is asserted to contain **889 Categories, 28 Groups, 206 Families, exactly one Category ID needing manual mapping**.
- Every generated row remains `HUMAN_ID_SLUG_LABEL_AND_SAFETY_REVIEW_REQUIRED`. The summary has `categoriesAuthorizedForActivation: 0` and `sqlStatementsGenerated: 0`. The Node negative tests alter source evidence, gates, IDs, result counts, authorization fields and language modes to prove denial.
- The script is deliberately under `scripts/` and **never imported by Worker/Android code**, SQL migrations, real search aliases or deployment tools. No production data, PII, real areas, OAuth secrets, call/payment, UI or remote Cloudflare resources.

## 2026-10-29 — Same mapping evidence surfaced inside the 45 human review packets

The existing `scripts/catalog-review-packets.mjs` now **calls `buildCatalogMappingReadiness(preflight)` directly** to attach source-pinned `mappingCompatibility` ID/slug syntax-only candidates and D1 Category-title issues to each of the **same 889 review items**. Its per-packet and global manifest summaries count ID/slug/label issue Categories; all totals are cross-checked against this mapping audit. Reviewers use `npm run catalog:review-packet -- --packet=N` and `npm run catalog:review-packets`, without separately reconciling two lists. [Reviewer packet details](JODLO_CATEGORY_HUMAN_REVIEW_PACKETS_2026-10-28.md).

This is still **pure offline review**, with four pending gates per Category, no final ID/slug selection, no D1 migration/seed, no activation, no worker contact and no Cloudflare deployment.

## What remains

M-005 **breadth** is approved for all legitimate work (ADR-0011). **Final** JODLO Category IDs/slugs, corrected bilingual labels, occupational/legal/safety and regulated-work policy, reviewer signatures/Founder M-005 category-specific authorization, plus contact/moderation policy still require actual decisions/evidence. The 45 [existing reviewer packets](JODLO_CATEGORY_HUMAN_REVIEW_PACKETS_2026-10-28.md) remain the human workflow for every Category; this syntax report is a companion, not a second approval process. M-003 area/privacy, M-004 visual UI and M-007 production-only release are unchanged.

No category has been activated. Actual PR-head and separately merged-main CI must pass before treating this verification code as stable; even then it is **local compatibility evidence, not proof of release readiness**.
