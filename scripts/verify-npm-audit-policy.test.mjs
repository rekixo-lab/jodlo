import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { auditNpmSecurityPolicy } from "./verify-npm-audit-policy.mjs";

const install = "npm ci --no-audit --no-fund";
const policy = "npm run audit:policy-check";
const prod = "npm run audit:prod";
const all = "npm run audit:all";
function baseline() {
  return {
    "package.json": JSON.stringify({
      scripts: {
        "audit:prod": "npm audit --omit=dev --audit-level=moderate",
        "audit:all": "npm audit --audit-level=high",
      },
    }),
    ".github/workflows/checks.yml":
      "name: no deployment\nsteps:\n" +
      [policy, install, prod, all, "npm test"].map(cmd => "  - run: " + cmd).join("\n") + "\n",
  };
}
async function fixture(change) {
  const root = await mkdtemp(join(tmpdir(), "jodlo-audit-policy-"));
  try {
    const files = baseline();
    if (change) change(files);
    for (const [path, contents] of Object.entries(files)) {
      const full = join(root, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, contents, "utf8");
    }
    return await auditNpmSecurityPolicy(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("approved npm production and complete dependency audit gates pass", async () => {
  assert.deepEqual((await fixture()).errors, []);
});
test("weakened or removed production/full thresholds are rejected", async () => {
  const changed = await fixture(files => {
    const pkg = JSON.parse(files["package.json"]);
    pkg.scripts["audit:prod"] = "npm audit --omit=dev --audit-level=high";
    pkg.scripts["audit:all"] = "npm audit --audit-level=critical";
    files["package.json"] = JSON.stringify(pkg);
  });
  assert.match(changed.errors.join(" "), /audit:prod/);
  assert.match(changed.errors.join(" "), /audit:all/);
});
test("audit skipping, duplicates and CI command removal are rejected", async () => {
  const skipped = await fixture(files => {
    files[".github/workflows/checks.yml"] = files[".github/workflows/checks.yml"]
      .replace("run: " + prod, "run: " + prod + " || true");
  });
  assert.match(skipped.errors.join(" "), /Expected exactly one CI command: npm run audit:prod/);
  const duplicate = await fixture(files => {
    files[".github/workflows/checks.yml"] += "  - run: " + all + "\n";
  });
  assert.match(duplicate.errors.join(" "), /Expected exactly one CI command: npm run audit:all/);
  const missing = await fixture(files => {
    files[".github/workflows/checks.yml"] = files[".github/workflows/checks.yml"]
      .replace("  - run: " + all + "\n", "");
  });
  assert.match(missing.errors.join(" "), /Expected exactly one CI command: npm run audit:all/);
});
test("audits cannot be moved ahead of clean install or after other tests", async () => {
  const reordered = await fixture(files => {
    files[".github/workflows/checks.yml"] = files[".github/workflows/checks.yml"]
      .replace("  - run: " + install + "\n  - run: " + prod,
        "  - run: " + prod + "\n  - run: " + install);
  });
  assert.match(reordered.errors.join(" "), /audit sequence/);
  const late = await fixture(files => {
    files[".github/workflows/checks.yml"] = files[".github/workflows/checks.yml"]
      .replace("  - run: " + all + "\n  - run: npm test",
        "  - run: npm test\n  - run: " + all);
  });
  assert.match(late.errors.join(" "), /audit sequence/);
});
test("actual repository workflow enforces the expected audit policy", async () => {
  const result = await auditNpmSecurityPolicy();
  assert.deepEqual(result.errors, [], result.errors.join("\n"));
});
