# JODLO Customer Service card — public-only, approval-safe slice (2026-11-05)

## Scope

Native Android **Customer Browse → Service detail**, **all public Services Feed**, and **Saved Services** share one card that renders **only** an already existing public Listing reference, the current/past **approved Category label** when safely resolved, and an explicit evidence state. This is a usability and safety improvement to the currently approved minimum public Catalog; it is **not** a Worker identity/profile release and does **not** claim any human review has occurred.

The card has two distinct evidence states:

| Evidence | Legitimate source | User-visible statement | May Save? |
| --- | --- | --- | --- |
| `REFERENCE_ONLY` | Browsed public page or locally Saved opaque Listing ID; optional previously approved Category label | *Only a reference; open to check public status now* | Not directly |
| `PUBLIC_WHEN_CHECKED` | One exact anonymous `/api/v1/listings?id=...&lang=...` response with the same original Listing ID, Category ID and requested Hindi/English language | *Public at the time of the check; may change afterward* | Only if the actual configured HTTPS API and correct response were used |

The typed `CustomerServiceCard.publicWhenChecked` constructor is private to its validated companion method: callers cannot use a data-class `copy` to manufacture a checked badge. Mismatched Listing IDs, Category IDs, languages, absent detail, empty label and invalid/stale detail cannot become a checked card. A Saved bookmark, owner-private publication state, cached feed, or previously checked Saved batch **never** becomes current-public proof by itself. Existing UI actions still make an explicit fresh anonymous detail read before Save. Saved item removal remains offline-only.

**Approved public projection:** Category (from an already-approved public endpoint), opaque Listing reference, and the observation at the time of a valid read. No account ID, Google subject, Worker name, profile summary, custom text, skills, experience, price/rate, rating, address, GPS, phone, online status, call button, verification or contact permission is returned, rendered, guessed or persisted.

**Empty and error states:** Missing approved names show a neutral bilingual *Category name could not be checked*, never a guessed name from ID. A saved/disabled/unpublished/hidden listing remains a reference or explicit failure; network and older-provider failure cannot produce a checked badge. English/Hindi are the only two supported interface locales, matching existing project policy. The existing native outlined cards preserve readable title, reference, state, owner-not-verified notice and touchscreen action. Accessibility still needs the one final founder physical-phone acceptance.

## Policy proposal for a future real public Worker card — NOT approved

Before any Worker identity-like display, obtain explicit founder/qualified policy signoff on every proposed field **individually**, with data provenance, consent, moderation and retention. Suggested decisions to *review*, not silently implement:

| Candidate future field | Decision/risks requiring approval |
| --- | --- |
| Public display name / alias | Whether pseudonym allowed; impersonation, prohibited names, moderation and removal |
| Worker-authored service summary | Safe length/scripts, bilingual review, prohibited claims and content moderation |
| Experience and credentials | Evidence, no automatic "verified" badge, dispute/appeal handling |
| Price/rate and units | Disclosures, tax/platform policy, deceptive listings, update history |
| Broad service area | Explicit approximate precision, non-GPS default, location consent, profile visibility |
| Images/R2 | File size/type checks, moderation, rights, malware, removal and private storage |
| Public contact/calling | Separate customer/Worker consent, bilateral blocks, abuse limits, availability, Agora/FCM live architecture |
| Account closure & moderation | Retention/deletion/backup periods, appeal, audit access, operator restore and responsible party |

No future field is in the current API, database migration or Android card. Old Finworkar data and historical 889/7,267 Catalog review are read-only research, not approved public data. First five Categories/48 Services still need real reviewer signatures, then explicit founder activation. No payment/provider release, Worker/public profile, production migration or remote deployment is authorized by this software-only slice.

## Test and release evidence

- Kotlin JVM tests exercise strict checked vs unchecked projection, explicit ID/Category/language match, invalid name, empty detail and absence of an automatic promotion from a saved reference.
- Android JDK 17/21 compilation proves native integration across all three surfaces; existing API/SQLite/workerd tests protect the original public DTO and owner isolation.
- CI and app no longer show a misleading "current" public Service claim for mere Saved items or feed pages. Device QA must remain deferred until the entire end-to-end product is ready. Live Worker API version, approved records and production availability are separately unverified.

Track full field-policy decisions and complete public Worker profiles under [master backlog #235](https://github.com/rekixo-lab/jodlo/issues/235); authoritative source-vs-live caution remains in [CURRENT_STATE.md](CURRENT_STATE.md).
