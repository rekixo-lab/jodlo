# JODLO native Google Play Billing read-only readiness — 11 November 2026

## Engineering milestone (does NOT start checkout)

JODLO's actual Android application now has an **explicitly opt-in Google Play Billing Library 9.1.0** compilation seam. The default APK is unchanged and **does not compile or install this billing adapter**; no owner-approved JODLO Play Console product IDs, prices, paid/free minute rules, refund/debt policies, token exchange endpoint or publicly usable checkout exist. All current payment and debit routes remain disabled. Finworkar is read-only.

## What ships in source

- `apps/android/app/build.gradle.kts`: `-PjodloEnablePlayBilling=true` is the **only** selector for the optional `src/playBilling/kotlin` source folder and dependency `com.android.billingclient:billing:9.1.0`. `BuildConfig.PLAY_BILLING_ENABLED` defaults to `false`. Existing Agora, Firebase and normal/debug builds are unaffected.
- `JodloPlayBillingReadOnlyClient` uses the real Google Play `BillingClient`, pending one-time-product opt-in and automatic service reconnection. Its only capability is connecting, reading unverified one-time purchases, querying ProductDetails for an **explicit nonempty approved SKU set**, and closing its Play connection. It handles PURCHASED, PENDING and OTHER **only as unverified observations**. A response does NOT mint credit.
- The read-only callback never exposes raw purchase tokens, purchase order IDs, claimed prices, Google account identity or payment credentials. The client does not persist purchase data or metadata. The source contains **no `launchBillingFlow`, `acknowledgePurchase` or `consumeAsync`** calls and is **not wired to the app's navigation**.
- The optional library does not create product catalog decisions. An empty or invalid SKU list triggers **no Google Play query**. The real localized prices and available offers must come from the user's own activated Play Console products when that later product is approved.
- `.github/workflows/android-native.yml` now compiles `:app:compileDebugKotlin` with `-PjodloEnablePlayBilling=true` under JDK 21 as a **CI-only build**. Existing JDK17/21 debug APK and optional Agora/FCM builds continue. A Node static contract test also checks default-off behavior and absence of purchase, grant or token-exposing code.

## Release wiring that is still required

1. Owner supplies JODLO Play Console merchant account, actual paid-product IDs and their minute sizes, price decisions, billing eligibility and all user-visible terms. **Historical Finworkar pack sizes are reference only**, not real JODLO SKUs or prices.
2. Secure production app/backend account binding: Android sends obfuscated account hash supplied by a **current authenticated backend session** into `BillingFlowParams`; backend validates Play ProductPurchaseV2, voided purchase history, RTDN, account, SKU and server-chosen amount before any durable credit. Never accept a client-provided amount or token digest as final settlement.
3. Approved actual user-initiated checkout UI, lifecycle-synchronized restore/query, pending purchase UX, verified purchase token exchange to server (token stored only when legal and necessary), and server-initiated consume only **after** a verified idempotent grant. Crash/unknown handling follows migrations 0024, 0025 and 0026.
4. Refund/chargeback and already-spent minute policy, transaction receipts, lawful finance/tombstone retention and account erasure; provider quotas and operational error handling.
5. Cloudflare D1 migration backup/rollback and controlled rollout, Google service account permissions, physical Play test tracks and **one final consolidated real-phone E2E QA**, including full two-device Agora/FCM calling and actual developer-approved catalog activation. Main CI is not proof that newer Worker code has been deployed or that an Android debug APK is production-ready.

## Local verification

Native debug build: `gradle -p apps/android -PincludeAndroidApp=true :app:assembleDebug --no-daemon` (still Play-free).

Opt-in Play SDK compile only: `gradle -p apps/android -PincludeAndroidApp=true -PjodloEnablePlayBilling=true :app:compileDebugKotlin --no-daemon`.

Google Play Billing documentation: https://developer.android.com/google/play/billing/integrate and https://developer.android.com/google/play/billing/migrate-gpblv9

No billing transaction, token exchange, payment activation, remote migration, email or deployment occurred in this milestone.
