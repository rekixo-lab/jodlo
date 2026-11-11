import { createRemoteJWKSet, jwtVerify, errors, type JWTVerifyGetKey } from "jose";
import {
  decodeUntrustedJodloRtdnHint,
  type PlayRtdnHint,
} from "./google-play-rtdn-fences.ts";
import { jodloPlayPurchaseFingerprint } from "./google-play-purchase-preflight.ts";

/** Google-managed public keys. NEVER fetch JWKS from a request or JWT header. */
const GOOGLE_PUBSUB_KEYS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"), {
    timeoutDuration: 3000, cooldownDuration: 30000, cacheMaxAge: 3600000,
  },
);
const MAX_PUSH_BYTES = 16_384;
const MAX_ID_TOKEN_BYTES = 4096;

export type JodloPubSubPolicy = Readonly<{
  audience: string;
  email: string;
  subscription: string;
}>;

export type AuthenticatedPlayPush = Readonly<{
  kind: "authenticated";
  hint: PlayRtdnHint;
  /** Ephemeral, in-memory purchase token. Never log, persist or return it. */
  purchaseToken: string;
}>;
export type PlayPushAuthentication =
  | AuthenticatedPlayPush
  | Readonly<{kind: "rejected" | "unavailable"}>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function validJodloPubSubPolicy(value: unknown): value is JodloPubSubPolicy {
  const p = record(value);
  if (!p || typeof p.audience !== "string" ||
      typeof p.email !== "string" || typeof p.subscription !== "string")
    return false;
  try {
    const url = new URL(p.audience);
    if (url.protocol !== "https:" || !url.hostname || url.username ||
        url.password || url.search || url.hash || url.pathname === "/" ||
        p.audience !== url.toString()) return false;
  } catch { return false; }
  return p.audience.length <= 512 &&
    /^[a-z0-9._-]{3,100}@[a-z0-9.-]{3,160}\.iam\.gserviceaccount\.com$/i.test(p.email) &&
    /^projects\/[a-z][a-z0-9-]{4,80}\/subscriptions\/[A-Za-z][A-Za-z0-9._~+%-]{2,200}$/.test(p.subscription);
}

async function boundedBody(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_PUSH_BYTES))
    throw Error("Invalid Pub/Sub body size");
  if (!request.body) throw Error("Missing Pub/Sub body");
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let lengthRead = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      lengthRead += chunk.value.byteLength;
      if (lengthRead > MAX_PUSH_BYTES) throw Error("Oversized Pub/Sub body");
      parts.push(chunk.value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const all = new Uint8Array(lengthRead);
  let offset = 0;
  for (const chunk of parts) { all.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(all));
}

/** Authenticate Google Pub/Sub PUSH *before* exposing even a hint.
 * Signature, exact single audience, service account email + verified email,
 * numeric Google subject, issuer, exp, iat, subscription and package all
 * have to match. No data mutation or provider API occurs in this module.
 *
 * The JWT verification key is injected only for isolated deterministic tests;
 * the Worker entrypoint uses the fixed Google rotating JWKS.
 */
export async function authenticateJodloPlayPubSubPush(
  request: Request,
  policy: JodloPubSubPolicy,
  nowMs = Date.now(),
  keys: JWTVerifyGetKey = GOOGLE_PUBSUB_KEYS,
): Promise<PlayPushAuthentication> {
  if (!validJodloPubSubPolicy(policy) ||
      !Number.isSafeInteger(nowMs) || nowMs <= 0 ||
      request.method !== "POST" ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers.get("content-type") ?? "",
      ) ||
      new URL(request.url).search !== "")
    return {kind: "rejected"};
  const authorization = request.headers.get("Authorization");
  if (!authorization ||
      !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization) ||
      authorization.length > MAX_ID_TOKEN_BYTES + 7)
    return {kind: "rejected"};
  try {
    const {payload, protectedHeader} = await jwtVerify(authorization.slice(7), keys, {
      algorithms: ["RS256"],
      audience: policy.audience,
      issuer: ["accounts.google.com", "https://accounts.google.com"],
      requiredClaims: ["sub", "iat", "exp", "email", "email_verified"],
      maxTokenAge: "1h", clockTolerance: "5s",
      currentDate: new Date(nowMs),
    });
    if (protectedHeader.alg !== "RS256" ||
        payload.aud !== policy.audience ||
        payload.email !== policy.email ||
        payload.email_verified !== true ||
        typeof payload.sub !== "string" ||
        !/^[0-9]{6,64}$/.test(payload.sub) ||
        typeof payload.exp !== "number" || typeof payload.iat !== "number" ||
        payload.exp - payload.iat > 3600 ||
        payload.exp - payload.iat < 1)
      return {kind: "rejected"};
    const envelope = record(await boundedBody(request));
    if (!envelope || envelope.subscription !== policy.subscription)
      return {kind: "rejected"};
    const hint = await decodeUntrustedJodloRtdnHint(envelope, nowMs);
    if (!hint) return {kind: "rejected"};
    const message = record(envelope.message);
    if (!message || typeof message.data !== "string") return {kind: "rejected"};
    const encoded = atob(message.data);
    const bytes = Uint8Array.from(encoded, character => character.charCodeAt(0));
    const data = record(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)));
    if (!data) return {kind: "rejected"};
    const row = hint.kind === "voided_hint"
      ? record(data.voidedPurchaseNotification)
      : record(data.oneTimeProductNotification);
    const purchaseToken = row?.purchaseToken;
    if (typeof purchaseToken !== "string" ||
        await jodloPlayPurchaseFingerprint(purchaseToken) !== hint.sourceKeyHash)
      return {kind: "rejected"};
    return {kind: "authenticated", hint, purchaseToken};
  } catch (error) {
    // Expected signature/claim/JWT failures and malformed bodies fail closed;
    // temporary JWKS network errors remain retryable, never accepted.
    if (error instanceof errors.JOSEError || error instanceof SyntaxError ||
        error instanceof TypeError || error instanceof RangeError ||
        error instanceof DOMException || error instanceof Error &&
          /Pub\/Sub/.test(error.message))
      return {kind: "rejected"};
    return {kind: "unavailable"};
  }
}
