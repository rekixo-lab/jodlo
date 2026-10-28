# JODLO M-005 — First 17 genuine historical trade scope assessments (2026-10-28)

**Decision status: preliminary source-backed assessment, NOT an approved category list or certification.** This is the first substantive desk review of actual source Service tasks rather than another tooling-only work queue. The assistant inspected the pinned historical bilingual archive for these exact Category IDs and their Service examples. **No native-speaker sign-off, occupational safety audit, legal licensing check, founder category approval, UI rollout, D1 seed or production deployment has occurred.**

The machine-checkable, deliberately non-executable row decisions and English/Hindi scoped text are in [source-pinned assessment JSON](data/jodlo-m005-first-17-scope-assessments-2026-10-28.json). Each row records (a) exact source Category ID, Safety Tier and an actual English Service name that must exist under that parent, (b) proposed accessible Hindi display name, (c) *positive* permitted work boundaries and *negative* excluded tasks in both languages, (d) primary safety/privacy concern, and (e) four pending sign-offs.

## Individual, source-specific desk outcomes

| Status | Actual source Category IDs | Proposed scoped treatment |
|---|---|---|
| **10 narrow-scope candidates — approval pending** | `plumber`, `carpenter`, `house-painter`, `house-cleaner-maid`, `sofa-carpet-cleaner`, `gardener`, `tailor-stitching`, `bicycle-repairer`, `watch-repairer`, `tyre-puncture-technician` | Recommend **only routine lower-risk work** within each source Category after independent approval. Exclude mains electricity, gas, structural work, dangerous heights, toxic paint/chemical treatment, biohazards, pesticide application, unsafe roadside repair and unconsented property/data access. Original legacy Service names are **not all accepted** by recommending a parent. |
| **4 extra review before public listing** | `mobile-repair`, `laptop-repair`, `two-wheeler-mechanic`, `home-shifting-helper` | Device data and reset/credential consent; vehicle brakes/road testing; lifting/property liability; old shifting Service Hindi labels include English clauses. Require separate privacy/safety/wording review before deciding if narrower parts could be enabled. |
| **3 held pending specialist policy** | `electrician`, `ac-technician`, `home-tutor` | Electrical mains and high-voltage work; refrigerant and electrical safety; and safeguarding minors plus the historical education Group status inconsistency. **No affirmative public listing recommendation yet.** |

**Careful distinction:** *Recommended narrow scope* means a suggested, bounded eligibility **question for the Founder and human reviewers**. It is **not** authorization for the backend to activate even these ten Categories, and it says nothing about badges, customer contact permissions, background checks or qualifications. JODLO's own existing D1 active/eligible Listing guards still apply. This first 17 is a priority desk sample only; every other one of the 889 historical Categories remains within the [45-packet review queue](JODLO_CATEGORY_HUMAN_REVIEW_PACKETS_2026-10-28.md). It is **not** a future ten-trade marketplace restriction.

## Real source evidence, with explicit boundaries

- `plumber`: source Service **“Tap / faucet repair”**, but no permission for electrical geyser connections or gas lines.
- `house-painter`: **“Interior wall painting”** supports an ordinary wall-work suggestion; source **“Exterior wall painting”** can involve height, so no automatic approval of all painting Services.
- `house-cleaner-maid`: **“Sweeping and mopping”**, ordinary cleaning only; no childcare, patient care or hazardous chemical combinations.
- `gardener`: **“Garden maintenance”** supports routine upkeep, but source also mentions **“Garden pest care”**, which must not authorize hazardous pesticide work.
- `tyre-puncture-technician`: **“Tube puncture repair”** belongs to a potentially workable shop service; historical **“Emergency roadside puncture support”** is a separate traffic-risk question.
- `mobile-repair`: **“Data backup and transfer support”** means customer privacy and custody safeguards need a defined consent policy.
- `laptop-repair`: **“Virus and malware cleanup”** needs user data/access boundaries before the Category could be advertised.
- `two-wheeler-mechanic`: **“Brake service”** is safety-critical. Do not use generic legacy `vehicle_repair` tier as a full qualification policy.
- `home-shifting-helper`: **“Safe lifting and loading”** carries lifting/property concerns and historical mixed-language service titles.
- `electrician`: **“New house wiring”** clearly cannot be treated like a low-risk household task.
- `ac-technician`: **“AC gas refill”** requires refrigerant handling and electrical safeguards, not an automatic pass.
- `home-tutor`: **“school subjects home tuition”** implies potential one-on-one contact with minors and an inconsistent disabled historical parent Group.

Other included Services are checked against the pinned snapshot by `scripts/verify-m005-first-scope-review.mjs`; the [JSON](data/jodlo-m005-first-17-scope-assessments-2026-10-28.json) contains positive/negative scope for **each** of the 17, in both scripts.

## Concrete next review/approval actions

1. **Founder M-005 policy decision:** decide whether the *proposed narrow boundaries* are acceptable for named Categories after appropriate human QA and whether additional credential/safety conditions must apply. This is distinct from saying “continue engineering.”
2. **Occupational safety, regulatory and native Hindi/English human review:** verify meaning, task legality, sector obligations, actual category labels, and exclusion language. This desk review is not legal advice or human editorial certification.
3. **Moderation/contact model:** define how job requests, customer identity, home entry, reporting and unsafe listing categories work. Existing worker self-publish applies only to independently active Categories; no automatic verified badge (ADR-0009).
4. **After explicit sign-offs**, develop a separately reviewed machine-verifiable approved ID set and local D1 migration/seed **only for exact accepted categories** with per-category scopes. The present JSON cannot serve as that seed or runtime dictionary.

Validation: `npm run catalog:m005-first-review`, `npm run reference:check`, `npm test`. The validator cross-checks every Category ID, original safety tier, service evidence, source SHA and permanently pending signoffs against the original pinned immutable archive. It forbids fabricated `approved`/`is_active` fields, extra languages, human certification claims or promoting high-voltage/refrigerant categories to ordinary work. Actual CI verification on PR and merged main is required before asserting this change landed.

M-003 personal location/consent, M-004 visual UI and M-007 Cloudflare remote production approval remain separate. Finworkar repository must remain read-only.
