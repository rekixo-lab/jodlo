# Worker private Agora audio preference — source-only scope (6 November 2026)

ADR-0014 already authorizes a separately revocable, default-OFF Worker consent to receive future Agora Internet voice calls. This change exposes ONLY that private preference in the native Worker screen. It does NOT implement or activate calls.

## Vertical slice

- Authenticated Worker manually fetches the current private consent and revision. Missing row means OFF, never implicit ON after publication.
- A two-stage Hindi/English review is required before one guarded update. Loss of acknowledgement clears the UI state and requires an exact new read; no automatic write retry.
- New private GET/PUT /api/v1/me/agora-call-preference route uses a current Worker session and an owner-scoped D1 compare-and-swap, with exact strict boolean and revision input, no account ID supplied by the caller.
- No public Worker badge, phone number, RTC token, signaling, notification, recording, provider credential, email, billing, area or data upload.
- Local D1 Node integration tests and Kotlin decoder, route and session fence tests. Android JDK17/21 debug APK CI is required.

## Not complete

Actual Agora calling, presence/busy, bilateral block/report, rate limits, end-to-end signaling, FCM incoming ringing, retention/erasure, provider acceptance, current deployed API SHA and physical phone QA remain independent gates under issue #235.

Production rollout requires checking the correct live D1 migrations/bindings, current Worker version, safe backup/rollback and explicit release procedure. Do not deploy or seed production on the basis of code CI. Finworkar legacy repositories remain read-only.