pluginManagement {
    repositories {
        google()
        gradlePluginPortal()
        mavenCentral()
    }
}
rootProject.name = "Jodlo"
include(":core")

// CI's existing JVM-only suite intentionally requires neither Android SDK nor AGP.
// Opt in to the native app when building an actual APK.
if (providers.gradleProperty("includeAndroidApp").orNull == "true") {
    include(":app")
}
