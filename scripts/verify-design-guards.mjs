/**
 * JODLO first-pass design guard: prevents common hardcoded visual constants,
 * inline UI strings and byte-identical media assets as source is introduced.
 * Semantic duplication and visual quality still require review/device testing.
 * No Android source exists in the foundation yet: this is preventive.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binaryAssetExt = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg", ".json", ".lottie", ".riv", ".glb", ".gltf"]);
const ignoreDirs = new Set(["node_modules", ".git", ".gradle", "build", "dist", ".wrangler", "out"]);
const uiRules = [
  ["Inline Compose Text literal: use localized stringResource", /\bText\s*\(\s*(?:(?:text)\s*=\s*)?"[^"]+/g],
  ["Inline UI contentDescription literal: use stringResource", /\bcontentDescription\s*=\s*"[^"]+/g],
  ["Raw Compose color literal: use centralized semantic theme tokens", /\bColor\s*\(\s*0x[0-9A-Fa-f]+/g],
  ["Named palette color outside design system: use semantic colors", /\bColor\.(?:Red|Blue|Green|Yellow|Cyan|Magenta|Gray|DarkGray|LightGray|Black|White)\b/g],
  ["Raw fontSize: use Typography tokens", /\bfontSize\s*=\s*\d+(?:\.\d+)?\.sp\b/g],
  ["Raw corner radius: use Shapes tokens", /\bRoundedCornerShape\s*\(\s*\d+(?:\.\d+)?\.dp\b/g],
  ["Raw border stroke: use stroke tokens", /\bBorderStroke\s*\(\s*\d+(?:\.\d+)?\.dp\b/g],
  ["Hardcoded animation duration: use Motion tokens", /\banimationSpec\s*=\s*tween\s*\(\s*\d+/g],
];

async function walk(base) {
  try { if (!(await stat(base)).isDirectory()) return []; } catch { return []; }
  const acc = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) await visit(path);
      } else if (entry.isFile()) acc.push(path);
    }
  }
  await visit(base);
  return acc;
}

function lineOf(s, index) { return 1 + s.slice(0, index).split("\n").length - 1; }
function pathLabel(root, path) { return relative(root, path).split(sep).join("/"); }
function isTest(path) { return /\/(?:test|androidTest)\//.test(path); }
function isTheme(path) { return /\/core\/designsystem\//.test(path) || /\/ui\/theme\//.test(path); }
function isMediaResource(path, rel) {
  return binaryAssetExt.has(extname(path).toLowerCase()) &&
    (/^apps\/android\/.*\/src\/main\/res\/(?:drawable|mipmap|raw)[^/]*\//.test(rel) ||
     /^apps\/android\/.*\/src\/main\/assets\//.test(rel) ||
     /^apps\/web\/(?:public|src\/assets)\//.test(rel));
}

export async function auditDesignRules(root = repoRoot) {
  const errors = [], hashes = new Map();
  let kotlinFiles = 0, xmlFiles = 0, assetFiles = 0;
  for (const base of ["apps/android", "apps/web"]) {
    for (const path of await walk(resolve(root, base))) {
      const rel = pathLabel(root, path), ext = extname(path).toLowerCase();
      if (isMediaResource(path, rel)) {
        assetFiles++;
        const digest = createHash("sha256").update(await readFile(path)).digest("hex");
        if (hashes.has(digest)) errors.push(`Duplicate media asset bytes: ${rel} = ${hashes.get(digest)} (reuse one asset)`);
        else hashes.set(digest, rel);
      }
      if (isTest(path)) continue;
      if (ext === ".kt" && /^apps\/android\//.test(rel)) {
        kotlinFiles++;
        if (isTheme("/" + rel)) continue;
        const s = await readFile(path, "utf8");
        for (const [reason, re] of uiRules) {
          for (const match of s.matchAll(new RegExp(re.source, re.flags))) {
            errors.push(`${rel}:${lineOf(s, match.index)} — ${reason}`);
          }
        }
      }
      if (ext === ".xml" && /^apps\/android\//.test(rel)) {
        xmlFiles++;
        if (/\/res\/values(?:-[^/]+)?\/(?:colors|themes|styles|dimens)\.xml$/.test(rel)) continue;
        const s = await readFile(path, "utf8");
        for (const m of s.matchAll(/\bandroid:text\s*=\s*"([^"]+)"/g)) {
          const v = m[1]; if (!/^@(?:string|plurals)\//.test(v) && !/^\?attr\//.test(v)) {
            errors.push(`${rel}:${lineOf(s, m.index)} — Inline XML text: use @string resource`);
          }
        }
        for (const m of s.matchAll(/\b(?:android:textColor|android:backgroundTint|app:strokeColor)\s*=\s*"(#[0-9a-fA-F]{6,8})"/g)) {
          errors.push(`${rel}:${lineOf(s, m.index)} — Inline XML color: use theme resource`);
        }
      }
    }
  }
  return { errors, kotlinFiles, xmlFiles, assetFiles };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await auditDesignRules();
  if (result.errors.length) {
    console.error("JODLO reuse/design guard FAILED:\n" + result.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`JODLO reuse/design guard OK — ${result.kotlinFiles} Kotlin, ${result.xmlFiles} XML and ${result.assetFiles} media files scanned (future Android/web source protected).`);
  }
}
