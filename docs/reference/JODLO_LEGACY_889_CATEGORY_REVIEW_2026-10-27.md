# JODLO: historical 889-category review work queue

**Status: analysis only. Zero categories approved or seeded.** This review is not a deployment, public taxonomy, searchable synonym import, human translation certification or safety whitelist. The **old Finworkar** repository and immutable historical source remain untouched.

## New deterministic, reproducible review workflow

Run `npm run reference:check` in this repository to verify the original pinned bilingual archive SHA-256, its hierarchy, legacy candidate safeguards, pilot city names and the **full 889-category review invariants**. Run `npm run reference:review > review.json` to generate a JSON review **locally** containing one record for every historical Category; do **not** feed this output into migrations or copy it into the Android/Worker bundle.

Each row contains only historical public taxonomy fields (ID, Group, Family, bilingual names, source Safety Tier, Service count), evidence counts of Hindi labels with Latin characters and cross-Category reused service labels, an explicit `UNAPPROVED_HUMAN_SAFETY_AND_LANGUAGE_REVIEW_REQUIRED` status, and reason flags. It never has a publish/approve/is_active/seed field. Provenance hashes and refusal of added language modes are hard-coded into the read-only CLI.

## Whole-catalog findings, not production authorization

| Check across historic 889 | Finding | Interpretation |
|---|---:|---|
| 28 Groups / 206 Families / 889 Categories / 7,267 Services | Full hierarchy | Historical reference only |
| Distinct legacy safety-tier labels | 113 | **Not** JODLO approved risk policy |
| Service records containing ASCII Latin in the historical Hindi label | 4,928 | Requires human Hindi/meaning review; technical acronyms may legitimately need exceptions |
| Categories with one or more affected Hindi service labels | 616 | Affected category IDs stay individually reviewable |
| Categories under a Group whose historical status is missing or not active | 51 | 26 education/advisory and 25 environment/utilities; **not** proof each trade is unusable |
| Categories with a service label also used under another Category | 127 | Context-specific collisions; NEVER globally merge / map to one trade |
| Cross-category duplicated label keys, English/Hindi counted separately | 139 | No automatic Service → Category ID assignment from ambiguous name alone |
| Legacy Category IDs incompatible with existing JODLO ASCII ID contract | 1 | `farmer-helper-मजदूर` needs explicit reversible mapping |
| Distinct historical section references without corresponding section export | 1,514 | Cannot infer new Section navigation from these references |

**Every Category requires separate human safety and linguistic acceptance**, including ones with no detected mechanical problems. A blank flag list is not an approval. Historical `active=true` and `PRODUCTION_CANDIDATE` are never deployment permission.

## How this helps future Search

Use the work queue to prioritize source corrections and trustworthy **category-scoped** phrase mapping. Two services with the same human label can mean different jobs under different parents (e.g., leakage repair for different equipment). Never add all legacy Service terms to the existing intent alias resolver in bulk, never auto-select a guessed Category. Keep original catalog search, manually chosen Category fallback, approved-active D1 publication, ADR-0008 two languages, and global eligible-public-listing Home facet.

Next stage (future separate approval): review true Category safety rules and mark accepted IDs explicitly under M-005; human-check Hindi/English synonym scopes and conflicting leaf labels; approve M-003 area/consent/retention before actual Bilaspur/Raipur location matching; UI needs M-004 visual approval; release needs M-007. This work itself **does not block approved active-category worker immediate self-publication** (ADR-0009), no auto verification badge.

Verification: exact PR head and subsequent merged-main GitHub Actions must both succeed before claiming fully tested.

## 2026-10-28 Service-level evidence companion

The complete [7,267-Service source-locked quality review](JODLO_LEGACY_7267_SERVICE_REVIEW_2026-10-28.md) is now derived on demand using the same pinned archive reader, not imported into JODLO Search/D1. Review every parent-scoped Service before ever adding synonyms. All 889 Categories remain unapproved by this review alone.
