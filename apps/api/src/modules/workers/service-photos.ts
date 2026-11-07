import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { validOpaqueId } from "../shared/identifiers.ts";
import { PUBLIC_LISTING_ELIGIBILITY } from "./listings.ts";
import type { ServiceCity } from "./service-area.ts";

const MAX_BYTES = 42 * 1024;
const MAX_EDGE = 512;
const MAX_REVISION = 2147483647;
type Status = "pending" | "approved" | "rejected" | "cleared";
type PhotoState = {status: Status; revision: number};

const CURRENT_WORKER =
  "SELECT s.account_id FROM auth_sessions AS s " +
  "JOIN accounts AS a ON a.id=s.account_id AND a.status='active' " +
  "JOIN worker_profiles AS wp ON wp.account_id=a.id AND wp.status='draft' " +
  "WHERE s.token_hash=? AND s.expires_at>unixepoch()";

/** Admit the Android re-encoded baseline JPEG format. No EXIF, ICC, comments,
 * trailing bytes, attached files or original filenames enter storage.
 * A reviewer still has to inspect the decoded image before publication.
 */
export function validServicePhoto(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_BYTES / 3 * 4 ||
      value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const data = atob(value);
  if (data.length > MAX_BYTES || btoa(data) !== value ||
      data.charCodeAt(0) !== 0xff || data.charCodeAt(1) !== 0xd8) return false;
  const byte = (index: number) => data.charCodeAt(index);
  const word = (index: number) => byte(index) * 256 + byte(index + 1);
  let frame = false;
  let index = 2;
  while (index < data.length) {
    if (byte(index++) !== 0xff) return false;
    const marker = byte(index++);
    const length = word(index);
    if (!Number.isFinite(length) || length < 2 || index + length > data.length) return false;

    if (marker === 0xe0) {
      if (length !== 16 || data.slice(index + 2, index + 7) !== "JFIF\0" ||
          byte(index + 14) !== 0 || byte(index + 15) !== 0) return false;
    } else if (marker === 0xc0) {
      const height = word(index + 3), width = word(index + 5), components = byte(index + 7);
      if (frame || byte(index + 2) !== 8 || (components !== 1 && components !== 3) ||
          length !== 8 + components * 3 || height < 1 || height > MAX_EDGE ||
          width < 1 || width > MAX_EDGE) return false;
      frame = true;
    } else if (marker === 0xda) {
      if (!frame || length < 8) return false;
      index += length;
      if (index >= data.length - 2) return false;
      while (index < data.length) {
        if (byte(index++) !== 0xff) continue;
        while (byte(index) === 0xff) index++;
        const next = byte(index++);
        if (next === 0xd9) return index === data.length;
        if (next !== 0 && !(next >= 0xd0 && next <= 0xd7)) return false;
      }
      return false;
    } else if (marker !== 0xc4 && marker !== 0xdb && marker !== 0xdd) {
      return false;
    }
    index += length;
  }
  return false;
}

export async function ownServicePhoto(db: D1Database, bearer: string, id: string, download: boolean) {
  if (!validSessionToken(bearer) || !validOpaqueId(id)) return null;
  const {results} = await db.prepare(
    "SELECT COALESCE(p.review_status,'cleared') AS status,COALESCE(p.revision,0) AS revision" +
    (download ? ",p.jpeg_base64 AS jpeg" : "") +
    " FROM worker_listings AS wl LEFT JOIN worker_service_photos AS p ON p.listing_id=wl.id " +
    "WHERE wl.id=? AND wl.worker_account_id=(" + CURRENT_WORKER + ")",
  ).bind(id, await sessionHash(bearer)).all<PhotoState & {jpeg?: string | null}>();
  return results[0] ?? null;
}

export async function submitServicePhoto(
  db: D1Database, bearer: string, id: string, revision: number, jpeg: string,
): Promise<PhotoState | null> {
  if (!validSessionToken(bearer) || !validOpaqueId(id) || !validServicePhoto(jpeg) ||
      !Number.isSafeInteger(revision) || revision < 0 || revision >= MAX_REVISION) return null;
  const {results} = await db.prepare(
    "INSERT INTO worker_service_photos(listing_id,category_id,jpeg_base64,review_status,revision) " +
    "SELECT wl.id,wl.category_id,?,'pending',1 FROM worker_listings AS wl " +
    "WHERE wl.id=? AND wl.worker_account_id=(" + CURRENT_WORKER + ") " +
    "AND (?=0 OR EXISTS(SELECT 1 FROM worker_service_photos WHERE listing_id=wl.id AND revision=?)) " +
    "ON CONFLICT(listing_id) DO UPDATE SET category_id=excluded.category_id," +
    "jpeg_base64=excluded.jpeg_base64,review_status='pending',revision=worker_service_photos.revision+1 " +
    "WHERE worker_service_photos.revision=? RETURNING review_status AS status,revision",
  ).bind(jpeg, id, await sessionHash(bearer), revision, revision, revision).all<PhotoState>();
  return results[0] ?? null;
}

export async function clearServicePhoto(db: D1Database, bearer: string, id: string, revision: number) {
  if (!validSessionToken(bearer) || !validOpaqueId(id) ||
      !Number.isSafeInteger(revision) || revision < 1 || revision >= MAX_REVISION) return null;
  const {results} = await db.prepare(
    "UPDATE worker_service_photos SET jpeg_base64=NULL,review_status='cleared',revision=revision+1 " +
    "WHERE listing_id=? AND revision=? AND review_status<>'cleared' " +
    "AND EXISTS(SELECT 1 FROM worker_listings AS wl WHERE wl.id=worker_service_photos.listing_id " +
    "AND wl.worker_account_id=(" + CURRENT_WORKER + ")) RETURNING review_status AS status,revision",
  ).bind(id, revision, await sessionHash(bearer)).all<PhotoState>();
  return results[0] ?? null;
}

const PENDING_PHOTOS =
  " FROM worker_service_photos AS p JOIN worker_listings AS wl ON wl.id=p.listing_id " +
  "JOIN accounts AS a ON a.id=wl.worker_account_id AND a.status='active' " +
  "WHERE p.review_status='pending' AND p.category_id=wl.category_id";

export async function pendingServicePhotos(db: D1Database, after: string | null) {
  const {results} = await db.prepare(
    "SELECT p.listing_id AS listingId,p.category_id AS categoryId,p.revision" + PENDING_PHOTOS +
    " AND p.listing_id>? ORDER BY p.listing_id LIMIT 26",
  ).bind(after ?? "").all<{listingId: string; categoryId: string; revision: number}>();
  const items = results.slice(0, 25);
  return {items, nextCursor: results.length > 25 ? items.at(-1)?.listingId ?? null : null};
}

export async function servicePhotoForReview(db: D1Database, id: string) {
  const {results} = await db.prepare(
    "SELECT p.listing_id AS listingId,p.category_id AS categoryId,p.revision,p.jpeg_base64 AS jpeg" +
    PENDING_PHOTOS + " AND p.listing_id=?",
  ).bind(id).all<{listingId: string; categoryId: string; revision: number; jpeg: string}>();
  return results[0] ?? null;
}

export async function reviewServicePhoto(
  db: D1Database, id: string, revision: number, decision: "approved" | "rejected",
) {
  if (!validOpaqueId(id) || !Number.isSafeInteger(revision) || revision < 1 || revision >= MAX_REVISION ||
      (decision !== "approved" && decision !== "rejected")) return false;
  const {meta} = await db.prepare(
    "UPDATE worker_service_photos SET review_status=?,revision=revision+1 " +
    "WHERE listing_id=? AND revision=? AND review_status='pending' AND EXISTS (" +
    "SELECT 1 FROM worker_listings AS wl JOIN accounts AS a ON a.id=wl.worker_account_id " +
    "WHERE wl.id=worker_service_photos.listing_id AND wl.category_id=worker_service_photos.category_id " +
    "AND a.status='active')",
  ).bind(decision, id, revision).run();
  return meta.changes === 1;
}

export async function publicServicePhoto(db: D1Database, id: string, categoryId: string, city: ServiceCity | null) {
  const {results} = await db.prepare(
    "SELECT p.jpeg_base64 AS jpeg FROM worker_service_photos AS p " +
    "JOIN worker_listings AS wl ON wl.id=p.listing_id AND wl.category_id=p.category_id " +
    "JOIN accounts AS a ON a.id=wl.worker_account_id " +
    "JOIN worker_profiles AS wp ON wp.account_id=a.id " +
    "JOIN categories AS c ON c.id=wl.category_id " +
    "WHERE p.listing_id=? AND p.category_id=? AND p.review_status='approved' AND " + PUBLIC_LISTING_ELIGIBILITY +
    (city === null ? "" : " AND wl.service_city=?"),
  ).bind(id, categoryId, ...(city === null ? [] : [city])).all<{jpeg: string}>();
  return results[0] ?? null;
}
