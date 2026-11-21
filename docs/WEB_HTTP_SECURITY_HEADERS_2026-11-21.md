# JODLO web HTTP security headers — 2026-11-21

## Scope

The development-stage bilingual, static JODLO Home/Help/Privacy/Terms/deletion site at
`apps/web/` already has an HTML **meta** Content Security Policy (CSP), no
forms, trackers, cookies or external resources. HTML meta policies cannot
enforce `frame-ancestors`; headers are a separate deployment responsibility.

This change adds Cloudflare Pages' source-owned `apps/web/_headers` file with
a single `/*` path rule. **It is only active if an owner deploys `apps/web`
as a Cloudflare Pages static asset directory** (and the deployment method
actually honors Pages `_headers`). It does not modify, secure, route or
deploy the independently hosted `api.jodlo.rekixo.com` Worker.

The policy prevents browser cross-origin connections and unexpected external
scripts, images, fonts and embeds; denies framing and geolocation/microphone/
camera/payment browser permissions; opts out of search indexing during
development; and uses nosniff/no-referrer/same-origin defenses. The HTML
meta policy remains the fallback. No `unsafe-inline`, wildcard execution,
network call, service worker, tracking, user-data upload, secrets or backend
changes are introduced.

## Verification and manual gates

- `node --test scripts/web-security-headers.test.mjs` enforces the fixed
  Pages route, HTTP CSP directives, consistency with the HTML meta fallback
  and fail-closed rejection of an unsafe drift. The repository Foundation
  CI also includes this test.
- A successful CI pass validates **only committed source**, not Cloudflare
  Pages availability, DNS/TLS, a response actually carrying those headers,
  the current production website, or review of Privacy/Terms.
- Operator: confirm how `jodlo.rekixo.com` is really hosted and which static
  directory is deployed. If it is not Pages, configure **equivalent HTTP
  response headers** in its actual host after owner approval; do not assume
  placing this file will secure a Worker or another hosting service.
- Operator: inspect real DNS/TLS and web response headers read-only; only
  once this is confirmed should HSTS be assessed. Never enable HSTS blindly
  on the entire `rekixo.com` parent domain or apply website restrictions
  to the API hostname.
- Public release additionally requires human-approved Privacy Policy,
  Terms, account-deletion process, moderation, contact/support workflow
  and one consolidated end-to-end phone acceptance. These remain open.

Related: [infrastructure](CLOUDFLARE_INFRASTRUCTURE.md),
[release readiness](RELEASE_READINESS.md),
[verified state](CURRENT_STATE.md).

## Combined-main integration check

This integration branch starts from `main` after the approved 72-screen UI
and CI trust-boundary merges. Its required **new-commit** CI checks cover both
Android release blocking and web HTTP headers against that exact combined
source. Previous standalone PR checks are not a substitute for these checks.
