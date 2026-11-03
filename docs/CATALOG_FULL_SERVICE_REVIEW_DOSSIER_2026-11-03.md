# JODLO full Category + Service human-review dossier — 2026-11-03

## Actual production starting point

Founder-operated read-only query of the real dedicated `jodlo-production` D1 on
3 November 2026 returned **0 total Categories, 0 active Categories and
0 public Listings**. The Android Google Login and worker draft are separately
confirmed against `https://api.jodlo.rekixo.com`. The empty Catalog is real
missing approved data, not a search or authentication defect.

The pinned historical Finworkar **read-only reference** holds 889 Categories
and 7,267 Services across 45 packets. The existing global reviewer queue
contains **2,667 unstarted tasks** with **zero qualified signoffs and zero
Category activation authorization**. These facts never license a production import.

## Deliverable: review an entire Category and ALL its Services at once

Prior tools supplied a ranked list of original Category IDs and service IDs,
or required opening a complete 45-packet hierarchy. The new source-pinned,
**offline and read-only** dossier joins a small priority window to each Category's
complete bilingual Service list, original Group/Family, historical safety *label
for review only*, exact flags, cross-Category ambiguities and three outstanding
human-review tasks. It reuses the **existing** immutable source and does not
create another taxonomy, fabricate a signoff, write SQL or contact production.

On trusted Ubuntu checkout:

```bash
npm run catalog:review-dossier -- --check
npm run catalog:review-dossier -- --summary
npm run catalog:review-dossier -- --next --limit=5
npm run catalog:review-dossier -- --next --limit=5 --after=laptop-repair
```

Pages of **1–10 Categories** are supported. The `--after` cursor is the prior
window's `page.nextCursor`, never an arbitrary new ID. An optional
`--progress-root=.local-category-review/progress` reads the **existing,
gitignored, validated 45-packet self-reported** progress, but does not
authenticate the reviewer or convert the status to APPROVED.

The first priority window contains AC Technician (10 Services), Home Tutor (8),
Electrician (10), Two-Wheeler Mechanic (10) and Computer/Laptop Repair (10):
**48 original bilingual Service names** in one review-ready page. These original
terms are evidence, not final JODLO names, claims of skill, eligibility or legality.

## Release gate remains closed

- Human Hindi/English editorial review, qualified occupational/regulatory review
  and final original-to-JODLO Category mapping are still independently required
  for every applicable Category/Service.
- Qualified reviewer identity and evidence quality require independent checks;
  a GitHub PR link or self-reported `EVIDENCE_LINKED_UNVERIFIED` is not a signoff.
- The founder separately approves specific Categories for activation; safety
  exceptions, regulated work, moderation and privacy must not be guessed.
- **No production SQL, D1 seeding, Category publication, service alias import,
  Android demo, provider, Finworkar write, staging or Worker deployment.**

Engineering next after qualified approval: implement a separately reviewed,
operator-controlled **approved-only** D1 import/activation transaction and
real-device Worker → public Customer visibility smoke test, with rollback.
Until those decisions and evidence exist, no Category may be activated.
