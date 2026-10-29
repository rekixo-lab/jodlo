# JODLO — 45-packet human reviewer attention order (2026-10-29)

**Review only. NOT a safety score, expert signoff, approved work allowlist or deployment instruction.** ADR-0011 founder mandate is all legitimate trades, not a ten-category limit. The review coverage remains **all 889 original Categories and 7,267 historical Services** across 45 packets. The existing unified human queue joins Category ID/title corrections, Service bilingual names and Service occupational scope proposals; this new deterministic ordering REUSES those already source-validated evidence streams.

## Commands

```bash
npm run catalog:review-triage -- --check
npm run catalog:review-triage -- --summary
npm run catalog:review-triage -- --packets
npm run catalog:review-triage -- --packet=1
npm run catalog:review-triage -- --packet=45
npm run catalog:review-triage -- --lane=SPECIALIST_HOLD_REVIEW
npm run catalog:review-triage -- --lane=AMBIGUOUS_PARENT_REVIEW
npm run catalog:review-triage -- --all
npm run catalog:review-triage -- --review-root=.local-category-review/joint --summary
npm run catalog:review-triage -- --review-root=.local-category-review/joint --packet=7
npm run reference:check
npm test
```

Without a review root, all 135 source-locked correction/scope templates are unsubmitted. For real local evidence, the specified root must contain exactly the **three original** directories category/, service-name/, service-scope/, each with all 45 corresponding JSON files. Existing [unified queue validation](JODLO_UNIFIED_HUMAN_REVIEW_QUEUE_2026-10-29.md) refuses forged approvals, altered IDs/source, missing or extra rows, invalid Hindi/English proposals, traversal, symlinked files and unsafe oversized evidence. Keep reviewer drafts in local ignored directories; do not put personal or secret records in GitHub PRs.

## The five attention lanes

| Order | Technical reviewer lane | Evidence (not legal classification) |
| --- | --- | --- |
| 1 | SPECIALIST_HOLD_REVIEW | Specialist-policy hold among the original 17 preliminary desk opinions |
| 2 | REPORTED_SPECIALIST_OR_EXTRA_REVIEW | Submitted unverified Service-scope concern or earlier desk extra-review note |
| 3 | AMBIGUOUS_PARENT_REVIEW | Original or proposed Service name with multiple possible parent Categories |
| 4 | SOURCE_AND_EDITORIAL_REPAIR | Mechanical source/ID/slug/Hindi-text/Section flags or incomplete/unverified draft evidence |
| 5 | BASELINE_HUMAN_REVIEW | No known mechanical/desk diagnostic; **still all qualified reviews mandatory** |

Every Category has exactly one primary lane; multiple evidence reasons are retained. Lanes are **attention order only, not a risk score**. Within a lane, order uses the original packet number then exact original Category ID. A historical source safety tier is copied only as a label and does NOT prove legal compliance or safe work. The first 10 desk suggestions are neither approvals nor a product limit; 872 Categories still lack preliminary desk assessment.

The output includes original Category IDs and bilingual labels, Service count, desk source opinion, original diagnostic issues and flagged Service IDs, counts of unverified scope concerns, unresolved multi-parent Service proposals, incomplete name/scope evidence and the original mandatory human review state. A missing Service-name correction is NOT by itself evidence a new title is necessary.

## Unchanged hard authorization gates

**ALL 889/7,267 remain pending qualified human occupational, legal, bilingual and source-mapping review.** The queue requires 0 authenticated human/legal/founder approvals, 0 activated Categories or Services, 0 aliases and 0 SQL. No automatic approval, Category seed, remote D1, contact, PII, Android UI, Cloudflare staging or production, OAuth credentials or Finworkar write.

**M-005 NEEDS_DECISION_NOW:** final safe Category scopes, regulated qualification, original ID mapping, first customer request/contact, reporting/appeals and moderation. M-003 privacy/areas, M-004 visual design and M-007 production and M-008 real Google OAuth remain independently gated. Founder authorization to continue safe code is NOT evidence for those decisions.

CI runs strict source and queue checks via npm test and reference:check, besides existing local Worker/D1 and Kotlin checks.