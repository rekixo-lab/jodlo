# JODLO — globally prioritized next human review actions (2026-11-02)

**Non-authorizing, local-only work planning.** This CLI gives reviewers a **small, resumable batch** of the next original Category review tasks across the **entire 889-Category / 7,267-Service scope**. It does **not** define eligible jobs, auto-approve legal or occupational safety, activate a public Category, import aliases, create D1 migrations, decide a rollout by packet, or require Android. Historic Finworkar data remains a READ-ONLY reference.

## Why this exists

The existing [all-category review triage](../../scripts/catalog-review-triage.mjs) orders the full 889-source evidence queue into attention lanes, while the [45-packet progress system](../../scripts/catalog-human-review-progress.mjs) carries 2,667 strictly source-fingerprinted tasks and reviewer **self-reported, unverified** statuses. They intentionally separate triage from review state.

The [new action view](../../scripts/catalog-review-next-actions.mjs) joins **these existing validated artifacts by immutable original Category ID**, not by display order. It provides a bounded global next-task window and a continuation cursor. This lets a human prioritize attention without manually opening 45 packet reports, silently cutting scope to ten Categories, or representing a PR link as verified legal signoff.

## Commands — all offline (no Cloudflare or GitHub write)

```bash
npm run catalog:review-next
npm run catalog:review-next -- --limit=5
npm run catalog:review-next -- --limit=5 --after=ORIGINAL_SOURCE_CATEGORY_ID
npm run catalog:review-next -- --summary
npm run catalog:review-next-check
```

- Default: at most **20** Category cards; `--limit=1..25` bounds each window. When `page.nextCursor` is non-null, provide it **unchanged** to the next `--after` request. The cursor is only valid for the current local attention snapshot; if underlying human drafts change, regenerate the first page.
- Each card retains: original packet/group work reference via `packetNumber`, source Category ID and fingerprint, historic Hindi/English labels, source Service count, priority lane and reason codes, and **all three** editorial/occupational-and-legal/mapping human tasks with their existing statuses and optional unverified JODLO PR references.
- The first-window ordering follows the **full existing review-attention queue**; it is **not** a legal hazard ranking, certification, quota, fixed pilot allowlist, or product rollout order. Later windows retain all 889 original items, including source IDs needing manual correction.
- Optional `--review-root=RELATIVE_DIR` and `--progress-root=RELATIVE_DIR` reuse the **same strict path, symlink, source hash and input validation** as the upstream human-review tools. Source-locked inputs or original counts that do not match fail closed; no file is automatically rewritten.
- `--check` verifies input coverage and zero authorization. `--summary` shows the 45/889/7267/2667 original coverage and unverified status counts; it does **not** claim completed human reviews, legal approval, or any remotely validated evidence.

## Review acceptance remains separate

Every original Category, including unflagged rows, still needs qualified occupational/legal and bilingual content review, reviewed parent/ID mappings, and founder decisions **before** any actual public activation. Entries tagged `EVIDENCE_LINKED_UNVERIFIED` or `SPECIALIST_HANDOFF_PENDING` remain unresolved—not completed. Real service scopes or credentials are **not** introduced by this utility. `categoriesAuthorizedForActivation`, `servicesAuthorizedForActivation`, `approvedAliases` and `sqlStatementsGenerated` are always **zero** in its output.

Cross-reference [ADR-0011](../decisions/0011-all-category-coverage-smart-discovery.md), [M-005 manual gates](../MANUAL_ACTIONS.md), [full review packets](JODLO_CATEGORY_HUMAN_REVIEW_PACKETS_2026-10-28.md), [Status](../STATUS.md), and [the earlier Business Logic audit](../BUSINESS_LOGIC_AUDIT_2026-11-02.md).

## Evidence / release boundary

The code/test PR must receive green PR-head CI, **then** green independent merged-main CI before its status is described as verified. This is an offline workflow improvement only; no staging, production deployment, real user data, payment, caller, moderation, Android, Cloudflare resources or legacy Finworkar writes.
