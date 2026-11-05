# 2026-11-05 — Native Help & Data Rights + static bilingual website

## Full user-visible source journey delivered

- **Native Home → Help** and **Account → Help** now open a guest-accessible Hindi/English Help & Data screen. Every action leads to an already implemented real native screen, not a mocked endpoint: Customer public search, device Saved remove/clear, Google-backed Account current-D1 export and all-device sign-out, private Worker Service Category management.
- Help explains exactly what currently works and what does **not**: Category/Listing are not Worker verification or live availability; Saved is phone-local; D1 export includes private records, is user-directed and may be placed in cloud storage; export and sign-out are NOT erasure; neither includes provider/backup records; Agora Internet calling and true area-based nearby search remain unavailable.
- **New responsive future JODLO website source** at [`apps/web/index.html`](../apps/web/index.html) with a flat black/green appearance, complete Hindi/English topics and a progressive-enhancement language switch. The site ships as static HTML + CSS + vanilla JS, no external dependency, remote asset, analytics, cookies, trackers, location permission or support/deletion form. Document [source/rollout constraints](../apps/web/README.md). Its `noindex`, CSP and referrer meta directives are **source protections**, not evidence of configured hosting security headers.
- No email address, support staff, legal terms, policy date, erasure workflow, retention deadline, full backup scope or live public domain is invented. **Do not publish this Help preview as a Privacy Policy / Terms / customer-support contact**. The final approved documents and verified contact path must be independent work.

## Test acceptance

- Node native `scripts/help-center.test.mjs` is included in the repository's normal Foundation `npm test`; checks website assets, CSP, no network/transmission primitives, in-memory language switching, legal/deletion truthfulness, matching Hindi/English Android strings and direct native navigation to existing screens.
- Android native APK compile on JDK17 and JDK21 proves Compose Help view integrates with current Home and Account. Existing account/export/session, Saved and Worker JVM/API tests remain the functional authority for the actions; **Help itself makes no backend request**.
- Require exact PR-head and independently merged-main Foundation/Android CI. CI is not the published website, official policy approval, user-account deletion acceptance or final phone testing.

## Still OPEN for real product launch

The owner must approve actual privacy, account erasure provider/backup lifecycle, complaints/appeal/moderation, a real support contact and responsible operator identity; implement legally reviewed Terms and Privacy with accessible rights and hosted stable version paths; verify JODLO domain ownership distinct from the API and legacy Finworkar projects; deploy only with operator-controlled DNS/TLS/security headers, tests and rollback; implement genuine Agora/FCM, approved area/Worker fields, human Catalog approvals, payments and **one consolidated final founder physical-phone acceptance** under [#235](https://github.com/rekixo-lab/jodlo/issues/235). This PR neither deploys nor sends email, imports personal data or touches the legacy repositories.
