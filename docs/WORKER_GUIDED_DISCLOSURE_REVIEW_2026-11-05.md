# Worker Category-only Guided Editor: Public Scope & Final Review — 2026-11-05

## What this source slice actually delivers

This milestone upgrades the **existing native Worker Create/Edit Category journey**, rather than claiming a full Finworkar-style rich Worker profile. After selecting a *currently approved* Category, the Worker must deliberately see the precise public-data scope and then take a **separate final review/confirmation** before either the existing authenticated Publish POST or revision-safe Category PUT can be attempted:

1. **Select current approved Category.** Creation only selects an approved page row; editing starts from an exact authenticated owner-revision snapshot and keeps the original Listing ID and revision.
2. **Review the Category-only disclosure.** Explain that the only public data available today is the approved Category and opaque Listing reference. No name, description, experience, price, location, service area, photo, phone, verified status, call permission or other unapproved identity/profile data is collected, changed or displayed.
3. **Separate final review and explicit confirmed write.** Core requires both consecutive review stages, the same session generation and a currently loaded approved destination row. Edit additionally requires the original current owner row, prior revision, changed destination and client-visible duplicate avoidance. The backend always rechecks account ownership, approval, moderation, Category uniqueness and the CAS revision before any write; the client review does NOT approve a Worker or a Category.

A known duplicate Category in **already loaded own listings** prevents client-side Create/Edit review/confirm. This is a conservative usability guard only, **not** a claim that all owner pages were checked. The existing server unique-owner/Category constraint and conflict response remain authoritative for categories absent from the loaded page, changes from another device and concurrent requests. No new capability to create duplicate listings is added.

## State invalidation and failure behavior

- Choosing a different Category, refreshing/changing the Catalog query, switching language, clearing a selection, losing the current owner row, logout/account change, failed/stale revision read or cancelling the reviewed step requires a renewed disclosure/final review as appropriate.
- An old unversioned owner listing can NEVER produce the edit version token. The final edit continues through `editCategoryVersioned` and the existing single-flight uncertain-write guard; no downgrade or automatic retries are added.
- The final button does not save an unpublished draft locally. Publishing still uses the same existing approved Category-only API. A lost remote acknowledgement is **not** a proven rejection; use the independent manual read-only recovery from [Worker uncertain exact recovery](WORKER_UNCERTAIN_EXACT_RECOVERY_2026-11-05.md).
- Hindi (Devanagari) and English are the only approved UI languages. No extra personal field, public DTO, database migration or provider secret is introduced.

## Automated verification scope

The Kotlin contract suites verify skipped-review refusal, stale account/Category cancellation, disclosure state reset, changed owner row, unversioned edit refusal and known duplicate create/edit denial. Existing server-authoritative uniqueness and revision/ABA tests remain intact. Native Android JDK17/21 compilation must independently pass for both PR head and merged main, along with Foundation CI.

## Explicit limits and the next genuine feature gates

**Full guided multi-field editing is still OPEN** under [#235](https://github.com/rekixo-lab/jodlo/issues/235). The next real feature requires reviewed decisions on **each** proposed Worker public name/alias, service summary, experience/credentials, rate units, approximate service area and photographs, including proof, consent, moderation, retention, deletion and legal/safety appeal handling. This milestone implements **no input or database field** for those undecided items.

Nothing is deployed to Cloudflare/D1, seeded into the live Catalog, sent by email, copied from legacy Finworkar or tested on the physical phone. All new JODLO releases still require an explicit controlled operator rollout and the founder's **one final consolidated full-app phone acceptance**.
