# Android release-candidate build gate — 21 November 2026

## Reason

The main Android Gradle module previously allowed `:app:assembleRelease` or
`:app:bundleRelease` even though its ordinary build defaults to an empty API
origin, empty Google Web OAuth ID, development version `0.1.0-dev`, and no
verified signed production release configuration. A successfully compiled APK
is **not** evidence of an approved, functioning production Marketplace.

## Enforced source boundary

- The Android Gradle release variant is **disabled by default** through the
  Android Components `beforeVariants` API. Ordinary `:app:assembleDebug`,
  Kotlin Core, optional Agora, FCM and read-only Play SDK compilation remain
  available, including offline CI configurations.
- To enable a **candidate** variant, a trusted operator must explicitly set
  `jodloReleaseCandidate=true` plus the exact dedicated
  `jodloApiOrigin=https://api.jodlo.rekixo.com`, a nonempty public
  `jodloGoogleWebClientId` matching Google's web-client-ID shape,
  `jodloReleaseVersionName` as numeric `major.minor.patch`, and
  `jodloReleaseVersionCode` as an integer from 2 to 2,100,000,000.
- The release candidate receives those **explicit** version values. Debug
  builds retain their previous `1` / `0.1.0-dev` values by default.
- GitHub Android CI tests that the unconfigured release tasks do not exist
  and that asking for a candidate without owner configuration fails with the
  expected reason. Node regression tests also enforce source invariants.
- This does **not** implement app signing, upload to Play, release approval,
  contract verification against a real deployed Worker, phone acceptance,
  catalog review, Firebase/Agora delivery or Play Billing. The build cannot
  grant any of those statuses. Do **not** put signing keys, OAuth secrets or
  Google service-account JSON in GitHub.

## Later operator checklist (not an instruction to deploy now)

1. First confirm current Cloudflare Worker/D1 migrations, backup and rollback,
   separate from the GitHub SHA, and actual API domain/TLS.
2. Complete human Catalog review, real provider checks, Privacy/Terms,
   moderation, billing and full Customer-to-Worker end-to-end features.
3. Agree on distinct Play version code/name, build signing and release track,
   approved public Google Web Client ID, and correct provider configuration.
4. On an owner-controlled workstation only, supply the public Gradle
   properties through private local configuration. A release-candidate build
   remains **unsigned/unapproved for public distribution** until operator
   signing, Play policy and one consolidated real-device acceptance succeed.
5. Keep production deployment and migration a separately authorized
   action—never a CI push side effect, never a Finworkar write.

Related: [release readiness](RELEASE_READINESS.md),
[manual actions](MANUAL_ACTIONS.md),
[real-provider connection runbook](REAL_PRODUCTION_CONNECTION_RUNBOOK_2026-11-03.md).
