import java.net.URI

plugins {
    id("com.android.application") version "8.6.1"
    id("org.jetbrains.kotlin.android") version "1.9.24"
    id("com.google.gms.google-services") version "4.4.4" apply false
}

val agoraEnabled = providers.gradleProperty("jodloEnableAgora").orNull == "true"
val fcmEnabled = providers.gradleProperty("jodloEnableFcm").orNull == "true"
// Opt-in library compile only; no real product IDs, checkout or entitlement route is authorized.
val playBillingEnabled = providers.gradleProperty("jodloEnablePlayBilling").orNull == "true"
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

android {
    sourceSets.getByName("main") {
        java.srcDir(if (agoraEnabled) "src/agora/kotlin" else "src/noAgora/kotlin")
        java.srcDir(if (fcmEnabled) "src/fcm/kotlin" else "src/noFcm/kotlin")
        if (playBillingEnabled) java.srcDir("src/playBilling/kotlin")
    }
    namespace = "com.rekixo.jodlo"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.rekixo.jodlo"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-dev"
        manifestPlaceholders["callMessagingServiceEnabled"] = fcmEnabled
        buildConfigField("boolean", "FCM_ENABLED", fcmEnabled.toString())
        buildConfigField("boolean", "AGORA_ENABLED", agoraEnabled.toString())
        buildConfigField("boolean", "PLAY_BILLING_ENABLED", playBillingEnabled.toString())
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
