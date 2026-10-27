# ADR-0008 — JODLO supports only Hindi and English

**Status:** Founder-approved and binding — 2026-10-27  
**Scope:** All JODLO copy, UI planning, search/text processing, future documentation and accessibility labels.

## Founder decision

JODLO has **exactly two supported languages**:
- **Hindi**, written in **Devanagari**.
- **English**.

**Hinglish is NOT a supported language or interaction mode.** Do not write Romanized-Hindi (e.g. `mujhe plumbing chahiye`) vocabulary, convert between scripts, train a mixed-language matcher, auto-transliterate, add Hinglish search synonyms, or ship Hinglish app labels. A phrase mixing Latin and Devanagari in one natural-language search must not get a best-guess service match.

## Immediate implementation effect

- Existing `/api/v1/catalog?lang=en|hi` and `/api/v1/catalog/search?lang=en|hi` remain the only display locales.
- `catalog/search-phrases.ts` must use separate *Hindi-script* and *English* grammatical token sets with no Romanized-Hindi stopwords. Mixed-script input returns no inferred category.
- Regular literal English/Hindi category search, strict prepared-SQL queries, bounds, inactive-category exclusion and bilingual output remain unchanged.
- No new locales, packages, UI/screens, real pilot taxonomy or remote resources.
- The **old Finworkar** source may accurately describe historic Hinglish behavior; this is **not permission** to implement it in JODLO.

## Verification and gating

Use synthetic positive Hindi+English and negative Romanized-Hindi/mixed-script tests; require PR and post-merge main CI Green. M-003 locality/privacy and M-005 pilot flows remain future founder decisions; M-004 blocks UI implementation, M-008 Google provider setup, M-007 remote production-only launch. This language decision is **already finalized** and must not be re-asked.

## Implementation verified

[PR #25](https://github.com/rekixo-lab/jodlo/pull/25) merged as `e0ce6d04a56f9c8aaa27c24d50f821ace5201ae3`; [main GitHub Actions #40493262734](https://github.com/rekixo-lab/jodlo/actions/runs/40493262734) **SUCCESS** on that exact SHA (84/84 Node tests, local D1 migrations, strict TypeScript, docs/design guards and both Worker dry-run bundles). Synthetic natural search tests confirm separate English/Hindi categories and denial of Hinglish/Roman Hindi/mixed-script queries. No UI language switch or real production speech/audio was tested.
