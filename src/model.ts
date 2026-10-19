import type { SnapshotIdentity } from './snapshot.js';

export interface Party {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 when known. Only annotates matches; never suppresses one. */
  country?: string;
  source: string;
}

export type MatchState = 'new' | 'cleared' | 'escalated';

/** A reviewer's recorded ruling on one party/entry pair, bound to the name and entry content it was made against. */
export interface Decision {
  check: 'csl';
  partyId: string;
  entryKey: string;
  partyNameKey: string;
  entryFingerprint: string;
  decision: 'cleared' | 'escalated';
  reason: string;
  reviewer: string;
  decidedAt: string;
  /** The screening run whose result the reviewer read when making this ruling. Optional; the caller names it. */
  runId?: string;
}

export interface Match {
  /** `${source}|${id}`; unique within a snapshot. */
  entryKey: string;
  /** The raw CSL id, which is not unique on its own. */
  entryId: string;
  entryFingerprint: string;
  matchedName: string;
  listSource: string;
  programs: string[];
  entryType: string | null;
  entryCountries: string[];
  countryMismatch: boolean;
  rule: 'exact' | 'contains' | 'within' | 'similar';
  score: number;
  reason: string;
  state: MatchState;
  decision?: Decision;
}

export type PartyResult = { party: Party; partyNameKey: string } & (
  | { status: 'clear' }
  | { status: 'unscreenable'; reason: 'empty-name' | 'unreadable-characters' }
  | { status: 'flagged'; matches: Match[] }
);

export interface ScreenOptions {
  /** Minimum similarity for the `similar` rule. Default 0.9. */
  threshold?: number;
  /** Replaces DEFAULT_STOP_WORDS. Entries are normalised like names, so 'Inc' or 'L.L.C.' work. */
  stopWords?: readonly string[];
  /** Shortest token that is indexed and used to find candidates. Default 3. */
  minTokenLength?: number;
  /**
   * Replaces DEFAULT_GENERIC_TOKENS: one-word listed entity names that match a party only as its first
   * token. Normalised like names.
   */
  genericTokens?: readonly string[];
}

export const MATCHER_VERSION = '3';

export interface ScreenResult {
  check: 'csl';
  matcher: { version: string; threshold: number; minTokenLength: number; stopWords: string[]; genericTokens: string[] };
  snapshot: SnapshotIdentity;
  counts: { parties: number; screened: number; unscreenable: number; clear: number; flagged: number };
  parties: PartyResult[];
}
