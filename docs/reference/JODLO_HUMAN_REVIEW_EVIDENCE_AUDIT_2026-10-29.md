# JODLO — unresolved human-review evidence audit (2026-10-29)

**ADR-0011 full source breadth: 45 review packets, 889 original Categories, 7,267 original Services, 2,667 human review work tasks.** This read-only tool cross-checks the same validated Category/Service proposal evidence, source diagnostics, attention-order worklist and local progress ledger; it never checks GitHub PR existence, author identity, legal credentials, evidence quality or actual signoffs.

## Why this report exists

Individual human review packets can contain PR-shaped URLs and self-reported progress. Those URLs are only syntax-checked in the existing validators. The unresolved evidence dossier joins each Category's original ID and language labels, source diagnostics, Service name/scope evidence counts, specialist concerns, cross-Category phrase ambiguity, incomplete Name/Scope handoffs, Category mapping proposals, individual progress task status and all referenced PR URLs. All case rows preserve `stillRequiresQualifiedHumanAndFounderReview: true`, and no URL, reused URL, risk tier or historical desk opinion makes a Category publishable.

## Read-only local commands

```bash
npm run catalog:review-evidence-audit -- --check
npm run catalog:review-evidence-audit -- --summary
npm run catalog:review-evidence-audit -- --packets
npm run catalog:review-evidence-audit -- --packet=1
npm run catalog:review-evidence-audit -- --packet=45
npm run catalog:review-evidence-audit -- --category=ORIGINAL_SOURCE_CATEGORY_ID
npm run catalog:review-evidence-audit -- --flag=SPECIALIST_HANDOFF_PENDING
npm run catalog:review-evidence-audit -- --flag=SERVICE_DRAFT_HANDOFF_UNRESOLVED
npm run catalog:review-evidence-audit -- --all
npm run reference:check
npm test
```

Without real offline reviewer inputs, it uses the complete unsubmitted original templates. Optional real **gitignored** reviewer inputs can be joined as:

```bash
npm run catalog:review-evidence-audit -- --review-root=.local-category-review/joint --progress-root=.local-category-review/progress --summary
npm run catalog:review-evidence-audit -- --review-root=.local-category-review/joint --progress-root=.local-category-review/progress --packet=7
```

The review root uses the 135 existing original Category/Service name/Service occupational-scope packets; the progress root uses exactly 45 existing reviewer progress packets. Both paths must be real repo-relative local directories. Existing source-fingerprint, complete-coverage, language, PR-URL syntax, field-schema and symlink/size/path protections are reused. **Stale local reviewer progress must be reconciled with changed original proposal data; it is rejected, not silently attached to a new scope.** Nothing writes to the source archive or to a Cloudflare environment.

## Explicit unresolved statuses

| Flag | Meaning for a human reviewer |
| --- | --- |
| `TASK_NOT_STARTED` | Human work not yet reported |
| `TASK_IN_PROGRESS_UNVERIFIED` | A person self-reported activity but no authenticated signoff |
| `TASK_EVIDENCE_LINKED_UNVERIFIED` | PR URL is formatted correctly, but linked evidence and qualified author are not verified |
| `SPECIALIST_HANDOFF_PENDING` | A handoff was recorded; a specialist review has not been verified |
| `ORIGINAL_SOURCE_DIAGNOSTIC` | Original source ID, name, source flag or other mechanical diagnostic |
| `PROPOSED_CATEGORY_MAPPING_UNVERIFIED` | Category ID/slug/bilingual title change requires human adjudication |
| `PROPOSED_SERVICE_NAME_UNVERIFIED` | Bilingual Service label draft requires human adjudication |
| `PROPOSED_SERVICE_SCOPE_UNVERIFIED` | Included/excluded work and qualifications draft requires independent review |
| `SERVICE_DRAFT_HANDOFF_UNRESOLVED` | Name/scope evidence is one-sided; a missing name correction might be intentional |
| `CROSS_CATEGORY_PHRASE_COLLISION` | Proposed phrase has ambiguous parent Category choices |
| `SERVICE_SCOPE_CONCERN_REQUIRES_SPECIALIST` | Unverified proposed occupational safety/legal/qualification concerns |
| `EVIDENCE_REFERENCE_REUSED_NEEDS_CONTEXT` | The same URL references more than one Category; that can be valid, but needs context |

The `--summary` totals and `--packets` identify the outstanding workload; `--packet=N`, `--category=...` and `--flag=...` provide targeted reviewer handoffs. Shared PR references are counted once per Category and **never treated as proof of dishonest or unsafe work**. The tool does **not** query GitHub, perform live source retrieval, check whether a PR/comment exists, authenticate author identity, establish qualified legal expertise or determine evidence validity. The summary explicitly sets `linkedEvidenceAuthenticationChecksPerformed: 0` and all authenticated signoffs to 0.

**Every original Category and Service remains awaiting independent qualified review.** Zero founder/category approvals, zero approved aliases, zero activated Categories/Services and zero SQL statements are enforced even if all PR-shaped references are filled. The old 17 preliminary desk assessments (10 narrow recommendations, 4 further review, 3 specialist holds) are not release permissions. All 872 other Categories also remain included.

**M-005 manual founder decision still required** on real qualified occupational/legal/Hindi-English review, final Category IDs, first contact/request and safety/complaint/moderation policy. M-003 area/PII/privacy, M-004 visual design approval, M-007 no remote Cloudflare staging or production deployment and M-008 live OAuth remain independent. No personal case notes or credentials in PRs; no customer/worker personal data or Finworkar writes.

All changes are nonvisual Node/CLI only and registered in `npm test` and `reference:check`, alongside existing local D1/workerd and Kotlin/JVM CI. Do not claim verification or completion until the exact PR-head and independently merged-main GitHub Actions results are green.