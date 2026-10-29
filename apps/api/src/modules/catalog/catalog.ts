import type { D1Database } from "../../data/d1.ts";
import { categoryIntentTerms } from "./search-phrases.ts";
import { PUBLIC_LISTING_ELIGIBILITY } from "../workers/listings.ts";
import { validCategoryId } from "../shared/identifiers.ts";
import { ambiguousWorkCategoryIds, resolveConservativeWorkIntent } from "./intent-aliases.ts";

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

/** Shared syntax for nonpersonal public Category browse and Search cursors. */
function parsePublicCategoryCursor(raw: string): {sortOrder:number;id:string} | null {
  const match=/^(0|[1-9][0-9]{0,6}):([a-zA-Z0-9_-]{1,64})$/.exec(raw);
  if(!match||Number(match[1])>1_000_000||!validCategoryId(match[2]))return null;
  return {sortOrder:Number(match[1]),id:match[2]};
}

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
    after=parsePublicCategoryCursor(afterRaw);
    if(!after)return null;
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
  includeChoices: boolean;
  /** Keyset opt-in; keeps the old 0..100 offset path byte-for-byte compatible. */
  cursor: boolean;
  after: {sortOrder:number;id:string}|null;
}
export type CatalogSearchPage = {
  categories: PublicCategory[];
  nextOffset?: number | null;
  nextCursor?: string | null;
  /** Only emitted after explicit includeChoices=1 and multi-trade evidence. */
  needsChoice?: boolean;
  choices?: PublicCategory[];
};

/** Exact query shape, bounded server-side regardless of client parameters.
 * NFC retains correct Hindi search while eliminating equivalent Unicode spellings.
 */
export function parseCatalogSearch(params: URLSearchParams): CatalogSearchOptions | null {
  const allowed = new Set(["lang", "q", "limit", "offset", "availableOnly", "includeChoices", "cursor", "after"]);
  let unknown = false;
  params.forEach((_value, key) => {
    if (!allowed.has(key) || params.getAll(key).length !== 1) unknown = true;
  });
  if (unknown || params.getAll("q").length !== 1) return null;
  const language = params.get("lang") ?? "en";
  if (language !== "en" && language !== "hi") return null;
  const availability = params.get("availableOnly");
  if (availability !== null && availability !== "1") return null;
  const choices = params.get("includeChoices");
  if(choices !== null && choices !== "1") return null;
  const cursorRaw=params.get("cursor");
  const afterRaw=params.get("after");
  if(cursorRaw!==null&&cursorRaw!=="1")return null;
  if(afterRaw!==null&&cursorRaw!=="1")return null;
  // The curated choice UI is a single explicit user decision, never paginated.
  if(cursorRaw==="1"&&(params.has("offset")||choices==="1"))return null;
  const after=afterRaw===null?null:parsePublicCategoryCursor(afterRaw);
  if(afterRaw!==null&&!after)return null;

  const query = (params.get("q") ?? "").trim().normalize("NFC");
  const length = [...query].length;
  if (length < 2 || length > 64 || /[\u0000-\u001f\u007f-\u009f]/u.test(query)) return null;

  const limitRaw = params.get("limit");
  const offsetRaw = params.get("offset");
  if (limitRaw !== null && !/^(?:[1-9]|1[0-9]|2[0-5])$/.test(limitRaw)) return null;
  if (offsetRaw !== null && !/^(?:0|[1-9][0-9]?|100)$/.test(offsetRaw)) return null;
  // Choices are a bounded user decision, not another paginated search.
  if(choices === "1" && offsetRaw !== null && offsetRaw !== "0") return null;
  return { language, query, limit: limitRaw === null ? 20 : Number(limitRaw),
    offset: offsetRaw === null ? 0 : Number(offsetRaw),
    availableOnly: availability === "1",
    includeChoices: choices === "1",cursor:cursorRaw==="1",after };
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

/** Opt-in, bounded all-trade discovery: keyset traverses matches after the
 * legacy Search offset=100 ceiling. Same active-only and availableOnly guards.
 * Every search term and cursor component is bound, never string-interpolated.
 */
function searchCursorQuery(termCount:number,availableOnly:boolean,hasCursor:boolean):string {
  return PUBLIC_PAGE_FIELDS+"FROM categories WHERE is_active = 1 AND "+
    Array(termCount).fill(MATCH_PUBLIC_CATEGORY_TERM).join(" AND ")+
    (availableOnly?" AND "+ELIGIBLE_LISTING_EXISTS:"")+
    (hasCursor?" AND (sort_order > ? OR (sort_order = ? AND id > ?))":"")+
    " ORDER BY sort_order ASC, id ASC LIMIT ?";
}

/** Alias resolution may only return an already active, backend-approved
 * category; optional listing availability uses the same public eligibility.
 */
function curatedAliasQuery(availableOnly: boolean): string {
  return PUBLIC_CATEGORY_FIELDS + "FROM categories WHERE is_active = 1 AND id = ? " +
    (availableOnly ? "AND " + ELIGIBLE_LISTING_EXISTS + " " : "") +
    "ORDER BY sort_order ASC, id ASC LIMIT ? OFFSET ?";
}

/** Bound to 2..10 current curated trade IDs, no private fields or matching
 * against inactive categories. availableOnly uses published/allowed public rows.
 */
function ambiguousChoicesQuery(count: number, availableOnly: boolean): string {
  if (!Number.isInteger(count) || count < 2 || count > 10)
    throw new Error("Unexpected curated trade choice count");
  return PUBLIC_CATEGORY_FIELDS +
    "FROM categories WHERE categories.is_active = 1 AND categories.id IN (" +
    Array(count).fill("?").join(",") + ") " +
    (availableOnly ? "AND " + ELIGIBLE_LISTING_EXISTS + " " : "") +
    "ORDER BY categories.sort_order ASC, categories.id ASC LIMIT 10";
}

export async function searchPublicCategories(
  db: D1Database, opts: CatalogSearchOptions,
): Promise<CatalogSearchPage> {
  const intent = categoryIntentTerms(opts.query);
  // A generic sentence such as "मुझे काम चाहिए" must not reveal the first
  // category as a false-positive best match.
  if (intent?.length === 0) return opts.cursor
    ? {categories:[],nextCursor:null}
    : {categories:[],nextOffset:null};
  const alias = resolveConservativeWorkIntent(opts.query);
  if(opts.cursor){
    // This is a separate optional transport for exhaustive large-catalog
    // Search, not a change to legacy offset pagination or choice confirmation.
    if(alias.kind==="ambiguous")return {categories:[],nextCursor:null};
    const terms=intent??[opts.query];
    const args:(string|number)[]=[
      opts.language,...terms.flatMap(term=>[term,term,term]),
    ];
    if(opts.after)args.push(opts.after.sortOrder,opts.after.sortOrder,opts.after.id);
    args.push(opts.limit+1);
    const {results}=await db.prepare(searchCursorQuery(
      terms.length,opts.availableOnly,opts.after!==null,
    )).bind(...args).all<PublicCategory&{sortOrder:number}>();
    if(results.length===0&&alias.kind==="unique"&&opts.after===null){
      // A curated one-trade suggestion is still restricted to a pre-approved,
      // active (and optionally available) ID; it never repeats in later pages.
      const {results:alternate}=await db.prepare(curatedAliasQuery(opts.availableOnly))
        .bind(opts.language,alias.categoryId,1,0).all<PublicCategory>();
      return {categories:alternate.map(({id,slug,name})=>({id,slug,name})),
        nextCursor:null};
    }
    const selected=results.slice(0,opts.limit);
    const last=selected[selected.length-1];
    return {
      categories:selected.map(({id,slug,name})=>({id,slug,name})),
      nextCursor:results.length>opts.limit&&last
        ? String(last.sortOrder)+":"+last.id:null,
    };
  }
  // Default remains unchanged. Explicit callers can request bounded,
  // D1-validated options; this does NOT choose/post on the user's behalf.
  if (alias.kind === "ambiguous") {
    if (!opts.includeChoices) return { categories: [], nextOffset: null };
    const ids=ambiguousWorkCategoryIds(opts.query);
    if (ids.length < 2) return { categories: [], nextOffset: null };
    const { results: choices }=await db.prepare(ambiguousChoicesQuery(ids.length,opts.availableOnly))
      .bind(opts.language,...ids).all<PublicCategory>();
    return { categories: [], nextOffset: null, needsChoice: true,
      choices: choices.map(({id,slug,name})=>({id,slug,name})) };
  }
  const terms = intent ?? [opts.query];
  const values = terms.flatMap(term => [term, term, term]);
  const sql = terms.length === 1
    ? (opts.availableOnly ? SEARCH_AVAILABLE_PUBLIC_CATEGORIES_QUERY : SEARCH_PUBLIC_CATEGORIES_QUERY)
    : searchQuery(terms.length, opts.availableOnly);
  const { results } = await db.prepare(sql)
    .bind(opts.language, ...values, opts.limit + 1, opts.offset)
    .all<PublicCategory>();
  // A curated phrase can conflict with the *literal* name of a different
  // active trade. Opt-in clients must not treat that incidental text match as
  // the user's intended profession. Show a bounded explicit choice instead.
  // The default response stays backward compatible for existing clients.
  if (opts.includeChoices && alias.kind === "unique" &&
      results.some(row => row.id !== alias.categoryId)) {
    // Never make up a complete result set from a truncated query page.
    // Fetch at most 11 text matches (independent of client's search limit).
    const { results: literal } = await db.prepare(sql)
      .bind(opts.language, ...values, 11, 0).all<PublicCategory>();
    if (literal.length > 9) {
      return { categories: [], nextOffset: null, needsChoice: true, choices: [] };
    }
    const { results: mapped } = await db.prepare(curatedAliasQuery(opts.availableOnly))
      .bind(opts.language, alias.categoryId, 1, 0).all<PublicCategory>();
    const candidates = new Map<string, PublicCategory>();
    for (const row of [...literal, ...mapped])
      candidates.set(row.id, {id:row.id,slug:row.slug,name:row.name});
    // Stable response for deterministic user confirmation.
    return { categories: [], nextOffset: null, needsChoice: true,
      choices: [...candidates.values()].sort((a,b)=>a.id.localeCompare(b.id)) };
  }
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
  // The parser permits a Search GET only for offsets 0..100. Never advertise
  // a continuation (for example 125) that the same API would reject with 400.
  // This is a deliberate public Search depth bound, not proof of no more rows.
  const candidateOffset = opts.offset + opts.limit;
  return { categories, nextOffset:
    results.length > opts.limit && candidateOffset <= 100 ? candidateOffset : null };
}
