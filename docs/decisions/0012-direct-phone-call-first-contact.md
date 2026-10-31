# ADR-0012 — Direct phone call as the first customer–worker contact

> **Binding clarification (2026-10-31):** [ADR-0013](0013-agora-ip-voice-calling.md) specifies that "direct phone call" here means **in-app Agora RTC Internet audio calling**, not PSTN/SIM dialing or any worker telephone number. Do not implement number display vs masked carrier dial or ask that question again. Earlier transport alternatives and number-exposure choices below are superseded by ADR-0013; the remaining privacy/consent, worker safety, incoming-call signaling, UI and no-deploy gates still apply.


**Status: ACCEPTED founder product decision — 2026-10-31; M-005 first-contact CHANNEL DONE.**

## Founder decision and exact scope

On **2026-10-31**, the JODLO founder explicitly chose **"सीधे फोन कॉल" (direct phone call)** as the customer's **first contact with a worker**, and asked to record the decision and continue safe engineering. Therefore, **do not introduce a mandatory in-app request/accept/decline step before the first call**. Existing generic request transition experiments are not the initial-contact product design and may not be silently promoted to a customer-facing booking workflow.

The existing self-publication decision (ADR-0009), two pilot city names (ADR-0010), all legitimate trades / all 889 historical source Categories in safety review (ADR-0011), Google login (ADR-0007), and two-language Hindi Devanagari / English policy (ADR-0008) remain binding.

## What this DOES NOT approve

A **phone-call product channel is approved**. It is **not approval** to reveal or persist a worker's phone number, collect a customer's phone, publish phone data in public search, infer consent from self-publication, enable a `tel:`/Android dialer UI, choose a masked-number provider, start RTC/VoIP, silently dial, automatically record calls, store call history, or configure Cloudflare/telephony services.

Before any real in-app Agora RTC call, the founder must settle **M-003 privacy for call identity/metadata, consent and retention**, **M-005 explicit worker call opt-in, access controls, current availability, block/report/moderation and abuse prevention**, **M-004 call screen/ringing storyboard**, and **M-006 Agora vendor onboarding, token and signaling integration** when needed. No telephone-number disclosure or private-number routing is part of the approved Agora-first contact.

## Local-only, deny-by-default engineering contract

- Keep the existing authenticated requester, owner-scoped worker listing, D1 Category activation and moderation checks; never trust a public browse preview, client-supplied worker/phone, worker draft, or category alias as authorization.
- The new internal `modules/interactions/direct-call.ts` composes the **existing** `decideContactSafety` with the **existing** `readCurrentRequestTarget` source facts. Additional policy booleans are intentionally not stored or available yet: up-to-date worker consent to calls, verified contact destination, approved connection/privacy method, abuse budget, service availability and mutual blocks.
- No real policy provider exists, so this pure contract has **no live call path**. A synthetic `candidate` means only that an injected, test-only complete policy passes—not permission to reveal a phone number, launch a dialer or place a call. Current source conditions must be revalidated at any future disclosure/connection authorization boundary, with a race-safe design.
- Test stale listing/Category, deactivated accounts, self-contact, missing/malformed policy and unapproved privacy. No new phone/PII/area/call/request D1 tables, public routes, notification events, Android UI or remote deployments.

## Remaining manual actions and implementation sequencing

- **M-005 contact mode:** **DONE**, direct in-app Agora voice call first (ADR-0013). The prior request-first suggestion is superseded.
- **M-005 contact safety / M-003:** **NEEDS_DECISION_NOW** for live Agora eligibility: worker opt-in, busy/availability, mutual block, abuse throttling, call participant/metadata privacy, consent and retention. The earlier 'number display vs masked carrier connection' question is CLOSED by ADR-0013.
- **M-004:** Visual Android UI/screens and the presentation of a phone action still require founder-approved design.
- **M-006:** Agora RTC Voice vendor choice **DONE** (ADR-0013); App ID/certificate, token server, incoming-call signaling and operational onboarding remain **DEFERRED**.
- **M-007:** No Cloudflare staging, remote D1, domain, Play/production release before final founder approval.
- **M-008:** Google Cloud OAuth configuration and real Android sign-in testing remain separate.

There is **no customer request endpoint** or active call handling in this ADR. Finworkar remains read-only. The source/API and notification implementations are still local-only.
