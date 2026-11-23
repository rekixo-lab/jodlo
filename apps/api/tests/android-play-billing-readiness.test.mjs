import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appPath = new URL("../../android/app/", import.meta.url);
const readApp = path => readFileSync(new URL(path, appPath), "utf8");
const workflow = readFileSync(
  new URL("../../../.github/workflows/android-native.yml", import.meta.url), "utf8");

test("Play Billing is absent from default JODLO APK and only compiles with explicit opt-in",()=>{
  const gradle=readApp("build.gradle.kts");
  assert.match(gradle,/val playBillingEnabled = providers\.gradleProperty\("jodloEnablePlayBilling"\)\.orNull == "true"/);
  assert.match(gradle,/if \(playBillingEnabled\) \{\s*java\.srcDir\("src\/playBilling\/kotlin"\)/);
  assert.match(gradle,/else \{\s*java\.srcDir\("src\/noPlay\/kotlin"\)/);
  assert.match(gradle,/if \(playBillingEnabled\) implementation\("com\.android\.billingclient:billing:9\.1\.0"\)/);
  assert.match(gradle,/buildConfigField\("boolean", "PLAY_BILLING_ENABLED", playBillingEnabled\.toString\(\)\)/);
  assert.doesNotMatch(gradle,/buildConfigField\("String", "PLAY_PRODUCT/);
  assert.match(workflow,/-PincludeAndroidApp=true -PjodloEnablePlayBilling=true :app:compileDebugKotlin/);
});

test("opt-in native billing adapter is read-only and cannot mint or activate paid minutes",()=>{
  const code=readApp("src/playBilling/kotlin/com/rekixo/jodlo/JodloPlayBillingReadOnlyClient.kt");
  assert.match(code,/PendingPurchasesParams\.newBuilder\(\)\.enableOneTimeProducts\(\)\.build\(\)/);
  assert.match(code,/\.enableAutoServiceReconnection\(\)/);
  assert.match(code,/BillingClient\.ProductType\.INAPP/);
  assert.match(code,/queryProductDetailsAsync/);
  assert.match(code,/queryPurchasesAsync/);
  assert.match(code,/Purchase\.PurchaseState\.PENDING/);
  assert.match(code,/Purchase\.PurchaseState\.PURCHASED/);
  assert.match(code,/approvedIds\.isEmpty\(\)/);
  for(const forbidden of [
    /\blaunchBillingFlow\s*\(/,
    /\backnowledgePurchase\s*\(/,
    /\bconsumeAsync\s*\(/,
    /\bgetPurchaseToken\s*\(/,
    /\bgetOrderId\s*\(/,
    /\.orderId\b/,
    /\bcom\.razorpay\b/,
    /\bstartActivityForResult\s*\(/,
  ]) assert.doesNotMatch(code,forbidden,"native SDK source must not launch, settle or disclose purchase");
  assert.match(code,/PURCHASED is still NOT a server-verified JODLO entitlement/);
});

test("read-only Play restore is approved-SKU scoped and distinguishes offline from none",()=>{
  const code=readApp("src/playBilling/kotlin/com/rekixo/jodlo/JodloPlayBillingReadOnlyClient.kt");
  assert.match(code,/approvedProductIds: Set<String>/);
  assert.match(code,/approvedProductIds\.toSet\(\)\.takeIf/);
  assert.match(code,/ids\.isNotEmpty\(\) && ids\.size <= 16/);
  assert.match(code,/ids\.size != 1 \|\| ids\.single\(\) !in approvedIds/);
  assert.match(code,/internal sealed interface ReadResult<out T>/);
  assert.match(code,/data class Available<T>\(val items: List<T>\)/);
  assert.match(code,/data object Unavailable/);
  assert.match(code,/if \(closed \|\| !client\.isReady \|\| approvedIds\.isEmpty\(\)\)/);
  assert.match(code,/callback\(ReadResult\.Unavailable\)/);
  assert.match(code,/callback\(ReadResult\.Available\(result\.items\.mapNotNull\(::unverified\)\)\)/);
  assert.match(code,/if \(closed\) return@queryPurchasesAsync/);
  assert.match(code,/if \(closed\) return@queryProductDetailsAsync/);
  assert.doesNotMatch(code,/callback\(emptyList\(\)\)/);
});


test("opt-in Play price preview uses ONLY Play ProductDetails, never an old INR price",()=>{
  const code=readApp("src/playBilling/kotlin/com/rekixo/jodlo/JodloPlayBillingReadOnlyClient.kt");
  assert.match(code,/private fun queryApprovedProductDetails\(/);
  assert.match(code,/fun queryApprovedOneTimeProductIds\(/);
  assert.match(code,/fun queryLocalizedOneTimePrices\(/);
  assert.match(code,/product\.oneTimePurchaseOfferDetailsList\?\.singleOrNull\(\)/);
  assert.match(code,/offer\?\.formattedPrice/);
  assert.match(code,/if \(price\.isNullOrBlank\(\) \|\| price\.length > 64/);
  assert.match(code,/ReadResult\.Unavailable/);
  for(const forbidden of [
    /amountInr|amountPaise|priceInr|pricePaise/,
    /"₹[0-9]+"/,
    /"Rs\s*[0-9]+"/,
    /Razorpay|com\.razorpay/,
    /\blaunchBillingFlow\s*\(/,
    /\bconsumeAsync\s*\(/,
    /\backnowledgePurchase\s*\(/,
  ]) assert.doesNotMatch(code,forbidden,
    "no invented price or active paid action in the preview source");
});


test("Play proof handoff is strictly owner-bound, one-shot, redacted and never settles money",()=>{
  const code=readApp("src/playBilling/kotlin/com/rekixo/jodlo/JodloPlayBillingReadOnlyClient.kt");
  assert.match(code,/internal class OwnerBoundUnverifiedProof/);
  assert.match(code,/@Synchronized\s+fun submitOnceToServer/);
  assert.match(code,/secretToken = null/);
  assert.match(code,/OwnerBoundUnverifiedProof\(<redacted>\)/);
  assert.match(code,/purchase\.accountIdentifiers\?\.obfuscatedAccountId != binding/);
  assert.match(code,/purchase\.purchaseToken/);
  assert.match(code,/inspected\.state != PurchaseState\.PURCHASED \|\| inspected\.acknowledged/);
  assert.match(code,/!VALID_PURCHASE_TOKEN\.matches\(purchase\.purchaseToken\)/);
  assert.match(code,/fun queryOwnerBoundUnverifiedProofs\(/);
  assert.match(code,/!VALID_ACCOUNT_BINDING\.matches\(accountBinding\)/);
  assert.match(code,/private fun queryOneTimePurchases\(/);
  assert.match(code,/queryOneTimePurchases \{ result ->/);
  assert.match(code,/onUnverifiedPurchases\(purchases\.mapNotNull\(::unverified\)\)/);
  for(const unsafe of [
    /fun\s+launchOwnerBoundCheckout/,
    /\blaunchBillingFlow\s*\(/,
    /\bconsumeAsync\s*\(/,
    /\backnowledgePurchase\s*\(/,
    /"₹\s*[0-9]+"/,
    /private val cachedPurchaseToken/,
  ])assert.doesNotMatch(code,unsafe);
});


test("debug-only Android checkout is gated and cannot be bundled into an approved release",()=>{
  const gradle=readApp("build.gradle.kts");
  assert.match(gradle,/val playCheckoutEnabled = providers\.gradleProperty\("jodloEnablePlayCheckout"\)\.orNull == "true"/);
  assert.match(gradle,/!playCheckoutEnabled \|\| \(playBillingEnabled && !releaseCandidateRequested/);
  assert.match(gradle,/buildConfigField\("boolean", "PLAY_CHECKOUT_ENABLED", playCheckoutEnabled\.toString\(\)\)/);
  assert.doesNotMatch(workflow,/-PjodloEnablePlayCheckout=true/);
  // The standard app never imports, invokes or exposes the opt-in engine.
  const app=readApp("src/main/java/com/rekixo/jodlo/MainActivity.kt");
  assert.doesNotMatch(app,/JodloPlayCheckoutController|prepareAndLaunchOwnerBoundCheckout/);
});

test("debug checkout reuses ONE BillingClient, no stale price or duplicate payment starts",()=>{
  const shared=readApp("src/playBilling/kotlin/com/rekixo/jodlo/JodloPlayBillingReadOnlyClient.kt");
  const engine=readApp("src/playBilling/kotlin/com/rekixo/jodlo/JodloPlayCheckoutController.kt");
  assert.match(shared,/private val checkout(?:: JodloPlayCheckoutController)? by lazy/);
  assert.match(shared,/JodloPlayCheckoutController\(\s*client, approvedIds, ::queryApprovedProductDetails, ::ownerBoundProof/);
  assert.match(shared,/if \(!closed\) checkout\.onPurchaseUpdated\(result,purchases\)/);
  assert.match(shared,/checkout\.invalidateSession\(\)/);
  assert.match(engine,/if \(!BuildConfig\.PLAY_CHECKOUT_ENABLED\)/);
  assert.match(engine,/!validJodloPlayAccountBinding\(currentServerBinding\)/);
  assert.match(engine,/!validGoogleFormattedPrice\(displayedGooglePrice\)/);
  assert.match(engine,/reviewFreshGooglePlayOffer\(/);
  assert.match(engine,/\.oneTimePurchaseOfferDetailsList\?\.singleOrNull\(\)/);
  assert.match(engine,/attempt\.launchStarted = true/);
  assert.match(engine,/sessionInvalidated = true/);
  assert.match(engine,/activity\.runOnUiThread/);
  assert.match(engine,/\.setProductDetails\(product!!\)/);
  assert.match(engine,/\.setOfferToken\(\(review as PlayOfferReview\.Ready\)\.offerToken\)/);
  assert.match(engine,/\.setObfuscatedAccountId\(attempt\.binding\)/);
  assert.match(engine,/billing\.launchBillingFlow\(activity,params\)/);
  assert.match(engine,/Event\.VerifyWithCloudflare\(proof\)/);
  assert.match(engine,/Event\.Pending/);
  assert.match(engine,/Event\.RestoreManually/);
  assert.match(engine,/BillingClient\.BillingResponseCode\.USER_CANCELED/);
  for (const code of [shared,engine]) {
    for(const forbidden of [
      /\bconsumeAsync\s*\(/,
      /\backnowledgePurchase\s*\(/,
      /\bgetOrderId\s*\(/,
      /Razorpay|com\.razorpay/,
      /"₹[0-9]+"/,
      /grantTrusted|recordTrustedCallCreditEvent|availableSeconds\s*\+\=/,
      /setObfuscatedAccountId\(accountId\)/,
      /BillingFlowParams\.newBuilder\(\)\s*\.build\(\)/,
    ]) assert.doesNotMatch(code,forbidden,
      "checkout code cannot invent prices, auto-grant credits or skip account proof");
  }
  assert.equal((shared+engine).match(/BillingClient\.newBuilder\(/g)?.length,1);
  assert.equal((shared+engine).match(/billing\.launchBillingFlow\(/g)?.length,1);
});

test("pure checkout review is defined once in Kotlin Core and rejects changed Google price",()=>{
  const core=readFileSync(new URL("../../android/core/src/main/kotlin/com/rekixo/jodlo/core/network/PlayCheckoutOfferReview.kt",import.meta.url),"utf8");
  const tests=readFileSync(new URL("../../android/core/src/test/kotlin/com/rekixo/jodlo/core/network/PlayMinutePackContractTest.kt",import.meta.url),"utf8");
  assert.match(core,/fun reviewFreshGooglePlayOffer\(/);
  assert.match(core,/validJodloPlayAccountBinding\(serverAccountBinding\)/);
  assert.match(core,/freshProductId != requestedProductId/);
  assert.match(core,/freshFormattedGooglePrice != previouslyDisplayedGooglePrice/);
  assert.match(core,/freshOfferToken\.isNullOrBlank\(\)/);
  assert.match(core,/fun validGoogleFormattedPrice\(/);
  assert.match(tests,/playCheckoutOfferContractIsStrictAndHasNoLocallyInventedPrice\(\)/);
});


test("private account minute dashboard is owner-fenced and has no hardcoded money or checkout",()=>{
  const dashboard=readApp("src/main/java/com/rekixo/jodlo/AccountDashboard.kt");
  const screen=readApp("src/main/java/com/rekixo/jodlo/PrivatePlayMinuteAccountSection.kt");
  const session=readFileSync(
    new URL("../../android/core/src/main/kotlin/com/rekixo/jodlo/core/network/InMemorySessionCoordinator.kt",import.meta.url),"utf8");
  const decoder=readFileSync(
    new URL("../../android/core/src/main/kotlin/com/rekixo/jodlo/core/network/JodloReplyDecoder.kt",import.meta.url),"utf8");
  assert.match(dashboard,/AccountPane\.PURCHASE_STATUS -> \{\s*PrivatePlayMinuteAccountSection\(session, busy\)/);
  assert.match(screen,/session\.accountPrivateReadMarker\(\)/);
  assert.match(screen,/remember\(session,marker\)/);
  assert.match(screen,/session\.playAccountOverview\(owner\)/);
  assert.match(screen,/PrivatePlayMinuteAccountSnapshot\.confirmed\(owner,now,result\)/);
  assert.match(screen,/snapshot = null/);
  assert.match(screen,/current\.catalog\.packs/);
  assert.match(screen,/stringResource\(R\.string\.play_overview_balance/);
  assert.match(session,/fun playAccountOverview\(/);
  assert.match(session,/JodloRoutes\.playAccountOverview\(token\)/);
  assert.match(session,/JodloReplyDecoder::playAccountOverview/);
  assert.match(session,/consistentRead = true, expectedOwner = owner/);
  assert.match(decoder,/private fun playCatalog\(data: JsonObject\)/);
  assert.match(decoder,/fun playAccountOverview\(reply: TransportReply\)/);
  for(const forbidden of [
    /launchBillingFlow\s*\(/,
    /acknowledgePurchase\s*\(/,
    /consumeAsync\s*\(/,
    /purchaseToken/,
    /paymentReceipt/,
    /priceInr|pricePaise|amountInr|Razorpay/,
    /"₹[0-9]+"/,
    /availableSeconds\s*\+\=/,
  ]) assert.doesNotMatch(screen,forbidden,
    "account preview is read-only and must not invent prices or grant credit");
  for(const locale of ["values","values-hi"]) {
    const strings=readApp("src/main/res/"+locale+"/strings.xml");
    for(const resource of ["play_overview_readonly_notice","play_overview_refresh",
      "play_overview_balance","play_overview_packs_title","play_overview_price_pending"])
      assert.ok(strings.includes('name="'+resource+'"'));
  }
});


test("manual Play restore has a separate default-off, non-release build gate",()=>{
  const gradle=readApp("build.gradle.kts");
  assert.match(gradle,/val playRestoreEnabled = providers\.gradleProperty\("jodloEnablePlayRestore"\)\.orNull == "true"/);
  assert.match(gradle,/!playRestoreEnabled \|\| \(playBillingEnabled && !releaseCandidateRequested/);
  assert.match(gradle,/buildConfigField\("boolean", "PLAY_RESTORE_ENABLED", playRestoreEnabled\.toString\(\)\)/);
  // Synthetic QA compilation explicitly exercises the only visible restore
  // screen, while a separate CI step proves it cannot ship in release.
  assert.match(workflow,/Compile manual Play restore UI in isolated configured QA debug mode/);
  assert.match(workflow,/-PjodloEnablePlayBilling=true -PjodloEnablePlayRestore=true/);
  assert.match(workflow,/Reject restored purchase UI in release candidates even with credentials/);
  const app=readApp("src/main/java/com/rekixo/jodlo/MainActivity.kt");
  const screen=readApp("src/main/java/com/rekixo/jodlo/PrivatePlayMinuteAccountSection.kt");
  for(const source of [app,screen])assert.doesNotMatch(source,
    /JodloPlayManualRestore|inspectOneOwnedPlayPurchaseManually|queryOwnerBoundUnverifiedProofs/,
    "regular Android UI never launches a Play restore or queries purchases");
});

test("explicit owner-bound manual restore reuses one Play connection, no granting or automatic receipt replay",()=>{
  const sdk=readApp("src/playBilling/kotlin/com/rekixo/jodlo/JodloPlayBillingReadOnlyClient.kt");
  const restore=readApp("src/playBilling/kotlin/com/rekixo/jodlo/JodloPlayManualRestore.kt");
  const checkout=readApp("src/playBilling/kotlin/com/rekixo/jodlo/JodloPlayCheckoutController.kt");
  const session=readFileSync(new URL(
    "../../android/core/src/main/kotlin/com/rekixo/jodlo/core/network/InMemorySessionCoordinator.kt",
    import.meta.url),"utf8");
  const policy=readFileSync(new URL(
    "../../android/core/src/main/kotlin/com/rekixo/jodlo/core/network/PlayManualRestoreReview.kt",
    import.meta.url),"utf8");
  assert.equal((sdk+restore+checkout).match(/BillingClient\.newBuilder\(/g)?.length,1);
  assert.match(sdk,/private val manualRestore: JodloPlayManualRestore by lazy/);
  assert.match(sdk,/JodloPlayManualRestore\(approvedIds,::queryOwnerBoundUnverifiedProofs,restoreExecutor\)/);
  assert.match(sdk,/fun inspectOneOwnedPlayPurchaseManually\(/);
  assert.match(sdk,/if \(closed \|\| !BuildConfig\.PLAY_RESTORE_ENABLED\)/);
  assert.match(sdk,/manualRestore\.inspectOneExplicitPurchase\(session,owner,selectedProductId,onStatus\)/);
  assert.match(sdk,/manualRestore\.invalidateSession\(\)/);
  assert.match(sdk,/restoreExecutor\.shutdownNow\(\)/);
  assert.match(restore,/if \(!BuildConfig\.PLAY_RESTORE_ENABLED\)/);
  assert.match(restore,/session\.accountPrivateReadMarker\(\) == marker/);
  assert.match(restore,/session\.playVerificationBinding\(marker\)/);
  assert.match(restore,/identity\.verificationOnly/);
  assert.match(restore,/queryOwned\(identity\.accountBinding\)/);
  assert.match(restore,/AtomicBoolean\(false\)/);
  assert.match(restore,/selectManualPlayRestore\(/);
  assert.match(restore,/ManualPlayRestoreSelection\.Single/);
  assert.match(restore,/proof\.submitOnceToServer/);
  assert.match(restore,/session\.screenOwnedPlayPurchase\(marker,token\)/);
  assert.match(restore,/summarizeManualPlayScreening\(productId,screened!!\)/);
  assert.match(restore,/ManualPlayRestoreStatus\.AccountChanged/);
  assert.match(session,/private val playVerification = RemotePlayVerificationRepository\(authSender\)/);
  assert.match(session,/fun playVerificationBinding\(/);
  assert.match(session,/fun screenOwnedPlayPurchase\(/);
  assert.match(session,/playVerification\.binding\(token\)/);
  assert.match(session,/playVerification\.verify\(token,purchaseToken\)/);
  assert.match(session,/expectedOwner = owner, consistentRead = true/);
  assert.match(policy,/fun selectManualPlayRestore\(/);
  assert.match(policy,/productsFromOwnedProofs\.size > 16/);
  assert.match(policy,/fun summarizeManualPlayScreening\(/);
  assert.match(policy,/PlayReceiptScreening\.NotEligible/);
  for(const source of [sdk,restore])for(const forbidden of [
    /\backnowledgePurchase\s*\(/,
    /\bconsumeAsync\s*\(/,
    /recordTrustedCallCreditEvent|grantTrusted|availableSeconds\s*\+\=/,
    /Razorpay|com\.razorpay/,
    /"₹[0-9]+"/,
    /fun autoRestoreOnStart/,
  ])assert.doesNotMatch(source,forbidden,
    "manual restore cannot change money, local credit, or start an automatic replay");
});


test("regular account screen links only one build-time Play diagnostic seam",()=>{
  const account=readApp("src/main/java/com/rekixo/jodlo/PrivatePlayMinuteAccountSection.kt");
  const stub=readApp("src/noPlay/kotlin/com/rekixo/jodlo/PlayRestoreAccountDiagnostic.kt");
  const real=readApp("src/playBilling/kotlin/com/rekixo/jodlo/PlayRestoreAccountDiagnostic.kt");
  const gradle=readApp("build.gradle.kts");
  assert.match(account,/PlayRestoreAccountDiagnostic\(session,marker,current\.catalog,accountBusy\)/);
  assert.match(account,/if \(marker != null\)/);
  assert.match(gradle,/java\.srcDir\("src\/noPlay\/kotlin"\)/);
  assert.match(gradle,/java\.srcDir\("src\/playBilling\/kotlin"\)/);
  assert.match(stub,/@Composable\s+internal fun PlayRestoreAccountDiagnostic\(/);
  assert.match(real,/@Composable\s+internal fun PlayRestoreAccountDiagnostic\(/);
  assert.doesNotMatch(stub,/com\.android\.billingclient|BillingClient|queryPurchasesAsync/);
  assert.doesNotMatch(account,/com\.android\.billingclient|BillingClient|queryPurchasesAsync/);
  assert.match(real,/!BuildConfig\.DEBUG \|\| !BuildConfig\.PLAY_RESTORE_ENABLED/);
  assert.match(real,/catalog\.purchasable \|\| catalog\.priceSource != "google_play"/);
  assert.match(real,/catalog\.packs\.isEmpty\(\)/);
  assert.match(real,/remember\(context,session,owner,catalog\)/);
  assert.match(real,/DisposableEffect\(client\)/);
  assert.match(real,/alive\.set\(false\)/);
  assert.match(real,/client\.invalidateCheckoutForAccountChange\(\)/);
  assert.match(real,/client\.close\(\)/);
  assert.match(real,/client\.connect \{ ready ->/);
  assert.match(real,/if \(!connectionHandled\.compareAndSet\(false,true\)\) return@connect/);
  assert.match(real,/main\.postDelayed\(connectionTimeout,20_000L\)/);
  assert.match(real,/selected !in approved/);
  assert.match(real,/session\.accountPrivateReadMarker\(\) != owner/);
  assert.match(real,/client\.inspectOneOwnedPlayPurchaseManually\(/);
  assert.match(real,/JodloButton\(\s*onClick = ::reviewSelectedPack/);
  assert.match(real,/ManualPlayRestoreStatus\.ScreenedPendingSettlement/);
  for(const forbidden of [
    /launchBillingFlow\s*\(/,
    /acknowledgePurchase\s*\(/,
    /consumeAsync\s*\(/,
    /purchaseToken/,
    /setObfuscatedAccountId/,
    /priceInr|pricePaise|amountInr|Razorpay/,
    /"₹[0-9]+"/,
    /availableSeconds\s*\+\=/,
    /Log\.|println\(|Timber\./,
    /rememberSaveable|SharedPreferences|SavedStateHandle/,
  ]) assert.doesNotMatch(real,forbidden,"restore UI cannot pay, log or retain receipts");
  for(const locale of ["values","values-hi"]) {
    const strings=readApp("src/main/res/"+locale+"/strings.xml");
    for(const key of ["play_restore_qa_title","play_restore_qa_notice",
      "play_restore_qa_action","play_restore_qa_checking","play_restore_qa_disabled",
      "play_restore_qa_busy","play_restore_qa_actor_changed","play_restore_qa_unavailable",
      "play_restore_qa_none","play_restore_qa_ambiguous",
      "play_restore_qa_not_eligible","play_restore_qa_pending_settlement"])
      assert.ok(strings.includes('name="'+key+'"'),"missing "+locale+" "+key);
  }
});
