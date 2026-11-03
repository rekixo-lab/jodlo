/**
 * Generates JODLO production Wrangler configuration ONLY from real operator-
 * supplied Cloudflare account + D1 IDs and namespace choices.
 *
 * This tool NEVER calls Cloudflare, migrates a DB or deploys a Worker. It
 * deliberately refuses all local D1 fixture identifiers and production file
 * replacement. The generated file is gitignored and is not an auth credential.
 *
 * Usage on the owner's authenticated workstation:
 *   JODLO_CF_ACCOUNT_ID=... JODLO_D1_DATABASE_ID=... \
 *   JODLO_LOGIN_BURST_NAMESPACE_ID=... JODLO_ACCOUNT_LOGIN_NAMESPACE_ID=... \
 *     npm run production:config:write
 *   npm run production:config:check
 */
import { readFile, open, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const generatedPath = join(root, "apps/api/wrangler.production.generated.jsonc");
const templatePath = join(root, "apps/api/wrangler.jsonc");
const localOnlyD1 = "00000000-0000-0000-0000-000000000001";
const allowedKeys = [
  "name", "main", "compatibility_date", "workers_dev", "send_metrics",
  "account_id", "d1_databases", "ratelimits", "preview_urls",
];

function requireAccountId(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/i.test(value) ||
      /^0{32}$/.test(value)) {
    throw new Error("JODLO_CF_ACCOUNT_ID must be an actual 32-hex Cloudflare account ID");
  }
  return value.toLowerCase();
}

function requireD1Id(value) {
  if (typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ||
      value.toLowerCase() === localOnlyD1 ||
      /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)) {
    throw new Error("JODLO_D1_DATABASE_ID must be the real dedicated D1 UUID, not the local fixture");
  }
  return value.toLowerCase();
}

function requireNamespace(name, value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value) ||
      Number(value) > 2147483647 || value === "1001" || value === "1002") {
    throw new Error(name + " must be an operator-selected, unique positive rate namespace ID (not local 1001/1002)");
  }
  return value;
}

function assertBaseline(config) {
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      config.name !== "jodlo-api" || config.main !== "src/index.ts" ||
      !/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(config.compatibility_date) ||
      config.workers_dev !== false || config.send_metrics !== false ||
      config.routes !== undefined || config.route !== undefined ||
      config.d1_databases !== undefined || config.ratelimits !== undefined ||
      config.vars !== undefined || config.secrets !== undefined ||
      config.preview_urls !== undefined ||
      config.account_id !== undefined) {
    throw new Error("Committed Wrangler baseline changed: stop and review production configuration");
  }
}

/** Pure conversion. Identifiers originate from the human's *real* account. */
export function buildProductionConfig(env, baseline) {
  assertBaseline(baseline);
  const accountId = requireAccountId(env.JODLO_CF_ACCOUNT_ID);
  const databaseId = requireD1Id(env.JODLO_D1_DATABASE_ID);
  const burst = requireNamespace("JODLO_LOGIN_BURST_NAMESPACE_ID",
    env.JODLO_LOGIN_BURST_NAMESPACE_ID);
  const verified = requireNamespace("JODLO_ACCOUNT_LOGIN_NAMESPACE_ID",
    env.JODLO_ACCOUNT_LOGIN_NAMESPACE_ID);
  if (burst === verified) throw new Error("Production rate-limit namespaces must be different");
  if (env.JODLO_FINWORKAR_CF_ACCOUNT_ID &&
      accountId === requireAccountId(env.JODLO_FINWORKAR_CF_ACCOUNT_ID)) {
    throw new Error("JODLO and the explicitly identified Finworkar account must not match");
  }
  return {
    name: baseline.name,
    main: baseline.main,
    compatibility_date: baseline.compatibility_date,
    workers_dev: false,
    preview_urls: false,
    send_metrics: false,
    account_id: accountId,
    d1_databases: [{
      binding: "DB",
      database_name: "jodlo-production",
      database_id: databaseId,
      migrations_dir: "../../infra/migrations",
    }],
    ratelimits: [
      { name: "LOGIN_BURST_LIMITER", namespace_id: burst,
        simple: { limit: 100, period: 10 } },
      { name: "ACCOUNT_LOGIN_LIMITER", namespace_id: verified,
        simple: { limit: 20, period: 60 } },
    ],
  };
}

/** Pure fail-closed local structural preflight: NOT cloud auth or deployment. */
export function verifyProductionConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      Object.keys(config).some(k => !allowedKeys.includes(k)) ||
      config.name !== "jodlo-api" || config.main !== "src/index.ts" ||
      config.workers_dev !== false || config.preview_urls !== false ||
      config.send_metrics !== false ||
      !/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(config.compatibility_date)) {
    throw new Error("Unexpected production config, route, secret, or exposure: review required");
  }
  const accountId = requireAccountId(config.account_id);
  if (!Array.isArray(config.d1_databases) || config.d1_databases.length !== 1)
    throw new Error("Exactly one real JODLO D1 binding required");
  const db = config.d1_databases[0];
  if (Object.keys(db).sort().join(",") !==
      "binding,database_id,database_name,migrations_dir" ||
      db.binding !== "DB" || db.database_name !== "jodlo-production" ||
      db.migrations_dir !== "../../infra/migrations")
    throw new Error("Wrong D1 binding/migration path: refuse");
  const databaseId = requireD1Id(db.database_id);
  if (!Array.isArray(config.ratelimits) || config.ratelimits.length !== 2)
    throw new Error("Both login guards are mandatory");
  for (const [index, expected] of [
    {name:"LOGIN_BURST_LIMITER", limit:100, period:10},
    {name:"ACCOUNT_LOGIN_LIMITER", limit:20, period:60},
  ].entries()) {
    const value = config.ratelimits[index];
    if (Object.keys(value).sort().join(",") !== "name,namespace_id,simple" ||
        value.name !== expected.name ||
        Object.keys(value.simple || {}).sort().join(",") !== "limit,period" ||
        value.simple.limit !== expected.limit ||
        value.simple.period !== expected.period)
      throw new Error("Login admission guard configuration must match current reviewed backend");
    requireNamespace(value.name, value.namespace_id);
  }
  if (config.ratelimits[0].namespace_id === config.ratelimits[1].namespace_id)
    throw new Error("Shared rate namespaces are forbidden for distinct login guards");
  return { accountId, databaseId };
}

/** Upgrade an EXISTING operator-owned generated production file without
 * requesting its real Cloudflare IDs again. Refuse unsafe/unknown fields.
 */
export function hardenProductionConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      (config.preview_urls !== undefined && config.preview_urls !== false))
    throw new Error("Unsafe existing preview URL setting; manual review required");
  const hardened = { ...config, preview_urls: false };
  verifyProductionConfig(hardened);
  return hardened;
}

async function readBaseline() {
  const text = await readFile(templatePath, "utf8");
  // This repo's checked-in Wrangler baseline uses only full-line // comments.
  return JSON.parse(text.replace(/^\s*\/\/[^\n]*$/gm, ""));
}

export async function main(mode, env = process.env) {
  if (mode === "--write") {
    const config = buildProductionConfig(env, await readBaseline());
    verifyProductionConfig(config);
    // O_EXCL: never overwrite a previous real-account config accidentally.
    const file = await open(generatedPath, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(config, null, 2) + "\n", "utf8"); }
    finally { await file.close(); }
    process.stdout.write("Real-ID production config written to gitignored apps/api/wrangler.production.generated.jsonc. NO Cloudflare requests or deployment.\n");
  } else if (mode === "--harden") {
    const old = JSON.parse(await readFile(generatedPath, "utf8"));
    const hardened = hardenProductionConfig(old);
    if (old.preview_urls === false) {
      process.stdout.write("Existing config already denies Version/Preview URLs. No file changed.\n");
    } else {
      // Atomic LOCAL change; file never goes to GitHub or Cloudflare.
      const next = generatedPath + ".next";
      const f = await open(next, "wx", 0o600);
      try { await f.writeFile(JSON.stringify(hardened, null, 2) + "\n", "utf8"); }
      finally { await f.close(); }
      await rename(next, generatedPath);
      process.stdout.write("Existing real-ID production config hardened (LOCAL only).\n");
    }
  } else if (mode === "--check") {
    const json = JSON.parse(await readFile(generatedPath, "utf8"));
    const checked = verifyProductionConfig(json);
    if (env.JODLO_CF_ACCOUNT_ID &&
        checked.accountId !== requireAccountId(env.JODLO_CF_ACCOUNT_ID))
      throw new Error("Generated production config points to a DIFFERENT Cloudflare account");
    if (env.JODLO_D1_DATABASE_ID &&
        checked.databaseId !== requireD1Id(env.JODLO_D1_DATABASE_ID))
      throw new Error("Generated production config points to a DIFFERENT D1 database");
    process.stdout.write("Production config shape validated (not a provider connection/backup/deployment).\n");
  } else {
    throw new Error("Use --write (real IDs), --harden (existing file) or --check");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(error => {
    // No input environment values or token data are printed.
    process.stderr.write("JODLO production preflight: " + error.message + "\n");
    process.exitCode = 1;
  });
}
