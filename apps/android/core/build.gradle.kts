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

tasks.register<JavaExec>("verifyRepositories") {
    group = "verification"
    description = "Compile and verify nonvisual Catalog/Worker repository fakes"
    dependsOn(tasks.named("testClasses"))
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("com.rekixo.jodlo.core.network.JodloRepositoryTestKt")
}

tasks.register<JavaExec>("verifySessions") {
    group = "verification"
    description = "Compile and run nonvisual in-memory session and worker state tests"
    dependsOn(tasks.named("testClasses"))
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("com.rekixo.jodlo.core.network.InMemorySessionCoordinatorTestKt")
}

tasks.register<JavaExec>("verifyAuthExchange") {
    group = "verification"
    description = "Compile and test fakeable, nonvisual Google backend exchange and login races"
    dependsOn(tasks.named("testClasses"))
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("com.rekixo.jodlo.core.network.BackendGoogleSessionExchangeTestKt")
}

tasks.register<JavaExec>("verifyCancellation") {
    group = "verification"
    description = "Compile and verify slow-network cancellation, session safety and worker write uncertainty"
    dependsOn(tasks.named("testClasses"))
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("com.rekixo.jodlo.core.network.SessionCancellationTestKt")
}

tasks.register<JavaExec>("verifyReadScope") {
    group = "verification"
    description = "Compile and execute headless lifecycle/marketplace read coordination races"
    dependsOn(tasks.named("testClasses"))
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("com.rekixo.jodlo.core.network.HeadlessMarketplaceReadScopeTestKt")
}

tasks.register<JavaExec>("verifyWorkerWriteReview") {
    group = "verification"
    description = "Verify uncertain worker writes, read-only reconciliation and private cache invalidation"
    dependsOn(tasks.named("testClasses"))
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("com.rekixo.jodlo.core.network.HeadlessWorkerWriteScopeTestKt")
}

tasks.register<JavaExec>("verifyPublicRefresh") {
    group = "verification"
    description = "Verify public browse/search/listing refresh barrier during uncertain worker writes"
    dependsOn(tasks.named("testClasses"))
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("com.rekixo.jodlo.core.network.PublicReadRefreshBarrierTestKt")
}

tasks.register<JavaExec>("verifyPublicFreshness") {
    group = "verification"
    description = "Verify bounded public cache age, manual refresh and late GET rejection"
    dependsOn(tasks.named("testClasses"))
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("com.rekixo.jodlo.core.network.PublicCacheFreshnessTestKt")
}
