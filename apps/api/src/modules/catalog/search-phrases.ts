/**
 * JODLO original Hindi/Hinglish/English phrase analyzer.
 *
 * Inspired by read-only understanding of the OLD app's user journey, never
 * copied from its Firebase vocabulary or code. This intentionally does NOT
 * infer synonyms, professions, verified people, localities or work status.
 * It only removes a tiny, explicit set of grammatical/intention words before
 * finding published category names in the EXISTING public catalog.
 */
const NON_TRADE_WORDS = new Set([
  // Basic Hindi / spoken Hindi grammar and search intent
  "मुझे", "मेरा", "मेरे", "मेरी", "मैं", "हूँ", "हूं", "है", "का", "की", "के",
  "को", "लिए", "काम", "करता", "करती", "करते", "चाहिए", "चाहिये", "वाला",
  // Roman Hindi/Hinglish: no word→category translations or invented aliases
  "mujhe", "mera", "mere", "meri", "mai", "main", "hu", "hun", "hai",
  "ka", "ki", "ke", "ko", "liye", "kaam", "karta", "karti", "karte",
  "chahiye", "chahie", "wala",
  // Short English natural-language search grammar
  "i", "am", "need", "looking", "for", "please", "a", "the", "work",
  "service", "services",
]);

const MAX_QUERY_TOKENS = 12;
const MAX_TRADE_TERMS = 6;

/**
 * Return null to preserve existing literal substring search; an empty array
 * means the whole query was only filler, and must not match arbitrary services.
 *
 * Never strip punctuation that might change the meaning of a quoted/SQL-like
 * query. Search remains parameterized, so this is conservative by design.
 */
export function categoryIntentTerms(query: string): string[] | null {
  if (/[\u0000-\u001f\u007f-\u009f'";%_=<>\\]/u.test(query)) return null;
  const normalized = query.normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
  if (!normalized) return null;

  const tokens = normalized.split(/\s+/u);
  if (tokens.length < 2 || tokens.length > MAX_QUERY_TOKENS) return null;
  if (!tokens.some(t => NON_TRADE_WORDS.has(t))) return null;

  const terms = [...new Set(tokens.filter(t => !NON_TRADE_WORDS.has(t)))];
  if (terms.length > MAX_TRADE_TERMS) return null;
  if (terms.some(t => [...t].length < 2)) return null;
  return terms;
}
