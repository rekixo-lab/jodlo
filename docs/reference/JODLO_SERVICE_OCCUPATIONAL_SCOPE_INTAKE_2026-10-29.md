# JODLO — All 7,267 Service occupational scope intake (2026-10-29)

**Human evidence intake only · ADR-0011 · NO PUBLIC APPROVAL.** The founder requires all legitimate trades, not an arbitrary ten-category limit. Historical coverage is **889 Categories, 7,267 Service leaves, 45 full review packets**, including 872 Categories not yet desk-assessed. Previous review tools covered Category corrections, Service Hindi/English *names*, repeated cross-trade phrases and the 17 preliminary M-005 legal cards. They did not provide a source-pinned, per-Service draft for what work may be offered, must be excluded, or requires qualification.

This new OFFLINE validator creates that missing *human scope drafting* surface across all original Services. It **does not decide whether a task is legal/safe** or identify required qualifications automatically. It does not change the source archive, activate a Category, provide a trust badge, import vocabulary, write SQL, store customer/worker data, or authenticate anyone. Only qualified human/legal/linguistic reviewers can later inspect the proposals, and M-005 founder scope/contact/moderation gates still apply.

## Inspect and prepare all 45 packet templates

Run at repository root:

~~~bash
npm run catalog:service-scope -- --check
npm run catalog:service-scope -- --summary
npm run catalog:service-scope -- --packet=1 > .local-category-review/service-scope-packet-01.json
npm run catalog:service-scope -- --packet=45 > .local-category-review/service-scope-packet-45.json
npm run catalog:service-scope -- --validate-file=.local-category-review/service-scope-packet-01.json
npm run reference:check
npm test
~~~

Create the already-gitignored \`.local-category-review/\` directory locally before redirecting a template. Generate packet numbers 1–45, **not just the earlier ten examples**. No 45 draft files are checked into GitHub; they should be kept in a restricted reviewer workspace. Each packet contains its complete, stable original Category/Service rows and source SHA, not a truncated three-example selection. Packet files must be real, ≤1.5 MB, beneath the repository root and not symlinks. Validation rejects reordered, removed, added or modified historical records.

## Reviewer-draft fields

A source Service keeps immutable \`sourceServiceId\`, \`sourceServiceSha256\`, original English/Hindi names, original unresolved flags, and candidate parent Categories in each locale. For an **unsubmitted** leaf, all six proposal fields must be \`null\`, \`concernCodes:[]\`, \`status:"NOT_SUBMITTED"\` and \`evidenceUrl:null\`.

For a proposed scope, fill **all six** separate human-written text fields (no auto-translation):

| Field | Human reviewer should describe |
| --- | --- |
| \`includedEn\`, \`includedHi\` | What the Service would actually include (English, Devanagari Hindi) |
| \`excludedEn\`, \`excludedHi\` | Work that the description does not authorize or claim to cover |
| \`prerequisitesEn\`, \`prerequisitesHi\` | Potential qualifications, licensing, specialist/legal review and other preconditions **to independently verify** |

Optionally choose sorted, unique, **non-certifying** \`concernCodes\`: \`REGULATION_OR_LICENSING_REVIEW\`, \`SPECIALIST_QUALIFICATION_REVIEW\`, \`PHYSICAL_SAFETY_REVIEW\`, \`PRIVACY_AND_CONTACT_REVIEW\`, \`UNCLEAR_WORK_BOUNDARY\`, \`OTHER_SPECIALIST_REVIEW\`. Empty concerns **never imply safe work or no licensing requirements**. Then set \`status:"EVIDENCE_LINKED_UNVERIFIED"\` and link an actual JODLO GitHub PR or approved-style PR-comment reference in \`evidenceUrl\`. That URL format is syntax-checked, **not** authenticated as qualified review evidence. Do not place private case details in PR comments or JSON.

The tool checks normalized strings, field lengths, Hindi script only for Hindi fields (no Hinglish), English only for English fields, and strictly rejects unknown or extra fields, public approval claims, fake statuses, escaped paths, symlinks and external URLs. The **original historical SafetyTier remains an unapproved legacy label**, not an automated 2026 legal/safety judgment. Even a fully filled form returns \`qualifiedLegalReviewsAuthenticated:0\`, \`qualifiedSafetyReviewsAuthenticated:0\`, \`humanBilingualReviewsAuthenticated:0\`, \`founderCategoryApprovalsAuthenticated:0\`, \`servicesAuthorizedForActivation:0\`, \`categoriesAuthorizedForActivation:0\` and \`sqlStatementsGenerated:0\`.

## Remaining independent gates

The existing first-17 \`catalog:m005-evidence-*\` tool remains separate; it has no standing to approve the other 872 or these 7,267 Service scopes. Qualified legal/occupational and bilingual people must confirm the exact Service boundaries, any local regulations/credentials, appropriate safe exclusions and final reversible JODLO mappings, and the founder must approve the final Category/contact/moderation policy before activation. M-003 personal location/privacy, M-004 visual UI, M-007 final production-only deploy and M-008 real OAuth setup are unaffected.

CI runs source-locked \`--check\` in \`reference:check\` and regression tests under \`npm test\`, alongside compiled Kotlin, D1 and local workerd tests. **No original Category/Service has been approved or seeded by this implementation.** Finworkar is not edited.
