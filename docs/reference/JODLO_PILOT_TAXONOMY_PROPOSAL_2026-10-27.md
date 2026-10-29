# JODLO pilot taxonomy proposal — 2026-10-27

**SUPERSEDED AS LAUNCH-SCOPE GUIDANCE (2026-10-29):** Founder confirmed JODLO should cover **all 889 historical Category review candidates, not only the ten candidates below**. The ten are retained solely as traceable occupational-safety/language *sample reviews*, not a public activation cap. See [ADR-0011](../decisions/0011-all-category-coverage-smart-discovery.md). No broad unreviewed D1 seed or regulated-work authorization is implied.

**Founder-selected city-name scope (ADR-0010): Bilaspur / बिलासपुर and Raipur / रायपुर.** Exact local areas/geofences and personal-location policy remain unapproved. The 10 categories below are not yet approved or seeded.

> **NOT APPROVED. REFERENCE ONLY. NO D1 SEED, CLOUD DEPLOYMENT OR UI.** Worker self-publication in **already enabled** categories is approved; verified badges are never automatic (ADR-0009). This proposal neither enables a category nor changes that decision. Only Hindi (Devanagari) and English (ADR-0008).

## Provenance and quality findings

Source: the complete founder-supplied immutable bilingual Finworkar reference, compressed at data/finworkar-catalog-bilingual-2026-10-27.json.gz. The existing reference verifier checks its SHA and ancestry; the new check adds review safeguards. The catalog contains **28 groups, 206 families, 889 categories and 7,267 services**. They are historical *reference records*, not evidence of market demand or JODLO launch approval.

**New critical content defect:** 4,928 of the 7,267 legacy Hindi service names (67.8%) contain Latin letters, across **616 distinct categories**. For instance, the home shifting helper's service includes “जोड़ाई और असेंबली — Furniture dismantling support”. Conversely, the 28 Group, 206 Family and 889 Category Hindi names have zero ASCII Latin-letter matches. The legacy audit saying no names were *missing* does not mean these translations are correct. Technical acronyms require contextual review, but full English clauses must not ship as Hindi UI. **Keep service leaves out of the pilot until reviewed.**

After NFKC/casefold normalization that preserves Devanagari vowel marks, there are **no normalized name duplicates** within Groups, Families or Categories. Services have 79 English repeated-label groups (200 rows) and 60 Hindi repeated-label groups (160 rows), **all across different parent categories**, not inside one Category. Therefore do not globally deduplicate service names: “Water leakage repair” for AC, fridge and water purifier is context-dependent. A naïve regex that strips Indic combining marks can falsely merge distinct Hindi words.

Other review blockers remain: 113 historical safety-tier strings rather than a new approved JODLO policy; education-advisory marked active but with status disabled_needs_population; environment-utilities active with missing status; invalid old category ID farmer-helper-मजदूर; 1,514 sectionId references without a sections export; 1,784 service IDs incompatible with the category ID regex. Historical popular/PRODUCTION_CANDIDATE flags and price unit labels are **not** evidence of demand or live pricing consent.

## Four-level taxonomy contract — proposed only

- **Group:** top-level discoverability/navigation group. One stable ID and human-reviewed English/Hindi labels. Reject conflicting source status.
- **Family:** child of exactly one group, used to organize similar trades. Preserve explicit group ancestry.
- **Category:** selectable worker trade with own stable ID, active eligibility, safety scope and bilingual label. Current approved worker listings already use category ID + opaque public listing ID, not direct personal contact.
- **Service:** a future optional leaf **within** the category, requiring native-language review and a separate safe ID contract. Never infer missing section documents or publish untranslated labels; no leaf import is needed for today's backend.

For any future founder-approved subset import, keep a reversible legacy-to-JODLO ID mapping, guard collisions, verify ancestry and service risks, produce a dry-run diff, and require explicit pilot approval. Do not expand the shared ID validator to accept the malformed old ID.

## First-wave options — 10 source-backed category IDs

All ten belong to historical active parents and have category status active, historical tier standard or skilled_trade, and **no Latin letters within their Hindi service names**. That is a basic screening result, not linguistic or skill certification. Initial API remains category-only.

| Group → Family | Actual category ID | English / हिंदी | Source risk |
|---|---|---|---|
| Home → Plumbing | plumber | Plumber / प्लंबर | skilled_trade |
| Home → Carpentry & Furniture | carpenter | Carpenter / बढ़ई | skilled_trade |
| Home → Painting | house-painter | House Painter / घर पेंटर | skilled_trade |
| Home → Household Cleaning | house-cleaner-maid | House Cleaner / Maid / घरेलू सफाईकर्मी / मेड | standard |
| Home → Household Cleaning | sofa-carpet-cleaner | Sofa & Carpet Cleaner / सोफा और कार्पेट क्लीनर | standard |
| Home → Outdoor Support | gardener | Gardener / माली | standard |
| Retail → Tailoring | tailor-stitching | Tailor / दर्जी | standard |
| Retail → Specialty Local Repair | bicycle-repairer | Bicycle Repairer / साइकिल मरम्मत करने वाला | standard |
| Retail → Specialty Local Repair | watch-repairer | Watch Repairer / घड़ी मरम्मत करने वाला | standard |
| Automotive → Tyres & Wheels | tyre-puncture-technician | Tyre & Puncture Technician / टायर और पंचर टेक्नीशियन | standard |

Even these categories need safeguards: home entry, property damage, tools, painting chemicals, roadside risks, reporting/escalation, accurate scopes and safe customer contact. A low legacy source risk tier does not certify skill or trust. No category is automatically verified.

## Separate review or hold

**Needs extra scrutiny before first wave:** mobile-repair (device data/privacy); laptop-repair (private files, credentials, backup consent); two-wheeler-mechanic (road safety); home-shifting-helper (all eight source Hindi service names mix English clauses, plus lifting/property liability).

**Explicit holds:** electrician (high_voltage); ac-technician (refrigerant_and_electrical); home-tutor (disabled/conflicting parent and minor safeguarding). Also hold all other potentially clinical, licensed, dangerous chemicals, financial/legal regulated, surveillance/security-sensitive, high-voltage and confined-space services until scoped policy review. Treat missing group status as blocked for automated eligibility.

## Editorial + safety backlog

1. Triage the **4,928** Hindi-service script anomalies, then manually review meaning and accessibility for the other **2,339**. Preserve only Devanagari Hindi and English; never add Hinglish or unreviewed machine transliteration.
2. Compare service IDs and **parent-scoped** canonical labels; leave different-parent repeats intact unless separately and reversibly approved. Existing unique IDs and family/category ancestry are sound.
3. Create an explicit reversible map for farmer-helper-मजदूर; do not mutate the historical archive or silently relax validation.
4. Resolve parent statuses, missing section definitions and the separate leaf service-ID contract before any approved import.
5. Map high-risk/source-tier families to a new founder-approved policy and establish report, moderation, safeguarding and verification boundaries; do not use historical source tiers as enforcement logic.

## Founder decisions, implementation and proof

**M-005:** Founder has selected the **two city names** (Bilaspur and Raipur); now must choose which exact curated category IDs, if any, may become JODLO active seeds. Exact local pilot areas/wards have not been approved. The publication method is **already approved** (instant, not auto-verified); do not re-ask. Separately unapproved: first customer availability request/contact, verification rules and operational moderation/report/appeal.

**M-003** (personal location consent, retention, deletion), **M-004** (UI), **M-006** (payments/calling), **M-007** (production), **M-008** (real Google OAuth/device) remain gated.

The compact IDs-only [unapproved candidate manifest](data/jodlo-pilot-candidates-2026-10-27.json) and dependency-free verifier (scripts/verify-pilot-taxonomy-proposal.mjs, invoked by npm run reference:check) are **read-only quality controls**. No migration, route, seed, secrets, assets, external data, deployment or UI was added. The separate original reference SHA check remains authoritative.

See [source audit](FINWORKAR_CATALOG_AUDIT_2026-10-27.md), [ADR-0008](../decisions/0008-hindi-english-only.md) and [ADR-0009](../decisions/0009-instant-service-publication.md).
