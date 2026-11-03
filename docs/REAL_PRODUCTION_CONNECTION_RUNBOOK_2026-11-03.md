# JODLO — real-provider connection and controlled deployment runbook

## CF-04: real schema application complete; supported D1 verification still pending (2026-11-03)

**Owner evidence:** All eight real remote migrations `0001`–`0008` completed ✅ on `jodlo-production` / `723080b5-f165-4b31-839f-3063175824c7`, `migrations list --remote` returned no pending files, D1 reported 13 tables, and the expected JODLO table names were returned by an ordinary read-only `sqlite_master` query. Do **not** run `migrations apply` a second time as a troubleshooting step. The app has **not** been deployed publicly and real OAuth is still unconfigured.

**Correction to older runbook below:** Plain SQLite `PRAGMA integrity_check` was **rejected** by remote Cloudflare D1 with `SQLITE_AUTH`. This is consistent with D1's limited authorized PRAGMA set and does not undo successful schema migration. Cloudflare explicitly lists **`PRAGMA quick_check`** and **`PRAGMA foreign_key_check`** as supported. The quick check is *less thorough* than full integrity_check; use it as D1-supported verification, not as proof of a complete low-level file integrity audit.

Run these two commands **one at a time**, without combining or pasting additional quoted SQL. They are read-only and select the correct actual production D1 from the locally generated Wrangler configuration:

```bash
cd ~/jodlo
git switch main
git pull --ff-only origin main
npm run production:config:check
npx wrangler d1 execute jodlo-production --remote --config apps/api/wrangler.production.generated.jsonc --command "PRAGMA quick_check;"
npx wrangler d1 execute jodlo-production --remote --config apps/api/wrangler.production.generated.jsonc --command "PRAGMA foreign_key_check;"
```

Expected: `quick_check` reports `ok`; `foreign_key_check` returns **no violation rows**. These are **expected values, NOT yet observed results**. If either fails, stop and send only the redacted terminal error; do not reset Cloudflare permissions, rerun migrations or restore D1. A new Time Travel bookmark can be recorded **privately** before any future migration; never execute restore as ordinary verification.

**Next release work:** inspect the intended Worker name and Cloudflare routing isolation, security/privacy/account costs and rate namespaces. Prepare real Google Cloud Web and Android OAuth clients and exact `GOOGLE_CLIENT_ID` Worker secret. Worker deployment and restricted DNS/TLS smoke testing are distinct next milestones requiring their actual operator output. Keep JODLO separate from unrelated production databases in this shared account. [Official D1 SQL/PRAGMA list](https://developers.cloudflare.com/d1/sql-api/sql-statements/).


## CF-04 — apply only `jodlo-production` schema with interactive confirmation

**HISTORICAL PRE-MIGRATION INSTRUCTIONS (not current commands):** CF-03 owner's real `d1 info` showed 0 tables on the exact JODLO UUID, and `migrations list --remote` showed eight pending files. The command below is a **real, irreversible-until-restored** change of *that production D1*; it is authorized by ADR-0015 but not a claim that the remote schema exists yet. No call/notification/provider/payment features become live merely because tables exist.

Before proceeding, confirm no other engineer is concurrently modifying this D1, verify Cloudflare account **`8f31060fbcfee2b3e9309138cad7f12f`** and dedicated D1 **`723080b5-f165-4b31-839f-3063175824c7`**; inspect this database rather than the other production DBs in the shared account. The D1 Time Travel bookmark from the current read-only command should be kept **privately** with the local operator; it is not a substitute for a recovery procedure. On an empty fresh database, risk to pre-existing users is low, but the migration is a real change. Cloudflare states `d1 migrations apply` applies all currently unapplied files in order, takes a backup, and rolls back a failing migration; earlier successful migrations may remain applied. Time Travel restore overwrites live state and must never be executed as routine testing. Sources: [Cloudflare D1 migration CLI](https://developers.cloudflare.com/workers/wrangler/commands/d1/), [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

```bash
cd ~/jodlo
git switch main
git pull --ff-only origin main
npx wrangler whoami
npm run production:config:check
npx wrangler d1 info jodlo-production
npx wrangler d1 time-travel info jodlo-production --config apps/api/wrangler.production.generated.jsonc
npx wrangler d1 migrations list jodlo-production --remote --config apps/api/wrangler.production.generated.jsonc

# STOP if account, database, UUID, or migration set differs from reviewed evidence.
# The next command WRITES REAL TABLES to JODLO production D1. It asks confirmation.
npx wrangler d1 migrations apply jodlo-production --remote --config apps/api/wrangler.production.generated.jsonc
```

**After manual confirmation and command completion**, verify the exact same D1 is active using these **read-only** commands:

```bash
npx wrangler d1 migrations list jodlo-production --remote --config apps/api/wrangler.production.generated.jsonc
npx wrangler d1 info jodlo-production
npx wrangler d1 execute jodlo-production --remote --config apps/api/wrangler.production.generated.jsonc --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
npx wrangler d1 execute jodlo-production --remote --config apps/api/wrangler.production.generated.jsonc --command "PRAGMA quick_check;"
```

Historical expected outcome for the earlier phase: eight migrations applied, none pending, JODLO tables listed, and supported D1 `quick_check` returning `ok` (with no foreign-key violations). The schema steps are now observed complete; the new D1 consistency check remains pending. **Do not invent the outcome; use actual operator output.** If a migration fails, stop—do not delete/recreate the D1 or rerun blindly. Report exact error and remaining pending files; review Cloudflare's rollback/recovery guidance before any second write. Preserve secrets and bookmarks outside public git.

**Following milestone:** only when CF-04 is independently verified, review production Worker target name, Cloudflare DNS and privacy controls; then prepare protected live `wrangler deploy` with actual Google OAuth configuration and controlled traffic. A successful D1 migration by itself does not create a public API URL, does not activate the 889-category review inventory and does not allow unauthenticated Worker writes.


## CF-02 verified (2026-11-03); next: CF-03 read-only remote D1 inspection

**Founder-provided real terminal evidence, 2026-11-03:** On the authenticated Cloudflare account `8f31060fbcfee2b3e9309138cad7f12f`, the owner ran `npm run production:config:write`, `npm run production:config:check` and `npx wrangler deploy --dry-run --config apps/api/wrangler.production.generated.jsonc`. Output confirmed a locally generated gitignored production configuration, successful shape validation, a compiled **92.37 KiB** Worker bundle (**21.67 KiB gzip**) with `env.DB (jodlo-production)`, `env.LOGIN_BURST_LIMITER (100 requests/10s)` and `env.ACCOUNT_LOGIN_LIMITER (20 requests/60s)`. Real dedicated D1 is `723080b5-f165-4b31-839f-3063175824c7`; the owner supplied two namespace IDs `45130001` and `45130002`. These numbers passed local validation; uniqueness against other Workers in the shared account has **not** been independently checked. **No remote schema, Worker deploy, route, OAuth secret or device login was changed by this dry-run.**

The following commands **inspect** the authenticated account and dedicated JODLO D1; they do **not** apply SQL migrations or deploy a Worker. Do not attempt to create `jodlo-production` again (it already exists). Verify the operator's account and real database identity before continuing:

```bash
cd ~/jodlo
git switch main
git pull --ff-only origin main
npx wrangler whoami
npm run production:config:check
npx wrangler d1 info jodlo-production
npx wrangler d1 time-travel info jodlo-production --config apps/api/wrangler.production.generated.jsonc
npx wrangler d1 migrations list jodlo-production --remote --config apps/api/wrangler.production.generated.jsonc
```

**Stop and inspect the output; do not `migrations apply --remote` or `wrangler deploy` in this step.** Cloudflare D1 [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) is available for recovery and `migrations list` reports unapplied SQL files; neither a local dry-run nor a migration listing constitutes a remote schema deployment. If a database is missing, a wrong account appears, or unexpected applied migrations exist, stop without touching any other Cloudflare resource. Review current privacy/security, D1 recovery, namespace uniqueness and release checks before future intentional remote mutation. [Official D1 CLI](https://developers.cloudflare.com/workers/wrangler/commands/d1/).


## CF-01 real account/D1 result and next copyable CF-02 commands (2026-11-03)

**Owner-executed successfully:** `npx wrangler login` for account `8f31060fbcfee2b3e9309138cad7f12f`, followed by `npx wrangler d1 create jodlo-production --location apac`: real D1 `723080b5-f165-4b31-839f-3063175824c7`, APAC, zero tables. The account also hosts other real production D1 databases. JODLO's database is separate; **account-level isolation is not proven**, so confirm the right account, database, Worker and namespaces before any remote operation. Cloudflare's create output may suggest binding `jodlo_production`; JODLO **must bind as `DB`** for existing `env.DB` code.

The following is **CF-02 only, no remote writes**. Choose two **unused, distinct positive integer rate-limit namespaces** unique across this same account's other Workers (these are namespace identifiers, not secrets or D1 IDs). On the already logged-in Ubuntu machine:

```bash
cd ~/jodlo
git switch main
git pull --ff-only origin main
npx wrangler whoami
npx wrangler d1 info jodlo-production

export JODLO_CF_ACCOUNT_ID=8f31060fbcfee2b3e9309138cad7f12f
export JODLO_D1_DATABASE_ID=723080b5-f165-4b31-839f-3063175824c7

read -r -p 'Choose UNIQUE unused login-burst namespace integer: ' JODLO_LOGIN_BURST_NAMESPACE_ID
read -r -p 'Choose a DIFFERENT unused verified-login namespace integer: ' JODLO_ACCOUNT_LOGIN_NAMESPACE_ID
export JODLO_LOGIN_BURST_NAMESPACE_ID JODLO_ACCOUNT_LOGIN_NAMESPACE_ID

npm run production:config:write
npm run production:config:check
git check-ignore apps/api/wrangler.production.generated.jsonc
npx wrangler deploy --dry-run --config apps/api/wrangler.production.generated.jsonc
```

**Stop at dry-run.** The account/D1 IDs here are not passwords; do not paste tokens, secret client credentials or Wrangler's private OAuth storage. If the generated file already exists, the generator intentionally refuses to overwrite it; **review before changing**. `wrangler deploy --dry-run` does not deploy code. Cloudflare rate-limit namespace IDs are account-unique integer strings and per-location approximate caps. <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/>.

After the dry run is successful, you may inspect unapplied remote migrations **without applying them**:

```bash
npx wrangler d1 migrations list jodlo-production --remote --config apps/api/wrangler.production.generated.jsonc
```

**Do not run `migrations apply`, `wrangler deploy` without `--dry-run`, `wrangler secret put`, or attach public DNS yet.** Those are intentional protected future steps after checking migrations, backups and privacy. [Cloudflare D1 official commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/). The older CF-01 pending examples below are historical.


**Effective 3 November 2026.** [ADR-0015](decisions/0015-real-provider-integration-and-controlled-production.md) is the operative policy. Real provider onboarding, Cloudflare provisioning and controlled deployment are now **authorized engineering work**. The commands below are an operator runbook, **not proof the operations occurred**. No Cloudflare account, D1, DNS, Google OAuth or real Agora is assumed to be connected.

## CF-02 — Executable real-ID Wrangler production config (new, after owner CF-01)

The checked-in `apps/api/wrangler.jsonc` is **only the dry-run baseline**. Do not add dummy production bindings to it or deploy with it. Use the newly added generator on your trusted Ubuntu machine **after** your own real Cloudflare account login and `npx wrangler d1 create jodlo-production`. Unlike a sample JSON, this generator refuses missing inputs, the placeholder local D1 UUID, the local rate-limit namespaces and any auto-public exposure.

Cloudflare rate-limit namespace IDs are unique positive integer values **selected by you for your own account**, not a secret and not a separately-created D1 resource. Check your existing account Worker namespaces and choose two distinct unused numbers different from the local test IDs 1001 and 1002. Current auth limits are 100 per 10 seconds before proof and 20 per 60 seconds after verified Google subject **per Cloudflare location**; they are approximate and not Agora abuse limits.

Run the following commands on your own authorized Ubuntu computer. All `read` prompts take **nonsecret identifiers** and avoid hardcoding fake IDs in the repository:

```bash
cd ~/jodlo
git switch main
git pull --ff-only origin main
npx wrangler whoami
npx wrangler d1 list
read -r -p 'JODLO Cloudflare Account ID (32 hex): ' JODLO_CF_ACCOUNT_ID
read -r -p 'jodlo-production D1 UUID: ' JODLO_D1_DATABASE_ID
read -r -p 'Unique login burst namespace ID: ' JODLO_LOGIN_BURST_NAMESPACE_ID
read -r -p 'Different verified-login namespace ID: ' JODLO_ACCOUNT_LOGIN_NAMESPACE_ID
export JODLO_CF_ACCOUNT_ID JODLO_D1_DATABASE_ID
export JODLO_LOGIN_BURST_NAMESPACE_ID JODLO_ACCOUNT_LOGIN_NAMESPACE_ID
npm run production:config:write
npm run production:config:check
git check-ignore apps/api/wrangler.production.generated.jsonc
npx wrangler deploy --dry-run --config apps/api/wrangler.production.generated.jsonc
```

The generated file `apps/api/wrangler.production.generated.jsonc` is **gitignored** and created exclusively; it will never overwrite a previous account's config silently. It sets a real `DB` binding, dedicated `jodlo-api` Worker, both login rate-limit bindings, no public routes and `workers_dev=false`. `npm run production:config:write` makes **NO** Cloudflare calls, migration or deployment; the final `--dry-run` only builds/validates the bundle. Confirm actual Cloudflare account and D1 UUID in the dashboard independently; local structural validation alone does not establish ownership, backup status or readiness.

**Do not run remote migrations, `wrangler secret put` or deployment merely because the config is valid.** Review account isolation, D1 backup/recovery, privacy/delete controls, Google OAuth audience, budgets and limited traffic first. After that, use the explicitly guarded, manually invoked commands further below.

## Manual CF-01: Cloudflare account and D1 — NEEDS_DECISION_NOW

On your own browser open https://dash.cloudflare.com and choose/create an owner-controlled **dedicated JODLO** Cloudflare account. Enable MFA, review billing and cost alerts, verify no Finworkar Worker/DNS/database would be affected. Check Workers & Pages and D1. Cloudflare Account ID and D1 database ID are nonsecret identifiers you may share; **never** send account passwords, API tokens or recovery credentials to chat or GitHub.

On your own trusted Ubuntu terminal:

    cd ~/jodlo
    npm ci
    npx wrangler login
    npx wrangler whoami

If you have confirmed the correct account, create a **real** dedicated D1 database, recording the actual UUID:

    npx wrangler d1 create jodlo-production

After creating a real JODLO D1, follow CF-02 above to generate the production Wrangler configuration. Never copy local D1 IDs or the local Wrangler config into production; no remote migration/deployment before the real-account, backup, privacy and security preflight.

**Evidence to provide:** correct owner-owned Cloudflare account chosen; whether JODLO Worker/D1 exist; nonsecret Account ID and D1 UUID if created. No secret values.

## Manual DNS-01: Production host — UPCOMING

Confirm who controls rekixo.com. In Cloudflare DNS / Workers Custom Domains, attach **only** the reviewed jodlo.rekixo.com hostname to the dedicated JODLO Worker after protected health smoke checks. Do not repoint apex/www, wildcard routing or old Finworkar services. Verify actual TLS and /api/v1/health after route setup. Current workers_dev=false means there is no automatically available workers.dev API origin.

## Manual GOOGLE-01: Real login credentials — NEEDS_DECISION_NOW once Cloudflare config is ready

Use https://console.cloud.google.com/apis/credentials (Google Cloud Console / Google Auth Platform). Select/create a separate JODLO Google project, configure branding, audience/consent, authorized domains, support/privacy details and any required Google review.

Create a **Web application OAuth client**. Its public Web Client ID is the Android Credential Manager serverClientId and the backend's exact GOOGLE_CLIENT_ID audience. Also create the **Android OAuth client** for exact package com.rekixo.jodlo, with SHA-1 of actual debug and later release/Play signing certificates. On Ubuntu, inspect the debug certificate (enter any keystore password locally, never in chat):

    keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey

After verified Cloudflare Worker exists, set the backend's GOOGLE_CLIENT_ID via the Cloudflare Worker Variables/Secrets dashboard or your own interactive terminal:

    npx wrangler versions secret put GOOGLE_CLIENT_ID --config apps/api/wrangler.production.generated.jsonc

Use `versions secret put` above only after the Worker exists: it creates a new version without automatic deployment. Plain `wrangler secret put` deploys a version immediately. Configure any required secret in the Cloudflare dashboard or trusted terminal and verify before enabling traffic. The **Web Client ID is public configuration** but an OAuth client secret, Google ID token or signing key is not. Verify actual issuer/audience/signature, login rate limits, JODLO session creation/logout and account privacy before admitting real users. A Google picker appearing on-screen is not proof login works.

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
2. Verify production bundle without deployment: npx wrangler deploy --dry-run --config apps/api/wrangler.production.generated.jsonc .
3. After correctly binding the **real** jodlo-production D1, examine remote migrations: npx wrangler d1 migrations list jodlo-production --remote --config apps/api/wrangler.production.generated.jsonc .
4. Only when intentionally approved for that live DB and backed up, migrate explicitly: npx wrangler d1 migrations apply jodlo-production --remote --config apps/api/wrangler.production.generated.jsonc . **This mutates real remote data** and is never automatic.
5. Store any secrets via Cloudflare protected Secrets UI or trusted interactive Wrangler command; not in .env in git, PRs, screenshots or CI logs.
6. Deploy after a final environment review: npx wrangler deploy --config apps/api/wrangler.production.generated.jsonc . This **does deploy live Worker code**. Keep outside traffic restricted until safe smoke checks succeed, then enable intended access gradually and monitor/revert if needed.
7. Verify actual DNS/TLS, health, correct data isolation, Google login/session logout, Worker publishing, Customer listing detail/unpublish and security errors. Record nonsecret deployment version/commit/migration/verification evidence in [STATUS](STATUS.md).

Official docs: https://developers.cloudflare.com/workers/wrangler/commands/d1/ ; https://developers.cloudflare.com/workers/wrangler/commands/workers/ ; https://developers.cloudflare.com/workers/configuration/secrets/ .

## Later real providers — UPCOMING

Agora: separate real project, server-issued RTC tokens, correct incoming signaling, live presence/busy, block/report/abuse rules, real two-phone testing. Worker calling consent stays **OFF by default** and synthetic call preflights cannot authorize an actual call.

FCM/push: JODLO-owned Firebase project, user consent, token lifecycle, protected service credentials; no Finworkar Firebase reuse.

Payments: owner-authorized merchant/provider onboarding and Play-policy eligibility, backend-verified ledger/refunds, **never** simulated success as real money.

The owner will be told each precise manual action as it becomes essential; generic engineering permission is already granted. **No record here certifies a deployed service, completed Google connection, production data collection or public launch.**
