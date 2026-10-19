import { jaroWinkler } from './jaroWinkler.js';
import { MATCHER_VERSION } from './model.js';
import type { Match, Party, PartyResult, ScreenOptions, ScreenResult } from './model.js';
import { DEFAULT_STOP_WORDS, hasUnreadableCharacters, nameTokens } from './normalize.js';
import type { SlimEntry, Snapshot } from './snapshot.js';

interface IndexedName {
  entry: SlimEntry;
  name: string;
  key: string;
  tokens: Set<string>;
  /** Has a token >= minTokenLength. Names without one match only by `exact` (with or without spaces). */
  indexable: boolean;
}

const RULE_RANK = { exact: 3, contains: 2, within: 1, similar: 0 } as const;
type Rule = keyof typeof RULE_RANK;

/** A one-token listed name on these entry types is too generic (a ship, a nickname) to match inside a longer party name. */
const NON_ENTITY_TYPES: ReadonlySet<string> = new Set(['Individual', 'Vessel', 'Aircraft']);
/**
 * One-word listed entity names (after stop words are dropped) too generic to flag anywhere but a party
 * name's first token. Each was measured on real customer names: as a later token it flagged only
 * unrelated organisations using it as an ordinary word.
 * A word joins this list only from such a measurement, because each one is a name that can be hidden
 * behind another word.
 */
export const DEFAULT_GENERIC_TOKENS: readonly string[] = ['center', 'focus', 'technology', 'united'];

/** Longest run of adjacent party tokens joined when looking for a listed word split by separators. */
const MAX_RUN = 3;
const spaceless = (key: string) => key.replace(/ /g, '');
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const bucket = m.get(k);
  if (bucket) bucket.push(v);
  else m.set(k, [v]);
};

export function screen(parties: Party[], snapshot: Snapshot, options: ScreenOptions = {}): ScreenResult {
  const threshold = options.threshold ?? 0.9;
  const minTokenLength = options.minTokenLength ?? 3;
  if (!(typeof threshold === 'number' && threshold > 0 && threshold <= 1)) {
    throw new TypeError(`threshold must be a number in (0, 1], got ${String(threshold)}`);
  }
  if (!Number.isInteger(minTokenLength) || minTokenLength < 1) {
    throw new TypeError(`minTokenLength must be an integer >= 1, got ${String(minTokenLength)}`);
  }
  const withinMinLength = Math.max(4, minTokenLength);
  // Caller stop words go through the same normalisation as names, so 'Inc' and 'L.L.C.' behave.
  const noStops: ReadonlySet<string> = new Set();
  const stopWords = new Set((options.stopWords ?? DEFAULT_STOP_WORDS).flatMap((w) => nameTokens(w, noStops)));
  const genericTokens = new Set((options.genericTokens ?? DEFAULT_GENERIC_TOKENS).flatMap((w) => nameTokens(w, noStops)));

  const seenIds = new Set<string>();
  for (const party of parties) {
    if (seenIds.has(party.id)) throw new Error(`Duplicate party id: ${party.id}`);
    seenIds.add(party.id);
  }

  const index = new Map<string, IndexedName[]>();
  const bySpaceless = new Map<string, IndexedName[]>();
  let longestSpaceless = 0;

  for (const entry of snapshot.entries) {
    for (const name of [entry.name, ...entry.altNames]) {
      const tokens = nameTokens(name, stopWords);
      if (tokens.length === 0) continue;
      const indexed: IndexedName = { entry, name, key: tokens.join(' '), tokens: new Set(tokens), indexable: tokens.some((t) => t.length >= minTokenLength) };
      push(bySpaceless, spaceless(indexed.key), indexed);
      longestSpaceless = Math.max(longestSpaceless, spaceless(indexed.key).length);
      for (const token of indexed.tokens) if (token.length >= minTokenLength) push(index, token, indexed);
    }
  }

  const results: PartyResult[] = parties.map((party): PartyResult => {
    const tokens = nameTokens(party.name, stopWords);
    const partyNameKey = tokens.join(' ');
    const ptoks = new Set(tokens);
    // A non-Latin letter or unreadable character would split a word into fragments (or vanish), so a listed name could be missed.
    if (hasUnreadableCharacters(party.name)) return { party, partyNameKey, status: 'unscreenable', reason: 'unreadable-characters' };
    // An empty key cannot be screened; it must not read as clear.
    if (partyNameKey === '') return { party, partyNameKey, status: 'unscreenable', reason: 'empty-name' };
    // `within` needs a party token long enough to be distinctive: at least 4, and never shorter than an indexed token.
    const hasLongToken = tokens.some((t) => t.length >= withinMinLength);

    // Each party token, and each run of two or three adjacent tokens joined without spaces, with the position
    // it starts at. A run catches a separator inserted inside a listed word ("Ros-neft Trading" holds
    // "rosneft"). At most MAX_RUN units per position keeps the work linear in the party name's length; a run
    // longer than any listed name cannot match and is not looked up.
    const units = new Map<string, number>();
    for (let i = 0; i < tokens.length; i++) {
      let run = '';
      for (let j = i; j < tokens.length && j - i < MAX_RUN; j++) {
        run += tokens[j];
        if (run.length > longestSpaceless && j > i) break;
        if (!units.has(run)) units.set(run, i);
      }
    }

    const candidates = new Set<IndexedName>();
    for (const u of units.keys()) {
      if (u.length >= minTokenLength) for (const c of index.get(u) ?? []) candidates.add(c);
      for (const c of bySpaceless.get(u) ?? []) candidates.add(c);
    }
    for (const c of bySpaceless.get(spaceless(partyNameKey)) ?? []) candidates.add(c);

    const best = new Map<string, { rule: Rule; score: number; name: IndexedName; reason: string | null }>();
    for (const cand of candidates) {
      let shared = 0;
      for (const t of cand.tokens) if (ptoks.has(t)) shared++;
      const cover = shared / Math.max(ptoks.size, cand.tokens.size);
      const score = Math.min(jaroWinkler(partyNameKey, cand.key), 0.5 + cover / 2);
      // Contained when every listed token is a party token, or a run of them, or the whole listed name is one run.
      const candSpaceless = spaceless(cand.key);
      const inUnits = [...cand.tokens].every((t) => units.has(t)) || units.has(candSpaceless);
      // A one-token name on an entity counts in any position, except a generic word, which counts only first.
      const at = units.get(candSpaceless);
      const containedAlone =
        cand.tokens.size > 1 ||
        (!NON_ENTITY_TYPES.has(cand.entry.type ?? '') && at !== undefined && (at === 0 || !genericTokens.has(candSpaceless)));
      let rule: Rule | null = null;
      let reason: string | null = null;
      if (partyNameKey === cand.key) rule = 'exact';
      else if (spaceless(partyNameKey) === spaceless(cand.key)) {
        rule = 'exact';
        reason = 'exact ignoring spaces';
      } else if (!cand.indexable) continue;
      else if (shared === cand.tokens.size && containedAlone) rule = 'contains';
      else if (inUnits && containedAlone) {
        rule = 'contains';
        reason = 'contains listed name ignoring spaces';
      }
      // A one-word party name counts only as the listed name's first word: as a later word ("Sino IC Test",
      // "Oriental Apple") it is an ordinary word in an unrelated name, measured on real customer names.
      else if (shared === ptoks.size && hasLongToken && (ptoks.size > 1 || cand.key.split(' ')[0] === tokens[0])) rule = 'within';
      else if (score >= threshold) rule = 'similar';
      if (rule === null) continue;
      const cur = best.get(cand.entry.key);
      if (!cur || RULE_RANK[rule] > RULE_RANK[cur.rule] || (rule === cur.rule && score > cur.score)) {
        best.set(cand.entry.key, { rule, score, name: cand, reason });
      }
    }

    if (best.size === 0) return { party, partyNameKey, status: 'clear' };

    const country = party.country?.toUpperCase();
    const matches: Match[] = [...best.values()].map(({ rule, score, name, reason }) => ({
      entryKey: name.entry.key,
      entryId: name.entry.id,
      entryFingerprint: name.entry.fingerprint,
      matchedName: name.name,
      listSource: name.entry.source,
      programs: name.entry.programs,
      entryType: name.entry.type,
      entryCountries: name.entry.countries,
      countryMismatch: !!country && name.entry.countries.length > 0 && !name.entry.countries.includes(country),
      rule,
      // An exact rule is a full match whatever the token-cover heuristic says (spaceless matches cover fewer tokens).
      score: rule === 'exact' ? 1 : score,
      reason:
        reason ??
        (rule === 'exact' ? 'exact after normalisation'
        : rule === 'contains' ? 'contains listed name'
        : rule === 'within' ? 'listed name contains party name'
        : `similar ${score.toFixed(2)}`),
      state: 'new',
    }));
    matches.sort((a, b) => RULE_RANK[b.rule] - RULE_RANK[a.rule] || b.score - a.score || (a.entryKey < b.entryKey ? -1 : a.entryKey > b.entryKey ? 1 : 0));
    return { party, partyNameKey, status: 'flagged', matches };
  });

  const count = (s: PartyResult['status']) => results.filter((r) => r.status === s).length;
  const unscreenable = count('unscreenable');
  return {
    check: 'csl',
    matcher: { version: MATCHER_VERSION, threshold, minTokenLength, stopWords: [...stopWords].sort(), genericTokens: [...genericTokens].sort() },
    snapshot: snapshot.identity,
    counts: {
      parties: results.length,
      screened: results.length - unscreenable,
      unscreenable,
      clear: count('clear'),
      flagged: count('flagged'),
    },
    parties: results,
  };
}
