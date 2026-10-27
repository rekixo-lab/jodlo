import type { D1Database } from "../../data/d1.ts";
import { categoryIntentTerms } from "./search-phrases.ts";
import { PUBLIC_LISTING_ELIGIBILITY } from "../workers/listings.ts";
import { validCategoryId } from "../shared/identifiers.ts";
import { resolveConservativeWorkIntent } from "./intent-aliases.ts";

export type CatalogLanguage = "en" | "hi";
export type PublicCategory = { id: string; slug: string; name: string };

/** One field projection shared by list and search; only public category data. */
const PUBLIC_CATEGORY_FIELDS =
  "SELECT id, slug, CASE WHEN ? = 'hi' THEN COALESCE(NULLIF(name_hi, ''), name_en) ELSE name_en END AS name ";

/** Shared by Worker/D1 adapter and SQLite schema-contract tests. */
export const PUBLIC_CATEGORIES_QUERY =
  PUBLIC_CATEGORY_FIELDS +
  "FROM categories WHERE is_active = 1 ORDER BY sort_order ASC, id ASC LIMIT 100";

/** Nonpersonal availability: a category qualifies only when an actual public
 * listing would pass the SAME account/worker/category/moderation SQL rules.
 * No worker identity, coordinates, count or contact is returned. EXISTS avoids
 * multiple listings duplicating a single category row.
 */
const ELIGIBLE_LISTING_EXISTS =
  "EXISTS (SELECT 1 FROM worker_listings AS wl " +
  "JOIN accounts AS a ON a.id=wl.worker_account_id " +
  "JOIN worker_profiles AS wp ON wp.account_id=a.id " +
  "JOIN categories AS c ON c.id=wl.category_id " +
  "WHERE wl.category_id=categories.id AND " + PUBLIC_LISTING_ELIGIBILITY + ")";

export const AVAILABLE_PUBLIC_CATEGORIES_QUERY =
  PUBLIC_CATEGORY_FIELDS + "FROM categories WHERE is_active = 1 AND " +
  ELIGIBLE_LISTING_EXISTS + " ORDER BY sort_order ASC, id ASC LIMIT 100";

export async function listPublicCategories(
  db: D1Database,
  language: CatalogLanguage,
  availableOnly = false,
): Promise<PublicCategory[]> {
  const sql = availableOnly ? AVAILABLE_PUBLIC_CATEGORIES_QUERY : PUBLIC_CATEGORIES_QUERY;
  const { results } = await db.prepare(sql)
    .bind(language)
    .all<PublicCategory>();
  return results.map(({ id, slug, name }) => ({ id, slug, name }));
}

/** A bounded keyset page lets a manual category picker eventually traverse
 * hundreds of approved entries without loading a giant UI grid at once.
 * The original unpaginated /catalog response remains unchanged (100 cap).
 */
export interface CatalogBrowseOptions {
  language: CatalogLanguage;
  availableOnly: boolean;
  limit: number | null;
  after: { sortOrder: number; id: string } | null;
}

export type CatalogBrowsePage = {
  categories: PublicCategory[];
  nextCursor: string | null;
};

/** Strict public cursor: sort-order and an already public category ID, not a
 * personal identifier. Server still independently filters active/eligible rows.
 */
export function parseCatalogBrowse(params: URLSearchParams): CatalogBrowseOptions | null {
  const allowed = new Set(["lang","availableOnly","limit","after"]);
  let invalid = false;
  params.forEach((_value,key) => {
    if (!allowed.has(key) || params.getAll(key).length !== 1) invalid = true;
  });
  if (invalid) return null;
  const language = params.get("lang") ?? "en";
  if (language !== "en" && language !== "hi") return null;
  const availability = params.get("availableOnly");
  if (availability !== null && availability !== "1") return null;
  const limitRaw = params.get("limit");
  const afterRaw = params.get("after");
  if (limitRaw === null && afterRaw !== null) return null;
  if (limitRaw !== null && !/^(?:[1-9]|1[0-9]|2[0-5])$/.test(limitRaw)) return null;
  let after: CatalogBrowseOptions["after"] = null;
  if (afterRaw !== null) {
    const match = /^(0|[1-9][0-9]{0,6}):([a-zA-Z0-9_-]{1,64})$/.exec(afterRaw);
    if (!match || Number(match[1]) > 1_000_000 || !validCategoryId(match[2])) return null;
    after = {sortOrder:Number(match[1]),id:match[2]};
  }
  return {language,availableOnly:availability === "1",
    limit:limitRaw === null ? null : Number(limitRaw),after};
}

const PUBLIC_PAGE_FIELDS = PUBLIC_CATEGORY_FIELDS.trimEnd() + ", sort_order AS sortOrder ";
function browsePageSql(availableOnly: boolean, hasCursor: boolean): string {
  return PUBLIC_PAGE_FIELDS + "FROM categories WHERE is_active = 1 " +
    (availableOnly ? "AND " + ELIGIBLE_LISTING_EXISTS + " " : "") +
    (hasCursor ? "AND (sort_order > ? OR (sort_order = ? AND id > ?)) " : "") +
    "ORDER BY sort_order ASC, id ASC LIMIT ?";
}

/** Returns exactly one page; never leaks sort_order to the API projection. */
export async function browsePublicCategories(
  db:D1Database,opts:CatalogBrowseOptions,
):Promise<CatalogBrowsePage> {
  if (opts.limit === null) {
    return {categories:await listPublicCategories(db,opts.language,opts.availableOnly),nextCursor:null};
  }
  const args: (string | number)[] = [opts.language];
  if(opts.after) args.push(opts.after.sortOrder,opts.after.sortOrder,opts.after.id);
  args.push(opts.limit + 1);
  const {results} = await db.prepare(browsePageSql(opts.availableOnly,opts.after !== null))
    .bind(...args).all<PublicCategory & {sortOrder:number}>();
  const selected = results.slice(0,opts.limit);
  const last = selected[selected.length-1];
  return {
    categories:selected.map(({id,slug,name})=>({id,slug,name})),
    nextCursor:results.length > opts.limit && last
      ? String(last.sortOrder) + ":" + last.id : null,
  };
}

export interface CatalogSearchOptions {
  language: CatalogLanguage;
  query: string;
  limit: number;
  offset: number;
  availableOnly: boolean;
}
export type CatalogSearchPage = {
  categories: PublicCategory[];
  nextOffset: number | null;
};

/** Exact query shape, bounded server-side regardless of client parameters.
 * NFC retains correct Hindi search while eliminating equivalent Unicode spellings.
 */
export function parseCatalogSearch(params: URLSearchParams): CatalogSearchOptions | null {
  const allowed = new Set(["lang", "q", "limit", "offset", "availableOnly"]);
  let unknown = false;
  params.forEach((_value, key) => {
    if (!allowed.has(key) || params.getAll(key).length !== 1) unknown = true;
  });
  if (unknown || params.getAll("q").length !== 1) return null;
  const language = params.get("lang") ?? "en";
  if (language !== "en" && language !== "hi") return null;
  const availability = params.get("availableOnly");
  if (availability !== null && availability !== "1") return null;

  const query = (params.get("q") ?? "").trim().normalize("NFC");
  const length = [...query].length;
  if (length < 2 || length > 64 || /[\u0000-\u001f\u007f-\u009f]/u.test(query)) return null;

  const limitRaw = params.get("limit");
  const offsetRaw = params.get("offset");
  if (limitRaw !== null && !/^(?:[1-9]|1[0-9]|2[0-5])$/.test(limitRaw)) return null;
  if (offsetRaw !== null && !/^(?:0|[1-9][0-9]?|100)$/.test(offsetRaw)) return null;
  return { language, query, limit: limitRaw === null ? 20 : Number(limitRaw),
    offset: offsetRaw === null ? 0 : Number(offsetRaw),
    availableOnly: availability === "1" };
}

/** Search ONLY the approved public category taxonomy: no workers, contact,
 * locality, verification labels, exact GPS or seed content. All terms are bound.
 * instr() makes SQL LIKE % and _ literal, preventing wildcard amplification.
 */
const MATCH_PUBLIC_CATEGORY_TERM =
  "(instr(lower(name_en), lower(?)) > 0 " +
  "OR instr(name_hi, ?) > 0 OR instr(slug, lower(?)) > 0)";
const PUBLIC_CATEGORY_SORT_PAGE = " ORDER BY sort_order ASC, id ASC LIMIT ? OFFSET ?";

function searchQuery(termCount: number, availableOnly = false): string {
  // termCount is internal and bounded by categoryIntentTerms to at most 6.
  // Every term is still passed via bound parameters; never embedded in SQL.
  return PUBLIC_CATEGORY_FIELDS + "FROM categories WHERE is_active = 1 AND " +
    Array(termCount).fill(MATCH_PUBLIC_CATEGORY_TERM).join(" AND ") +
    (availableOnly ? " AND " + ELIGIBLE_LISTING_EXISTS : "") +
    PUBLIC_CATEGORY_SORT_PAGE;
}

export const SEARCH_PUBLIC_CATEGORIES_QUERY = searchQuery(1);
export const SEARCH_AVAILABLE_PUBLIC_CATEGORIES_QUERY = searchQuery(1, true);

/** Alias resolution may only return an already active, backend-approved
 * category; optional listing availability uses the same public eligibility.
 */
function curatedAliasQuery(availableOnly: boolean): string {
  return PUBLIC_CATEGORY_FIELDS + "FROM categories WHERE is_active = 1 AND id = ? " +
    (availableOnly ? "AND " + ELIGIBLE_LISTING_EXISTS + " " : "") +
    "ORDER BY sort_order ASC, id ASC LIMIT ? OFFSET ?";
}

export async function searchPublicCategories(
  db: D1Database, opts: CatalogSearchOptions,
): Promise<CatalogSearchPage> {
  const intent = categoryIntentTerms(opts.query);
  // A generic sentence such as "मुझे काम चाहिए" must not reveal the first
  // category as a false-positive best match.
  if (intent?.length === 0) return { categories: [], nextOffset: null };
  const alias = resolveConservativeWorkIntent(opts.query);
  // Two distinct trades are not automatically collapsed to one category.
  if (alias.kind === "ambiguous") return { categories: [], nextOffset: null };
  const terms = intent ?? [opts.query];
  const values = terms.flatMap(term => [term, term, term]);
  const sql = terms.length === 1
    ? (opts.availableOnly ? SEARCH_AVAILABLE_PUBLIC_CATEGORIES_QUERY : SEARCH_PUBLIC_CATEGORIES_QUERY)
    : searchQuery(terms.length, opts.availableOnly);
  const { results } = await db.prepare(sql)
    .bind(opts.language, ...values, opts.limit + 1, opts.offset)
    .all<PublicCategory>();
  // Preserve the pre-existing name/grammar search and its pagination.
  // Only on an actual miss try one conservative category-specific alias.
  if (results.length === 0 && alias.kind === "unique") {
    const { results: alternate } = await db.prepare(curatedAliasQuery(opts.availableOnly))
      .bind(opts.language, alias.categoryId, opts.limit + 1, opts.offset)
      .all<PublicCategory>();
    const suggested = alternate.slice(0, opts.limit)
      .map(({ id, slug, name }) => ({ id, slug, name }));
    return { categories: suggested, nextOffset: null };
  }
  const categories = results.slice(0, opts.limit)
    .map(({ id, slug, name }) => ({ id, slug, name }));
  return { categories, nextOffset: results.length > opts.limit ? opts.offset + opts.limit : null };
}
