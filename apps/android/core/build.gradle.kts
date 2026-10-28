plugins {
    kotlin("jvm") version "1.9.24"
}
repositories {
    mavenCentral()
}
kotlin {
    jvmToolchain(17)
}
tasks.register<JavaExec>("verifyContracts") {
    group = "verification"
    description = "Compile and run the JODLO Android-compatible headless Kotlin contract suite"
    dependsOn(tasks.named("testClasses"))
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("com.rekixo.jodlo.core.network.JodloApiCoreTestKt")
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
}
tasks.register<JavaExec>("verifyReplies") {
    group = "verification"
    description = "Compile and run typed JSON reply and one-shot error tests"
    dependsOn(tasks.named("testClasses"))
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("com.rekixo.jodlo.core.network.JodloReplyDecoderTestKt")
}
