# JODLO — Historical 7,267 Service-label review queue (2026-10-28)

**Status:** read-only analysis and local reproducible tooling. No JODLO service activation, synonym import, category approval, D1 seed, UI or deployment.

## Why this matters

The old catalog is not a safe ready-made search dictionary. A single displayed service label may mean **different worker trades** under different parent categories; importing its text as a global synonym would recreate Finworkar's false-match hazard. In addition, many old Hindi service labels contain Latin/English, and the old service identifier format is distinct from the existing JODLO *category* identifier policy. These facts demand individual service-level review before any future matching expansion.

## Offline workflow

- `npm run reference:check`: revalidates both immutable legacy SHA-256 hashes, 889-category work queue and **new service queue invariants**, in addition to existing founder city/taxonomy guards. No remote access or user data.
- `npm run reference:service-summary`: prints counts only.
- `npm run reference:services > legacy-service-review.json`: outputs all 7,267 historical service records as a **local, review-only JSON work queue**. Do not copy this into the shipped Android/Worker bundle or use it as a seed.

The output preserves the original service ID, Group/Family/Category IDs, bilingual names, historical `sectionId`, and namespaced (English/Hindi) cross-Category collisions. Each row is explicitly `UNAPPROVED_HUMAN_SERVICE_LANGUAGE_SCOPE_REVIEW_REQUIRED`; fields that imply approval, worker identity, verified status, contact details or search-index activation are **not present**. Historical source IDs are never silently mutated.

## Pin-verified findings

| Service-level quality issue | Historical count | What it means |
|---|---:|---|
| Service leaves reviewed mechanically | 7,267 | None made publishable by this script |
| Hindi labels containing Latin letters | 4,928 | Human Hindi-script and semantic editorial review, not automatic transliteration |
| Categories affected by those Hindi labels | 616 | Human review should be scoped by the actual Category |
| Cross-Category repeated bilingual label keys | 139 | English/Hindi label keys counted separately; never merge worker trades based only on name |
| Categories participating in those collisions | 127 | Work vocabulary must map to the intended parent Category, not a global leaf-name alias |
| Historical leaf IDs unlike current Category-ID contract | 1,784 | A future *separate* leaf-ID policy or reversible map is needed; no change to existing `validCategoryId` |
| Unique unresolved historical service section references | 1,514 | Missing section catalog; do not invent Group/Family/Section nav from these pointers |

The archived safety tiers (113 kinds) remain **old evidence** and cannot automatically decide the new product's legal/safety policy. No quality flag means **not yet reviewed**, never automatically approved. The UI and Search cannot reasonably support all old leaves until the founder approves editorial rules and safe category IDs.

## Safe following work

1. Human language reviewers validate single-script Hindi + English terminology and approved context per Category, including acronyms that may be legitimate.
2. For repeated names used across trades, retain *all parent contexts*. A phrase may yield ambiguous choices requiring worker/customer confirmation, not a made-up high-confidence match.
3. Prepare a separate **proposed** alias candidate file with explicit editorial provenance and deny-by-default status; only approved-active Category IDs may surface publicly under existing Backend gates.
4. Gate any real city/area-specific availability behind M-003, UI behind M-004, real catalog activation behind M-005 and any Cloudflare deployment behind M-007.

See [889-category review](JODLO_LEGACY_889_CATEGORY_REVIEW_2026-10-27.md), [source catalog audit](FINWORKAR_CATALOG_AUDIT_2026-10-27.md), [ADR-0008](../decisions/0008-hindi-english-only.md), and [Smart Discovery foundation](JODLO_SMART_DISCOVERY_FOUNDATION_2026-10-27.md). CI results must be verified on exact PR/main hashes before claiming tests green.
