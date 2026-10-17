import { describe, expect, test } from 'vitest';
import { applyDecisions, parseDecisions, decisionKey, makeDecision, partyOutcome } from './decisions.js';
import { loadSnapshot } from './snapshot.js';
import { cslDocument } from './testkit.js';
import { screen } from './screen.js';
import type { Decision, Party, PartyResult, ScreenResult } from './model.js';

const doc = (name: string) =>
  cslDocument([
    { id: 'R1', name, country: 'RU' },
    { id: 'D1', name: 'Veltrane Partners', source: 'Entity List' },
    { id: 'D1', name: 'Veltrane Partners', source: 'Denied Persons List' },
  ]);
const snap = await loadSnapshot(doc('Rosoboronexport'));
const p = (id: string, name: string): Party => ({ id, name, source: 'test' });
const run = (parties: Party[], s = snap) => screen(parties, s);
const party = (r: ScreenResult, id: string) => r.parties.find((x) => x.party.id === id) as PartyResult;
const states = (r: ScreenResult, id: string) => {
  const x = party(r, id);
  return x.status === 'flagged' ? x.matches.map((m) => m.state) : [];
};
const RK = 'Entity List|R1';
const decide = (r: ScreenResult, over: Partial<Parameters<typeof makeDecision>[1]> = {}) =>
  makeDecision(r, { partyId: '1', entryKey: RK, decision: 'cleared', reason: 'different company', reviewer: 'rev', decidedAt: '2026-01-01T00:00:00Z', ...over });

describe('decisionKey', () => {
  test('is unambiguous across the party/entry boundary', () => {
    expect(decisionKey('a', 'b|c')).not.toBe(decisionKey('a|b', 'c'));
  });
});

describe('makeDecision', () => {
  const r = run([p('1', 'Rosoboronexport LLC')]);
  test('copies both fingerprints from the matching flag', () => {
    const m = (party(r, '1') as Extract<PartyResult, { status: 'flagged' }>).matches[0]!;
    expect(decide(r)).toEqual({
      check: 'csl', partyId: '1', entryKey: RK, partyNameKey: 'rosoboronexport', entryFingerprint: m.entryFingerprint,
      decision: 'cleared', reason: 'different company', reviewer: 'rev', decidedAt: '2026-01-01T00:00:00.000Z',
    });
  });
  test('copies runId through when given, and omits it when not', () => {
    expect(decide(r, { runId: '2026-01-01-2' }).runId).toBe('2026-01-01-2');
    expect('runId' in decide(r)).toBe(false);
  });
  test('rejects an empty runId', () => {
    expect(() => decide(r, { runId: '' })).toThrow(/runId/);
  });
  test('rejects blank reason or reviewer', () => {
    expect(() => decide(r, { reason: '   ' })).toThrow(/reason/);
    expect(() => decide(r, { reviewer: '' })).toThrow(/reviewer/);
  });
  test('rejects an unparseable decidedAt and normalises a valid one to UTC ISO', () => {
    for (const decidedAt of ['', 'yesterday']) expect(() => decide(r, { decidedAt })).toThrow(/decidedAt/);
    expect(decide(r, { decidedAt: '2026-01-01T05:00:00+05:00' }).decidedAt).toBe('2026-01-01T00:00:00.000Z');
  });
  test('rejects a pair that is not flagged', () => {
    expect(() => decide(r, { entryKey: 'Entity List|D1' })).toThrow(/not flagged/);
    expect(() => decide(r, { partyId: 'nope' })).toThrow(/not flagged/);
    expect(() => decide(run([p('1', 'Nothing Listed')]))).toThrow(/not flagged/);
  });
});

describe('applyDecisions', () => {
  const r = run([p('1', 'Rosoboronexport LLC')]);

  test('cleared applies and the party becomes flagged-cleared', () => {
    const d = decide(r);
    const out = applyDecisions(r, [d]);
    expect(states(out, '1')).toEqual(['cleared']);
    expect((party(out, '1') as Extract<PartyResult, { status: 'flagged' }>).matches[0]!.decision).toEqual(d);
    expect(partyOutcome(party(out, '1'))).toBe('flagged-cleared');
  });

  test('escalated applies and holds on a later run', () => {
    const d = decide(r, { decision: 'escalated' });
    expect(partyOutcome(party(applyDecisions(r, [d]), '1'))).toBe('flagged-escalated');
    expect(partyOutcome(party(applyDecisions(run([p('1', 'Rosoboronexport LLC')]), [d]), '1'))).toBe('flagged-escalated');
  });

  test('does not mutate its input', () => {
    const before = JSON.stringify(r);
    const out = applyDecisions(r, [decide(r)]);
    expect(JSON.stringify(r)).toBe(before);
    expect(out).not.toBe(r);
    expect(states(r, '1')).toEqual(['new']);
  });

  test('a renamed party is new again', () => {
    const d = decide(r);
    const renamed = run([p('1', 'Rosoboronexport Holdings')]);
    expect(states(renamed, '1')).toEqual(['new']);
    expect(states(applyDecisions(renamed, [d]), '1')).toEqual(['new']);
  });

  test('a changed CSL entry is new again', async () => {
    const d = decide(r);
    const changed = run([p('1', 'Rosoboronexport LLC')], await loadSnapshot(cslDocument([{ id: 'R1', name: 'Rosoboronexport', country: 'RU', programs: ['NEW'] }])));
    expect(states(changed, '1')).toEqual(['new']);
    expect(states(applyDecisions(changed, [d]), '1')).toEqual(['new']);
  });

  test('the latest decision by decidedAt supersedes, whatever the array order', () => {
    const early = decide(r, { decision: 'cleared', decidedAt: '2026-01-01T00:00:00Z' });
    const late = decide(r, { decision: 'escalated', decidedAt: '2026-02-01T00:00:00Z' });
    expect(states(applyDecisions(r, [early, late]), '1')).toEqual(['escalated']);
    expect(states(applyDecisions(r, [late, early]), '1')).toEqual(['escalated']);
  });

  test('latest is by instant, not string order, across offsets', () => {
    // 00:00+05:00 is 19:00Z the previous day: earlier than 2026-01-01T00:00:00Z although it sorts later as a string.
    const earlier = { ...decide(r, { decision: 'cleared' }), decidedAt: '2026-01-01T00:00:00+05:00' };
    const later = { ...decide(r, { decision: 'escalated' }), decidedAt: '2026-01-01T00:00:00Z' };
    expect(states(applyDecisions(r, [earlier, later]), '1')).toEqual(['escalated']);
    expect(states(applyDecisions(r, [later, earlier]), '1')).toEqual(['escalated']);
  });

  test('an unparseable stored decidedAt never applies, even alone or as the apparent latest', () => {
    const good = decide(r, { decision: 'cleared' });
    const bad = { ...decide(r, { decision: 'escalated' }), decidedAt: 'zzz' };
    expect(states(applyDecisions(r, [bad]), '1')).toEqual(['new']);
    expect(states(applyDecisions(r, [good, bad]), '1')).toEqual(['cleared']);
  });

  test('an exact tie goes to escalated, whatever the order', () => {
    const c = decide(r, { decision: 'cleared' });
    const e = { ...decide(r, { decision: 'escalated' }), decidedAt: '2026-01-01T05:00:00+05:00' };
    expect(states(applyDecisions(r, [c, e]), '1')).toEqual(['escalated']);
    expect(states(applyDecisions(r, [e, c]), '1')).toEqual(['escalated']);
  });

  test('a stale latest decision is not bypassed by an older valid one', () => {
    const old = decide(r, { decidedAt: '2026-01-01T00:00:00Z' });
    const stale: Decision = { ...decide(r, { decidedAt: '2026-02-01T00:00:00Z' }), entryFingerprint: 'f'.repeat(64) };
    expect(states(applyDecisions(r, [old, stale]), '1')).toEqual(['new']);
  });

  test('decisions key on party and entry, not entry alone', () => {
    const two = run([p('1', 'Rosoboronexport LLC'), p('2', 'Rosoboronexport LLC')]);
    const out = applyDecisions(two, [decide(two)]);
    expect(states(out, '1')).toEqual(['cleared']);
    expect(states(out, '2')).toEqual(['new']);
  });

  test('the same CSL id on two lists is decided separately', () => {
    const v = run([p('1', 'Veltrane Partners')]);
    const out = applyDecisions(v, [decide(v, { entryKey: 'Entity List|D1' })]);
    const m = (party(out, '1') as Extract<PartyResult, { status: 'flagged' }>).matches;
    expect(Object.fromEntries(m.map((x) => [x.entryKey, x.state]))).toEqual({ 'Entity List|D1': 'cleared', 'Denied Persons List|D1': 'new' });
  });
});

describe('partyOutcome', () => {
  test('clear and unscreenable pass through', () => {
    const r = run([p('1', 'Nothing Listed'), p('2', '...')]);
    expect(partyOutcome(party(r, '1'))).toBe('clear');
    expect(partyOutcome(party(r, '2'))).toBe('unscreenable');
  });
  test('one cleared match plus one new match is flagged-new', () => {
    const v = run([p('1', 'Veltrane Partners')]);
    const out = applyDecisions(v, [decide(v, { entryKey: 'Entity List|D1' })]);
    expect(partyOutcome(party(out, '1'))).toBe('flagged-new');
  });
  test('escalated beats cleared when nothing is new', () => {
    const v = run([p('1', 'Veltrane Partners')]);
    const out = applyDecisions(v, [
      decide(v, { entryKey: 'Entity List|D1' }),
      decide(v, { entryKey: 'Denied Persons List|D1', decision: 'escalated' }),
    ]);
    expect(partyOutcome(party(out, '1'))).toBe('flagged-escalated');
  });
});

describe('applyDecisions ignores records that are not real rulings', () => {
  const r = run([p('1', 'Rosoboronexport LLC')]);
  test.each([
    ['unknown decision value', { decision: 'clear' }],
    ['blank reason', { reason: '  ' }],
    ['another check', { check: 'other' }],
  ])('%s', (_name, over) => {
    const bad = { ...decide(r), ...over } as unknown as Decision;
    expect(states(applyDecisions(r, [bad]), '1')).toEqual(['new']);
  });
});

describe('parseDecisions', () => {
  const good = () => decide(run([p('1', 'Rosoboronexport LLC')]));
  test('returns a valid array unchanged', () => {
    const d = good();
    expect(parseDecisions([d])).toEqual([d]);
    expect(parseDecisions([])).toEqual([]);
  });
  test('accepts a decision with a runId and one without', () => {
    const withRun = { ...good(), runId: '2026-01-01' };
    expect(parseDecisions([withRun, good()])).toEqual([withRun, good()]);
  });
  test.each([
    ['empty', ''],
    ['a number', 7],
    ['null', null],
  ])('rejects a runId that is %s', (_n, runId) => {
    expect(() => parseDecisions([good(), { ...good(), runId }])).toThrow(/decisions\[1\]\.runId/);
  });
  test('rejects a non-array', () => {
    expect(() => parseDecisions({})).toThrow(TypeError);
  });
  test.each([
    ['check', { check: 'x' }],
    ['partyId', { partyId: '' }],
    ['entryKey', { entryKey: 5 }],
    ['partyNameKey', { partyNameKey: '' }],
    ['entryFingerprint', { entryFingerprint: undefined }],
    ['decision', { decision: 'clear' }],
    ['reason', { reason: '' }],
    ['reviewer', { reviewer: ' ' }],
    ['decidedAt', { decidedAt: 'yesterday' }],
  ])('names index and field %s', (field, over) => {
    expect(() => parseDecisions([good(), { ...good(), ...over }])).toThrow(new RegExp(`decisions\\[1\\]\\.${field}`));
  });
});
