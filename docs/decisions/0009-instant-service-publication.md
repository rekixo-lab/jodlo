# ADR-0009 — Immediate worker service publication, without automatic verification

**Status: founder-approved, 2026-10-27 — M-005 publication subdecision.**

The founder explicitly approved: a worker may **publish a service listing immediately** without manual prepublication review; verification badges are **never automatic**. This supersedes the previous *proposal* to require manual approval first. Founder also requested security and moderation safeguards.

## Approved narrow implementation

- A customer account remains one Google-linked identity with a **private** worker opt-in profile whose `status` stays `draft`. A separate `worker_listings` entity becomes immediately `published` after a verified active worker chooses a **preexisting active catalog category**. Private draft is NOT public verification.
- Initial public listing response contains **only an opaque listing ID and category ID**. No worker account ID, contact, address, precise GPS, service description, price, photo, certification, "verified" label or trust ranking is exposed. Categories remain bilingual Hindi and English; **no real pilot category seed** was invented.
- D1 `UNIQUE(worker_account_id,category_id)` prevents repeat category duplicates. Atomic insert/upsert ensures repeat attempts preserve the existing listing ID. An owner can unpublish or republish their own category service after explicit action.
- Public reads **re-check** active owner, private opt-in existence, active category, published status and `moderation_status='allowed'` on every database lookup. Moderator-controlled `hidden` blocks both public reads and a worker's attempted republication. There is **no public moderator/admin API** or unreviewed fake AI moderation; a trusted internal DB operation can hide an entry for local tests, with future report/review admin workflow pending. No free-form text/media is accepted, limiting unreviewed user content.
- Minimal endpoints: public `GET /api/v1/listings?categoryId=<id>`, authenticated owner `GET /api/v1/me/listings`, `POST /api/v1/me/listings` with only `{"categoryId":"..."}`, `DELETE /api/v1/me/listings?id=<opaque-id>`. All using existing server-issued sessions, bounded parsing and narrow projections. No direct calling or real requests yet.
- All tests/migrations/Workers bundles are **local only**. NO remote Cloudflare D1 migrations, staging or production deployment until explicit M-007 approval.

## Still awaiting specific founder decisions

M-005 is **partially** decided only: actual first pilot city/area, curated active service categories, extra listing details, trust/verification process, customer request vs direct calling, reporting/appeal workflow, moderation staff authentication and abuse limits still need decisions. M-003 privacy/area selection/consent/retention/deletion before real personal location; M-004 visuals before UI; M-008 real Google OAuth/device; M-006 calling/payments providers. The general business goal and this publication approval do **not** approve those details.

Only **Hindi (Devanagari) and English**, no Hinglish (ADR-0008). Old Finworkar repos remain READ ONLY.
