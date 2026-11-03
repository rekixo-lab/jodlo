# JODLO — real-provider connection and controlled deployment runbook

**Effective 3 November 2026.** [ADR-0015](decisions/0015-real-provider-integration-and-controlled-production.md) is the operative policy. Real provider onboarding, Cloudflare provisioning and controlled deployment are now **authorized engineering work**. The commands below are an operator runbook, **not proof the operations occurred**. No Cloudflare account, D1, DNS, Google OAuth or real Agora is assumed to be connected.

## Manual CF-01: Cloudflare account and D1 — NEEDS_DECISION_NOW

On your own browser open https://dash.cloudflare.com and choose/create an owner-controlled **dedicated JODLO** Cloudflare account. Enable MFA, review billing and cost alerts, verify no Finworkar Worker/DNS/database would be affected. Check Workers & Pages and D1. Cloudflare Account ID and D1 database ID are nonsecret identifiers you may share; **never** send account passwords, API tokens or recovery credentials to chat or GitHub.

On your own trusted Ubuntu terminal:

    cd ~/jodlo
    npm ci
    npx wrangler login
    npx wrangler whoami

If you have confirmed the correct account, create a **real** dedicated D1 database, recording the actual UUID:

    npx wrangler d1 create jodlo-production

The existing apps/api/wrangler.jsonc is currently not wired to real D1; an engineer must add the **actual** DB binding, approved login rate-limit bindings LOGIN_BURST_LIMITER and ACCOUNT_LOGIN_LIMITER, and any needed protected Worker config. Never copy local placeholder database UUID or jodlo_catalog_local from apps/api/wrangler.local.jsonc into production. No remote migration/deployment before config, backup/restore, privacy and budget review.

**Evidence to provide:** correct owner-owned Cloudflare account chosen; whether JODLO Worker/D1 exist; nonsecret Account ID and D1 UUID if created. No secret values.

## Manual DNS-01: Production host — UPCOMING

Confirm who controls rekixo.com. In Cloudflare DNS / Workers Custom Domains, attach **only** the reviewed jodlo.rekixo.com hostname to the dedicated JODLO Worker after protected health smoke checks. Do not repoint apex/www, wildcard routing or old Finworkar services. Verify actual TLS and /api/v1/health after route setup. Current workers_dev=false means there is no automatically available workers.dev API origin.

## Manual GOOGLE-01: Real login credentials — NEEDS_DECISION_NOW once Cloudflare config is ready

Use https://console.cloud.google.com/apis/credentials (Google Cloud Console / Google Auth Platform). Select/create a separate JODLO Google project, configure branding, audience/consent, authorized domains, support/privacy details and any required Google review.

Create a **Web application OAuth client**. Its public Web Client ID is the Android Credential Manager serverClientId and the backend's exact GOOGLE_CLIENT_ID audience. Also create the **Android OAuth client** for exact package com.rekixo.jodlo, with SHA-1 of actual debug and later release/Play signing certificates. On Ubuntu, inspect the debug certificate (enter any keystore password locally, never in chat):

    keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey

After verified Cloudflare Worker exists, set the backend's GOOGLE_CLIENT_ID via the Cloudflare Worker Variables/Secrets dashboard or your own interactive terminal:

    npx wrangler secret put GOOGLE_CLIENT_ID --config apps/api/wrangler.jsonc

Caution: Cloudflare secret put can deploy a Worker version; coordinate with the production release plan. The **Web Client ID is public configuration** but an OAuth client secret, Google ID token or signing key is not. Verify actual issuer/audience/signature, login rate limits, JODLO session creation/logout and account privacy before admitting real users. A Google picker appearing on-screen is not proof login works.

## Manual PHONE-01: Pull and install real Android APK on Ubuntu — UPCOMING

If the JODLO repo is already at ~/jodlo, run:

    cd ~/jodlo
    git status --short
    git checkout main
    git pull --ff-only origin main
    java -version
    javac -version
    adb devices -l

If not cloned: git clone https://github.com/rekixo-lab/jodlo.git ~/jodlo . Requirements: Node >=22.16, full JDK 17 or 21, Gradle 8.10.2, Android SDK platform 35 and build-tools 35.0.0. On Android enable Developer options/USB debugging, unlock and authorize the computer. An authorized device appears as device in adb devices -l.

Use **actual** nonsecret Cloudflare origin and Web Client ID as Gradle properties on the trusted **local machine only**, not in git. Example property names to put in ~/.gradle/gradle.properties (replace illustrative values with your real approved values):

    jodloApiOrigin=https://YOUR_VERIFIED_JODLO_API_HOST
    jodloGoogleWebClientId=YOUR_REAL_WEB_CLIENT_ID.apps.googleusercontent.com

Then:

    cd ~/jodlo
    npm run android:devices
    npm run android:run

This script builds the debug APK, installs it on a connected authorized phone and opens com.rekixo.jodlo/.MainActivity. For several devices, use npm run android:run -- --serial DEVICE_SERIAL. It does not silently uninstall or erase app data. The current **default unconfigured APK** is still an offline preview; real provider testing requires these real Gradle values and a reachable reviewed API. See [Android app README](../apps/android/app/README.md).

## Controlled live deployment sequence (operator only; NOT automatic CI)

1. Verify exact-head GitHub PR/main Foundation + Android CI, dependency/security review, owner account isolation, production config, real backup/restore plan, D1 migration review, privacy/data handling, rate-limit bindings, cost budgets/alerts and a rollback path.
2. Verify production bundle without deployment: npx wrangler deploy --dry-run --config apps/api/wrangler.jsonc .
3. After correctly binding the **real** jodlo-production D1, examine remote migrations: npx wrangler d1 migrations list jodlo-production --remote --config apps/api/wrangler.jsonc .
4. Only when intentionally approved for that live DB and backed up, migrate explicitly: npx wrangler d1 migrations apply jodlo-production --remote --config apps/api/wrangler.jsonc . **This mutates real remote data** and is never automatic.
5. Store any secrets via Cloudflare protected Secrets UI or trusted interactive Wrangler command; not in .env in git, PRs, screenshots or CI logs.
6. Deploy after a final environment review: npx wrangler deploy --config apps/api/wrangler.jsonc . This **does deploy live Worker code**. Keep outside traffic restricted until safe smoke checks succeed, then enable intended access gradually and monitor/revert if needed.
7. Verify actual DNS/TLS, health, correct data isolation, Google login/session logout, Worker publishing, Customer listing detail/unpublish and security errors. Record nonsecret deployment version/commit/migration/verification evidence in [STATUS](STATUS.md).

Official docs: https://developers.cloudflare.com/d1/wrangler-commands/ ; https://developers.cloudflare.com/workers/wrangler/commands/workers/ ; https://developers.cloudflare.com/workers/configuration/secrets/ .

## Later real providers — UPCOMING

Agora: separate real project, server-issued RTC tokens, correct incoming signaling, live presence/busy, block/report/abuse rules, real two-phone testing. Worker calling consent stays **OFF by default** and synthetic call preflights cannot authorize an actual call.

FCM/push: JODLO-owned Firebase project, user consent, token lifecycle, protected service credentials; no Finworkar Firebase reuse.

Payments: owner-authorized merchant/provider onboarding and Play-policy eligibility, backend-verified ledger/refunds, **never** simulated success as real money.

The owner will be told each precise manual action as it becomes essential; generic engineering permission is already granted. **No record here certifies a deployed service, completed Google connection, production data collection or public launch.**
