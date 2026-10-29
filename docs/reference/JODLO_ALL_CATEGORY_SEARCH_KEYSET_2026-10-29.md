# JODLO — Full-coverage Search cursor pagination (2026-10-29)

**Offline backend-only feature, ADR-0011.** All legitimate reviewed work Categories belong in future product discovery; **889 historical records are review scope, not automatically active**. Current search retained a legacy offset ceiling of 100 (up to 125 matching results in one request), even though `/api/v1/catalog?limit=25&after=...` could browse an entire approved catalog. The new **opt-in** `cursor=1` Search mode allows any number of approved matching Categories to be traversed with one bounded page at a time.

## API examples

```text
GET /api/v1/catalog/search?q=Service&lang=en&cursor=1&limit=25
GET /api/v1/catalog/search?q=Service&lang=en&cursor=1&limit=25&after=8:plumber
GET /api/v1/catalog/search?q=Service&lang=hi&cursor=1&limit=25&availableOnly=1
```

Cursor example is **illustrative**: use only a `nextCursor` returned by the server for the same search, language and availability filters. Never invent a category ID, sort order, or availability. In `cursor=1` mode, a successful Search response has `language`, `query`, `categories` and `nextCursor` (string or null); **no** `nextOffset`. Continue until `nextCursor:null`. Without `cursor=1`, the previous `nextOffset` response is unchanged, including its existing depth and caps, to avoid breaking installed clients.

The new parser strictly accepts only `cursor=1`; `after` is valid **only** with cursor mode, and uses the shared bounded nonpersonal `sort_order:categoryId` syntax. `offset` cannot be combined with cursor mode. `includeChoices=1` remains a separate user-confirmation mode and cannot be paginated; mixed cursor and choice options are rejected. `limit` stays 1..25, `q` stays 2..64 Unicode codepoints, `lang` is exactly `en` or `hi`; repeated and extra parameters fail with 400. Existing nonvisual Kotlin clients continue to use their prior legacy Search adapter, with no unapproved Android UI changes.

All SQL values (query, cursor sort order and ID, paging limit) are parameter-bound; Search uses only **currently active D1 Categories**, with `availableOnly=1` restricted by the same published, moderator-allowed, account-active, worker-profile-eligible `EXISTS` test. The public reply contains Category `id,slug,name` only: no worker identity, contact, geography, counts or verification. A category disabled after an earlier page does not leak via the subsequent page. The curated single-trade alias fallback is restricted to an actually active ID and never repeats after the first cursor; unknown/mixed-script/ambiguous phrases are not mapped into a guessed trade. The cursor is a position token, **not** a signed snapshot or a promise that live catalog edits will not reorder rows. It must not be treated as proof of occupational/legal eligibility.

## Verification and gates

`apps/api/tests/catalog-search-keyset.test.mjs` exercises all **889 synthetic, local-only approved** fixture Categories with 36 pages of max 25, sort-order ties, prior-row deactivation, availability-only and moderation guards, shape backward compatibility, cursor tampering, Hindi/English split, ambiguous intents, SQL error redaction and worker identity non-disclosure. These fixtures do **not** activate original source records. Run `npm test`, `npm run typecheck`, local D1/workerd CI, exact PR-head and independent main CI.

**No source 889/7,267 import, new real Category authorization, Search synonym seed, Android UI, personal location, contact, staging, Cloudflare deployment or Finworkar change.** M-003/M-004/M-005 legal/safety/real mapping/contact/moderation/M-007/M-008 remain independently gated.
