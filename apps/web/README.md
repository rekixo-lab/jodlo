# JODLO Help & Data Controls — static source preview

This is a **real, self-contained responsive bilingual help website source** for the future JODLO domain. It deliberately is **not** a deployed support service, a legal Privacy Policy, Terms of Service, an account-deletion channel or proof of a verified support contact.

## What the source does

- Entry: `apps/web/index.html`; uses only the local `styles.css` and `app.js`. Hindi is available without JavaScript. The English switch runs locally in memory, using `aria-pressed`, `lang` and `hidden`; it stores nothing.
- Clear guidance is linked to actions that *already exist* inside the actual Android application: public anonymous browsing, managing/clearing **device-only** Saved bookmarks, current JODLO D1 account export through Android's document picker, all-device logout, and private Worker Category editing/pausing.
- Exact boundaries: sign-out and export are **not** erasure; provider/backup records are not included in JODLO D1 export. Public approved Category and opaque Listing references are **not** verified identities/availability/contacts. The existing Nearby page has only a manual, in-memory city choice, not real location relevance.
- No forms, support ticket submission, unverified email address, private account data, ads, third-party analytics, cookies, remote JS/CSS, microphone/GPS access, request to the live JODLO API or fake call/booking CTA.
- Source has a restrictive **meta CSP**, `noindex`, no-referrer and no external content; operators must enforce their own HTTPS security headers at the actual public host. Local-site test is part of `npm test` and Android JDK 17/21 compilation checks the native Help screens.

## Native in-app journey

Home → **Help, privacy and my data**, and Account → **Help and data rights information** lead to a guest-accessible screen with actual buttons to Customer, Saved, Account and Worker. No new bearer access, Saved reading or data persistence happens inside Help. User can choose the existing effective action in its original screen. The Help screen does **not** submit any deletion request or imply a reviewer-approved data-retention window.

## Required gates BEFORE public website or Play release

1. Founder/qualified legal and privacy reviewers must approve the final Privacy Policy, Terms of Service, controller/operator identification, applicable contact route, retention/deletion/backup/provider handling, appeal/report process and website ownership. None are invented here.
2. Operator verifies the intended **JODLO website** DNS/domain and separate Cloudflare project; do not connect this static site to the Worker API domain `api.jodlo.rekixo.com` or the legacy Finworkar site. Deploy only after separate reviewed release and rollback acceptance with HTTPS/TLS, security headers, content checks and actual working support route.
3. Full authenticated account erasure, moderation/reporting, accurate provider backups, website privacy information and reporting support must be delivered before this is advertised as a completed legal/support service.
4. Human Catalog approval, live provider/calling/nearby, Cloudflare/D1 migrations and **one consolidated final physical-phone acceptance** remain under [#235](https://github.com/rekixo-lab/jodlo/issues/235). This PR does not affect them.

**No email, production deploy, external account action, DNS change, payment, old Finworkar modification, fake identity or physical phone test is part of this slice.**
