import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { validOpaqueId } from "../shared/identifiers.ts";

export type ServiceCity = "bilaspur" | "raipur";

export function validServiceCity(value: unknown): value is ServiceCity {
  return value === "bilaspur" || value === "raipur";
}

type OwnServiceArea = {city: ServiceCity | null; revision: number};

const CURRENT_WORKER =
  "SELECT s.account_id FROM auth_sessions AS s " +
  "JOIN accounts AS a ON a.id=s.account_id AND a.status='active' " +
  "JOIN worker_profiles AS wp ON wp.account_id=a.id AND wp.status='draft' " +
  "WHERE s.token_hash=? AND s.expires_at>unixepoch()";
const OWN_SERVICE =
  " WHERE id=? AND worker_account_id=(" + CURRENT_WORKER + ")";
const AREA_COLUMNS = "service_city AS city,revision";

function projectArea(row: OwnServiceArea | undefined): OwnServiceArea | null {
  if (!row) return null;
  if ((row.city !== null && !validServiceCity(row.city)) ||
      !Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision > 2147483647) {
    throw new Error("Invalid own service area");
  }
  return row;
}

export async function readOwnServiceArea(
  db: D1Database, bearer: string, id: string,
): Promise<OwnServiceArea | null> {
  if (!validSessionToken(bearer) || !validOpaqueId(id)) return null;
  const {results} = await db.prepare("SELECT " + AREA_COLUMNS + " FROM worker_listings" + OWN_SERVICE)
    .bind(id, await sessionHash(bearer)).all<OwnServiceArea>();
  return projectArea(results[0]);
}

/** The owner may withdraw consent from any owned service, including one
 * that is no longer public. Publication and moderation are independent.
 */
export async function changeOwnServiceArea(
  db: D1Database, bearer: string, id: string, city: ServiceCity | null, revision: number,
): Promise<OwnServiceArea | null> {
  if (!validSessionToken(bearer) || !validOpaqueId(id) ||
      (city !== null && !validServiceCity(city)) ||
      !Number.isSafeInteger(revision) || revision < 0 || revision >= 2147483647) return null;
  const {results} = await db.prepare(
    "UPDATE worker_listings SET service_city=?,revision=revision+1" + OWN_SERVICE +
    " AND revision=? RETURNING " + AREA_COLUMNS,
  ).bind(city, id, await sessionHash(bearer), revision).all<OwnServiceArea>();
  return projectArea(results[0]);
}
