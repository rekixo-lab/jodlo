# JODLO — real-provider connection and controlled deployment runbook

> **LIVE EVIDENCE UPDATE — 2026-11-04:** The founder's newer 2026-11-03 verification recorded in [STATUS](STATUS.md) confirms that `jodlo-api` was deployed to `https://api.jodlo.rekixo.com` and tested through Android Google Sign-In/private Worker draft; D1 migrations and supported read-only integrity checks also passed. **The “first Worker deploy”, “no TLS/route” and “OAuth unconfigured” checkpoints in this dated 2026-11-03 runbook are now historical. Do not execute them as current instructions.** First perform read-only ownership, deployed-version, hostname/DNS/TLS, API and D1 checks against actual resources; any intentional upgrade requires a separately controlled release with rollback. Green 2026-11-04 main CI does not establish that newer code is deployed, and the real Catalog still had 0 Categories/0 Listings at last owner read. Do not auto-seed legacy data or alter other Cloudflare projects.


## VERIFIED on owner computer (2026-11-03): DNS/CF-06 local Custom Domain dry-run, NOT deployed

**Founder-operated actual Ubuntu CLI (2026-11-03):** `git pull` reached merged PR #210; `npm run production:config:harden` successfully upgraded the existing local real-ID no-route configuration; `production:config:check`, `production:domain:write` and `production:domain:check` all **SUCCEEDED**; `npx wrangler deploy --dry-run --config apps/api/wrangler.production.domain.generated.jsonc` compiled the real `jodlo-api` Worker (**92.37 KiB / 21.67 KiB gzip**) and listed `DB=jodlo-production`, `LOGIN_BURST_LIMITER` (100/10s) and `ACCOUNT_LOGIN_LIMITER` (20/60s). The CLI explicitly ended `--dry-run: exiting now`. This is positive evidence of **local production config + exact Custom Domain dry-run**, **NOT** a Cloudflare Worker upload, activated DNS, issued TLS certificate, live API, real Google OAuth or public launch.

**First external action still pending (CF-05):** Check in the correct Cloudflare account that `jodlo-api` is unused or belongs only to JODLO; verify no existing public routes or preview URLs. Check `rekixo.com` zone **Active**, inspect `api.jodlo` DNS and other routing conflicts. The founder's screenshot showed all 11 DNS entries and no explicit `api.jodlo.rekixo.com` entry, but did **not** itself verify zone status or Worker-name ownership. The owner can run read-only `npx wrangler deployments list --name jodlo-api --config apps/api/wrangler.production.generated.jsonc` and confirm in Workers & Pages. A not-found error is not proof of ownership. **Only after those checks** do the first actual `wrangler deploy --config apps/api/wrangler.production.generated.jsonc` with **no route**, confirm deployment, then intentionally attach exact `api.jodlo.rekixo.com` with the **separate** `wrangler.production.domain.generated.jsonc` (this public domain deploy is another distinct release) and verify TLS plus `https://api.jodlo.rekixo.com/api/v1/health`. Both commands actually deploy to Cloudflare and have NOT been run.

**Next read-only checks** (this is the next operator command, not deploy):

```bash
cd ~/jodlo
npx wrangler whoami
npx wrangler deployments list --name jodlo-api --config apps/api/wrangler.production.generated.jsonc
```

Also verify in **Cloudflare dashboard → rekixo.com → Overview** that the zone is **Active**, and in **Workers & Pages** whether `jodlo-api` exists or has an attached domain. The previous screenshot of DNS Records showed 11 records without the exact API hostname but is not sufficient evidence of zone Active status or Worker ownership. **Stop before deployment on any name, DNS, zone or domain conflict.** When safe, follow the below two-stage protected deploy guidance: first no-route Worker upload, then exact-host Custom Domain attach. Never create a manual placeholder DNS record, touch the website `jodlo.rekixo.com`, or equate a dry-run with live URL.


## DNS-01 / CF-06 — founder-confirmed dedicated API Custom Domain (2026-11-03)

**Exact confirmed hostname:** `api.jodlo.rekixo.com` (NOT `jodlo.rekixo.com`). Android `jodloApiOrigin` is **`https://api.jodlo.rekixo.com`**, with NO `/api/v1` suffix; the app's existing repository methods add `/api/v1`. After actual domain attach and TLS verification the health check is **`https://api.jodlo.rekixo.com/api/v1/health`**. Website and API remain separate. Binding decision: [ADR-0016](decisions/0016-jodlo-dedicated-custom-api-domain.md).

**Status:** decision LOCKED; actual Custom Domain, DNS, TLS, Worker deployment, Google OAuth and health response **NOT YET CONFIRMED**. Owner stated **no new deployment commands have been run** as of this confirmation. Do not interpret the existing real D1 as a publicly deployed API.

### Why Custom Domain rather than a Worker path route?

The `jodlo-api` Worker owns all requests to **only** `api.jodlo.rekixo.com`; Cloudflare Workers Custom Domains are designed for an origin Worker and automatically create the necessary DNS record and managed TLS certificate when their zone is active. This uses `routes:[{"pattern":"api.jodlo.rekixo.com","custom_domain":true}]` — not `"jodlo.rekixo.com/api/v1/*"`, not a wildcard. [Cloudflare official docs](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

### First verify zone and DNS ownership — MANUAL and read-only

1. Open [Cloudflare dashboard](https://dash.cloudflare.com) and select the **JODLO authenticated account** ending `7f12f` (Account ID from previous owner CLI). Verify the **`rekixo.com` Cloudflare zone is ACTIVE in that same account**. If that zone belongs to another account, stop and investigate; do not move nameservers or DNS casually.
2. In **rekixo.com → DNS → Records**, look specifically for **`api.jodlo`** (full hostname `api.jodlo.rekixo.com`) and any colliding CNAME, A/AAAA, wildcard or custom-domain route. Also inspect **Workers & Pages → jodlo-api → Settings → Domains & Routes**, if it already exists. **Never delete or overwrite an existing live record** without identifying its owner and dependent apps. Do not touch `jodlo.rekixo.com`, apex `rekixo.com`, `www` or other Cloudflare Workers.
3. Confirm `jodlo-api` Worker name is unused or is the founder's intended JODLO Worker. Cost limits/alerts, reviewed personal-data constraints and protection from unwanted public traffic must be ready **before** attaching the Custom Domain.

### Exact repository commands — LOCAL ONLY; no deployment

After this PR is merged and fetched, on the owner's trusted Ubuntu machine:

```bash
cd ~/jodlo
git switch main
git pull --ff-only origin main
npm ci

# Harden the original real-account, gitignored, no-route config once.
npm run production:config:harden
npm run production:config:check

# Create a DIFFERENT gitignored config for the exact custom API hostname.
# This does not request API tokens and makes no remote Cloudflare changes.
npm run production:domain:write
npm run production:domain:check

# Build/validate without deploying or attaching the public domain.
npx wrangler deploy --dry-run --config apps/api/wrangler.production.domain.generated.jsonc
```

`production:domain:write` refuses to overwrite a previous domain file and requires the safe real account/D1/rate-limit bindings and both `workers_dev:false` and `preview_urls:false`. It creates a **separate ignored file**, so the original no-route config remains available for a safer first Worker upload. If the domain file already exists, use `production:domain:check` rather than rerunning `--write`. Changes to actual D1 or rate-limit IDs after generation will fail the check rather than silently deploying an old-account config.

### EXPLICIT REAL PUBLISHING STEP — only after external checks

- First, if there is **no previously deployed JODLO Worker**, use the **original no-route configuration** for a controlled upload, **only after verifying no Worker name collision**:

```bash
npx wrangler deploy --config apps/api/wrangler.production.generated.jsonc
```

This is a real code deployment, but does not intentionally attach the custom hostname. Verify in the dashboard that it belongs to JODLO and has no accidental existing domain/preview routes.

- **After** correct `rekixo.com` zone ownership, exact hostname record safety, user-data protections, owner-controlled release and dry-run checks, this separate command **DEPLOYS and ATTACHES THE PUBLIC Custom Domain**:

```bash
npx wrangler deploy --config apps/api/wrangler.production.domain.generated.jsonc
```

This last command is **not a dry-run**: it creates/updates an Internet-reachable Custom Domain for the JODLO Worker. Do **not** run it before Cloudflare zone/hostname collision checks or assume any existing dashboard-managed route is safe. Cloudflare will handle the Custom Domain DNS/TLS, but you must confirm DNS activation/certificate validity from actual live evidence. Do not create a manual dummy AAAA record or point the website at this Worker.

### After controlled attachment — actual read-only smoke

```bash
curl -i --max-time 20 https://api.jodlo.rekixo.com/api/v1/health
```

Only report the exact observed status/body after that command succeeds. A successful health response is NOT proof of Google sign-in, Customer/Worker onboarding or approved Categories. Real Google OAuth requires the dedicated Google Cloud project, Web Client ID as server audience, Android OAuth client for `com.rekixo.jodlo`, signing SHA-1 and protected Worker `GOOGLE_CLIENT_ID` configuration. Keep Worker calling OFF and no unreviewed Category activation. Follow [Manual Actions](MANUAL_ACTIONS.md).


## CF-04 verified, CF-05 — first protected real Cloudflare Worker deployment

**CF-04 database integrity evidence (owner's actual Wrangler CLI, 2026-11-03):** `npx wrangler d1 execute jodlo-production --remote` returned **`PRAGMA quick_check = ok`**, and a separate **`PRAGMA foreign_key_check` returned no rows** on the specific real JODLO D1 UUID `723080b5-f165-4b31-839f-3063175824c7`. The eight production migrations and zero pending migrations were confirmed in the prior terminal output. D1 `quick_check` is limited verification, not a full SQLite `integrity_check`. **The Cloudflare Worker has NOT yet been deployed, no DNS route attached, real Google OAuth not configured and public acceptance is not green.**

**Reason for new hardening:** Cloudflare permits Version/Preview URLs to be independently enabled; disabling `workers.dev` alone may not clear an existing setting. For the initial API upload we explicitly set `workers_dev:false`, `preview_urls:false`, **no `routes`**. This prevents accidental preview URLs, but is not a substitute for checking any existing dashboard-managed custom routes on a Worker with the same name. [Cloudflare docs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/).

**A. Operator's local existing config upgrade — no remote changes.** Run on the Ubuntu workstation already authenticated to the actual Cloudflare account, after this PR has merged and `git pull` has retrieved it:

```bash
cd ~/jodlo
git switch main
git pull --ff-only origin main
npm ci
npx wrangler whoami
npm run production:config:harden
npm run production:config:check
git check-ignore apps/api/wrangler.production.generated.jsonc
npx wrangler deploy --dry-run --config apps/api/wrangler.production.generated.jsonc
```

The `--harden` command is **idempotent** and updates the existing generated config locally through an atomic replace; it retains its actual account ID, D1 UUID and verified rate limiter IDs. It refuses unknown fields, malformed IDs, wrong binding, enabled preview URLs and public routes, and will not write any secrets. Never run `production:config:write` over the existing file or commit the generated file. If the harden command fails, stop and show the error with all secrets removed.

**B. Account/name collision review — read-only Cloudflare step.** In [Cloudflare dashboard](https://dash.cloudflare.com) > Workers & Pages for the logged-in account, inspect whether `jodlo-api` already exists. If so, determine whether it belongs to JODLO, whether it has users or routes/custom domains/preview URLs, and whether this owner authorizes replacing it. Wrangler can also inspect the current known deployment (errors may mean no Worker or access issues, so don't mistake a failure for an empty safe name):

```bash
npx wrangler deployments list --name jodlo-api --config apps/api/wrangler.production.generated.jsonc
```

Double-check Cloudflare Account ID `8f31060fbcfee2b3e9309138cad7f12f`, `jodlo-production` D1 `723080b5-f165-4b31-839f-3063175824c7`, no other databases, two unique login rate limiter namespaces, cost alerts and rollback. Do **not** overwrite an unknown existing Worker, deploy to Finworkar or attach wildcard DNS. The configured authentication endpoint returns **503** until its genuine `GOOGLE_CLIENT_ID` Web OAuth client is safely configured; this is a deliberate fail-closed state, not a usable sign-in.

**C. Real Worker deployment (owner-executed, intentionally not CI).** Only after A and B, and after confirming no unrelated Worker/name or existing public routes:

```bash
npx wrangler deploy --config apps/api/wrangler.production.generated.jsonc
```

**This command actually uploads and deploys code to the real Cloudflare account.** Expect an actual Worker version/deployment record. With the guarded config alone, there is **no public hostname**, so a successful deployment will *not* prove an HTTP endpoint is reachable from an Android phone. Inspect Cloudflare > Workers & Pages > `jodlo-api` > Deployments/Settings > Domains & Routes to verify the Worker version and absence of public `workers.dev`, Version URL, Custom Domain or unintended Route. Do not treat a successful deploy as a public launch, OAuth success or finished personal-data policy.

**D. Next following real integration:** Google Cloud Console JODLO project Web+Android OAuth clients (package `com.rekixo.jodlo`, correct SHA-1), protected Cloudflare `GOOGLE_CLIENT_ID` binding, reviewed exact JODLO HTTPS hostname/DNS with TLS and access control, then real phone Google login, Worker publish -> Customer read -> unpublish. Founder call consent remains OFF; no fake production Categories or Agora. No public DNS/Google auth actions are performed by this PR.


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
