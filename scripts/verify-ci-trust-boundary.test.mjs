import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditWorkflowSource, auditCITrustBoundary } from "./verify-ci-trust-boundary.mjs";

const safeWorkflow = `name: Safe compile
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Test only
        run: npm test
`;

test("read-only PR checks with credential-free checkout are accepted", () => {
  assert.deepEqual(auditWorkflowSource(safeWorkflow), []);
});

test("dangerous event triggers are rejected, including inline trigger syntax", () => {
  for (const source of [
    safeWorkflow.replace("  pull_request:", "  pull_request_target:"),
    safeWorkflow.replace("  pull_request:", "  workflow_run:"),
    safeWorkflow.replace("  pull_request:", "  schedule:"),
    safeWorkflow.replace("on:\n  pull_request:\n  push:\n    branches: [main]", "on: [pull_request_target]"),
  ]) {
    assert.match(auditWorkflowSource(source).join("\n"), /event trigger forbidden/);
  }
});

test("writes, overly broad privileges, and missing read-only top-level scope fail", () => {
  for (const source of [
    safeWorkflow.replace("contents: read", "contents: write"),
    safeWorkflow.replace("permissions:\n  contents: read", "permissions: write-all"),
    safeWorkflow.replace("permissions:\n  contents: read", ""),
    safeWorkflow.replace("runs-on: ubuntu-latest", "runs-on: ubuntu-latest\n    permissions:\n      id-token: write"),
  ]) {
    assert.match(auditWorkflowSource(source).join("\n"), /permissions/);
  }
});

test("unchecked remote actions, token references, and implicit checkout credentials fail", () => {
  const bad = [
    [safeWorkflow.replace("actions/setup-node@v4", "untrusted/example-action@main"),
      /unreviewed action/],
    [safeWorkflow.replace("persist-credentials: false", "fetch-depth: 1"),
      /persist-credentials: false/],
    [safeWorkflow.replace("run: npm test", "run: echo ${{ secrets.PRODUCTION_DEPLOY_KEY }}"),
      /must not read GitHub secrets/],
    [safeWorkflow.replace("run: npm test", "run: echo GITHUB_TOKEN"),
      /must not read GitHub secrets/],
    [safeWorkflow.replace("run: npm test", "uses: docker://example.net/latest"),
      /unreviewed action/],
  ];
  for (const [source, message] of bad)
    assert.match(auditWorkflowSource(source).join("\n"), message);
});

test("main-only temporary APK artifact upload is required", () => {
  const withUpload = safeWorkflow + "      - uses: actions/upload-artifact@v4\n";
  assert.match(auditWorkflowSource(withUpload).join("\n"), /limited to main/);
  assert.deepEqual(auditWorkflowSource(withUpload +
    "        if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'\n"), []);
});

async function fixture(workflows, action = auditCITrustBoundary) {
  const root = await mkdtemp(join(tmpdir(), "jodlo-ci-trust-"));
  try {
    const dir = join(root, ".github/workflows");
    await mkdir(dir, { recursive: true });
    for (const [filename, contents] of Object.entries(workflows))
      await writeFile(join(dir, filename), contents);
    return await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("every YAML workflow is audited; required ones cannot be removed", async () => {
  assert.deepEqual(await fixture({
    "checks.yml": safeWorkflow,
    "android-native.yml": safeWorkflow,
  }), []);
  const invalid = await fixture({
    "checks.yml": safeWorkflow,
    "additional.yaml": safeWorkflow.replace("contents: read", "contents: write"),
  });
  assert.match(invalid.join("\n"), /Missing required workflow: android-native.yml/);
  assert.match(invalid.join("\n"), /additional.yaml: workflow write or broad permissions/);
});

test("workflow symlinks fail closed", async () => {
  const result = await fixture({
    "checks.yml": safeWorkflow,
    "android-native.yml": safeWorkflow,
  }, async root => {
    await symlink(join(root, ".github/workflows/checks.yml"),
      join(root, ".github/workflows/other.yml"));
    return auditCITrustBoundary(root);
  });
  assert.match(result.join("\n"), /Unsafe workflow entry: other.yml/);
});

test("current repository workflows honor PR token isolation", async () => {
  const errors = await auditCITrustBoundary();
  assert.deepEqual(errors, [], errors.join("\n"));
});
