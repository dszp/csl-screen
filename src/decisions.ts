import type { Decision, Match, PartyResult, ScreenResult } from './model.js';

/** Unambiguous: both parts are JSON-encoded, so no separator inside an id can shift the boundary. */
export function decisionKey(partyId: string, entryKey: string): string {
  return JSON.stringify([partyId, entryKey]);
}

export interface DecisionInput {
  partyId: string;
  entryKey: string;
  decision: 'cleared' | 'escalated';
  reason: string;
  reviewer: string;
  decidedAt: string;
  /** Identifies the run whose result the reviewer read; copied into the Decision. */
  runId?: string;
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== '';

/** Records a ruling bound to the party name and CSL entry content the reviewer actually saw. */
export function makeDecision(result: ScreenResult, input: DecisionInput): Decision {
  const reason = input.reason.trim();
  const reviewer = input.reviewer.trim();
  if (reason === '') throw new Error('A decision needs a non-blank reason');
  if (reviewer === '') throw new Error('A decision needs a non-blank reviewer');
  const decidedAtMs = Date.parse(input.decidedAt);
  if (!Number.isFinite(decidedAtMs)) throw new Error(`decidedAt is not a valid timestamp: ${JSON.stringify(input.decidedAt)}`);
  if (input.runId !== undefined && !nonEmpty(input.runId)) throw new Error('runId, when given, must be a non-empty string');
  const party = result.parties.find((r) => r.party.id === input.partyId);
  const match = party?.status === 'flagged' ? party.matches.find((m) => m.entryKey === input.entryKey) : undefined;
  if (!party || !match) throw new Error(`Party ${input.partyId} is not flagged against entry ${input.entryKey}`);
  return {
    check: 'csl',
    partyId: input.partyId,
    entryKey: input.entryKey,
    partyNameKey: party.partyNameKey,
    entryFingerprint: match.entryFingerprint,
    decision: input.decision,
    reason,
    reviewer,
    decidedAt: new Date(decidedAtMs).toISOString(),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
  };
}

/**
 * Returns a new result with each match's `state` and `decision` set from the latest decision for its
 * (party, entry) key. A decision applies only if the party name and CSL entry are unchanged since it was
 * made; otherwise the match is `new` again. Only the latest decision is considered, so a stale one is not
 * bypassed by an older valid one. "Latest" compares parsed instants, so offsets and precision do not matter;
 * a decision whose `decidedAt` does not parse is never latest and never applies. On an exact tie,
 * `escalated` wins over `cleared`, whatever the array order.
 */
export function applyDecisions(result: ScreenResult, decisions: readonly Decision[]): ScreenResult {
  const latest = new Map<string, { d: Decision; at: number }>();
  for (const d of decisions) {
    // Defensive: a record that is not a real ruling must never clear or escalate anything.
    if (d.check !== 'csl') continue;
    if (d.decision !== 'cleared' && d.decision !== 'escalated') continue;
    if (typeof d.reason !== 'string' || d.reason.trim() === '') continue;
    const at = Date.parse(d.decidedAt);
    if (!Number.isFinite(at)) continue;
    const key = decisionKey(d.partyId, d.entryKey);
    const cur = latest.get(key);
    if (!cur || at > cur.at || (at === cur.at && d.decision === 'escalated')) latest.set(key, { d, at });
  }
  return {
    ...result,
    parties: result.parties.map((r): PartyResult => {
      if (r.status !== 'flagged') return r;
      return {
        ...r,
        matches: r.matches.map((m): Match => {
          const { decision: _prior, ...rest } = m;
          const d = latest.get(decisionKey(r.party.id, m.entryKey))?.d;
          if (!d || d.partyNameKey !== r.partyNameKey || d.entryFingerprint !== m.entryFingerprint) {
            return { ...rest, state: 'new' };
          }
          return { ...rest, state: d.decision, decision: d };
        }),
      };
    }),
  };
}

const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Validates persisted decisions (for example a decisions file read from disk). Throws a TypeError naming the index and field. */
export function parseDecisions(value: unknown): Decision[] {
  if (!Array.isArray(value)) throw new TypeError('decisions must be an array');
  value.forEach((d: unknown, i) => {
    if (d === null || typeof d !== 'object' || Array.isArray(d)) throw new TypeError(`decisions[${i}] is not an object`);
    const r = d as Record<string, unknown>;
    if (r.check !== 'csl') throw new TypeError(`decisions[${i}].check must be "csl"`);
    for (const f of ['partyId', 'entryKey', 'partyNameKey', 'entryFingerprint']) {
      if (!nonEmpty(r[f])) throw new TypeError(`decisions[${i}].${f} must be a non-empty string`);
    }
    if (r.decision !== 'cleared' && r.decision !== 'escalated') throw new TypeError(`decisions[${i}].decision must be "cleared" or "escalated"`);
    if (!nonBlank(r.reason)) throw new TypeError(`decisions[${i}].reason must not be blank`);
    if (!nonBlank(r.reviewer)) throw new TypeError(`decisions[${i}].reviewer must not be blank`);
    if (typeof r.decidedAt !== 'string' || !Number.isFinite(Date.parse(r.decidedAt))) {
      throw new TypeError(`decisions[${i}].decidedAt must be a valid timestamp`);
    }
    if (r.runId !== undefined && !nonEmpty(r.runId)) throw new TypeError(`decisions[${i}].runId must be a non-empty string when present`);
  });
  return value as Decision[];
}

export type PartyOutcome = 'clear' | 'unscreenable' | 'flagged-new' | 'flagged-escalated' | 'flagged-cleared';

export function partyOutcome(r: PartyResult): PartyOutcome {
  if (r.status !== 'flagged') return r.status;
  if (r.matches.some((m) => m.state === 'new')) return 'flagged-new';
  if (r.matches.some((m) => m.state === 'escalated')) return 'flagged-escalated';
  return 'flagged-cleared';
}
