import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = path => readFileSync(fileURLToPath(new URL("../" + path, import.meta.url)), "utf8");
const actualHeaders = read("apps/web/_headers");
const html = read("apps/web/index.html");

// Cloudflare Pages _headers source parser for this intentionally tiny,
// single-rule manifest. It is a validation of committed text, not a claim
// about real HTTP response headers or active Pages hosting.
function parseHeaders(source) {
  const lines = source.split(/\r?\n/).filter(line => line.trim() && !line.startsWith("#"));
  assert.equal(lines.shift(), "/*", "Pages headers must cover the static website root");
  const entries = new Map();
  for (const line of lines) {
    const match = line.match(/^  ([A-Za-z][A-Za-z-]*): (.+)$/);
    assert.ok(match, "Unreviewed Pages headers line or route: " + line);
    const key = match[1].toLowerCase();
    assert.ok(!entries.has(key), "Duplicate HTTP header: " + key);
    entries.set(key, match[2]);
  }
  return entries;
}
function directives(value) {
  const parts = new Map();
  for (const part of value.split(";")) {
    if (!part.trim()) continue;
    const [name, ...rest] = part.trim().split(/\s+/);
    assert.ok(!parts.has(name), "Duplicate CSP directive: " + name);
    parts.set(name, rest.join(" "));
  }
  return parts;
}
function verify(source, document = html) {
  const headers = parseHeaders(source);
  const required = new Map([
    ["x-content-type-options", "nosniff"],
    ["x-frame-options", "DENY"],
    ["referrer-policy", "no-referrer"],
    ["cross-origin-opener-policy", "same-origin"],
    ["cross-origin-resource-policy", "same-origin"],
    ["x-robots-tag", "noindex, nofollow, noarchive"],
    ["permissions-policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"],
  ]);
  assert.equal(headers.size, required.size + 1, "Only reviewed security/privacy headers");
  for (const [name, value] of required)
    assert.equal(headers.get(name), value, "Unexpected security header: " + name);
  assert.ok(!headers.has("strict-transport-security"), "Do not set HSTS before TLS is verified");

  const csp = headers.get("content-security-policy");
  assert.equal(typeof csp, "string", "Missing CSP");
  assert.doesNotMatch(csp, /(?:unsafe-inline|unsafe-eval|https?:|data:|blob:|\*)/i,
    "External or executable CSP sources are forbidden on help website");
  const rules = directives(csp);
  const expected = new Map([
    ["default-src", "'none'"],
    ["script-src", "'self'"],
    ["style-src", "'self'"],
    ["img-src", "'self'"],
    ["font-src", "'self'"],
    ["connect-src", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'none'"],
    ["object-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["upgrade-insecure-requests", ""],
  ]);
  assert.deepEqual(rules, expected, "CSP must keep the minimal, reviewed directives");

  const meta = document.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(meta, "Website must retain the fallback HTML CSP");
  // The HTML meta fallback must match shared directives exactly. CSP
  // frame-ancestors is HTTP-only and deliberately absent in the meta tag.
  for (const [name, value] of directives(meta[1])) {
    assert.equal(rules.get(name), value, "HTML and HTTP CSP differ for " + name);
  }
  assert.match(document, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.doesNotMatch(document, /<script(?![^>]*src="\.\/app\.js")/i,
    "Only reviewed self-hosted JS may run");
}

test("Cloudflare Pages website response headers enforce offline privacy by default", () => {
  assert.doesNotThrow(() => verify(actualHeaders));
});

test("fail closed when a header route, privacy control, or CSP source changes", () => {
  const bad = [
    [actualHeaders.replace("/*\n", "/api/*\n"), /website root/],
    [actualHeaders.replace("  X-Frame-Options: DENY\n", ""), /Only reviewed security\/privacy headers/],
    [actualHeaders.replace("script-src 'self'", "script-src 'unsafe-inline'"), /External or executable CSP/],
    [actualHeaders.replace("script-src 'self'", "script-src https://tracker.example"), /External or executable CSP/],
    [actualHeaders.replace("frame-ancestors 'none'", "frame-ancestors *"), /External or executable CSP/],
    [actualHeaders.replace("geolocation=()", "geolocation=(self)"), /Unexpected security header/],
    [actualHeaders.replace("noindex, nofollow, noarchive", "index, follow"), /Unexpected security header/],
    [actualHeaders + "  X-Frame-Options: DENY\n", /Duplicate HTTP header/],
    [actualHeaders.replace("script-src 'self'", "script-src 'self'; script-src 'self'"),
      /Duplicate CSP directive/],
  ];
  for (const [source, pattern] of bad)
    assert.throws(() => verify(source), pattern);
});

test("do not silently weaken CSP only in HTML while HTTP remains strict", () => {
  assert.throws(() => verify(actualHeaders,
    html.replace("connect-src 'none'", "connect-src 'self'")), /HTML and HTTP CSP differ/);
  assert.throws(() => verify(actualHeaders,
    html.replace('<meta http-equiv="Content-Security-Policy"',
      '<meta http-equiv="Content-Security-Policy-Report-Only"')), /fallback HTML CSP/);
});
