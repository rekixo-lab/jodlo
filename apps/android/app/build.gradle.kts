import java.net.URI

plugins {
    id("com.android.application") version "8.10.1"
    id("org.jetbrains.kotlin.android") version "1.9.24"
    id("com.google.gms.google-services") version "4.4.4" apply false
}

val agoraEnabled = providers.gradleProperty("jodloEnableAgora").orNull == "true"
val fcmEnabled = providers.gradleProperty("jodloEnableFcm").orNull == "true"
// Billing remains absent unless explicitly configured. A separate policy gate
// enables the checkout UI; production backend capability is also checked per tap.
val playBillingEnabled = providers.gradleProperty("jodloEnablePlayBilling").orNull == "true"
val playCheckoutEnabled = providers.gradleProperty("jodloEnablePlayCheckout").orNull == "true"
val playRestoreEnabled = providers.gradleProperty("jodloEnablePlayRestore").orNull == "true"
val playPolicyVersion = providers.gradleProperty("jodloPlayPolicyVersion").orNull?.trim().orEmpty()
require(playPolicyVersion.isEmpty() || playPolicyVersion == "jodlo-play-minutes-v1") {
    "Unsupported JODLO Play settlement policy version"
}
if (fcmEnabled) {
    require(file("google-services.json").isFile) {
        "Place JODLO's google-services.json in the Android app module before enabling FCM"
    }
    apply(plugin = "com.google.gms.google-services")
}

repositories {
    google()
    mavenCentral()
    if (agoraEnabled) {
        maven("https://download.agora.io/maven/") {
            content {
                includeGroup("io.agora.rtc")
                includeGroup("io.agora.infra")
            }
        }
    }
}

val apiOrigin = providers.gradleProperty("jodloApiOrigin").orNull?.trim().orEmpty()
if (apiOrigin.isNotEmpty()) {
    val uri = URI(apiOrigin)
    require(uri.scheme == "https" && uri.host != null && uri.userInfo == null &&
        uri.port in listOf(-1, 443) && uri.rawQuery == null && uri.rawFragment == null &&
        (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")) {
        "jodloApiOrigin must be an HTTPS origin without credentials, path, query or fragment"
    }
}

val googleWebClientId = providers.gradleProperty("jodloGoogleWebClientId").orNull?.trim().orEmpty()
require(googleWebClientId.isEmpty() ||
    Regex("""^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$""").matches(googleWebClientId)) {
    "jodloGoogleWebClientId must be a public WEB OAuth client ID only"
}

// A debug APK may be built with no backend or Google identity, but a release
// variant must never be created accidentally with those development defaults.
// This is a SOURCE/BUILD gate, NOT approval to publish, sign, charge or deploy.
val releaseCandidateRequested = providers.gradleProperty("jodloReleaseCandidate").orNull == "true"
val candidateVersionName = providers.gradleProperty("jodloReleaseVersionName").orNull?.trim().orEmpty()
val candidateVersionCode = providers.gradleProperty("jodloReleaseVersionCode").orNull?.toIntOrNull()
require(!playRestoreEnabled || (playBillingEnabled &&
    apiOrigin.isNotBlank() && googleWebClientId.isNotBlank() &&
    (!releaseCandidateRequested || (playCheckoutEnabled && playPolicyVersion == "jodlo-play-minutes-v1")))) {
    "Play recovery needs configured Billing; a release candidate also needs the explicit checkout policy"
}
require(!playCheckoutEnabled || (playBillingEnabled &&
    apiOrigin.isNotBlank() && googleWebClientId.isNotBlank() &&
    playPolicyVersion == "jodlo-play-minutes-v1")) {
    "Checkout requires configured Play Billing, API, Google identity and explicit settlement policy"
}
if (releaseCandidateRequested) {
    require(apiOrigin == "https://api.jodlo.rekixo.com") {
        "Release candidate requires the dedicated verified JODLO API origin"
    }
    require(googleWebClientId.isNotBlank()) {
        "Release candidate requires a configured JODLO Google Web OAuth client ID"
    }
    require(Regex("""^[1-9][0-9]{0,2}\.[0-9]{1,3}\.[0-9]{1,3}$""")
        .matches(candidateVersionName)) {
        "Release candidate needs explicit numeric major.minor.patch version name"
    }
    require(candidateVersionCode != null && candidateVersionCode in 2..2100000000) {
        "Release candidate needs a new positive version code (>= 2)"
    }
}

// No release Gradle tasks exist by default. A consciously configured build is
// only a candidate; the owner must separately verify signing, Play policies,
// providers, real-device QA, reviewed Catalog and rollout authorization.
androidComponents {
    beforeVariants(selector().withBuildType("release")) { variant ->
        variant.enable = releaseCandidateRequested
    }
}

android {
    sourceSets.getByName("main") {
        java.srcDir(if (agoraEnabled) "src/agora/kotlin" else "src/noAgora/kotlin")
        java.srcDir(if (fcmEnabled) "src/fcm/kotlin" else "src/noFcm/kotlin")
        if (playBillingEnabled) {
            java.srcDir("src/playBilling/kotlin")
        } else {
            // Same tiny UI seam, no SDK types/Google Play dependency in normal APK.
            java.srcDir("src/noPlay/kotlin")
        }
    }
    namespace = "com.rekixo.jodlo"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.rekixo.jodlo"
        minSdk = 26
        targetSdk = 36
        versionCode = if (releaseCandidateRequested) requireNotNull(candidateVersionCode) else 1
        versionName = if (releaseCandidateRequested) candidateVersionName else "0.1.0-dev"
        manifestPlaceholders["callMessagingServiceEnabled"] = fcmEnabled
        buildConfigField("boolean", "FCM_ENABLED", fcmEnabled.toString())
        buildConfigField("boolean", "AGORA_ENABLED", agoraEnabled.toString())
        buildConfigField("boolean", "PLAY_BILLING_ENABLED", playBillingEnabled.toString())
        // OFF by default, including ordinary release candidates. Explicitly
        // configured builds still require live server readiness before checkout.
        buildConfigField("boolean", "PLAY_CHECKOUT_ENABLED", playCheckoutEnabled.toString())
        buildConfigField("boolean", "PLAY_RESTORE_ENABLED", playRestoreEnabled.toString())
        buildConfigField("String", "PLAY_POLICY_VERSION", "\"" + playPolicyVersion + "\"")
        buildConfigField("String", "API_ORIGIN", "\"" + apiOrigin + "\"")
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"" + googleWebClientId + "\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(project(":core"))
    if (agoraEnabled) implementation("io.agora.rtc:voice-sdk:4.7.0")
    if (playBillingEnabled) implementation("com.android.billingclient:billing:9.1.0")
    if (fcmEnabled) {
        implementation(platform("com.google.firebase:firebase-bom:34.7.0"))
        implementation("com.google.firebase:firebase-messaging")
    }
    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
}
