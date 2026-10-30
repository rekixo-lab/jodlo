import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { auditDependencyLock } from "./verify-dependency-lock.mjs";

function baseline() {
  const manifest = {
    name: "jodlo", version: "0.0.1", private: true, workspaces: ["apps/api"],
    dependencies: { jose: "^6.1.0" },
    devDependencies: { typescript: "~5.8.3", wrangler: "^4.0.0" },
  };
  const workspace = { name: "@jodlo/api", version: "0.0.1", private: true };
  const external = name => ({
    version: "1.0.0",
    resolved: "https://registry.npmjs.org/" + name + "/-/" + name + "-1.0.0.tgz",
    integrity: "sha512-ZGVtbw==",
  });
  const lock = {
    name: manifest.name, version: manifest.version, lockfileVersion: 3,
    packages: {
      "": { name: manifest.name, version: manifest.version,
        workspaces: ["apps/api"], dependencies: { ...manifest.dependencies },
        devDependencies: { ...manifest.devDependencies } },
      "apps/api": { name: workspace.name, version: workspace.version },
      "node_modules/@jodlo/api": { resolved: "apps/api", link: true },
      "node_modules/jose": external("jose"),
      "node_modules/typescript": external("typescript"),
      "node_modules/wrangler": external("wrangler"),
    },
  };
  return { "package.json": manifest, "apps/api/package.json": workspace,
    "package-lock.json": lock };
}
async function fixture(edit) {
  const files = baseline();
  if (edit) edit(files);
  const root = await mkdtemp(join(tmpdir(), "jodlo-lock-"));
  try {
    for (const [path, json] of Object.entries(files)) {
      const full = join(root, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, JSON.stringify(json));
    }
    return await auditDependencyLock(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
test("consistent npm v3 workspace lock is accepted", async () => {
  const result = await fixture();
  assert.deepEqual(result.errors, []);
  assert.equal(result.packageCount, 3);
});
test("missing and outdated lockfile are rejected", async () => {
  const missing = await fixture(f => { delete f["package-lock.json"]; });
  assert.match(missing.errors.join(" "), /Missing or invalid JSON/);
  const old = await fixture(f => { f["package-lock.json"].lockfileVersion = 2; });
  assert.match(old.errors.join(" "), /lockfileVersion 3/);
});
test("changed manifest dependency range or workspace link fails", async () => {
  const stale = await fixture(f => { f["package.json"].dependencies.jose = "^6.4.0"; });
  assert.match(stale.errors.join(" "), /dependencies mismatch: jose/);
  const bad = await fixture(f => {
    f["package-lock.json"].packages["node_modules/@jodlo/api"].resolved = "apps/other";
  });
  assert.match(bad.errors.join(" "), /workspace link/);
});
test("unverified transitive package and removed package metadata fail", async () => {
  const integrity = await fixture(f => {
    delete f["package-lock.json"].packages["node_modules/jose"].integrity;
  });
  assert.match(integrity.errors.join(" "), /Unpinned or unverified package/);
  const missing = await fixture(f => {
    f["package-lock.json"].packages["node_modules/jose"].resolved = "file:../unstable.tgz";
  });
  assert.match(missing.errors.join(" "), /Unpinned or unverified package/);
});
test("actual JODLO lockfile matches source workspaces", async () => {
  const result = await auditDependencyLock();
  assert.deepEqual(result.errors, [], result.errors.join("\n"));
  assert.ok(result.packageCount > 0);
});
