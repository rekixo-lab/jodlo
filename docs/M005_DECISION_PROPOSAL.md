# M-005 — accepted publication, city and Agora contact decisions; remaining operational choices

**BINDING CATEGORY-BREADTH UPDATE (2026-10-29):** Founder explicitly reaffirmed **all 889 Category review candidates** as the platform's full-scope objective and rejected a ten-trade launch restriction. The earlier proposed ten are only human desk-review examples, NOT a pilot limitation. See [ADR-0011](decisions/0011-all-category-coverage-smart-discovery.md). Exact final eligible IDs/labels, human safety/regulatory/ID mapping and actual D1 activation still pending; customer contact, moderation, areas, UI and deployment require separate decisions.

**FOUNDER APPROVED on 2026-10-27:** workers **immediately self-publish** a minimal service listing. **No automatic verification badge.** The earlier proposed manual pre-publication review is **superseded**; do not ask it again. See [ADR-0009](decisions/0009-instant-service-publication.md).


## Current binding updates — 2026-11-01 (supersedes stale historical notes below)

- **First contact APPROVED:** Direct **Agora in-app Internet AUDIO call**, initiated by the customer, without compulsory service Request → Accept. No worker telephone number, PSTN/SIM call or number-masking flow; see [ADR-0013](decisions/0013-agora-ip-voice-calling.md), which supersedes the telephone interpretation of ADR-0012.
- **Worker call consent APPROVED:** Separate default-OFF, explicitly worker-owned and revocable incoming-call opt-in, already implemented as narrow private D1 preference with revision CAS; see [ADR-0014](decisions/0014-explicit-worker-agora-call-opt-in.md). Publication or login never implies consent. Do **not** ask these decisions again.
- **Outstanding M-005 operational policy:** The founder has **NOT** selected authoritative presence, worker-wide busy concurrency, bilateral blocks/reports, numeric anti-spam quotas, ringing/retry bounds, or online/offline delivery. Review the [M-005 Agora operational founder decision pack](M005_AGORA_OPERATIONAL_DECISIONS.md), marked **DRAFT / PENDING**; its working proposals are **not** approvals.
- Existing local-only synthetic Agora lifecycle/SQLite tests do not supply missing real policy or authorize external signaling. M-003 call metadata retention, M-004 screens, M-006 SDK/signaling and real credentials, M-007 production-only launch and M-008 device Google OAuth remain independently gated.

## Still unapproved
- Founder-selected city names are **Bilaspur and Raipur** (ADR-0010). Exact subareas/wards, personal locality policy (M-003) and the real service categories to activate are **still pending** (none are seeded).
- Verification/trust definitions and whether additional public service details should be shown.
- Agora direct in-app audio as first contact is **already decided** (ADR-0013); remaining moderation report/appeal admin workflow, presence/busy, mutual blocks, delivery and numerical spam rules are **not decided**.
- M-003 locality selection, GPS consent, deletion/retention; M-004 app UI; M-008 live Google; M-007 production-only launch.

The new backend uses **category + opaque listing ID only**, private worker profile remains draft, moderator can hide via trusted internal DB operation; this does not authorize personal/geo/contact data. Hindi and English only, no Hinglish; old Finworkar read-only.

**Implemented and CI-verified narrow M-005 publication slice:** [PR #35](https://github.com/rekixo-lab/jodlo/pull/35) merged as `2668fc2a6e59c0b8e87871c4def1c4e2dc847a06`; [main GitHub Actions #40514179945](https://github.com/rekixo-lab/jodlo/actions/runs/40514179945) completed **SUCCESS** on that exact main SHA (128/128 Node tests, docs/design/founder gate checks, local D1 migrations 0001–0004, strict TypeScript and both Wrangler dry-run Worker bundles). Previous unapproved manual review proposal is superseded. Further pilot/category/contact/trust specifications remain independent.

## Subsequent founder decision — two city names selected (2026-10-27)

Founder selected **Bilaspur / बिलासपुर and Raipur / रायपुर** (ADR-0010). The previous item "first pilot city/area" is **partly resolved**: city names are DONE, specific subareas/ward boundaries remain undecided. All category IDs (including the ten older review examples), trust/verification and moderation/report/appeals remain unapproved; first-contact Agora calling is already approved by ADR-0013 but real operation is not. M-003 user location/consent/retention/deletion remains independent. No D1 seed or deployment.
