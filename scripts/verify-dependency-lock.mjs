/**
 * Read-only npm workspace lockfile preflight. npm ci still performs the
 * authoritative dependency resolution, tarball integrity and install check.
 * This guard catches accidental lock removal or obviously unpinned packages
 * before invoking the network in CI.
 */
import { readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDefault = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

async function readJson(path, errors) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { errors.push("Missing or invalid JSON: " + path); return null; }
}

function matchesManifest(actual, expected, label, errors) {
  if (!actual || typeof actual !== "object") {
    errors.push("Missing lockfile package: " + label);
    return;
  }
  if (actual.name !== expected.name || actual.version !== expected.version)
    errors.push("Lockfile identity mismatch: " + label);
  for (const key of dependencyFields) {
    const manifestDeps = expected[key] || {};
    const lockedDeps = actual[key] || {};
    const keys = new Set([...Object.keys(manifestDeps), ...Object.keys(lockedDeps)]);
    for (const name of keys)
      if (lockedDeps[name] !== manifestDeps[name])
        errors.push("Lockfile " + label + " " + key + " mismatch: " + name);
  }
}

export async function auditDependencyLock(root = rootDefault) {
  const errors = [];
  const manifest = await readJson(join(root, "package.json"), errors);
  const lock = await readJson(join(root, "package-lock.json"), errors);
  if (!manifest || !lock) return { errors, packageCount: 0 };
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object")
    return { errors: [...errors, "Expected npm lockfileVersion 3 packages"], packageCount: 0 };

  matchesManifest(lock.packages[""], manifest, "root", errors);
  if (lock.name !== manifest.name || lock.version !== manifest.version)
    errors.push("Top-level lockfile identity mismatch");

  const workspaces = manifest.workspaces;
  if (!Array.isArray(workspaces) || workspaces.some(x => typeof x !== "string" || !/^apps\/[a-z][a-z0-9-]*$/.test(x)))
    errors.push("Unexpected npm workspaces declaration");
  else {
    if (JSON.stringify(lock.packages[""]?.workspaces) !== JSON.stringify(workspaces))
      errors.push("Lockfile workspace list mismatch");
    for (const path of workspaces) {
      const workspaceManifest = await readJson(join(root, path, "package.json"), errors);
      if (!workspaceManifest) continue;
      matchesManifest(lock.packages[path], workspaceManifest, path, errors);
      const link = lock.packages["node_modules/" + workspaceManifest.name];
      if (!link || link.link !== true || link.resolved !== path)
        errors.push("Missing or incorrect npm workspace link: " + path);
    }
  }

  let packageCount = 0;
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.startsWith("node_modules/") || entry?.link === true) continue;
    packageCount++;
    if (typeof entry?.version !== "string" ||
        typeof entry?.resolved !== "string" ||
        !entry.resolved.startsWith("https://registry.npmjs.org/") ||
        typeof entry?.integrity !== "string" ||
        !/^sha(?:256|384|512)-[A-Za-z0-9+/=]+$/.test(entry.integrity)) {
      errors.push("Unpinned or unverified package metadata: " + path);
    }
  }
  if (packageCount === 0) errors.push("No locked external packages");
  return { errors, packageCount };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await auditDependencyLock();
  if (result.errors.length) {
    console.error("JODLO dependency lock FAILED:\n" + result.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("JODLO npm workspace lock OK: " + result.packageCount +
      " registry packages with recorded integrity; npm ci verifies installation.");
  }
}
