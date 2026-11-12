import type { D1Database } from "../../data/d1.ts";
import { categoryIntentTerms } from "./search-phrases.ts";
import { PUBLIC_LISTING_ELIGIBILITY } from "../workers/listings.ts";
import { validServiceCity, type ServiceCity } from "../workers/service-area.ts";
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

/** Public, bounded exact-ID resolution used by device-only Saved and
 * authenticated owner dashboard UI. Every returned row is an ACTIVE, already
 * approved Category. Never exposes an unpublished name, source evidence,
 * owner, worker status, account, phone or location.
 *
 * This is an opt-in read-only mode of EXISTING GET /api/v1/catalog, not a
 * new route, table, alias, Category activation or availability claim.
 */
export type PublicCategoryLabelRequest = Readonly<{
  language: CatalogLanguage; ids: readonly string[];
}>;

export function parsePublicCategoryLabels(
  params: URLSearchParams,
): PublicCategoryLabelRequest | null {
  if(params.getAll("ids").length!==1 || params.size!==2 ||
      params.getAll("lang").length!==1) return null;
  const lang=params.get("lang");
  if(lang!=="hi" && lang!=="en")return null;
  const raw=params.get("ids")??"";
  // At most 20 exact IDs; no empty, duplicate, query wildcard or whitespace.
  // Validate without any SQL (including when D1 is not configured).
  if(raw.length<1 || raw.length>1_299)return null;
  const ids=raw.split(",");
  if(ids.length<1 || ids.length>20 || new Set(ids).size!==ids.length ||
      ids.some(id=>!validCategoryId(id)))return null;
  return {language:lang,ids};
}

export async function resolveApprovedCategoryLabels(
  db:D1Database, request:PublicCategoryLabelRequest,
):Promise<PublicCategory[]> {
  if(request.ids.length<1 || request.ids.length>20 ||
      new Set(request.ids).size!==request.ids.length ||
      request.ids.some(id=>!validCategoryId(id)))throw Error("Invalid public IDs");
  const sql=PUBLIC_CATEGORY_FIELDS+
    "FROM categories WHERE is_active = 1 AND id IN ("+
    request.ids.map(()=>"?").join(",")+
    ") ORDER BY sort_order ASC, id ASC LIMIT 20";
  const {results}=await db.prepare(sql).bind(request.language,...request.ids)
    .all<PublicCategory>();
  const allowed=new Set(request.ids);
  // Defensive source validation: a faulty D1 adapter cannot manufacture
  // extra category IDs outside the user's explicit request.
  return results
    .filter(({id})=>allowed.has(id))
    .map(({id,slug,name})=>({id,slug,name}));
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
    (hasCursor ? "AND " + currentAnchorSql(availableOnly,0) + " " +
      "AND (sort_order > ? OR (sort_order = ? AND id > ?)) " : "") +
    "ORDER BY sort_order ASC, id ASC LIMIT ?";
}

/** Returns exactly one page; never leaks sort_order to the API projection. */
export async function browsePublicCategories(
  db:D1Database,opts:CatalogBrowseOptions,
):Promise<CatalogBrowsePage> {
  if (opts.limit === null) {
    return {categories:await listPublicCategories(db,opts.language,opts.availableOnly),nextCursor:null};
  }
  // Validate the anchor INSIDE the same SQL statement as the returned page:
  // a category disabled between two previous independent reads cannot skip
  // the current active result set.
  const args: (string | number)[] = [opts.language];
  if(opts.after) args.push(opts.after.id,opts.after.sortOrder,
    opts.after.sortOrder,opts.after.sortOrder,opts.after.id);
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
  /** Explicit city declared by published Workers, never GPS/nearby proximity. */
  city?: ServiceCity | null;
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
  const allowed = new Set(["lang", "q", "limit", "offset", "availableOnly", "includeChoices", "cursor", "after", "city"]);
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
  // City lookup must ask for CURRENT published Services, not for a generic
  // Catalog taxonomy: legacy offset/choice queries keep their old behavior.
  const cityRaw=params.get("city");
  if(cityRaw!==null && (cursorRaw!=="1" || availability!=="1" ||
      !validServiceCity(cityRaw))) return null;
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
    includeChoices: choices === "1",cursor:cursorRaw==="1",after,
    city:cityRaw===null?null:cityRaw as ServiceCity };
}

/** Search ONLY the approved public category taxonomy: no workers, contact,
 * locality, verification labels, exact GPS or seed content. All terms are bound.
 * instr() makes SQL LIKE % and _ literal, preventing wildcard amplification.
 */
const MATCH_PUBLIC_CATEGORY_TERM =
  "(instr(lower(name_en), lower(?)) > 0 " +
  "OR instr(name_hi, ?) > 0 OR instr(slug, lower(?)) > 0)";

/** One SQL statement must both validate a continuation anchor and fetch the
 * next public Category page. The earlier separate anchor SELECT permitted a
 * time-of-check/time-of-use gap if the Category or its listing eligibility
 * changed before the page SELECT. All IDs, ordering tuples and search terms
 * remain SQL bind values, never interpolated into a query.
 *
 * This subquery uses the alias 'anchor' so the eligibility EXISTS must be
 * scoped to anchor.id, rather than the outer candidate Category row.
 */
/** Same authoritative public Listing predicate as the feed, with a *bound*
 * Worker-declared city. Never construct public availability by filtering a
 * page of global Categories on the device.
 */
function cityEligibleCategoryExists(alias:string,city:ServiceCity|null):string {
  const base=ELIGIBLE_LISTING_EXISTS.replace(
    "wl.category_id=categories.id","wl.category_id="+alias+".id");
  return city===null?base:base.slice(0,-1)+" AND wl.service_city=?)";
}
function currentAnchorSql(availableOnly:boolean,termCount:number,
                          city:ServiceCity|null=null):string {
  const eligibility = cityEligibleCategoryExists("anchor",city);
  return "EXISTS (SELECT 1 FROM categories AS anchor " +
    "WHERE anchor.id=? AND anchor.sort_order=? AND anchor.is_active=1" +
    (termCount ? " AND " +
      Array(termCount).fill(MATCH_PUBLIC_CATEGORY_TERM).join(" AND ") : "") +
    (availableOnly ? " AND " + eligibility : "") + ")";
}
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
function searchCursorQuery(termCount:number,availableOnly:boolean,hasCursor:boolean,
                           city:ServiceCity|null=null):string {
  return PUBLIC_PAGE_FIELDS+"FROM categories WHERE is_active = 1 AND "+
    Array(termCount).fill(MATCH_PUBLIC_CATEGORY_TERM).join(" AND ")+
    (availableOnly?" AND "+cityEligibleCategoryExists("categories",city):"")+
    (hasCursor?" AND "+currentAnchorSql(availableOnly,termCount,city)+
      " AND (sort_order > ? OR (sort_order = ? AND id > ?))":"")+
    " ORDER BY sort_order ASC, id ASC LIMIT ?";
}

/** An active curated alias must not silently mask a DIFFERENT active literal
 * match anywhere in the full catalog, including beyond the current page.
 * Query is one bounded existence check; every term and ID is bound.
 */
function searchCursorAliasConflictQuery(termCount:number,availableOnly:boolean,
                                        city:ServiceCity|null=null):string {
  return "SELECT 1 AS conflict FROM categories WHERE is_active = 1 AND "+
    Array(termCount).fill(MATCH_PUBLIC_CATEGORY_TERM).join(" AND ")+
    (availableOnly?" AND "+cityEligibleCategoryExists("categories",city):"")+
    " AND id <> ? LIMIT 1";
}

/** Alias resolution may only return an already active, backend-approved
 * category; optional listing availability uses the same public eligibility.
 */
function curatedAliasQuery(availableOnly: boolean,city:ServiceCity|null=null): string {
  return PUBLIC_CATEGORY_FIELDS + "FROM categories WHERE is_active = 1 AND id = ? " +
    (availableOnly ? "AND " + cityEligibleCategoryExists("categories",city) + " " : "") +
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
  const city=opts.city??null;
  if(city!==null && (!opts.cursor || !opts.availableOnly))
    throw new Error("City Search requires currently public Service availability");
  if(opts.cursor){
    // This is a separate optional transport for exhaustive large-catalog
    // Search, not a change to legacy offset pagination or choice confirmation.
    if(alias.kind==="ambiguous")return {categories:[],nextCursor:null};
    const terms=intent??[opts.query];
    const values=terms.flatMap(term=>[term,term,term]);
    // For continuation, the page SQL rechecks this source Category and all
    // search/availability terms atomically with the page itself.
    // Cursor mode cannot emit the legacy includeChoices response. When the
    // approved curated alias itself is active/available, a competing literal
    // Category match must not be presented as the user's intended trade.
    // Check the entire matching set, not merely the first 25 cursor rows.
    // Explicit confirmation remains available through legacy includeChoices.
    let activeAlias:PublicCategory[]=[];
    if(alias.kind==="unique"){
      const {results:aliasRows}=await db.prepare(curatedAliasQuery(opts.availableOnly,city))
        .bind(opts.language,alias.categoryId,...(city===null?[]:[city]),1,0).all<PublicCategory>();
      activeAlias=aliasRows.map(({id,slug,name})=>({id,slug,name}));
      if(activeAlias.length){
        const {results:conflicts}=await db.prepare(
          searchCursorAliasConflictQuery(terms.length,opts.availableOnly,city),
        ).bind(...values,...(city===null?[]:[city]),alias.categoryId).all<{conflict:number}>();
        if(conflicts.length)return {categories:[],nextCursor:null};
      }
    }
    const args:(string|number)[]=[opts.language,...values];
    if(city!==null) args.push(city);
    if(opts.after) {
      args.push(opts.after.id,opts.after.sortOrder,...values);
      if(city!==null) args.push(city);
      args.push(opts.after.sortOrder,opts.after.sortOrder,opts.after.id);
    }
    args.push(opts.limit+1);
    const {results}=await db.prepare(searchCursorQuery(
      terms.length,opts.availableOnly,opts.after!==null,city,
    )).bind(...args).all<PublicCategory&{sortOrder:number}>();
    if(results.length===0&&alias.kind==="unique"&&opts.after===null){
      // A curated suggestion can only return the active, eligibility-checked
      // Category itself, and never repeats on cursor continuation.
      return {categories:activeAlias,nextCursor:null};
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
