plugins {
    id("com.android.application") version "8.6.1"
    id("org.jetbrains.kotlin.android") version "1.9.24"
}

repositories {
    google()
    mavenCentral()
}

val apiOrigin = providers.gradleProperty("jodloApiOrigin").orNull?.trim().orEmpty()
if (apiOrigin.isNotEmpty()) {
    val uri = java.net.URI(apiOrigin)
    require(uri.scheme == "https" && uri.host != null && uri.userInfo == null &&
        uri.port in listOf(-1, 443) && uri.rawQuery == null && uri.rawFragment == null &&
        (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")) {
        "jodloApiOrigin must be an HTTPS origin without credentials, path, query or fragment"
    }
}

android {
    namespace = "com.rekixo.jodlo"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.rekixo.jodlo"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-dev"
        buildConfigField("String", "API_ORIGIN", "\"" + apiOrigin + "\"")
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
    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
