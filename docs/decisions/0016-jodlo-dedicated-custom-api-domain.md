# ADR-0016 — Dedicated JODLO custom API domain

- **Decision date:** 2026-11-03, confirmed explicitly by founder.
- **Status:** ACCEPTED — binding hostname for JODLO production API.
- **Related:** [ADR-0015](0015-real-provider-integration-and-controlled-production.md) authorizes real integrations and protected deployment.

## Confirmed external URL contract

| Purpose | Exact value |
| --- | --- |
| Production API hostname | `api.jodlo.rekixo.com` |
| **HTTPS API origin** used as Android `jodloApiOrigin` | `https://api.jodlo.rekixo.com` |
| Current API versioned prefix | `https://api.jodlo.rekixo.com/api/v1` |
| Public health-check endpoint | `https://api.jodlo.rekixo.com/api/v1/health` |
| Dedicated Cloudflare API Worker | `jodlo-api` |
| Website (separate host, NOT the API host) | `https://jodlo.rekixo.com` |
| Android app ID | `com.rekixo.jodlo` |

The founder specifically confirmed **`api.jodlo.rekixo.com`** after asking that the previously selected API hostname be honored. Older documents mention `jodlo.rekixo.com/api/v1` because the earlier single-host architectural proposal combined website and API. For **new implementation and Android builds**, use this dedicated API hostname instead; do not silently route API traffic via the website or invent another public API host.

## Cloudflare routing decision

Use a Cloudflare Workers **Custom Domain** on the single, exact hostname `api.jodlo.rekixo.com`, with the Worker as origin:

```json
{
  "routes": [
    { "pattern": "api.jodlo.rekixo.com", "custom_domain": true }
  ]
}
```

This is an exact-host mapping of **all paths** on that hostname. The API itself serves only its explicit `/api/v1/...` endpoints. Do not add a wildcard route, an unrelated zone, the website hostname, the parent `rekixo.com`, a new path-based route or a separate `workers.dev` / Preview URL. Keep `workers_dev:false`, `preview_urls:false`. Cloudflare manages the Custom Domain DNS/TLS when the `rekixo.com` zone is active in the correct account and the hostname has no conflicting DNS record. The owner must verify hostname/zone ownership and existing records first. **Do not delete an existing CNAME or change other routing without inspecting what it currently serves.**

The existing real-ID, **no-route** `apps/api/wrangler.production.generated.jsonc` is retained for safer first Worker upload. A separate, opt-in, gitignored `apps/api/wrangler.production.domain.generated.jsonc` is derived from that verified config with **only** the exact accepted Custom Domain. Creating/checking the file is offline; **deploying** with it makes the API hostname publicly routable and must only be done after the owner's zone/DNS/TLS, security/privacy, cost, rollout and first Worker checks.

## Release and verification

1. Complete actual JODLO D1 checks (eight migrations, `quick_check=ok`, no foreign key violations — owner-observed 2026-11-03) and exact green main CI.
2. On the owner's Cloudflare dashboard, verify the account and that `rekixo.com` is an **active zone**; inspect any existing `api.jodlo` DNS records, Custom Domains/Routes and unexpected `jodlo-api` Worker. **Stop on conflict** rather than replacing unrelated production services.
3. Harden existing real-ID config and dry-run. If needed deploy `jodlo-api` **without public routes** first and confirm its identity. Then explicitly enable the dedicated Custom Domain with the **separate** reviewed Wrangler config or Cloudflare Dashboard; avoid two competing sources of route truth.
4. After controlled domain attachment, verify Cloudflare-generated DNS and TLS and read-only `GET https://api.jodlo.rekixo.com/api/v1/health`, then public catalog behavior. An API health response does **not** establish real Google login, category approval, data privacy review or readiness for broad users.
5. When real Google OAuth Web/Android credentials are ready, set the Cloudflare server audience safely. Build Android using `jodloApiOrigin=https://api.jodlo.rekixo.com` (origin **without** `/api/v1`), plus real public Google Web Client ID. Verify login/logout and Customer↔Worker publication lifecycle from a physical phone before wider traffic.

**Current status as of this decision:** hostname is founder-confirmed; Custom Domain DNS/TLS attachment, Worker remote deploy, live health and Google OAuth have **not** been verified. Never claim they are live without Cloudflare/HTTPS evidence.

Cloudflare guidance: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ .
