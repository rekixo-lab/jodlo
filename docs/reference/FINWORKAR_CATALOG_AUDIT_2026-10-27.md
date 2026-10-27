# Finworkar public catalog — immutable reference audit (2026-10-27)

> **REFERENCE ONLY. NOT JODLO APPROVED PILOT DATA.** Source was exported by the founder from the OLD Finworkar Firebase project `fin-workar` on 2026-10-27. No Firestore writes, old-repository edits, new live JODLO categories or Cloudflare deployment occurred. Respect [ADR-0008](../decisions/0008-hindi-english-only.md) (only Hindi in Devanagari and English) and [ADR-0009](../decisions/0009-instant-service-publication.md) (workers can self-publish **only in an already enabled category**, never auto-verified).

## Permanent storage across future chats

- **Original complete exported 7,411,839-byte JSON (sha256 `e9716a2fc9ed069ed45761842d4e697b25f0fb32cf698e4647b0edb16ad117e3`)**: founder's **private ChatGPT Library** `/JODLO/Reference/finworkar-catalog-2026-10-27.json`. Library upload verified. Fetch through Files Library list/search/read in new chats; the raw original is **not committed publicly to GitHub** because it includes legacy extra languages, aliases, icon URLs and metadata.
- **Full content-preserving bilingual *reference projection*** of ALL four catalog collections: tracked in **this GitHub repo** at [`data/finworkar-catalog-bilingual-2026-10-27.json.gz`](data/finworkar-catalog-bilingual-2026-10-27.json.gz). Compressed 379,486 bytes, SHA-256 `c7a7e206490e191ec16ba4cf883a825018746e6e9b35ef1de8b4549d9f38c735`; decompressed UTF-8 JSON 3,563,179 bytes, SHA-256 `31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375`. This preserves **every ID, all en/hi names, ancestor IDs, active/selectable flags, category safety tiers/historical pricing units and service sections**; intentionally drops all other locale texts, Romanized-Hindi aliases, old remote image URLs and redundant per-document wrapper metadata. It is **not** a production import file or content license for old assets.
- Another private Library copy of the bilingual normalized JSON: `/JODLO/Reference/jodlo-finworkar-bilingual-reference-2026-10-27.json`. This helps analyses that don't need to decompress GitHub's `.gz`.
- **Read the archived artifact locally**: `gzip -dc docs/reference/data/finworkar-catalog-bilingual-2026-10-27.json.gz > /tmp/finworkar-reference.json` or Node `gunzipSync`. CI checks the archived bytes and hierarchy with `npm run reference:check`; never auto-seed them into local/remote D1.
- Historical origin is Firestore `fw_categories/current`, catalog `1.0.0`, exported `2026-10-27T14:20:14.084Z`. Original `groups/families/categories/services` counts match exported root manifest.

## Full verified record counts and hierarchy

| Collection | Documents | Missing English | Missing Hindi | Missing hierarchical parents |
|---|---:|---:|---:|---:|
| Groups (parent) | 28 | 0 | 0 | — |
| Families | 206 | 0 | 0 | 0 |
| Categories | 889 | 0 | 0 | 0 |
| Services | 7,267 | 0 | 0 | 0 |
| **Total** | **8,390** | **0** | **0** | **0** |

The inherited group, family and category IDs of every descendant are **internally consistent**; `categories.serviceCount` agrees with actual service counts for all 889 categories.

## Group distribution, actual legacy state (NOT automatically approved)

| Legacy parent group ID | Categories | Services | Legacy status |
|---|---:|---:|---|
| home-services | 21 | 180 | active |
| retail-shop | 14 | 114 | active |
| construction-field | 35 | 284 | active |
| manufacturing-industrial | 30 | 242 | active |
| events-wedding | 22 | 184 | active |
| beauty-wellness | 18 | 147 | active |
| transport-logistics | 37 | 302 | active |
| automotive | 24 | 199 | active |
| education-advisory | 26 | 208 | **disabled_needs_population despite active=true** |
| tech-it-digital | 34 | 291 | active |
| creative-media | 30 | 250 | active |
| hospitality-food | 29 | 237 | active |
| healthcare | 33 | 274 | active |
| agri-livelihood | 38 | 315 | active |
| admin-finance-legal | 28 | 232 | active |
| electronics-repair | 32 | 271 | active |
| real-estate-property | 14 | 114 | active |
| security-services | 17 | 137 | active |
| pets-animal-care | 13 | 105 | active |
| sports-fitness | 21 | 172 | active |
| telecom-networking | 16 | 133 | active |
| rentals-booking | 28 | 233 | active |
| environment-utilities | 25 | 200 | **status missing despite active=true** |
| traditional-crafts-artisans | 73 | 584 | active |
| textile-handloom-apparel | 48 | 384 | active |
| local-vendors-microbusiness | 80 | 640 | active |
| religious-cultural-community | 58 | 464 | active |
| fisheries-forestry-natural | 45 | 371 | active |

## Concrete pre-migration review findings

1. **Parent state conflicts:** `education-advisory` has `active:true` but `status:'disabled_needs_population'`; `environment-utilities` has `active:true` without `status`. Do **not** interpret `active:true` as permission to enable all children.
2. **One legacy CATEGORY ID fails existing ASCII-only JODLO `validCategoryId` contract:** `farmer-helper-मजदूर`. Must plan an explicit reversible ID mapping before any import, not relax global ID validation or silently change imported ancestry.
3. **All 889 categories say `catalogStatus='PRODUCTION_CANDIDATE'`**. That is historical source metadata, **not JODLO production sign-off**. All 889 categories are marked `active` and `selectable` in old data; this does not override the founder's requirement to curate pilot categories.
4. **Safety tiers are diverse (113 distinct values), including healthcare/regulated/high-risk kinds**, and 11 historical pricing-unit combinations. They are **review inputs only**, not implicitly adopted by JODLO. No money fields/prices were imported; historical unit labels are retained for future decision analysis.
5. There are **1,514 distinct service `sectionId` references**, with no exported `sections` collection. They are legacy *display grouping references*, not proof that corresponding section documents were exported. Avoid treating them as separate categories without a mapping decision.
6. **121 repeated English service labels** occur across the 7,267 services. Service IDs themselves are all unique, and a display-label collision is not an ID duplicate.
7. Legacy service IDs often exceed JODLO's existing 64-character category-ID shape; **1,784** service IDs fail the category-ID matcher (service IDs need their own reviewed ID contract), while one category ID fails. Never force `validCategoryId` on raw legacy service IDs.
8. No missing `nameLocalized.en` or `nameLocalized.hi` in any level. Still review wording and any inappropriate service/safety labels for new product use. Legacy Hinglish / `hi-Latn` and other locale fields are deliberately **not** part of this GitHub bilingual snapshot.
9. Original export describes its own scope as **public catalog only**; it contains **no real customer activity, worker skills, demand/popularity telemetry, geographical pilot evidence, trustworthy live-user statistics or final owner market decisions**. The 5,295 `popular:true` service flags are historical configuration flags, not proof of current demand.

## Next action — keep existing founder gates

- [x] Founder allowed **immediate worker self-publication without automatic verification badge** (ADR-0009); do not re-ask manual moderation vs automatic publication.
- [ ] **M-005 pending:** founder selects actual pilot area/city and curated starting category IDs; don't enable all 889 or infer a pilot from this export. Draft options from evidence but label as recommendations.
- [ ] **M-003 pending:** personal-area/GPS consent, retention, deletion, account privacy rules (no GPS in this reference).
- [ ] Moderator reporting/appeal, category controls, contact/request lifecycle, verified badge policy still require product decisions; M-004 UI design, M-008 real Google OAuth, M-007 production-only deploy remain gated.

**Never edit old Finworkar repositories or import the legacy Firebase backend**. JODLO remains an independent Cloudflare Workers+D1 system using only shared validated ID rules, actual owner-approved category seeds, and Hindi + English UI/content.

## Verified CI/archive reproducibility checkpoint

[PR #37](https://github.com/rekixo-lab/jodlo/pull/37) merged as `24ceeb5a206efb4116a3620b542ddaddb8eaa550`; [exact main GitHub Actions #40523757801](https://github.com/rekixo-lab/jodlo/actions/runs/40523757801) completed **SUCCESS** on that SHA: **128/128 tests**, bilingual gzip/SHA and full ancestry check, docs/design/founder CI, local D1 migrations, strict TS and both Wrangler dry-run builds. Complete compressed snapshot was pulled from GitHub checkout and SHA checked using built-in Node tools with no Firebase credentials. Existing 128 Node API/safety tests still pass. This does **not** prove any real pilot data/customer demand/production Cloudflare behavior.
