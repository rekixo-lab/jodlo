import type { D1Database } from "../../data/d1.ts";

export type CatalogLanguage = "en" | "hi";
export type PublicCategory = { id: string; slug: string; name: string };

/** One field projection shared by list and search; only public category data. */
const PUBLIC_CATEGORY_FIELDS =
  "SELECT id, slug, CASE WHEN ? = 'hi' THEN COALESCE(NULLIF(name_hi, ''), name_en) ELSE name_en END AS name ";

/** Shared by Worker/D1 adapter and SQLite schema-contract tests. */
export const PUBLIC_CATEGORIES_QUERY =
  PUBLIC_CATEGORY_FIELDS +
  "FROM categories WHERE is_active = 1 ORDER BY sort_order ASC, id ASC LIMIT 100";

export async function listPublicCategories(
  db: D1Database,
  language: CatalogLanguage,
): Promise<PublicCategory[]> {
  const { results } = await db.prepare(PUBLIC_CATEGORIES_QUERY)
    .bind(language)
    .all<PublicCategory>();
  return results.map(({ id, slug, name }) => ({ id, slug, name }));
}

export interface CatalogSearchOptions {
  language: CatalogLanguage;
  query: string;
  limit: number;
  offset: number;
}
export type CatalogSearchPage = {
  categories: PublicCategory[];
  nextOffset: number | null;
};

/** Exact query shape, bounded server-side regardless of client parameters.
 * NFC retains correct Hindi search while eliminating equivalent Unicode spellings.
 */
export function parseCatalogSearch(params: URLSearchParams): CatalogSearchOptions | null {
  const allowed = new Set(["lang", "q", "limit", "offset"]);
  let unknown = false;
  params.forEach((_value, key) => {
    if (!allowed.has(key) || params.getAll(key).length !== 1) unknown = true;
  });
  if (unknown || params.getAll("q").length !== 1) return null;
  const language = params.get("lang") ?? "en";
  if (language !== "en" && language !== "hi") return null;

  const query = (params.get("q") ?? "").trim().normalize("NFC");
  const length = [...query].length;
  if (length < 2 || length > 64 || /[\u0000-\u001f\u007f-\u009f]/u.test(query)) return null;

  const limitRaw = params.get("limit");
  const offsetRaw = params.get("offset");
  if (limitRaw !== null && !/^(?:[1-9]|1[0-9]|2[0-5])$/.test(limitRaw)) return null;
  if (offsetRaw !== null && !/^(?:0|[1-9][0-9]?|100)$/.test(offsetRaw)) return null;
  return { language, query, limit: limitRaw === null ? 20 : Number(limitRaw),
    offset: offsetRaw === null ? 0 : Number(offsetRaw) };
}

/** Search ONLY the approved public category taxonomy: no workers, contact,
 * locality, verification labels, exact GPS or seed content. All terms are bound.
 * instr() makes SQL LIKE % and _ literal, preventing wildcard amplification.
 */
export const SEARCH_PUBLIC_CATEGORIES_QUERY =
  PUBLIC_CATEGORY_FIELDS +
  "FROM categories WHERE is_active = 1 " +
  "AND (instr(lower(name_en), lower(?)) > 0 " +
  "OR instr(name_hi, ?) > 0 OR instr(slug, lower(?)) > 0) " +
  "ORDER BY sort_order ASC, id ASC LIMIT ? OFFSET ?";

export async function searchPublicCategories(
  db: D1Database, opts: CatalogSearchOptions,
): Promise<CatalogSearchPage> {
  const { results } = await db.prepare(SEARCH_PUBLIC_CATEGORIES_QUERY)
    .bind(opts.language, opts.query, opts.query, opts.query, opts.limit + 1, opts.offset)
    .all<PublicCategory>();
  const categories = results.slice(0, opts.limit)
    .map(({ id, slug, name }) => ({ id, slug, name }));
  return { categories, nextOffset: results.length > opts.limit ? opts.offset + opts.limit : null };
}
