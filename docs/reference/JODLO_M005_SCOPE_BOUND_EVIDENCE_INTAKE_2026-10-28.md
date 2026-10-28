# JODLO M-005 — Category-bound human review evidence intake (2026-10-28)

**Status: local-only human review submission template and validation, NOT approval, identity authentication, permission or D1 activation.** Implements the practical missing step between [17 scoped historical work proposals](JODLO_M005_FIRST_17_SCOPE_REVIEW_2026-10-28.md), the [official regulatory review checks](JODLO_M005_OFFICIAL_SAFETY_CROSSWALK_2026-10-28.md) and a possible **later independently authenticated** Founder M-005 decision.

## Reviewer workflow (not a UI)

An editor can focus on **one actual Category** without reviewing all 889 at once:

```bash
npm run catalog:m005-evidence-card -- --category=plumber
npm run catalog:m005-evidence-summary
npm run catalog:m005-evidence-template > m005-review-draft.json
```

The first command prints a single **pending** evidence record bound to the exact old ID. `--category=electrician` also works, but DOES NOT lift its specialist hold. The full template includes all **17 real reviewed Category IDs**, not a fixed ten-trade launch limit. The other 872 Categories remain in their own 45 review packets; extending actual M-005 work requires source-specific assessment and official-source checks, never arbitrary import.

The output contains a SHA-256 fingerprint of **the complete English/Hindi positive and excluded work scope, original Category risk tier, exact Service evidence, source archive SHA and current official reviewer requirements**. It has four distinct pending external gates: qualified legal/occupational safety, human bilingual language, operations moderation/consent/complaints, and **Founder approval of an exact Category and scope**. These are independent duties, not statuses this script can award.

When there is externally created and authorized review evidence, a human may copy the template to a **local untracked JSON file**, change only an individual `status` from `NOT_SUBMITTED` to `EVIDENCE_LINKED_UNVERIFIED` and include a specific link to the corresponding JODLO GitHub PR or PR comment. The validator accepts such **link submissions** as unverified metadata only:

```bash
node scripts/m005-scope-bound-review-intake.mjs --validate-file=m005-review-draft.json
```

**Do not include sensitive identity, licences, phone numbers, household addresses or customer/device contents** in the JSON or public PR comments. Experts should keep sensitive underlying evidence in an approved private process and share only a suitable reference. The validator cannot determine whether a link's author is the claimed reviewer, whether the linked document exists or whether any legal or safety conclusion is correct. Changing the scope or government risk tasks makes the old SHA obsolete.

## Absolute non-activation boundary

Even if **all four links** are filled in, the output still reports:

- `qualifiedHumanSignoffsAuthenticated: 0`
- `founderApprovalsAuthenticated: 0`
- `authorizedCategories: 0`
- `activatedCategories: 0`

A GitHub URL is **never** cryptographic proof or authorization. `EVIDENCE_LINKED_UNVERIFIED` must not be mistaken for `APPROVED`. The tool rejects extra approval/publish/is_active fields, fabricated completed gates, unknown/duplicate IDs, altered signoff sets, stale fingerprints, nonsource locales and off-domain or deceptive URLs. This is a strict **intake of proof to be independently checked**, not the actual verification/signing mechanism.

A separate human-verified and Founder-approved future process must decide specific category scopes and safe IDs under **M-005**, and only then may any independent controlled D1 activation be designed. M-003 personal locality/consent, M-004 user-facing visuals and M-007 cloud launch remain separate. Existing ADR-0009 instant self-publication stays limited to **already independently approved-active** JODLO Categories. No new API route, D1 migration, live alias import, Android UI or remote deployment in this PR.

## Tests

`npm run reference:check`, `npm run catalog:m005-evidence-summary` and `npm test`. Regression coverage includes single-category reviewer cards, four unverified links never producing activation, stale-scope digest invalidation, foreign/phishing links, fabricated signoffs, duplicate IDs and change of founder gates. This is strictly local engineering, not human expert validation.
