# M-005 — publication decision recorded, remaining pilot choices

**FOUNDER APPROVED on 2026-10-27:** workers **immediately self-publish** a minimal service listing. **No automatic verification badge.** The earlier proposed manual pre-publication review is **superseded**; do not ask it again. See [ADR-0009](decisions/0009-instant-service-publication.md).

## Still unapproved
- Founder-selected city names are **Bilaspur and Raipur** (ADR-0010). Exact subareas/wards, personal locality policy (M-003) and the real service categories to activate are **still pending** (none are seeded).
- Verification/trust definitions and whether additional public service details should be shown.
- Customer first sends an availability request vs direct calling, moderation report/appeal admin workflow, spam rules.
- M-003 locality selection, GPS consent, deletion/retention; M-004 app UI; M-008 live Google; M-007 production-only launch.

The new backend uses **category + opaque listing ID only**, private worker profile remains draft, moderator can hide via trusted internal DB operation; this does not authorize personal/geo/contact data. Hindi and English only, no Hinglish; old Finworkar read-only.

**Implemented and CI-verified narrow M-005 publication slice:** [PR #35](https://github.com/rekixo-lab/jodlo/pull/35) merged as `2668fc2a6e59c0b8e87871c4def1c4e2dc847a06`; [main GitHub Actions #40514179945](https://github.com/rekixo-lab/jodlo/actions/runs/40514179945) completed **SUCCESS** on that exact main SHA (128/128 Node tests, docs/design/founder gate checks, local D1 migrations 0001–0004, strict TypeScript and both Wrangler dry-run Worker bundles). Previous unapproved manual review proposal is superseded. Further pilot/category/contact/trust specifications remain independent.

## Subsequent founder decision — two city names selected (2026-10-27)

Founder selected **Bilaspur / बिलासपुर and Raipur / रायपुर** (ADR-0010). The previous item "first pilot city/area" is **partly resolved**: city names are DONE, specific subareas/ward boundaries remain undecided. All category IDs (including the proposed 10), trust/verification, first contact flow and moderation/report/appeals remain unapproved. M-003 user location/consent/retention/deletion remains independent. No D1 seed or deployment.
