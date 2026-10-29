# JODLO — unified all-trade human review queue (2026-10-29)

**ADR-0011; FULL 889 original Category and 7,267 Service scope; source-only, human review pending.** The founder rejected a ten-trade product limit. This executable offline queue joins the already validated source-locked **45 Category name/ID correction packets**, **45 Service bilingual-name correction packets**, **45 Service occupational-scope draft packets**, and the all-889 diagnostic exception register. It does **not** create a second taxonomy, approve a Category/Service, infer legality, apply corrections or import an alias.

## Explore the full source, with no supplied draft evidence

~~~bash
npm run catalog:unified-review -- --check
npm run catalog:unified-review -- --summary
npm run catalog:unified-review -- --packet=1
npm run catalog:unified-review -- --packet=45
npm run catalog:unified-review -- --category=ORIGINAL_SOURCE_ID
npm run catalog:unified-review -- --all
npm run reference:check
npm test
~~~

The default path synthesizes the **unsubmitted** versions of all three existing packet schemas. It confirms there are **889 original Categories**, **7,267 original Services**, 45 packet positions, **17 preliminary desk reviews**, **872 not desk-assessed**, zero genuine qualified human signoffs, zero owner Category approvals and zero activated records. It does **not** claim people have actually completed those reviews or that the legacy work is safe.

## Use actual offline reviewed proposals, without uploading private records

Under a repo-relative, *gitignored* directory such as \`.local-category-review/joint/\`, place exactly these three subdirectories and 45 files in each:

| Directory | Required files | Generate originals using |
| --- | --- | --- |
| \`category/\` | \`packet-01.json\` through \`packet-45.json\` | \`npm run catalog:correction-template -- --packet=N\` |
| \`service-name/\` | \`service-packet-01.json\` through \`service-packet-45.json\` | \`npm run catalog:service-corrections -- --packet=N\` |
| \`service-scope/\` | \`scope-packet-01.json\` through \`scope-packet-45.json\` | \`npm run catalog:service-scope -- --packet=N\` |

All 135 packets must be present even when there are zero proposals in some packets. One exact local invocation then checks the three streams together:

~~~bash
npm run catalog:unified-review -- --review-root=.local-category-review/joint
~~~

The output is a **human-readable JSON review queue**, not a public catalog or approval export. Run locally within the trusted repo. Never put private health, identity, worker/contact/location or legal case details in the files or an evidence PR. It requires real directories, refuses escaping paths and symlinked scope files, caps scope files at 1.5 MB (the two existing editors enforce their own size ceilings), rejects missing/extra files, changed source hashes/flags, reordered, invented or duplicated Category and Service IDs, invalid Hindi/English proposals, conflicting Category ID/slug drafts, and attempts to forge approved statuses. **Links to GitHub PRs are unverified syntax references only**, never identity or qualified signoff.

## What reviewers can see together

Each original Category appears **once** with original Group/Family, original historical names, the unapproved legacy safety label, prior (17-only) desk assessment or \`NOT_DESK_ASSESSED\`, immutable source diagnostic exceptions, submitted Category ID/slug/title proposal status, submitted Service bilingual-name draft count, submitted occupational scope draft count, specialist concern counts, unresolved cross-Category proposed-name collisions, and explicit **incomplete name/scope evidence** observations. Submitted Service IDs have compact handoff references to the two unverified PR links and proposed concern codes. The queue does **not** silently prefer an original or new parent for a shared phrase.

A Service may *legitimately* have no proposed name correction while still requiring human examination. Therefore \`SERVICE_SCOPES_WITHOUT_NAME_DRAFTS\` is only a coordination note, **not a rule demanding an artificial name edit**. Similarly, evidence for a new label without occupational scope does not mean the trade is approved. A draft mentioning licensing does not prove a regulation applies or a credential is valid. Existing 17 desk candidates are not a launch allowlist. The original 872 untouched Categories remain in scope.

The summary reports both submitted name/scope proposals, paired Service drafts, one-sided draft counts, Categories needing specialist review, cross-Category phrase conflicts and **all 889/7,267 still needing qualified review**. It always reports \`qualifiedLegalReviewsAuthenticated:0\`, \`qualifiedOccupationalReviewsAuthenticated:0\`, \`humanBilingualReviewsAuthenticated:0\`, \`founderCategoryApprovalsAuthenticated:0\`, \`approvedCategoryIds:0\`, \`approvedAliases:0\`, \`categoriesAuthorizedForActivation:0\`, \`servicesAuthorizedForActivation:0\`, \`sqlStatementsGenerated:0\`.

## Independent manual decisions still required

**M-005 NEEDS_DECISION_NOW** for legal/occupational/semantic language verification, exact safe work boundaries, final approved IDs and M-005 first contact, reporting/appeal/verification/moderation policy. **M-003** area and personal-location privacy, **M-004** pre-UI design approval, **M-007** no Cloudflare staging or deployment until production authorization, and **M-008** real OAuth remain separate. The founder's general permission to continue development and include *all legitimate work* is not evidence for these specific decisions. No original 889 records, 7,267 Service aliases or regulated work are activated. No Android visual UI, Cloudflare deploy, customer/worker PII, or Finworkar write.

CI automatically executes \`scripts/catalog-unified-human-review.mjs --check\` through \`reference:check\` and exhaustive mock reviewer validation tests through \`npm test\`, plus all prior Kotlin/JVM, local D1/workerd, TS and documentation gates.
