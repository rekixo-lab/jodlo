# ADR-0001 — Cloudflare-first modular monolith

Date: 2026-10-27 · Status: **accepted architectural direction**, infrastructure **NOT deployed**.

JODLO `com.rekixo.jodlo` + `jodlo.rekixo.com` starts with one typed TypeScript Cloudflare Worker API at `/api/v1`. It defines feature boundaries for auth, users, listings, local search, contact, payment, call, admin and moderation. Start with no D1/R2/Queues/DO until schema/feature needs are reviewed. Add D1 with explicit migrations and bounded indexed queries, R2 with safe uploads and private media, and Queues with idempotency and DLQ. Durable Objects only when live coordination requires it. Scale measured bottlenecks rather than premature microservices. Native Android remains on the device; payment/RTC/push may need external providers.

**Why:** simpler cost/performance profile and faster testability. **Tradeoff:** single Worker release boundary; mitigate with small contracts, tests, CI and staged rollout. Old Finworkar is read-only. See [Architecture](../ARCHITECTURE.md).
