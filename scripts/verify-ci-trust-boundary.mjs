/**
 * Offline CI trust-boundary audit. No GitHub token, network access or deployment.
 *
 * Reject dangerous event triggers, workflow write privileges, unexpected
 * third-party actions and credential-persisting checkouts. This is a narrow,
 * deliberately conservative code gate, NOT proof of GitHub branch protection
 * or of real production/provider acceptance.
 */
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDefault = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const approvedActions = new Set([
  "actions/checkout@v4",
  "actions/setup-node@v4",
  "actions/setup-java@v4",
  "actions/upload-artifact@v4",
  "gradle/actions/setup-gradle@v4",
]);
const required = ["checks.yml", "android-native.yml"];

export function auditWorkflowSource(source, fileName = "workflow.yml") {
  const errors = [];
  // Ignore ordinary full-line YAML comments; every check is source-only and
  // cannot claim to be a fully general YAML or GitHub expression interpreter.
  const lines = source.split(/\r?\n/).filter(line => !/^\s*#/.test(line));
  const body = lines.join("\n");
  const report = message => errors.push(fileName + ": " + message);

  if (!/^on:\s*$/m.test(body))
    report("explicit top-level event triggers are required");
  if (/\b(?:pull_request_target|workflow_run|repository_dispatch|schedule)\s*:/m.test(body) ||
      /^on:\s*\[[^\]]*\b(?:pull_request_target|workflow_run|repository_dispatch|schedule)\b/m.test(body))
    report("privileged, chained, external or scheduled event trigger forbidden");
  // The global read-only permission set must be present, and per-job
  // escalation cannot silently override it.
  if (!/^permissions:\s*\n  contents:\s*read\s*$/m.test(body))
    report("top-level permissions must explicitly grant only contents: read");
  if (/^\s*(?:contents|actions|checks|deployments|id-token|packages|pull-requests|issues|workflows|statuses):\s*write\s*$/m.test(body) ||
      /^\s*permissions:\s*(?:write-all|read-all)\s*$/m.test(body))
    report("workflow write or broad permissions forbidden");
  if (/\$\{\{\s*(?:secrets\.|github\.token\b)/i.test(body) ||
      /\bGITHUB_TOKEN\b/.test(body))
    report("workflow must not read GitHub secrets or tokens");

  const actions = [...body.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)\s*$/gm)];
  for (const action of actions) {
    if (!approvedActions.has(action[1]))
      report("unreviewed action or floating reference: " + action[1]);
  }
  for (let i = 0; i < lines.length; i++) {
    const checkout = lines[i].match(/^(\s*)-\s*uses:\s*actions\/checkout@v4\s*$/);
    if (!checkout) continue;
    const depth = checkout[1].length;
    const step = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() && line.search(/\S/) <= depth) break;
      step.push(line);
    }
    if (!step.some(line => /^\s+persist-credentials:\s*false\s*$/.test(line)))
      report("checkout must set persist-credentials: false");
  }
  if (body.includes("actions/upload-artifact@v4") &&
      !/if:\s*github\.ref\s*==\s*'refs\/heads\/main'/.test(body))
    report("debug APK upload must be limited to main");
  return errors;
}

export async function auditCITrustBoundary(root = rootDefault) {
  const errors = [];
  let entries;
  try {
    entries = await readdir(join(root, ".github/workflows"), { withFileTypes: true });
  } catch {
    return ["Missing .github/workflows directory"];
  }
  for (const name of required)
    if (!entries.some(entry => entry.name === name && entry.isFile()))
      errors.push("Missing required workflow: " + name);
  for (const entry of entries) {
    if (!/\.ya?ml$/.test(entry.name)) continue;
    if (!entry.isFile()) {
      errors.push("Unsafe workflow entry: " + entry.name);
      continue;
    }
    try {
      const source = await readFile(join(root, ".github/workflows", entry.name), "utf8");
      errors.push(...auditWorkflowSource(source, entry.name));
    } catch {
      errors.push("Unreadable workflow: " + entry.name);
    }
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  auditCITrustBoundary().then(errors => {
    if (errors.length) {
      for (const error of errors) process.stderr.write(error + "\n");
      process.exitCode = 1;
    } else {
      process.stdout.write("CI trust-boundary source audit passed (no deployment).\n");
    }
  }).catch(() => { process.stderr.write("CI trust-boundary audit failed.\n"); process.exitCode = 1; });
}
