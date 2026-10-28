# JODLO — Full 889-Category Activation Preflight (2026-10-28)

**All 889 historical Categories included. Zero approved, zero activated.** This is the offline engineering safety boundary between historical reference and *future separately authorized* real JODLO categories. It is intentionally not an activation script or a migration plan.

## How to run locally

- `npm run catalog:preflight-summary`: counts by mechanical Category issues plus all-outstanding human/founder gates, no private data
- `npm run catalog:preflight-review > rollout-preflight.json`: 889 item per-Category **draft review**, never a D1 seed or public API asset
- `npm run reference:check`: pin SHA-256, legacy ancestry, all old Service/phrase/editorial review and this full preflight; fails on source tampering
- `npm test`: synthetic negative/positive preflight shape tests; does not run a live cloud deployment

The script accepts even the single old Unicode/ASCII-incompatible source Category ID as a source **review item** with an explicit `CATEGORY_ID_MAPPING_REQUIRED` flag. It does **not** silently drop, normalize or activate it. All 889 can be included in one proposed draft; the old ten-ID shortlist is NOT a product launch boundary.

## Strict draft contract (non executable)

`makeCatalogExpansionDraft(report, sourceCategoryIds)` generates a bounded deterministic draft with **exact source IDs only**, the original source SHA and both allowed languages. `reviewCatalogExpansionDraft` expands every requested row into historical group/family references, bilingual Category labels, old Safety Tier **as evidence only**, service counts, mechanical source flags and FOUR **mandatory human/founder gates**:

1. Founder M-005 category activation and acceptable risk rules
2. Human occupational safety/legality review
3. Human bilingual Category label meaning review
4. Explicit final JODLO Category ID and slug mapping review

Even categories with no detected mechanical source issues are **blocked** until those reviews. `verifyCatalogExpansionPreflight` checks the entire output against the original source and refuses extra `approved`/`is_active`/`seed` fields, altered row content or removed gates. Summary explicitly reports `categoriesAuthorizedForActivation: 0`. No SQL is generated; existing `categories.is_active=0` default and server-authoritative Worker publication remain untouched.

## Why not activate immediately?

Historical `active=true` and a legacy `safetyTier` are not JODLO legal/safety approval. Some categories have suspicious ancestor status, 616 categories' Hindi Service leaves contain Latin text, 127 categories have labels shared across trades and one Category ID violates the new ID policy. These mechanical flags are **review priorities, not proof that the full category itself is unsafe**. The founder wants broad access for legitimate trades, so all 889 remain visible to editorial reviewers, and only genuinely unsafe / incorrectly specified Categories should eventually be restricted **after explicit M-005 policy**.

The draft preflight does NOT imply the user-facing Android search discovers all 889 today; the current public D1 only exposes actual active rows. It does not import the 7,267 old Services or 32 pending editorial proposed phrases. Before visual flow, M-004 approval is still required; city/area consent and storage need M-003; Cloudflare production needs M-007; no legacy Finworkar writes.

## Next gated product decision

**M-005:** define a category-by-category review policy that can support *broad safe activation without a small pilot allowlist*, including exclusions/verification for regulated, illegal, risky or misclassified services and human Hindi/English editorial checks. Only after that decision should a separately reviewed, signed-off ID manifest or D1 migration be prepared. This offline report itself must NEVER be treated as a public approval.

Verify PR head and separately merged-main GitHub Actions before stating tests are green.
