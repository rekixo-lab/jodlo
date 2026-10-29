/**
 * Dependency-free fail-closed Kotlin/JVM suite inventory. It prevents the
 * future "all green but new headless test was never run" release gap.
 *
 * This checks source registration only; GitHub Actions must still execute
 * the aggregate Gradle task to prove that all Kotlin tests actually pass.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = "apps/android/core/src/test/kotlin/com/rekixo/jodlo/core/network";
const mainClassPrefix = "com.rekixo.jodlo.core.network.";

export function readSuiteInputs(base = root) {
  const testDir = join(base, directory);
  const tests = Object.fromEntries(
    readdirSync(testDir)
      .filter((name) => name.endsWith(".kt"))
      .sort()
      .map((name) => [name, readFileSync(join(testDir, name), "utf8")]),
  );
  return {
    gradle: readFileSync(join(base, "apps/android/core/build.gradle.kts"), "utf8"),
    workflow: readFileSync(join(base, ".github/workflows/checks.yml"), "utf8"),
    tests,
  };
}

export function auditKotlinSuiteCoverage(
  { gradle, workflow, tests },
  { minimumSuites = 22 } = {},
) {
  const problems = [];
  const allTests = new Set();
  for (const [name, source] of Object.entries(tests)) {
    // A Kotlin package-level top-level main creates the *Kt JVM entrypoint.
    if (/^\s*fun\s+main\s*\(\s*\)\s*(?::\s*Unit\s*)?\{/m.test(source)) {
      allTests.add(name.replace(/\.kt$/, "Kt"));
    }
  }

  const suites = new Map();
  const usedClasses = new Map();
  const taskRx = /tasks\.register<JavaExec>\("([^"]+)"\)\s*\{([\s\S]*?)^\}/gm;
  for (const match of gradle.matchAll(taskRx)) {
    const [, task, body] = match;
    if (suites.has(task)) problems.push("Duplicate JavaExec task: " + task);
    const entries = [...body.matchAll(/mainClass\.set\("([^"]+)"\)/g)];
    if (entries.length !== 1) {
      problems.push("JavaExec task has no unique mainClass: " + task);
      continue;
    }
    const className = entries[0][1];
    if (!task.startsWith("verify") || !className.startsWith(mainClassPrefix)) {
      problems.push("Out-of-contract Kotlin verifier: " + task);
      continue;
    }
    const shortName = className.slice(mainClassPrefix.length);
    if (usedClasses.has(shortName))
      problems.push("Duplicate JVM test main: " + shortName);
    usedClasses.set(shortName, task);
    suites.set(task, shortName);
  }

  if (allTests.size < minimumSuites)
    problems.push("Expected at least " + minimumSuites +
      " executable Kotlin suites, found " + allTests.size);
  for (const name of allTests) {
    if (!usedClasses.has(name))
      problems.push("Executable Kotlin suite not registered for CI: " + name);
  }
  for (const [shortName, task] of usedClasses) {
    if (!allTests.has(shortName))
      problems.push("Verifier " + task + " points to missing/non-executable main " + shortName);
  }

  // This aggregate must be a *regular* Gradle task: JavaExec-only matching
  // must never select itself and produce a circular dependency.
  const aggregate = /tasks\.register\("verifyHeadlessCore"\)\s*\{([\s\S]*?)^\}/m.exec(gradle);
  if (!aggregate ||
      !/dependsOn\(tasks\.withType<JavaExec>\(\)\.matching\s*\{\s*it\.name\.startsWith\("verify"\)\s*\}\s*\)/.test(aggregate[1])) {
    problems.push("Missing lazy aggregate of all verify* JavaExec Kotlin suites");
  }
  if (!/gradle -p apps\/android :core:verifyHeadlessCore --no-daemon/.test(workflow))
    problems.push("GitHub CI does not execute the aggregate Kotlin JVM suite task");
  if (/:core:verify(?!HeadlessCore\b)[A-Za-z]+/.test(workflow))
    problems.push("GitHub CI still manually lists individual Kotlin verification tasks");

  return {
    ok: problems.length === 0,
    suiteCount: allTests.size,
    registeredCount: usedClasses.size,
    executableSuiteNames: [...allTests].sort(),
    problems,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = auditKotlinSuiteCoverage(readSuiteInputs());
  if (!result.ok) {
    for (const issue of result.problems) console.error("JODLO Kotlin CI coverage: " + issue);
    process.exitCode = 1;
  } else {
    console.log("JODLO Kotlin CI coverage: " + result.suiteCount +
      " executable suites registered exactly once; aggregate Gradle CI configured");
  }
}
