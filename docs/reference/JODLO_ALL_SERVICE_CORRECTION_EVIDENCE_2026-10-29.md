# JODLO — All 7,267 historical Service bilingual correction intake (2026-10-29)

**Review-only · ADR-0011 · Founder M-005 activation still pending.** All legitimate work Categories are in product review scope: exactly **889 historical Categories and 7,267 Services**, split across the SAME **45 full-source review packets** (20 Categories each, final 9). This workflow does **not** reintroduce the old ten-category limitation.

## What this actually adds

The previous full-Service reviewer packet exposes each historic English and Hindi Service name, source IDs, its old Group/Family/Category parent, original script/ID flags and any **other** Category sharing the same English/Hindi phrase. The new script creates a **modifiable, evidence-linked editorial correction proposal** for each source Service without ever touching the historic archive, public Search or D1.

A reviewer can propose specific corrected English and/or Hindi **Service labels** only. This does **not** approve a Service, change its parent, declare its occupational/legal eligibility, accept an unsafe Service, select among ambiguous trades, authorize a Category or create a public alias. It does not generate translations or claim certified language expertise.

## Use locally

```bash
npm run catalog:service-corrections -- --check
npm run catalog:service-corrections -- --summary
mkdir -p .local-category-review
npm run catalog:service-corrections -- --packet=1 > .local-category-review/service-packet-01.json
npm run catalog:service-corrections -- --validate-file=.local-category-review/service-packet-01.json
npm run reference:check
npm test
```

Repeat `--packet=N` for **all 45** original packets when collecting evidence. This is a *human editorial workflow*; do not pretend a command has reviewed the natural-language meaning of 7,267 records.

Within a generated packet, preserve all source fields and ALL Category/Service rows in exact order. For a genuine correction, edit **only** the affected Service's `proposedNameEn` and/or `proposedNameHi`, change `status` from `NOT_SUBMITTED` to `EVIDENCE_LINKED_UNVERIFIED`, and add an `evidenceUrl` such as a relevant `https://github.com/rekixo-lab/jodlo/pull/N` or allowed comment link. Every untouched Service must remain `NOT_SUBMITTED` with null proposals and URL. A link alone is never a signature and a proposal must actually differ from the historical label.

## Mechanical source checks, not editorial or legal endorsement

- The input must represent one of the exact **45 Category packet boundaries**. It keeps all source Group/Family/Category IDs, original names, original flags, full Service rows and each Service's known ambiguous Category choices. Both Category and Service source evidence receive SHA-256 fingerprints; stale/tampered/removed rows, changed parent identity, forged review status, added approval/seed fields or reordered Services fail closed.
- Only `en` and `hi` are supported. Proposed English text must contain Latin characters and no Devanagari; Hindi text must contain Devanagari and **no Latin words**. Both reject controls, markup angle brackets, non-NFKC forms, leading/trailing whitespace, empty strings and titles over **120 Unicode code points**. This is only **syntax hygiene**, not a guarantee of correct occupational vocabulary or spelling.
- Newly introduced English/Hindi phrase matches against a different historical Category are counted as `newlyDetectedSourceOrProposalPhraseConflictsUnverified`. Previously ambiguous source phrases stay explicitly visible through `otherSourceCategoryChoices`. **Never** auto-select one trade or treat a source label as a globally safe Search synonym.
- `--validate-file` allows only a real regular JSON file within the repository, maximum 1 MB, no symlinks. Store unapproved local drafts under the existing gitignored `.local-category-review/` folder. Do not upload unneeded personal information, IDs, credentials, licenses, customer details, addresses or phone numbers.
- Output always reports `humanBilingualReviewsAuthenticated: 0`, `humanOccupationalReviewsAuthenticated: 0`, `founderCategoryApprovalsAuthenticated: 0`, `approvedAliases: 0`, `categoriesAuthorizedForActivation: 0`, `activatedServices: 0`, `sqlStatementsGenerated: 0`. A successful validator means *syntactically valid, source-consistent unverified proposals only.*

The correction intake is deliberately **not** imported by the Worker, Kotlin/Android runtime or deployment pipeline, and does not create new D1 tables, seed SQL, public aliases or UI. All 889 Category occupational/legal, scoped safety/qualification, final reversible ID mapping, Hindi/English human review, trust/report/contact and explicit Founder M-005 approval remain essential. M-003 privacy/real areas, M-004 visual design, M-007 production-only release and M-008 actual OAuth are independent gates. No Finworkar mutation or remote Cloudflare deployment.

Review resources: [all Service evidence](JODLO_LEGACY_7267_SERVICE_REVIEW_2026-10-28.md), [45 original Category reviewer packets](JODLO_CATEGORY_HUMAN_REVIEW_PACKETS_2026-10-28.md), [Category ID/name correction intake](JODLO_ALL_CATEGORY_CORRECTION_EVIDENCE_2026-10-29.md) and [exception diagnostic register](JODLO_FULL_CATALOG_EXCEPTION_REGISTER_2026-10-29.md).

**Further independent gate (not implemented here):** if human reviewers submit corrections across several packets, jointly reconcile new-proposal vs new-proposal phrase overlaps and review every ambiguous parent before any future separately authorized Search alias import. This local validator reports collisions against original catalog phrases and within a packet; it does not assert that all 45 future submitted edits were approved or conflict-free.

## 2026-10-29 — Full 45-packet proposed Service name collision reconciliation

Single-packet Service correction validation cannot see an **identical new English/Hindi phrase proposed in ANOTHER packet for a different trade**. Added a source-locked **all-45-packet** reconciliation step, keeping every original Category and Service in the original packet order.

```bash
mkdir -p .local-category-review/services
for n in $(seq 1 45); do
  number=$(printf "%02d" "$n")
  node scripts/catalog-service-correction-evidence.mjs --packet="$n" > ".local-category-review/services/service-packet-$number.json"
done
# Make reviewed editorial proposals to relevant Service rows; preserve other rows.
npm run catalog:service-reconcile -- --directory=.local-category-review/services
npm run catalog:service-reconcile -- --check
npm run reference:check
npm test
```

The directory must contain **exactly** `service-packet-01.json` through `service-packet-45.json`. No symlinks, outside-repository paths, missing or out-of-order packets, forged approval or >1 MB packet files. The validator checks the previous strict source fingerprints and bilingual syntax for each packet, then groups **new proposed phrases** by language and NFKC/case-normalized exact string. It reports unresolved phrase conflicts if a proposal overlaps an old *different* parent Category, another proposal in the **same** packet, or another proposal in a **different** packet. Multiple source-Category parents remain visible for explicit human disambiguation; **collisions are reported, never silently fixed, approved or auto-selected**. Same-Category duplicate Service names are not cross-trade collisions. English and Hindi are kept separate.

The JSON summary retains 889 original Categories, 7,267 Services, 45 validated packets and zero human/founder authentication, approved aliases, activated Services, SQL or Category activation. An edited name is a **proposed label**, not a certified synonym, safety rule or final public Catalog mapping. Editors may use the output to resolve actual ambiguity with qualified occupational, legal and Hindi/English reviewers under M-005. No new runtime API, D1 seed, UI or Cloudflare deployment. Founder M-003/M-004/M-005/M-007/M-008 gates unchanged.
