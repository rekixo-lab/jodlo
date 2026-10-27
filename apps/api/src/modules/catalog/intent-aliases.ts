import { validCategoryId } from "../shared/identifiers.ts";

/**
 * Conservative FIRST-WAVE intent aliases. Manually authored test examples,
 * NOT the 7,267 unreviewed legacy service names or a general-language model.
 * They do not activate categories: a separate authoritative D1 active gate
 * is required before a public category suggestion is returned.
 * Expanding this small list needs editorial review and category safety policy.
 */
type IntentAlias = Readonly<{
  categoryId: string;
  locale: "hi" | "en";
  phrase: string;
}>;

export const WORK_INTENT_ALIASES: readonly IntentAlias[] = Object.freeze([
  { categoryId: "plumber", locale: "hi", phrase: "नल टपक रहा है" },
  { categoryId: "plumber", locale: "hi", phrase: "नल ठीक करना" },
  { categoryId: "plumber", locale: "en", phrase: "tap repair" },
  { categoryId: "plumber", locale: "en", phrase: "tap is leaking" },

  { categoryId: "carpenter", locale: "hi", phrase: "लकड़ी का फर्नीचर" },
  { categoryId: "carpenter", locale: "hi", phrase: "लकड़ी की अलमारी" },
  { categoryId: "carpenter", locale: "en", phrase: "wooden furniture" },
  { categoryId: "carpenter", locale: "en", phrase: "furniture repair" },

  { categoryId: "tailor-stitching", locale: "hi", phrase: "कपड़े की सिलाई" },
  { categoryId: "tailor-stitching", locale: "en", phrase: "dress stitching" },

  { categoryId: "bicycle-repairer", locale: "hi", phrase: "साइकिल की मरम्मत" },
  { categoryId: "bicycle-repairer", locale: "en", phrase: "bicycle repair" },

  // Additional explicit engineering examples for six historical candidate IDs.
  // These do NOT seed or activate a catalog category in JODLO.
  { categoryId: "house-painter", locale: "hi", phrase: "दीवार की पुताई" },
  { categoryId: "house-painter", locale: "en", phrase: "wall painting" },
  { categoryId: "house-cleaner-maid", locale: "hi", phrase: "घर की सफाई" },
  { categoryId: "house-cleaner-maid", locale: "en", phrase: "house cleaning" },
  { categoryId: "sofa-carpet-cleaner", locale: "hi", phrase: "सोफे की सफाई" },
  { categoryId: "sofa-carpet-cleaner", locale: "en", phrase: "sofa cleaning" },
  { categoryId: "gardener", locale: "hi", phrase: "बगीचे की देखभाल" },
  { categoryId: "gardener", locale: "en", phrase: "garden maintenance" },
  { categoryId: "watch-repairer", locale: "hi", phrase: "घड़ी की मरम्मत" },
  { categoryId: "watch-repairer", locale: "en", phrase: "watch repair" },
  { categoryId: "tyre-puncture-technician", locale: "hi", phrase: "टायर का पंचर" },
  { categoryId: "tyre-puncture-technician", locale: "en", phrase: "tyre puncture" },
]);

// Non-alias words may be ONLY ordinary single-language sentence framing.
// Restrictive matching prevents capturing an alias buried in unrelated words
// (including unsupported Romanized Hindi) as a confident occupation.
const HINDI_CONTEXT = new Set([
  "मैं", "मुझे", "मेरा", "मेरी", "मेरे", "को", "का", "की", "के", "है",
  "हूँ", "हूं", "लिए", "काम", "चाहिए", "चाहिये", "करना", "करता",
  "करती", "बनाता", "बनाती", "कृपया", "और",
]);
const ENGLISH_CONTEXT = new Set([
  "i", "my", "me", "need", "want", "please", "help", "the", "a",
  "an", "for", "with", "is", "are", "was", "work", "service",
  "services", "to", "do", "can", "you", "fix", "repair", "and",
]);

export type WorkIntent =
  | Readonly<{ kind: "unique"; categoryId: string }>
  | Readonly<{ kind: "ambiguous" }>
  | Readonly<{ kind: "none" }>;

const NONE: WorkIntent = Object.freeze({ kind: "none" });
const AMBIGUOUS: WorkIntent = Object.freeze({ kind: "ambiguous" });

function tokenize(raw: string): { locale: "hi" | "en"; words: string[] } | null {
  if ([...raw].length < 2 || [...raw].length > 64) return null;
  // Keep every injection-like symbol out of the alias resolver; the existing
  // SQL path still treats literal strings as data through bound parameters.
  if (/[\u0000-\u001f\u007f-\u009f'"%;_%=<>\\]/u.test(raw)) return null;
  const text = raw.normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
  if (!text) return null;
  const hasHindi = /\p{Script=Devanagari}/u.test(text);
  const hasLatin = /\p{Script=Latin}/u.test(text);
  if (hasHindi === hasLatin) return null; // mixed or unsupported
  if (/[^\p{Script=Devanagari}\p{Script=Latin}\p{Mark}\p{Number}\s]/u.test(text)) {
    return null;
  }
  const words = text.split(/\s+/u);
  if (words.length > 12) return null;
  return { locale: hasHindi ? "hi" : "en", words };
}

function phraseOffset(words: string[], phrase: string): number {
  const tokens = phrase.split(" ");
  for (let i = 0; i <= words.length - tokens.length; i++) {
    if (tokens.every((token, offset) => words[i + offset] === token)) return i;
  }
  return -1;
}


/** Static registry quality gate for future large-scale, editor-reviewed aliases.
 * No bulk import and no activation; 512 entries is an intentional review cap.
 * Errors are aggregated for reviewer feedback; the live matcher fails closed.
 */
export function validateWorkAliasRegistry(rows: readonly IntentAlias[]): string[] {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 512) {
    return ["Missing or over-budget alias registry"];
  }
  const problems: string[] = [];
  const phrases = new Set<string>();
  const perTrade = new Map<string, number>();
  const valid: IntentAlias[] = [];
  for (const [index, alias] of rows.entries()) {
    if (!alias || typeof alias !== "object" || !validCategoryId(alias.categoryId) ||
        (alias.locale !== "hi" && alias.locale !== "en") ||
        typeof alias.phrase !== "string") {
      problems.push("Invalid category/locale/phrase at " + index);
      continue;
    }
    const name=alias.phrase;
    if ([...name].length < 6 || [...name].length > 64 ||
        name !== name.trim() || name !== name.normalize("NFKC") ||
        name.includes("  ")) {
      problems.push("Unnormalized, unbounded or padded phrase at " + index);
      continue;
    }
    const matchesScript=alias.locale === "en"
      ? /^[a-z]+(?: [a-z]+){1,5}$/u.test(name)
      : /^[\p{Script=Devanagari}\p{Mark}]+(?: [\p{Script=Devanagari}\p{Mark}]+){1,5}$/u.test(name)
        && /\p{Script=Devanagari}/u.test(name);
    if (!matchesScript || (alias.locale === "en" &&
        /\b(?:mujhe|chahiye|kaam|karta|karti|mere|meri|mera|main)\b/u.test(name))) {
      problems.push("Non-canonical script, Romanized-Hindi words or punctuation at " + index);
      continue;
    }
    const phraseKey=alias.locale+"\u0000"+name;
    if (phrases.has(phraseKey)) problems.push("Duplicate alias at " + index);
    phrases.add(phraseKey);
    const tradeKey=alias.locale+"\u0000"+alias.categoryId;
    const count=(perTrade.get(tradeKey)??0)+1;
    perTrade.set(tradeKey,count);
    if (count > 24) problems.push("Too many aliases for one trade");
    valid.push(alias);
  }
  // Cross-category containment is disallowed even when the shorter phrase
  // would otherwise be matched first. Reviewers must resolve that collision.
  for (let i=0;i<valid.length;i++) for (let j=i+1;j<valid.length;j++) {
    const a=valid[i],b=valid[j];
    if (a.locale!==b.locale || a.categoryId===b.categoryId) continue;
    if (phraseOffset(a.phrase.split(" "),b.phrase)>=0 ||
        phraseOffset(b.phrase.split(" "),a.phrase)>=0) {
      problems.push("Conflicting cross-category aliases: "+i+" / "+j);
    }
  }
  return problems;
}

const REGISTRY_ERRORS=validateWorkAliasRegistry(WORK_INTENT_ALIASES);
if (REGISTRY_ERRORS.length) throw new Error("Invalid JODLO category alias registry");

/** Suggestion evidence only. Never automatic posting or claim of qualification. */
export function resolveConservativeWorkIntent(raw: string): WorkIntent {
  const parsed = tokenize(raw);
  if (!parsed) return NONE;
  const hits = WORK_INTENT_ALIASES
    .filter(a => a.locale === parsed.locale && validCategoryId(a.categoryId))
    .map(a => ({ alias: a, at: phraseOffset(parsed.words, a.phrase) }))
    .filter(hit => hit.at >= 0);
  const distinct = new Set(hits.map(hit => hit.alias.categoryId));
  if (distinct.size > 1) return AMBIGUOUS;
  if (distinct.size === 0) return NONE;

  const allowed = parsed.locale === "hi" ? HINDI_CONTEXT : ENGLISH_CONTEXT;
  for (const { alias, at } of hits) {
    const remaining = parsed.words.filter((_word, i) =>
      i < at || i >= at + alias.phrase.split(" ").length);
    if (remaining.every(word => allowed.has(word))) {
      return Object.freeze({ kind: "unique", categoryId: alias.categoryId });
    }
  }
  return NONE;
}
