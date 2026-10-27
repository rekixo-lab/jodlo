# JODLO — founder manual actions, owner gates and notification register

**Founder directive (2026-10-27): Whenever a manual action becomes genuinely necessary, the AI must tell the founder clearly and promptly during the active JODLO chat.** Persist it here so each future engineer/chat knows what is pending, why, and how to continue. The assistant handles automatable engineering itself; only the founder makes decisions, approvals and external account actions.

## Owner-action communication protocol

1. **Check at the start of every JODLO session:** read `AGENTS.md`, this register and `STATUS.md`; verify the latest main commit, open PRs and actual Actions status. Do not assume previous chat Memory can substitute for repository instructions.
2. **Raise a gate when needed, not after silently stalling:** say **"मैनुअल काम [ID]"**, exactly what the founder must decide/do, why now, expected choices/steps, what is blocked, what work the AI can still do, and when the action must be completed. Prefer **one essential blocking question** rather than dumping setup chores.
3. **Always differentiate:** `NEEDS_DECISION_NOW` (current technical blocker), `UPCOMING` (not a current blocker), `DEFERRED` (no action now), `DONE` (founder explicitly approved/completed with dated evidence) and `BLOCKED_EXTERNAL` (provider/platform issue). A proposed default is never treated as approval.
4. **Never ask for secrets:** passwords, live API tokens, account recovery codes, signing/private keys, payment OTPs, real-user data, or bank/customer records are not to be pasted into chats, PRs or commits. Manual provider setup is deferred until the matching approved stage; give safe console steps at that time.
5. **On founder answer or changed readiness:** update this register (ID, outcome, date/evidence), `STATUS.md`, `AI_HANDOFF.md`, `ROADMAP.md` and `README.md` via an isolated PR; run tests and verify **real PR + main CI** before claiming done. The AI continues all other non-blocked development.
6. **Honest notification boundary:** An ordinary chat cannot spontaneously message the founder after the chat ends or continuously monitor providers. Notify proactively **within ongoing sessions** when a gate arises; do not promise background alerts without an explicitly configured automation.

## Action register

| ID | State | Owner / trigger | Exact manual decision or action | What is gated / safe work until then |
| --- | --- | --- | --- | --- |
| **M-001** | **NEEDS_DECISION_NOW** | Founder; before first identity/worker/account D1 migration | Choose one shared login/account allowing customer and opt-in worker roles, **or** fully separate customer/worker accounts. Recommended for review: one account, roles granted server-side; **not approved**. | Blocks committing user-role/ownership schema; proceed with typed models/specs, auth guards and mock/local tests without real PII |
| **M-002** | **UPCOMING** | Founder; before activating real login and phone/email data flows | Decide identity method/provider and whether phone OTP is required; review cost, privacy/abuse and account recovery. Do **not** provide OTP, tokens or private phone numbers here. | Real identity integration blocked; provider ports, fake identity verification and negative auth tests can proceed |
| **M-003** | **UPCOMING** | Founder; before personal-location/areas schema | Decide area-selection and privacy/retention: proposed manual area-first, optional precise GPS only with consent and clear deletion; exact city/residency needs separate approval. | Real area/PII storage/search rules held; public category catalog can advance |
| **M-004** | **UPCOMING** | Founder; before ANY Android/web UI visual code, theme, screen or 3D artwork | Review layout flows, palette, typography, Hindi copy, transitions and selective 2.5D/3D storyboard; grant explicit design approval or request revisions. | No visual implementation until approved; backend, test harness, technical nonvisual interfaces can advance |
| **M-005** | **UPCOMING** | Founder; before seeding real catalog/pilot users | Choose pilot locality, approved service categories, matching/request lifecycle and trust/verification labels. | Do not publish fabricated categories, verified statuses or location data |
| **M-006** | **DEFERRED** | Founder; only once payments/RTC/FCM provider work needs real onboarding | Review eligible Google Pay India UPI merchant path and Google Play Billing digital SKU compliance, RTC/notification vendor, contracts, costs and safe provider setup. No legacy Razorpay. | Develop deny-by-default billing rules, local fake adapters and simulations, not live transactions |
| **M-007** | **DEFERRED** | Founder; after full product readiness, before first production-only release | Approve Cloudflare production-only resources/budget, D1 backups/migrations, DNS/TLS, scoped secrets, Play release controls, monitored smoke tests and rollback. | Absolutely no staging or remote Cloudflare deployment, no changes to Finworkar/live DNS |

**No manual Cloudflare, GitHub secret, Google Play or merchant console action is required today.** This register is the source of truth for *requests to the founder*, not evidence that an unapproved product decision is settled.

## Next action and order

1. **Ask M-001 now:** Should the *same JODLO account* be able to act as both a customer and an opt-in worker, or should they have entirely separate accounts? Explain the single-account recommendation without silently locking it in.
2. After approval, design local-only versioned D1 identity/worker relationships and ownership/auth tests. Ask **M-002/M-003** as their dependent implementation is reached; continue independent fake-adapter work in parallel.
3. Invite **M-004** feedback *before* UI coding; reserve **M-006/M-007** for actual later release/provider gates.

Read [AGENTS](../AGENTS.md), [Status](STATUS.md), [AI handoff](AI_HANDOFF.md), [Roadmap](ROADMAP.md), [Payment rules](PAYMENTS.md), [Release Readiness](RELEASE_READINESS.md) and [ADR-0004](decisions/0004-local-first-no-staging-until-production.md).
