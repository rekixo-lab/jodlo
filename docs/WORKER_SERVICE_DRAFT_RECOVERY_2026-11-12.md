# JODLO Worker Service draft recovery and account scope (12 Nov 2026)

## Real user journey

Worker → own Service → Manage service profile → type name/description/rate →
attempt save or reload during a poor connection. Before this change a successful
subsequent owner GET always overwrote the typed inputs, even if the preceding
POST timed out and the typed draft had **not** been committed. The owner also
had to infer whether the lost response had applied the update.

## New behavior

- A profile reload is always an exact authenticated owner read with the
  existing session-generation and write-revision fence. Only after a
  *successful, same-owner* GET does the nonvisual Kotlin recovery helper
  reconcile the server's current profile and the locally edited input.
- If the server copy **matches** the submitted draft (including NFC trim), it
  presents the server record, clears the unsent marker and does not issue a
  duplicate write. If the server copy differs, the latest owner status and
  revision are retained but the typed text stays on-device for manual review.
  A bilingual warning says explicitly that nothing was automatically sent.
- Invalid/partial input remains editable; local validation must still pass
  before the Worker can tap Submit again. A previous failed PUT no longer
  silently sacrifices that input on the next successful reload.
- Worker profile, photo-picker and service-city editor states are keyed to
  the account **session generation** (not the write revision), so local inputs,
  preview/export bytes, consent choice and error state from an old login
  cannot reappear under a different account.
- No user input is stored in a log, analytics, files or server by recovery.
  The helper does not attempt HTTP operations or infer publication rights.
  Existing server CAS/revision, review and public-data privacy gates remain.

## Checks and boundaries

The existing executable Kotlin JVM profile suite now covers lost-response
reconciliation, differing server version, invalid drafts, equivalent NFC input,
fresh initial load and cleared server state. Source guards assert all three
Service editors reset their local state on account generation changes and only
reconcile in the authenticated success branch. Require Foundation and Android
JDK17/JDK21 exact-PR-head green, squash merge, then independent main green.

No live Worker deploy, Catalog activation, provider call, production D1
mutation, payment operation, email, Finworkar write or physical-phone
acceptance has been performed. On-device final usability acceptance remains
in the project's consolidated release QA.
