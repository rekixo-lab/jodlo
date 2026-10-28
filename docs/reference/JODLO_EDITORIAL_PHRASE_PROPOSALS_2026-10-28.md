# JODLO — Human editorial phrase-proposal contract (2026-10-28)

**No aliases approved, no Category activated, no live runtime matcher change.** This is the first **positive but gated** bridge from the historical Service review to a manageable native-language editorial work batch. It is a proposal generator/validator, not a language reviewer or deployment authorization.

## Reproducible local workflow

The CLI uses the same SHA-pinned historical archive, verified 14,534 en/hi Service occurrences, 889 Category reviews and the **ten still-unapproved historical pilot candidate IDs** (merely a test batch choice, not a 10-trade product limitation).

- `npm run reference:editorial-summary`: proposed work-batch size, represented Categories and confirmed zero activation/import.
- `npm run reference:editorial-batch > proposed-phrases.json`: reproducible, **local-only** JSON batch of up to two English and two Hindi candidate phrases per historically proposed Category, with all exact Service IDs/parent ancestry.
- `npm run reference:check`: source hash/ancestry/ambiguity plus batch contract checks; CI exercises same rules.
- **Do not import or commit the generated JSON as a Worker/Android asset or D1 seed.** Do not advertise proposed aliases to customers.

The proposal schema is strict: `kind=JODLO_EDITORIAL_PHRASE_PROPOSALS_REVIEW_ONLY`, `state=NOT_APPROVED_NO_RUNTIME_MATCHER_NO_D1_SEED`, `languages=["en","hi"]`, exact immutable source SHA, and rows `{locale,phrase,categoryId,sourceServiceIds,sourceGroupId,sourceFamilyId,reviewRequired}`. Every row explicitly requires `LANGUAGE_MEANING_REVIEW`, `TRADE_SCOPE_REVIEW`, `FOUNDER_M005_CATEGORY_APPROVAL`.

## Never silently accept incorrect matches

The validator rejects unknown or unsafe Category IDs, source parent-state/ID/other review flags, altered Service IDs, mismatched Group/Family, Hindi containing Latin, unsupported/mixed Romanized language, overlong/malformed phrases, too-large batch, cross-Category shared phrase, tampered approval fields, removed human-review gates, duplicates, or unpinned source provenance. Unicode NFKC keeps Indic marks intact.

A single historical Category parent is **necessary but not sufficient** for trustworthy matching: the generated batch does not claim that its language is correct or professionally safe. Editors must approve semantic meaning, source service scope and category-risk policy separately. In the future, a **separate** founder-authorized publication mechanism could import explicitly approved words for independently active D1 Categories, with safe ambiguity handling.

No real 889-category import, external AI/translation, user data, city location, Android UI or Cloudflare deployment. Preserve existing ADR-0008 two languages, ADR-0009 instant self-publication only in approved-active Categories, and M-003/004/005/007 gates.

Evidence: exact PR head + merged-main GitHub CI green required before marking verified.
