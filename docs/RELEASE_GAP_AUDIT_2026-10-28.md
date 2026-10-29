# JODLO — release-readiness gap audit (2026-10-28)

**Decision:** NOT READY FOR PRODUCTION. This is a source/CI evidence audit, **not** a release or permission to ship. JODLO is completely separate from Finworkar. The latest independently verified pre-audit main at the start of this work was `0e49740cb5bb2c8eaeb05869a6bf678e89befe15`, [GitHub Actions #40691727089](https://github.com/rekixo-lab/jodlo/actions/runs/40691727089), completed success. Evidence from that run: **211 Node tests**, **21 executable Kotlin/JVM suites**, local D1 migration/bundle, strict TypeScript, founder/design/reference/docs guards and nondeploy Worker dry-run. This audit itself needs separate PR and exact new main CI verification.

## Current implementation evidence versus missing acceptance

| Area | Verified source and CI scope | Release gap / no completion claim |
|---|---|---|
| Cloudflare Worker API | `apps/api/src/modules/` includes identity/session, Catalog, Worker Draft/Listing, public discovery and restricted interaction contracts; 211 Node tests previously green | Full contact workflow and operational moderation/abuse/admin protections, verified billing/RTC/notifications and production authorization review **not shown complete** by the current tests |
| D1 | `infra/migrations/0001`–`0004` applied locally; local Worker bundling in CI | A synthetic local SQLite backup/independent-restore rehearsal is now executable in Node CI (PR #85); **still no Cloudflare D1 managed recovery rehearsal**, production backup evidence, defined RTO/RPO, realistic load/performance, cross-device end-to-end or production D1 availability proof |
| Android Core | `apps/android/core` has typed networking/session, explicit Worker writes, Customer Discovery, safe presentation and lifecycle tests; 21 executable Kotlin suites previously green | Only Kotlin/JVM core; **no Android `:app` APK**, Manifest, approved visual UI/theme, real device scheduler, actual provider Sign-In, on-device or accessibility/performance evidence |
| Contract integration | Local shared-fake Customer–Worker publication, uncertainty, logout/account-switch/expiry races tested | No actual backend rollout, Play policy review, real device network/latency testing or end-to-end remote transaction/queue evidence |
| Security and privacy | Founder guard, strict Hindi (Devanagari) and English, explicit Category selection; no precise GPS/contact/data exposure allowed | Pending founder M-003 locality/privacy, M-004 visual design, M-005 active taxonomy/interaction, M-008 provider setup, M-007 later production-only approval |
| Release operations | Versioned docs/gates/roadmap exist; CI is merge SHA-specific | Release candidate, dependency/security audit, migration/rollback dress rehearsal, monitoring, secrets, DNS/TLS, controlled production smoke and recovery **not complete** |

The checklist of record remains [RELEASE_READINESS.md](RELEASE_READINESS.md); this table is a **gap ledger**, not a replacement or an automatic approval.

## CI regression gap identified and resolved by this change

Before this audit, the workflow manually listed every `:core:verify*` Kotlin JVM suite, so a new Kotlin test `fun main()` could go unregistered/omitted while CI remained green. A new **single** `:core:verifyHeadlessCore` Gradle task lazily depends on **all** registered `verify*` `JavaExec` suites; the workflow executes that task instead of maintaining a fragile 21-item list. `npm run kotlin:coverage-check` independently inventories every executable Kotlin `fun main()` test file and registered verifier, fails on missing/duplicate/dangling mappings or a missing aggregate CI command, and enforces the existing 21-suite floor. Its Node negative tests deliberately inject omissions and prove a failure is detected. The check proves **suite wiring and execution**, **not** statement/branch coverage, feature completeness or release readiness. When adding a new Kotlin executable suite, register a matching `verify*` JavaExec task once; no workflow copy/paste.

## Sequenced next steps and owner gates

1. **Now, automatable, no owner decision:** keep extending existing headless Kotlin/API validation and local D1 simulation only where tests expose a concrete missing contract; add release evidence rather than duplicate state machinery. Keep CI aggregate/inventory guard green.
2. **Founder M-004, before any UI work:** approve visual design, tokens, navigation/motion and accessibility baseline. Only then build the native Android `:app` and real device tests; do not infer approval from this audit.
3. **Founder M-005, before active Category/customer interactions:** approve actual live taxonomy, publish/contact/request boundaries and review flow. Pilot city **names** Bilaspur and Raipur are already selected, **not** permission to activate Categories or service areas.
4. **Founder M-003 and M-008, when those integrations become necessary:** separately decide consent-based area/privacy behavior and approve actual Android-native Google provider console/SHA/client setup. No personal location or credentials added now.
5. **Infrastructure/provider code completion:** locally mock/test R2, Queues, notifications, RTC, payments, moderation and deletion using the existing source contracts, then evidence-based migration/restore, performance/security/device checks. Avoid staging and remote provisioning.
6. **Founder M-007, only at product-ready production release:** review final release candidate, budget, policy, backup/recovery, release protection, DNS and credentials. A green CI alone never approves deployment.

**Current action:** no new founder manual intervention is required for this specific source-only audit. The pending gates remain unresolved and will be raised when their dependent implementation reaches its actual decision point. Never request secrets or authorize staging/deployment from this document.


## 2026-10-29 — Narrow local backup/restore gap closure (PR #85)

PR #85 adds a real Node `node:sqlite` point-in-time backup and separate-file restore test for the **existing four disposable local migrations**. The test verifies database integrity and FK relationships plus restored signed-in/anonymous HTTP behaviors (including moderator-hidden listing and Google session-hash boundaries). This supersedes only the earlier statement that **no local backup/restore rehearsal exists**. It does not create a backup tool or emergency runbook for Cloudflare's managed D1, restore production data, demonstrate provider or cross-region reliability, set RTO/RPO or resolve privacy, legal, Android-device and launch gates. Preserve the unchecked production release items in `RELEASE_READINESS.md`; verify PR and exact merged-main CI before treating the test as installed.

## 2026-10-29 — Local workerd/D1 HTTP smoke (PR #86)

Adds a separate **real locally hosted workerd** contract check, beyond in-process fake-D1 API tests and Wrangler dry-run build: isolated temporary D1 persistence, existing migrations, synthetic public/hidden listings, actual HTTP catalogue/Search/listings requests and auth-fail-closed responses. CI must execute the script on the exact PR head and merged main before it is reported verified. This narrows the **local runtime coverage** gap only. No actual Cloudflare-managed D1, live auth, managed recovery, remote rate limiting, Android device, contacts/moderation operations or production readiness evidence is added; all founder gates remain unchanged.
