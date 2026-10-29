# JODLO — Offline human review work cards and self-reported progress (2026-10-29)

**ALL-TRADE REVIEW ONLY. ZERO HUMAN CERTIFICATION, CATEGORY APPROVAL OR PUBLIC ACTIVATION.** ADR-0011 mandates all legitimate trades; the historic **889 original Categories and 7,267 Services** must be examined, not only the first ten desktop samples. The 45 original attention-order packets from [review triage](JODLO_REVIEW_ATTENTION_ORDER_2026-10-29.md) are reused to generate exactly **2,667 local review actions**, three per Category. This is workflow bookkeeping, not a signed reviewer system, legal ruling, verified translation, qualification check, Category/Service allowlist or seed.

## Tasks for every original Category

| Human work type | Reviewer deliverable to seek independently |
| --- | --- |
| `HUMAN_ENGLISH_HINDI_EDITORIAL_REVIEW` | Qualified human inspect historical names, Hindi Devanagari, English, ambiguity and proposed language corrections |
| `QUALIFIED_OCCUPATIONAL_AND_LEGAL_SCOPE_REVIEW` | Verify actual work boundaries, regulations, exclusions, credentials, hazards and proposed Service scopes |
| `SOURCE_CATEGORY_MAPPING_AND_PARENT_REVIEW` | Resolve original Group/Family/Category ID lineage, final ID/slug mapping and cross-Category phrase ambiguity |

All three are required for **every** original Category, including the 872 without an earlier desk assessment, and do not represent a claim that the work is safe. M-005 founder final approved Category set, contact/request flow, verification, complaints and moderation remain separate decisions; no automatic per-Category founder signoff is claimed.

## Produce local work cards

```bash
npm run catalog:review-progress -- --check
npm run catalog:review-progress -- --summary
npm run catalog:review-progress -- --template-packet=1
npm run catalog:review-progress -- --template-packet=45
npm run catalog:review-progress -- --packet=1
npm run catalog:review-progress -- --all
npm run reference:check
npm test
```

To prepare a real reviewer workspace, create a local folder under `.local-category-review/` (already gitignored) and save one generated template each for packets 01–45, naming files `review-progress-01.json` ... `review-progress-45.json`. **Never commit actual reviewer case data or a private progress workspace.** To read complete local progress, run:

```bash
npm run catalog:review-progress -- --progress-root=.local-category-review/progress --summary
npm run catalog:review-progress -- --progress-root=.local-category-review/progress --packet=1
```

An optional `--review-root=.local-category-review/joint` selects all **135 validated Category/Service name/Service scope correction drafts** alongside the progress root. It re-fingerprints the original human-review action cards; if the source-proposal snapshot changes, stale progress files are refused until a human reconciles/rebases the evidence, rather than quietly inheriting claims for a different proposed Service definition.

## Self-reported state only, not approval

Each Category card retains the exact source Category ID, source fingerprint, current review attention lane, historical Service count and exactly three task objects in a fixed order. The only editable fields on a task are its `status` and `evidenceUrl`. The allowed statuses are:

| Status | Meaning | Evidence URL |
| --- | --- | --- |
| `NOT_STARTED` | No work reported | Must be null |
| `SELF_REPORTED_IN_PROGRESS` | A person reports activity, no identity or result authenticated | Must be null |
| `EVIDENCE_LINKED_UNVERIFIED` | Possible reviewer notes linked but **not checked**, no qualified signoff | JODLO GitHub PR/PR-comment URL required |
| `SPECIALIST_HANDOFF_PENDING` | Possible escalated issue; specialist review still not completed | JODLO GitHub PR/PR-comment URL required |

URLs are syntax-checked only; no GitHub role, identity, evidence quality, authenticity or lawful work can be inferred from them. The tool does not store names/PII, private location, reviewer identity, notes or timestamps. Do not put real private case details in GitHub PRs. A qualified reviewer who actually clears a matter cannot set `APPROVED`, `CLEARED`, `CERTIFIED`, `PUBLISHED`, any final Category ID or `is_active` with this tool: those require future separately designed authenticated gates and specific founder decisions.

## Fail-closed full-coverage checks

Local input must be a real repo-relative directory containing **exactly 45** complete JSON files. The validator checks original source SHA, full 889/7,267 coverage, stable packet sequence, 3 task types per Category, hashes of source names/diagnostics/evidence proposals, missing/extra/duplicate fields, unsupported status, false approvals, symlink and outside-root access and file bounds (200 KB per file). Each packet's summary and the 45-packet reconciliation show self-reported statuses, unverified evidence counts, **all 889/7,267 still awaiting human review**, exactly **zero** authenticated legal/occupational/bilingual/founder signoffs, **zero** activated Categories/Services, **zero** aliases, and **zero** SQL.

**Unchanged independent gates:** M-003 area/PII/privacy, M-004 founder visual design approval, M-005 final qualified human legal/safety/bilingual mapping and contact/moderation, M-007 no remote Cloudflare/staging until approved production-only release, M-008 live Google OAuth. The founder's broad permission to continue engineering cannot override these. No D1 seeding, release, contact, Android visuals, secrets or Finworkar changes.
