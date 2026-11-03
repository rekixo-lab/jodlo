/**
 * Produce a SECOND, explicitly public Cloudflare production Wrangler config
 * for the founder-confirmed JODLO Custom Domain.
 *
 * - Reads the existing, gitignored, hardened real-account production config.
 * - Rejects unexpected/public routes, preview URLs and changed bindings.
 * - Never connects to Cloudflare or mutates DNS, D1, secrets or deployments.
 * - Never overwrites a previously generated domain release file.
 *
 * Actual "wrangler deploy --config <domain file>" attaches the public host
 * and is an intentional OPERATOR RELEASE, not what this script does.
 */
import { readFile, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generatedPath as privateConfigPath, verifyProductionConfig } from "./prepare-production-wrangler.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const API_HOSTNAME = "api.jodlo.rekixo.com";
export const API_ORIGIN = "https://" + API_HOSTNAME;
export const publicConfigPath = join(root, "apps/api/wrangler.production.domain.generated.jsonc");

function exactCustomDomainRoutes(routes) {
  return Array.isArray(routes) && routes.length === 1 &&
    routes[0] && typeof routes[0] === "object" && !Array.isArray(routes[0]) &&
    Object.keys(routes[0]).sort().join(",") === "custom_domain,pattern" &&
    routes[0].pattern === API_HOSTNAME &&
    routes[0].custom_domain === true;
}

/** Validate only a dedicated exact-host Custom Domain and the safe real-ID config. */
export function verifyDomainConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      !exactCustomDomainRoutes(config.routes) ||
      config.route !== undefined || config.zone_id !== undefined ||
      config.zone_name !== undefined)
    throw new Error("Custom Domain must be exactly api.jodlo.rekixo.com; no wildcard/website routes");
  const { routes, ...privateConfig } = config;
  return verifyProductionConfig(privateConfig);
}

/** Operator-controlled transition; does not mutate the input or call a provider. */
export function buildDomainConfig(privateConfig) {
  verifyProductionConfig(privateConfig);
  const config = {
    ...structuredClone(privateConfig),
    routes: [{ pattern: API_HOSTNAME, custom_domain: true }],
  };
  verifyDomainConfig(config);
  return config;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main(mode) {
  if (mode === "--write") {
    const config = buildDomainConfig(await readJson(privateConfigPath));
    // The public release file is gitignored and never overwritten silently.
    const file = await open(publicConfigPath, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(config, null, 2) + "\n", "utf8");
    } finally {
      await file.close();
    }
    process.stdout.write("Exact JODLO Custom Domain config generated locally. No DNS/Worker deployment.\n");
  } else if (mode === "--check") {
    const config = await readJson(publicConfigPath);
    const actual = verifyDomainConfig(config);
    const privateConfig = await readJson(privateConfigPath);
    const expected = verifyProductionConfig(privateConfig);
    if (actual.accountId !== expected.accountId ||
        actual.databaseId !== expected.databaseId ||
        JSON.stringify(config.ratelimits) !== JSON.stringify(privateConfig.ratelimits) ||
        config.compatibility_date !== privateConfig.compatibility_date) {
      throw new Error("Domain config drift from real owner production account/D1/rate-limit bindings");
    }
    process.stdout.write("Exact custom API hostname and real production bindings locally verified (NOT deployed).\n");
  } else {
    throw new Error("Use --write (generate new file) or --check (verify existing file)");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(err => {
    process.stderr.write("JODLO API domain preflight: " + err.message + "\n");
    process.exitCode = 1;
  });
}
