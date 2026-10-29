# JODLO — All 889 Category editorial + safety exception register (2026-10-29)

**ADR-0011, OFFLINE REVIEW ONLY.** Founder approved all legitimate kinds of work as the **broad product scope**, not the automatic publication of all historical records. This register joins the SAME source-locked **889 historical Category** and **7,267 original Service** rows already organized into 45 packets. It gives qualified reviewers a concrete diagnostic worklist and preserves 872 not-yet-desk-assessed Categories. It is not a decision that a particular work type is safe, legal, publishable, translated correctly or verified.

## Use the local diagnostic queue

```bash
npm run catalog:exceptions -- --check
npm run catalog:exceptions -- --summary
npm run catalog:exceptions -- --issues
npm run catalog:exceptions -- --issue=HINDI_SERVICE_LATIN_SCRIPT
npm run catalog:exceptions -- --issue=SHARED_SERVICE_PHRASE_PARENTS
npm run catalog:exceptions -- --issue=DESK_SPECIALIST_HOLD
npm run catalog:exceptions -- --packet=1
npm run catalog:exceptions -- --category=farmer-helper-मजदूर
npm run catalog:exceptions -- --all
npm run reference:check
npm test
```

`--summary` exposes machine-evidence counts per diagnostic kind, including number of affected **Categories** and number of source **Service rows**. A Service can have more than one issue, so do not sum issue counts as unique Services. `--issues` filters to Categories with at least one detected diagnostic. **It deliberately does not replace `--all`: an unflagged Category still has mandatory human safety and bilingual review, and is not approved.** Every issue links its relevant original Service IDs; use the existing full-Service viewer (`npm run catalog:full-service-evidence -- --category=OLD_ID`) for exact original names, parent choices and flags.

## Meaning of diagnostic codes

| Diagnostic | Why inspect |
| --- | --- |
| `CATEGORY_ID_SYNTAX`, `CATEGORY_SLUG_SYNTAX`, `CATEGORY_LABEL_SYNTAX` | Original source identifier/slug or Category display label needs human-compatible mapping/wording review against the current D1 syntax |
| `HISTORICAL_CATEGORY_FLAGS` | Historical Group/Family/Category consistency or other legacy issue; original flag strings retained, never interpreted as approval |
| `HINDI_SERVICE_LATIN_SCRIPT` | Old Hindi Service text contains Latin characters; human Devanagari semantics required, never auto-transliterate |
| `SERVICE_ID_POLICY` | Historical Service ID is incompatible with the existing Category ID comparison; **a Service ID policy is not yet approved** |
| `SHARED_SERVICE_PHRASE_PARENTS` | An exact normalized bilingual Service phrase belongs to multiple source Categories; do not merge or auto-pick a trade |
| `UNVERIFIED_SECTION_REFERENCE` | Historical Service references a Section without an independently verified Section catalog |
| `DESK_EXTRA_REVIEW` | One of the first 17 *preliminary* human-review candidates was previously marked for extra review, not an expert signoff |
| `DESK_SPECIALIST_HOLD` | One of the first 17 was previously held for specialist policy review; do not override that hold |

**Safety boundary:** Archived `historicalSafetyTierNotAnAuthorization` is only a source label and **never becomes a modern risk or legal classification**. This script does NOT guess a safety tier for the other 872 Categories. Every Category (even without any diagnostics) remains `HUMAN_LANGUAGE_SAFETY_MAPPING_AND_FOUNDER_REVIEW_PENDING`. The same prior 17 desk opinions stay unchanged: **10 narrow recommendations (not approvals), 4 extra reviews, 3 specialist holds**. The founder does not have to choose 889 Category IDs one at a time; qualified people can review all 45 packets and escalate actual policy exceptions.

## Data integrity / fail-closed behavior

The script calls the already pinned full 45-packet/7,267-Service/14,534 localized phrase review and the existing independently source-validated first-17 scope review. It rejects missing, duplicate, reordered, forged-approved records, parent/flag count mismatches and altered desk safety tier. Source names and ID flags are shown as found; this does **not** provide a corrected Hindi translation, final source-to-JODLO mapping, human reviewer authentication, proof of lawfulness or approval to offer work. The `--check` mode is wired into `npm run reference:check` and regressions into `npm test`.

**Always zero:** authenticated human/founder signoffs, approved aliases, activated Categories and Services, generated SQL, D1 seeds and public Search imports. No new API route, Android/UI, contact, personal location, Cloudflare staging/production or Finworkar changes. Existing M-003 area privacy, M-004 visual design, **M-005 safety/final mapping/contact/moderation**, M-007 production and M-008 live OAuth decisions remain independent. Human reviewers must inspect actual legal/safety requirements and original work scopes; no automated diagnostic can substitute for that.
