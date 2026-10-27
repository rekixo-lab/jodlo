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

const ALIASES: readonly IntentAlias[] = Object.freeze([
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

/** Suggestion evidence only. Never automatic posting or claim of qualification. */
export function resolveConservativeWorkIntent(raw: string): WorkIntent {
  const parsed = tokenize(raw);
  if (!parsed) return NONE;
  const hits = ALIASES
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
