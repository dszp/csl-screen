/** Legal-form suffixes and filler words that carry no identity for name matching. */
export const DEFAULT_STOP_WORDS: readonly string[] = [
  'llc', 'inc', 'incorporated', 'co', 'corp', 'corporation', 'company',
  'ltd', 'limited', 'plc', 'pc', 'pllc', 'lp', 'llp', 'the', 'and', 'of',
  'sa', 'ag', 'gmbh', 'srl', 'bv', 'nv', 'oao', 'ooo', 'zao', 'jsc', 'pjsc',
];

/** Latin letters with no NFKD decomposition, and their ASCII spelling. */
const LATIN_FOLD: Readonly<Record<string, string>> = {
  'ß': 'ss', 'ẞ': 'SS', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ø': 'o', 'Ø': 'O',
  'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ð': 'd', 'Ð': 'D', 'þ': 'th', 'Þ': 'TH', 'ı': 'i',
};
const LATIN_FOLD_RE = new RegExp(`[${Object.keys(LATIN_FOLD).join('')}]`, 'g');

/**
 * NFKD, every combining mark (\p{M}) and format character (\p{Cf}) deleted, then the Latin fold:
 * the form every name is compared in. Deleting rather than separating means an invisible character
 * typed inside a word (a zero-width space, soft hyphen, bidi mark or variation selector in "Ros\u200Bneft")
 * leaves the word whole instead of splitting it into fragments that match nothing.
 */
function foldLatin(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .replace(LATIN_FOLD_RE, (c) => LATIN_FOLD[c]!);
}

/**
 * True when, after the fold, the name still has a letter outside A-Z/a-z, or a control (other than tab,
 * LF and CR), private-use or unassigned character. Such a name cannot be tokenised safely: a look-alike
 * letter from another script (Cyrillic о in "Rоsneft") or an unreadable character would split the word
 * and hide a listed entity, so the caller must screen it by hand.
 */
export function hasUnreadableCharacters(name: string): boolean {
  return /[^\P{L}A-Za-z]|[^\P{Cc}\t\n\r]|[\p{Co}\p{Cn}]/u.test(foldLatin(name));
}

/**
 * Lowercase ASCII tokens of a name: diacritics stripped, `&` read as "and",
 * everything outside [a-z0-9] treated as a separator, runs of single-character
 * tokens joined ("L.L.C." is `llc`, "D. K. Smith" is `dk smith`), stop words dropped.
 * Letters outside the Latin alphabet and other unreadable characters act as separators; see `hasUnreadableCharacters`.
 */
export function nameTokens(name: string, stopWords: ReadonlySet<string>): string[] {
  const raw = foldLatin(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t !== '');
  // Join before dropping stop words, so initials ("L.L.C.") become the word they spell.
  const joined: string[] = [];
  let run = '';
  for (const t of raw) {
    if (t.length === 1) run += t;
    else {
      if (run) joined.push(run);
      run = '';
      joined.push(t);
    }
  }
  if (run) joined.push(run);
  return joined.filter((t) => !stopWords.has(t));
}

export function normalizeName(name: string, stopWords: ReadonlySet<string>): string {
  return nameTokens(name, stopWords).join(' ');
}
