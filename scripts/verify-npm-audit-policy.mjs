/**
 * Dependency-free audit CI policy wiring guard.
 * A static regression tripwire, not a vulnerability scanner or YAML interpreter.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const expectedScripts = Object.freeze({
  "audit:prod": "npm audit --omit=dev --audit-level=moderate",
  "audit:all": "npm audit --audit-level=high",
});
const expectedCommands = [
  "npm run audit:policy-check",
  "npm ci --no-audit --no-fund",
  "npm run audit:prod",
  "npm run audit:all",
  "npm test",
];

export async function auditNpmSecurityPolicy(root = defaultRoot) {
  const errors = [];
  let pkg, workflow;
  try { pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")); }
  catch { errors.push("Missing or invalid package.json"); }
  try { workflow = await readFile(join(root, ".github/workflows/checks.yml"), "utf8"); }
  catch { errors.push("Missing foundation GitHub Actions workflow"); }
  if (pkg) {
    for (const [name, command] of Object.entries(expectedScripts)) {
      if (pkg.scripts?.[name] !== command)
        errors.push("Required npm audit policy changed or missing: " + name);
    }
  }
  if (workflow !== undefined) {
    // This workflow uses single-line run commands for these steps.
    // Exact matching rejects || true, --audit-level=critical and other bypasses.
    const commands = [...workflow.matchAll(/^\s+run:\s*(.+?)\s*$/gm)]
      .map(match => match[1].trim());
    let last = -1;
    for (const command of expectedCommands) {
      const matches = commands.flatMap((value, index) => value === command ? [index] : []);
      if (matches.length !== 1) {
        errors.push("Expected exactly one CI command: " + command);
      } else {
        if (matches[0] <= last)
          errors.push("npm CI audit sequence must run after clean install and before tests: " + command);
        last = matches[0];
      }
    }
  }
  return { errors };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors } = await auditNpmSecurityPolicy();
  if (errors.length) {
    console.error("JODLO npm audit policy FAILED:\n" + errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("JODLO npm audit policy OK: production moderate+ and full high+ before tests.");
  }
}
