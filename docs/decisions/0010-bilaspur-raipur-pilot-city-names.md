# ADR-0010 — Pilot city names: Bilaspur and Raipur

**Status: founder-approved M-005 city-name subdecision — 2026-10-27.**

## Founder decision and provenance

The founder answered the focused initial-pilot city question with **“bilaspur, raipur”**, selecting **two city names**: **Bilaspur / बिलासपुर** and **Raipur / रायपुर**. Previous single-city suggestions are superseded; do not re-ask which first city. For product planning the pairing is interpreted as Chhattisgarh, **but this is a contextual interpretation rather than an approved precise geographic boundary**. No state/district identifier, geofence, address, ward or coordinates is authorized by this reply.

The tiny [city-only reference manifest](../reference/data/jodlo-pilot-cities-2026-10-27.json) stores **only public bilingual names and nonpersonal identifiers**, with its schema reviewed by the existing `npm run reference:check` command. It is **not imported into the Worker, D1, Android, runtime configuration, or any automatic rollout**.

## What is NOT decided

- **M-005 still pending:** explicit approval of *which* of the 10 proposed [category candidates](../reference/JODLO_PILOT_TAXONOMY_PROPOSAL_2026-10-27.md) to enable; availability-request vs direct-contact workflow; verified badge requirements; moderation/reporting/appeals; any additional public fields. The categories are still `FOUNDER_DECISION_REQUIRED_NO_D1_SEED` and have not been seeded. No historical `popular` flag proves local demand.
- **M-003 still pending:** any actual customer/worker locality model, area/ward boundaries, location consent, retention/deletion or GPS. Choosing public city names is **not** consent to persist private location.
- **M-004** Android/web UI approval, **M-006** live calling/payments, **M-007** controlled first production release and **M-008** real Google OAuth/device configuration remain separate gates.

## Preserved decisions and implementation rules

ADR-0008: exactly **English** and **Hindi in Devanagari**, never Hinglish. ADR-0009: opted-in workers may immediately self-publish category-only listings in **already approved active** categories; no automatic verified badge. Private worker profile stays draft. No staging, remote deployment, personal data, pilot categories, old Finworkar repository writes or Firebase material transferred.

The catalog is a historical reference, not operational data. Next founder question: approve or revise the 10 source-backed category IDs; later select actual city subareas and privacy rules before real locality handling. This decision only removes the **city-name** subgate.
