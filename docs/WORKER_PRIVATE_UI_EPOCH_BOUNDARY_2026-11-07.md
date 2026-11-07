# Worker My Services privacy epoch and safe unknown publication — 7 Nov 2026

**Source-only native privacy fix**, not a live Worker/Market/Agora release.

## Complete private Worker management path

- A Worker signs into the shared Google-backed session, explicitly loads a private 20-row My Services page, and gets `ownerRowsMarker` only after the session-consistent response. Every listed private Service, filter count, selected Service panel and edit/preview action uses `WorkerOwnerUiFence.visibleRows` over the current session generation **and** local Worker-write revision. A stale cached list never becomes a new user's list merely because both account logins are `SignedIn(DRAFT)`.
- A subsequent private-page append requires the exact existing continuation cursor and same marker. A new first-page read clears previous private rows immediately. A success is applied only while the same marker is still active. After an owner write the current marker changes even for an uncertain write; any follow-up private list refresh is explicitly revalidated before applying.
- Exact selected status, revision-bound edit and anonymous Customer preview require an actually current selected owner row and drop asynchronous responses after a session/write change. Owner Category-name labels are explicitly requested, and cached labels are also marker-bound.
- On returning from the background or Android picker, an Activity ON_RESUME observer rechecks only the in-memory session and clears stale Worker view data, pending publication/edit review and selection. A user can also explicitly refresh an out-of-date account state. No polling, automatic retry, session data persistence, provider, GPS or unauthenticated API was added.
- `publicationStatus=null` was previously rendered as Published in one native owner card; it now displays **Unconfirmed** in Hindi and English, including uncertain-write exact-observation UI. Paused/Published controls remain gated by the real enum and existing server-side CAS checks; this does NOT turn owner status into public eligibility.

## Acceptance

Existing Kotlin worker-dashboard suite includes session replacement A→B, in-flight Worker write, post-write epoch and null marker tests for the pure fence. New Node source integration tests verify that native rows, selection, receipt handling and both locales actually use the boundary; CI registration is in the root test script. Require full exact PR-head Foundation + Android JDK17/21 green and independently green merged-main SHA. Do not touch production, send email, modify Finworkar or request partial phone QA. All real provider/consent, human Catalog review and final one-phone QA gates remain issue #235.