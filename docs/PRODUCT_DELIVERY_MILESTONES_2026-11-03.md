# JODLO — product-first execution plan (3 November 2026)

**Purpose:** stop confusing repeated green synthetic safety tests with an actual usable marketplace. This delivery plan supersedes the pattern of opening one Pull Request per tiny Agora experiment. It does not discard reviewed safety work.

## Source-of-truth corrections

- **Actual native Android app exists.** `apps/android/app/` contains an Android Compose launcher, Customer Browse/Search/Category/Listing and Worker sign-in/draft/listing screens. The real debug APK is built by `.github/workflows/android-native.yml` under JDK 17 and 21, with a temporary main-branch APK artifact. It is **not** currently a connected, production-ready marketplace. The default APK has **no API origin or Google OAuth client configured**.
- **Visual direction approved 2026-11-02:** [UI_REFERENCE_2026-11-02](UI_REFERENCE_2026-11-02.md) explicitly marks black/green flat-outline visual rules as binding. Older M-004 wording in historical files is stale **only for palette/component direction**, not device accessibility/usability acceptance or functional release approval.
- **Backend source code does more than tests:** Google JWT validation and hashed sessions, private Worker draft and explicit category-only listing publication, Hindi/English Search and keyset browsing, category-filtered public listings, owner-scoped reads/unpublish and safety preflight code exist. The API is **not deployed**, category review/activation is **not finished**, and live Agora, notifications, payments, moderation/reporting and personal location flows are incomplete. A synthetic eligibility result is never a real provider send.
- **True dependency order:** no simulated progress can replace reviewed public Categories and an actual vetted server configuration. Without approved active Categories and reachable backend, default Customer discovery is empty and Worker login is unavailable. Repeated new synthetic call tests will not cure that.

## Delivery method from now on

A **milestone is a usable user journey or concrete production module**, not a test count. Prefer one cohesive PR (or coordinated implementation PRs only when technically necessary) spanning all affected API, Kotlin Core, Android, localization and docs. Define the acceptance evidence at the beginning. Run sufficient targeted tests once and retain the obligatory exact-head Foundation CI; app changes must also pass Android-native APK compilation. After squash merge, independently verify the exact merged-main checks and report what works on a phone, what is mock/demo only, and what remains blocked. Avoid a string of unneeded test-only Agora PRs.

Working order: identify founder-approved scope → implement complete user-visible flow → exercise error states/accessibility/safety → CI/build → merge/verify → next vertical slice. No Cloudflare staging or production deployment; Finworkar remains read-only. Do not claim that green CI is real-device testing.

## Milestone ladder

| Order | Milestone and outcome | Current gate |
| --- | --- | --- |
| **A — CI VERIFIED; PHONE PENDING** | **Offline debug APK Customer preview.** Explicit opt-in sample dataset for existing Compose Browse, Hindi/English Search, Category selection, public listing pages and back/navigation; no network. User can try the flow on a phone and give screen/UX feedback without fabricating production records. | Code/build; this is the present PR |
| **B — IN PROGRESS** | **Live public Customer discovery and genuinely useful worker/service details.** Reuse real catalog, moderated listings, safe listing-detail projections and end-to-end Android states. Do not show worker ID, home address, phone, verification, location or calling availability without exact policy/data selection. | Review/activate Categories safely; M-003/M-005 public disclosure details |
| **C** | **Actual Google Worker onboarding, own listings and reliable mobile sessions.** Existing Android Core/Compose wiring is present. Verify approved HTTPS backend, Google Web OAuth client, Android credential setup, errors/logout and low-end device behaviour. | M-008 provider setup and M-007 release environment; no fake production login |
| **D** | **Direct in-app Agora AUDIO call, end-to-end.** Worker default-OFF consent; server-owned admission, actual presence/busy/rate/blocks/report, D1/DO boundary, signaling, device incoming ring, RTC token issuer, no-duplicate and UNKNOWN reconciliation, tests against fake provider then gated real-provider acceptance. | M-003 retention/export/deletion, M-005 live rules, M-006 provider credentials/policy |
| **E** | **Privacy/admin operational completeness.** Account deletion/export, backups/restores, abuse/appeals/moderation, local service-area consent, secure media/push; no unapproved personal data. | M-003/M-005 decisions and storage design |
| **F** | **Payments and launch.** Define eligible paid product, server-verified ledger/refunds, India UPI/Google Play policy; real-device accessibility/performance, security budgets, production secrets, explicit controlled release. | Payment policy and M-007 release approval; no staging |

**Nonnegotiable product decisions already made:** one account with optional Worker mode, Google Sign-In, Hindi Devanagari + English only (not Romanized Hindi), both Bilaspur and Raipur pilot city names, full 889-category **review target** rather than 10-category limitation, worker self-publication without a fake verification badge, direct **Agora in-app Internet audio** without showing telephone numbers, explicit separate Worker calling opt-in default OFF, approved black/green flat UI. Do not repeatedly ask the founder to choose these again.

**Decisions not yet supplied:** actual public Category approval/activation, service-area and personal-data policy, block-history and call-intent retention/export/deletion, live worker presence/busy and anti-spam numeric thresholds, user-report/appeal process, real provider signaling/ACK and operational credentials, production release acceptance. Broad standing engineering permission does **not** invent values.

## Milestone B first implementation (current PR)

The first cohesive customer discovery step is a published-listing-only filter across **actual** Android Browse, Hindi/English Search and keyset continuation, plus an explicit per-Listing detail tap that rechecks the current server-owned public eligibility using one anonymous API read. The response is the original minimal `id` and `categoryId` allowlist; a useful full Worker profile cannot be invented until M-003/M-005 disclosure and identity policy is chosen. Existing debug sample includes Categories with no synthetic Listings to verify toggle behavior. [Implementation contract and gate](CUSTOMER_PUBLISHED_SERVICE_DISCOVERY_2026-11-03.md). No published unreviewed Categories, real Worker contact, device/provider setup or Cloudflare deploy.

## Acceptance for A (merged PR #199; on-device review pending)

- In **unconfigured debug APK**, Customer tab clearly offers to opt into an **OFFLINE SAMPLE**; it is off by default. The sample uses a bounded, obvious `demo_` namespace and synthetic Category/Listing data. No production D1 Categories, real worker personas or phone numbers are created.
- Customer can browse sample entries, switch Hindi/English, search and select a Category, display public listing entries, load continuation pages, back out and disable the sample. The same production `RemoteCatalogRepository` and strict reply decoder protect sample results; do not implement a second client/network stack.
- The sample does not expose a Worker session, enable Google sign-in, approve publishing, invoke Agora/payments or make any network request. Worker tab remains dependent on a real configured server.
- When the sample is disabled, existing UI data is invalidated and the no-backend message returns. In a build with a configured approved API origin, real source takes precedence and the debug sample option is not shown.
- Android-native PR and main debug APK checks must pass **in addition to** Foundation. Do not represent compilable APK as a verified on-device experience until the founder actually installs/tests it.

**Manual phone step later (not a current engineering blocker):** open the latest successful **main** Android-native workflow artifact and install the debug APK; verify keyboard, screen rotation, font sizes, system back, Hindi and English, offline sample toggling and pagination. No real Google/API credentials need be shared in chat.

Related: [UI reference](UI_REFERENCE_2026-11-02.md), [Android build guidance](../apps/android/app/README.md), [Manual actions](MANUAL_ACTIONS.md), [Release readiness](RELEASE_READINESS.md).
