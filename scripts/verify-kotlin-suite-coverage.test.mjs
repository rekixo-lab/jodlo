import test from "node:test";
import assert from "node:assert/strict";
import { auditKotlinSuiteCoverage, readSuiteInputs } from "./verify-kotlin-suite-coverage.mjs";

const base = readSuiteInputs();
const check = (data = base) => auditKotlinSuiteCoverage(data);

test("every executable Kotlin JVM test is registered and CI runs the entire aggregate", () => {
  const outcome = check();
  assert.equal(outcome.ok, true, outcome.problems.join("; "));
  assert.equal(outcome.suiteCount, 22);
  assert.equal(outcome.registeredCount, outcome.suiteCount);
});

test("unregistered new executable Kotlin suite fails closed", () => {
  const tests = { ...base.tests, "ForgottenFutureTest.kt":
    "package com.rekixo.jodlo.core.network\nfun main() { check(true) }\n" };
  assert.match(check({ ...base, tests }).problems.join("\n"),
    /not registered for CI: ForgottenFutureTestKt/);
});

test("missing or stale Gradle verifier is rejected", () => {
  const gradle = base.gradle.replace(
    'mainClass.set("com.rekixo.jodlo.core.network.CustomerWorkerLifecycleRegressionTestKt")',
    'mainClass.set("com.rekixo.jodlo.core.network.MissingKt")',
  );
  const report=check({ ...base, gradle });
  assert.equal(report.ok,false);
  assert.match(report.problems.join("\n"), /not registered for CI: CustomerWorkerLifecycleRegressionTestKt/);
  assert.match(report.problems.join("\n"), /missing\/non-executable main MissingKt/);
});

test("duplicate registered class and missing aggregate coverage are rejected", () => {
  const duplicated = base.gradle.replace(
    'mainClass.set("com.rekixo.jodlo.core.network.CustomerWorkerLifecycleRegressionTestKt")',
    'mainClass.set("com.rekixo.jodlo.core.network.JodloApiCoreTestKt")',
  );
  assert.match(check({ ...base, gradle:duplicated }).problems.join("\n"),
    /Duplicate JVM test main: JodloApiCoreTestKt/);
  const disabled = base.gradle.replace(
    'dependsOn(tasks.withType<JavaExec>().matching { it.name.startsWith("verify") })',
    'dependsOn(tasks.named("verifyContracts"))',
  );
  assert.match(check({ ...base, gradle:disabled }).problems.join("\n"),
    /Missing lazy aggregate/);
});

test("GitHub CI must execute aggregate rather than a curated list", () => {
  const missing=base.workflow.replace(
    ':core:verifyHeadlessCore --no-daemon', ':core:verifyContracts --no-daemon',
  );
  const result=check({ ...base, workflow:missing });
  assert.equal(result.ok,false);
  assert.match(result.problems.join("\n"), /does not execute the aggregate/);
  assert.match(result.problems.join("\n"), /manually lists individual/);
});

test("a deleted executable Kotlin suite cannot silently shrink existing coverage", () => {
  const tests={...base.tests};
  delete tests["CustomerWorkerLifecycleRegressionTest.kt"];
  const result=check({ ...base, tests });
  assert.equal(result.ok,false);
  assert.match(result.problems.join("\n"), /Expected at least 22 executable Kotlin suites/);
});
