# JODLO — mission and working agreement

JODLO is a new India-first local work/service discovery platform for real nearby worker/customer matching. It aims to feel fast, native, lightweight, multilingual and safe.

## Immutable owner decisions
- Product **JODLO**, Android package `com.rekixo.jodlo`, proposed website `jodlo.rekixo.com`, repository `rekixo-lab/jodlo`.
- New cloud-native Cloudflare-first backend and **new data only**. Treat `finworkar-android`, `finworkar-backend`, `Finworkar-web` and their real customers as READ ONLY. Do not migrate data or touch live Firebase/Razorpay/Play listings.
- One small TypeScript Worker API as modular monolith; native Android Kotlin separated by feature. Founder must suggest/review/approve UI screens, navigation, branding and marketing artwork **before implementation**.
- Google Pay India UPI preferred where lawful; Google Play Billing rules apply to digital purchases in a Play-distributed app unless a properly eligible exception/alternative program is used. Old Razorpay never ported.
- Protect personal location, identities, accounts, wallet, RTC and content moderation; no unverified badges. Server-authoritative business rules, idempotent workflows and backups.
- No forced 30/60/90-day deadline. Measure actual service outcomes, not fake users or inflated downloads. Work via tested small PRs and an updated [STATUS](STATUS.md); no false green CI claims.

Read [README](../README.md), [AGENTS](../AGENTS.md), [AI HANDOFF](AI_HANDOFF.md), [Architecture](ARCHITECTURE.md), [Roadmap](ROADMAP.md), [Payment policy](PAYMENTS.md), and [Manual Actions](MANUAL_ACTIONS.md).
