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
  assert.match(gradle,/if \(playBillingEnabled\) java\.srcDir\("src\/playBilling\/kotlin"\)/);
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
    /\.purchaseToken\b/,
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
  assert.match(code,/callback\(ReadResult\.Available\(purchases\.mapNotNull\(::unverified\)\)\)/);
  assert.match(code,/if \(closed\) return@queryPurchasesAsync/);
  assert.match(code,/if \(closed\) return@queryProductDetailsAsync/);
  assert.doesNotMatch(code,/callback\(emptyList\(\)\)/);
});
