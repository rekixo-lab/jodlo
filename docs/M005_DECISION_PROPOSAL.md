# M-005 founder decision proposal — safe worker/customer pilot

**Status: PROPOSED, NOT APPROVED AS PRODUCT SPEC** (2026-10-27).

The founder stated "अगर मेरी मंजूरी चाहिए कुछ चीज में तो approved" — permission to continue sensible engineering. This does not identify the pilot location, actual service categories, verified-worker publication policy or initial customer contact process. Do **not** claim these exact choices are decided merely because development was authorized.

## Proposed conservative first pilot workflow (awaiting founder's choices)

1. A customer has one Google-linked JODLO account and may privately opt in as a worker (M-001/M-002 **already DONE**); the opt-in `worker_profiles.status='draft'` is *never* a public listing.
2. **Suggested**, not approved: worker prepares a service description and chooses only categories from a subsequently owner-approved active bilingual catalog. No trust badge or "verified" label merely for signing in or opting in.
3. **Suggested**, not approved: manual review of the service before publication, with ability to unpublish/disable; require worker active, listing available, category active and moderation approval on every public read. Never infer trust from old Finworkar calls/ratings.
4. **Suggested**, not approved: a customer first sends a bounded **request for availability**, and worker can accept or decline. Contact details are not exposed from search. Direct calling and notifications are separately reviewed, not an assumed automatic first-run capability.
5. **Suggested**, not approved: an area-first optional location policy with no required precise GPS; any real user location collection, consent, retention and deletion require separate M-003 approval.
6. **Required remaining owner specifications:** actual first city/area, service category shortlist, manual-vs-automatic publication, public fields/trust terminology, and first request vs calling choice. Pricing, fees and RTC/payments require later M-006 review. Hindi (Devanagari) and English only, no Hinglish (ADR-0008).
7. **No production deployments or staging** until M-007, no Android/web UI until M-004, no Google real-device OAuth setup until M-008. Old Finworkar code is READ-ONLY behavioral reference.

## Implementation status

Already shipped: public bilingual category read/search; private worker draft, pure deny-by-default listing/contact eligibility, generic request CAS/idempotency contract with test-only SQLite rehearsal and founder-gate CI. **No real service listing/public search, request persistence or calls yet.** The present change instead hardens already approved login/logout.

### One decision to raise when the user responds

**M-005:** Should each worker's service require **manual review before it is publicly visible**, or is automatic publication desired? Recommended default is **manual review, with no automatic "verified" badge**. Record founder's actual answer in `docs/MANUAL_ACTIONS.md`, then continue separately deciding pilot area/categories and request channel. Do not treat this proposal as consent for location/PII collection.
