# JODLO — Read-only availability-aware category discovery foundation (2026-10-27)

**Founder direction:** avoid leaving legitimate workers out solely because of a ten-item pilot shortlist; let them find work by typing/speaking, while customers should see real relevant available listings rather than empty category walls. This is a technical **first slice**, not a completed intelligent matcher or approval to seed/activate the 889 historical categories.

## Implemented contract, no new route or table

The **existing** public endpoints now support an opt-in `availableOnly=1` query facet:

- `GET /api/v1/catalog?lang=hi` — unchanged response; all currently **active/approved** category entries, maximum 100 (existing limit).
- `GET /api/v1/catalog?lang=hi&availableOnly=1` — same projection (`id,slug,name`), but only active categories with at least one currently publicly eligible worker listing. Suitable as a *non-geographic* candidate set for the future customer's Home; **NOT** proof that any worker is within a particular city or available at a requested time.
- `GET /api/v1/catalog/search?lang=hi&q=<encoded Hindi>&availableOnly=1` — same bounded, paginated, bilingual text search but limited to categories with a live eligible listing.
- `GET /api/v1/catalog/search?lang=hi&q=<encoded Hindi>` — unchanged search over the whole **active category** inventory (including empty categories), so a first worker can find a trade; future customer could also discover an empty category and get an explicit no-results state.

Only an exact `availableOnly=1` is supported, and duplicate/unknown query keys are rejected. No `availableOnly=0` or fake public `isAvailable` flag; do not infer an unapproved area or viewer identity from this read. The `categories` arrays retain their original API shape. Public listing eligibility is a **single shared SQL predicate** used by the existing `GET /api/v1/listings` path and these two optional facets: published status, moderator allowed, active worker account, existing opted-in private worker draft, active category. Correlated `EXISTS` prevents duplicate categories with multiple workers. This reflects current D1 state when queried; no cached counter drift. Tests cover publish/unpublish, moderation, disabled accounts, opt-in removal, category shutdown, many listings, input injection and no personal projection.

## Crucial remaining limitations, not hidden claims

1. **Catalog content:** No legacy catalog seed, no 889 activated, no 7,267 unreviewed service leaves indexed. All current public queries operate on **existing active JODLO rows only**; inactive/restricted catalog entries remain unselectable/publish-blocked. The ten proposals remain unapproved. Broad permission to *work* does not silently overwrite the recorded safety review or founder M-005 category IDs.
2. **Smart semantic resolution:** Existing `categoryIntentTerms` supports only approved Hindi/English grammar and public names. It does not yet match `नल टपक रहा है` to `plumber` or `लकड़ी का फर्नीचर` to `बढ़ई` without **reviewed service synonym/index data**. No fake 'AI understands everything' claim or unsupported transliteration/Hinglish. Prepare reviewable category-scoped aliases/fixtures, then test ambiguous and zero-match cases before extending matching.
3. **Browse scale:** `GET /catalog` has a prior 100-row cap; manual navigation across all 889 (if approved and imported) requires separate **cursor pagination / hierarchical navigation** (not implemented here). Search scans currently active categories, not all legacy references. Future UI needs founder M-004 approval.
4. **City/locality:** Today `availableOnly` is a **global, non-geographic existence check**, not a Bilaspur/Raipur availability or distance promise. Do not advertise it as local until founder approves M-003 personal area/consent/delete and precise pilot areas. Do not collect coordinates or addresses.
5. **Worker posting:** Existing ADR-0009 instant self-publication in an approved active category and no automatic verification remains untouched. No worker images, service descriptions, price, personal contact, request/call flow, moderator portal, personal data, chat or paywall introduced.

## Next exact implementation stages (separately gated)

- **Engineering safe:** test cursor-pagination/no-gap browse for an approved 889-entry synthetic dataset; design (but do not seed) a strictly reviewed per-category Hindi/English alias/index contract with source/provenance and tests for ambiguity, typo, no match and mixed-script rejection. Reuse existing Catalog + server-authoritative publishing contracts, not legacy code. Add synthetic workload latency tests.
- **M-005 decision:** how to safely enable the real nonrestricted categories beyond the ten earlier suggestions; review quality/safety flags, valid IDs and lineage. The founder's latest goal is broad coverage, but this commit does **not** assert all categories passed safety review.
- **M-003:** consent, city/area choice, optional GPS and retention/deletion before personal location data or 'nearby' promises.
- **M-004:** actual worker/customer Guided Post, Home, Group/Category screens and animation storyboard before UI code.
- **M-007:** no staging/remote deployments before separately approved production release. M-008 real Google OAuth still future.

Old Finworkar Android/backend source study is [here](LEGACY_GUIDED_POST_HOME_SEARCH_CODE_REVIEW_2026-10-27.md), purely READ ONLY. Language only Hindi (Devanagari) and English; no Hinglish. All tests currently synthetic/local; actual results must be confirmed by PR and merged-main CI before recording verification.

## Follow-up implementation — 889-row synthetic keyset browsing

The old `GET /api/v1/catalog` contract intentionally remains unchanged (100 rows, no cursor field) for existing clients. New explicitly requested pages `GET /api/v1/catalog?lang=hi&limit=25` return `{language,categories:[{id,slug,name}],nextCursor}`; pass `after=<encoded nextCursor>` for the next 25. The cursor has only public `sort_order:category_id`, not worker identifiers or personal data. `limit` must be an integer 1–25, `after` requires `limit`, ID and sort range are bounded, repeated/unknown/malformed keys are rejected; SQL values are bound and sorted by `(sort_order,id)` keyset, not offset. The optional previously implemented `availableOnly=1` facet applies to paginated read too. Synthetic test verifies **all 889 entries** reachable without duplicates, category status changes before cursor do not shift later pages, and a single eligible listing near the end remains discoverable. It is a synthetic fixture only: **no real JODLO 889-category activation**.

**Limits:** This does not implement a Group/Family navigator (current live D1 category schema is flat); nor does it guarantee snapshot consistency when category states or sort_order *ahead of cursor* change during traversal; clients must refresh if needed. Search endpoint keeps its independent, bounded text-query offset API; a future tested cursor/search index can supersede it. This is structural safety for a manual fallback and will not display 889 options on one screen. Actual UI still gated by M-004; actual city matching by M-003 and founder-approved precise area policy. Require exact PR and main CI green before claiming production-ready performance or completion.

## 2026-10-27 — Conservative natural-work-intent fallback (safe active-only)

After PR #43 (live-listing availability facet) and #44 (889-item synthetic cursor traversal), added a tightly bounded **first work-intent alias fallback** in the **existing** `GET /api/v1/catalog/search` route. It only runs when ordinary category name/grammar matching returns **no rows**, and only returns a **preexisting active D1 Category ID**. It reuses the exact optional `availableOnly=1` server-side listing eligibility check (published + allowed moderation + active owner + private opt-in + active category). No new route, table, user data, category seed or language mode.

- Four illustrated trades (plumber, carpenter, tailor-stitching, bicycle-repairer), 12 deliberately narrow hand-authored Hindi or English phrases; these are **engineering examples to verify matcher behavior**, not a complete human-reviewed service dictionary or founder approval of the category IDs. A category absent/inactive in D1 produces **zero** suggestions.
- Distinct trades in one request produce **no automatic choice**. Unsupported Romanized-Hindi, mixed-script, punctuation/injection-like or unrelated contextual text cannot trigger this alias fallback. SQL remains parameterized. This is **not broad semantic understanding** or fuzzy classification; it uses explicit matching evidence.
- Client must still allow worker confirmation/manual Group/Category selection; the original name search and response shape/pagination remain unchanged.
- Tests cover Hindi worker/customer examples, English equivalents, conflicting trades, unsupported language, inactive/hidden moderation, no-listing discovery, no private projection and error redaction. Exact CI results **pending verification**.
- Legacy 7,267 Service names (4,928 with Latin characters in Hindi labels) are **not** imported; no new UI, personal location, Bilaspur/Raipur area, Google OAuth, real pilot category enablement or Cloudflare deployment. M-003/M-004/M-005/M-007 boundaries remain as before.

## Continued matcher quality work — 2026-10-27

The source-only matcher now has 24 narrow routine-work examples for ten **candidate** category IDs, two-language script checks and a reviewed-alias registry validator. New examples are `house-painter`, `house-cleaner-maid`, `sofa-carpet-cleaner`, `gardener`, `watch-repairer`, `tyre-puncture-technician`. The test-only data uses human-readable Hindi/English words, not the unreviewed 7,267 historical service vocabulary. Each new mapping is *technically illustrative*, **not verified to work for every customer phrase**, and the actual D1 category must independently already be active. Conflicting phrases across categories fail startup validation; ambiguities in a query yield no automatic selection. This still does not make a smart general-purpose NLP engine, nor does it turn on unapproved risky trades.

The registry review guard catches malformed/mixed script, duplicate or cross-category contained phrases, oversized payloads, and bad IDs. It is **not** native-speaker semantic review, synonym exhaustiveness, professional qualification verification or AI moderation. Founder M-005 safety-gated category activation and editorial review remain unapproved. No personal location, UI, 889 activation, worker detail fields or Cloudflare activity. CI proof pending.
