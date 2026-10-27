/**
 * JODLO supports exactly two languages: Hindi (Devanagari) and English.
 * Founder explicitly excluded Hinglish / Romanized Hindi on 2026-10-27.
 *
 * Pure category-name sentence parser. It does not translate, transcribe audio,
 * infer occupations, import legacy Finworkar vocabulary, or store query text.
 * Keep the existing public taxonomy and parameterized SQLite matching.
 */
const HINDI_GRAMMAR = new Set([
  "मुझे", "मेरा", "मेरे", "मेरी", "मैं", "हूँ", "हूं", "है", "का", "की", "के",
  "को", "लिए", "काम", "करता", "करती", "करते", "चाहिए", "चाहिये", "वाला",
]);
const ENGLISH_GRAMMAR = new Set([
  "i", "am", "need", "looking", "for", "please", "a", "the", "work",
  "service", "services",
]);

const MAX_QUERY_TOKENS = 12;
const MAX_TRADE_TERMS = 6;

/** null means preserve existing literal-search semantics; [] means reject a
 * filler-only, mixed-script or unsupported-script phrase with NO candidates.
 * All terms are later sent as SQL bind values, never concatenated into SQL.
 */
export function categoryIntentTerms(query: string): string[] | null {
  // SQL-looking/punctuation-heavy queries are still treated as literal text,
  // and never interpreted as natural-language commands.
  if (/[\u0000-\u001f\u007f-\u009f'";%_=<>\\]/u.test(query)) return null;
  const normalized = query.normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
  if (!normalized) return null;

  // Hindi + English in the SAME query is not a third supported language.
  const hasHindi = /\p{Script=Devanagari}/u.test(normalized);
  const hasEnglish = /\p{Script=Latin}/u.test(normalized);
  if (hasHindi && hasEnglish) return [];
  // Never infer other language/script vocabularies from catalog field names.
  if (/[^\p{Script=Devanagari}\p{Script=Latin}\p{Mark}\p{Number}\s]/u.test(normalized)) return [];

  const tokens = normalized.split(/\s+/u);
  if (tokens.length < 2 || tokens.length > MAX_QUERY_TOKENS) return null;
  const filler = hasHindi ? HINDI_GRAMMAR : ENGLISH_GRAMMAR;
  if (!tokens.some(token => filler.has(token))) return null;

  const terms = [...new Set(tokens.filter(token => !filler.has(token)))];
  if (terms.length > MAX_TRADE_TERMS) return null;
  if (terms.some(term => [...term].length < 2)) return null;
  return terms;
}
