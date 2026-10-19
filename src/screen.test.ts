import { describe, expect, test } from 'vitest';
import { loadSnapshot } from './snapshot.js';
import { cslDocument } from './testkit.js';
import { DEFAULT_GENERIC_PARTY_TOKENS, DEFAULT_GENERIC_TOKENS, screen } from './screen.js';
import type { Party, PartyResult, ScreenResult } from './model.js';

const snap = await loadSnapshot(
  cslDocument([
    { id: 'H1', name: 'Huawei Technologies Co., Ltd.', country: 'CN', programs: ['EL'], type: 'Entity' },
    { id: 'R1', name: 'Rosoboronexport', country: 'RU' },
    { id: 'K1', name: 'Hikvision', country: 'CN' },
    { id: 'E1', name: 'Kalaye Electric Company', country: 'IR' },
    { id: 'A1', name: 'Obscura Trading House', alt_names: ['Zyrcon Industries'], country: 'AE' },
    { id: 'T1', name: 'Technology Group Holdings' },
    { id: 'B1', name: 'Brightwell Dynamics Group', alt_names: ['Brightwell Dynamics'] },
    { id: 'N1', name: 'Zentrix Quorbal Vandeck Lumnis Oprax Dynamo' },
    // the same CSL id on two lists is two entries
    { id: 'D1', name: 'Veltrane Partners', source: 'Entity List' },
    { id: 'D1', name: 'Veltrane Partners', source: 'Denied Persons List' },
    // every token is below the index length: matched by exact (with or without spaces) only
    { id: 'S1', name: 'Xu Li' },
    { id: 'DC', name: 'D COMPANY' },
    // one-token listed names on a non-entity type, and a one-token entity name, for the contains anchor
    { id: 'V1', name: 'VICTORY', type: 'Vessel' },
    { id: 'I1', name: 'TOM', type: 'Individual' },
    { id: 'G1', name: 'LLC Center', type: 'Entity' },
    // a party of short tokens only must not reach this by within
    { id: 'Q1', name: 'AB Holdings' },
    // initials join to the indexable token "ctr"
    { id: 'C1', name: 'C.T.R.' },
    { id: 'F1', name: 'Straße Holdings' },
    { id: 'RN', name: 'Rosneft', type: 'Entity' },
  ]),
);

const p = (id: string, name: string, country?: string): Party => ({ id, name, source: 'test', ...(country ? { country } : {}) });
const flagged = (r: ScreenResult, id: string) => {
  const x = r.parties.find((q) => q.party.id === id) as PartyResult;
  if (x.status !== 'flagged') throw new Error(`party ${id} is ${x.status}`);
  return x.matches;
};
const match = (r: ScreenResult, id: string) => flagged(r, id)[0]!;

describe('screen', () => {
  test('planted positives flag', () => {
    const r = screen(
      [p('1', 'Huawei Technologies, Inc.'), p('2', 'Rosoboronexport LLC'), p('3', 'Hikvision USA'), p('4', 'Kalaye Electric Co')],
      snap,
    );
    expect(r.parties.map((x) => x.status)).toEqual(['flagged', 'flagged', 'flagged', 'flagged']);
    expect(match(r, '3').rule).toBe('contains');
    expect(match(r, '3').reason).toBe('contains listed name');
    expect(match(r, '1').rule).toBe('exact');
    expect(match(r, '1').reason).toBe('exact after normalisation');
    expect(match(r, '1')).toMatchObject({
      entryKey: 'Entity List|H1', entryId: 'H1', listSource: 'Entity List', programs: ['EL'],
      entryType: 'Entity', entryCountries: ['CN'], matchedName: 'Huawei Technologies Co., Ltd.', state: 'new', score: 1,
    });
    expect(match(r, '1').entryFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test('unlisted and generic overlap stay clear', () => {
    const r = screen([p('1', 'Sinopec Group'), p('2', 'Acme Technology Group')], snap);
    expect(r.parties.map((x) => x.status)).toEqual(['clear', 'clear']);
    expect(r.counts).toMatchObject({ parties: 2, screened: 2, unscreenable: 0, clear: 2, flagged: 0 });
  });

  test('alias match reports the alias as matchedName', () => {
    const r = screen([p('1', 'Zyrcon Industries Ltd')], snap);
    expect(match(r, '1')).toMatchObject({ matchedName: 'Zyrcon Industries', rule: 'exact', entryId: 'A1' });
  });

  test('country mismatch annotates but never clears', () => {
    const r = screen([p('1', 'Huawei Technologies', 'us'), p('2', 'Huawei Technologies', 'CN'), p('3', 'Huawei Technologies')], snap);
    expect(match(r, '1').countryMismatch).toBe(true);
    expect(r.parties[0]!.status).toBe('flagged');
    expect(match(r, '2').countryMismatch).toBe(false);
    expect(match(r, '3').countryMismatch).toBe(false);
  });

  test('entry without countries never mismatches', () => {
    expect(match(screen([p('1', 'Technology Group Holdings', 'US')], snap), '1').countryMismatch).toBe(false);
  });

  test('name that normalises to nothing is unscreenable, counted, not clear', () => {
    const r = screen([p('9', 'The Company, LLC')], snap);
    expect(r.parties[0]).toMatchObject({ status: 'unscreenable', reason: 'empty-name' });
    expect(r.counts).toMatchObject({ parties: 1, screened: 0, unscreenable: 1, clear: 0 });
    expect(screen([p('9', '...')], snap).parties[0]).toMatchObject({ status: 'unscreenable', reason: 'empty-name' });
  });

  test('a name with letters outside the Latin alphabet is unscreenable, not split and cleared', () => {
    const r = screen(
      [p('1', 'R\u043esneft'), p('2', 'Рособоронэкспорт'), p('3', '\u0391lpha Trading'), p('4', 'Rosoboronexport')],
      snap,
    );
    for (const id of ['1', '2', '3']) {
      expect(r.parties.find((q) => q.party.id === id), id).toMatchObject({ status: 'unscreenable', reason: 'unreadable-characters' });
    }
    expect(r.parties[3]!.status).toBe('flagged');
    expect(r.counts).toMatchObject({ parties: 4, screened: 1, unscreenable: 3 });
  });

  test('an invisible format character or mark inside a word is removed, so the word still matches', () => {
    const probes = ['\u200B', '\u200C', '\u2060', '\uFEFF', '\u00AD', '\u200F', '\u202A', '\u061C', '\uFE00', '\u1DC0', '\u20D0', '\uFE20'];
    const r = screen(probes.map((c, i) => p(String(i), `Ros${c}neft Trading`)), snap);
    for (const [i, c] of probes.entries()) {
      const x = r.parties[i]!;
      const label = `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
      expect(x.partyNameKey, label).toBe('rosneft trading');
      expect(x.status === 'flagged' && x.matches.some((m) => m.entryId === 'RN'), label).toBe(true);
    }
  });

  test('a control or private-use character is unscreenable, not split and cleared', () => {
    const r = screen([p('1', 'Ros\u0000neft Trading'), p('2', 'Ros\uE000neft Trading')], snap);
    for (const x of r.parties) expect(x, x.party.id).toMatchObject({ status: 'unscreenable', reason: 'unreadable-characters' });
  });


  test('folded Latin letters are screenable, and fold the same way in listed names', () => {
    const r = screen([p('1', 'Müller GmbH'), p('2', '\u00c6r\u00f8 Shipping'), p('3', '\u0141\u00f3d\u017a Trading'), p('4', 'Stra\u00dfe Holdings'), p('5', 'Strasse Holdings')], snap);
    expect(r.parties.map((q) => q.status)).toEqual(['clear', 'clear', 'clear', 'flagged', 'flagged']);
    expect(match(r, '5')).toMatchObject({ rule: 'exact', entryId: 'F1', matchedName: 'Stra\u00dfe Holdings' });
  });

  test('threshold is an option', () => {
    const party = [p('1', 'Zentrix Quorbal Vandeck Lumnis Oprax Domino')];
    const low = screen(party, snap, { threshold: 0.9 });
    expect(match(low, '1')).toMatchObject({ rule: 'similar', entryId: 'N1' });
    expect(match(low, '1').score).toBeGreaterThanOrEqual(0.9);
    expect(match(low, '1').score).toBeLessThan(0.95);
    expect(match(low, '1').reason).toBe(`similar ${match(low, '1').score.toFixed(2)}`);
    expect(screen(party, snap, { threshold: 0.95 }).parties[0]!.status).toBe('clear');
    expect(low.matcher.threshold).toBe(0.9);
  });

  test('duplicate party id throws', () => {
    expect(() => screen([p('1', 'Alpha Corp'), p('1', 'Beta Corp')], snap)).toThrow(/duplicate party id/i);
  });

  test('one match per entry even when name and alias both hit', () => {
    const ms = flagged(screen([p('1', 'Brightwell Dynamics Group')], snap), '1');
    expect(ms.filter((m) => m.entryId === 'B1')).toHaveLength(1);
    expect(ms[0]).toMatchObject({ rule: 'exact', matchedName: 'Brightwell Dynamics Group' });
  });

  test('prefers contains over a higher-scoring similar name on the same entry', () => {
    // alias "Brightwell Dynamics" is contained in the party name; the primary name is only similar
    const ms = flagged(screen([p('1', 'Brightwell Dynamics Texas')], snap), '1');
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ rule: 'contains', matchedName: 'Brightwell Dynamics' });
  });

  test('same CSL id on two lists yields two matches keyed apart', () => {
    const ms = flagged(screen([p('1', 'Veltrane Partners')], snap), '1');
    expect(ms.map((m) => m.entryKey).sort()).toEqual(['Denied Persons List|D1', 'Entity List|D1']);
    expect(ms.every((m) => m.entryId === 'D1')).toBe(true);
  });

  test('matches are sorted by rule, then score descending', () => {
    const ms = flagged(screen([p('1', 'Technology Group Holdings Huawei Technologies')], snap), '1');
    expect(ms.length).toBeGreaterThanOrEqual(2);
    const rank = { exact: 3, contains: 2, within: 1, similar: 0 };
    for (let i = 1; i < ms.length; i++) {
      const a = ms[i - 1]!, b = ms[i]!;
      expect(rank[a.rule] > rank[b.rule] || (a.rule === b.rule && a.score >= b.score)).toBe(true);
    }
  });

  test('listed names made only of short tokens match by exact only, never contains', () => {
    expect(match(screen([p('1', 'Xu Li')], snap), '1')).toMatchObject({ rule: 'exact', entryId: 'S1' });
    expect(screen([p('1', 'Xu Li Wang')], snap).parties[0]!.status).toBe('clear');
    expect(screen([p('1', 'D. K. Example Services')], snap).parties[0]!.status).toBe('clear');
    expect(screen([p('1', 'Xu Li')], snap).counts.unscreenable).toBe(0);
  });

  test('initials are joined, so CTR reaches C.T.R. and T R Contractors does not', () => {
    expect(match(screen([p('1', 'CTR')], snap), '1')).toMatchObject({ rule: 'exact', entryId: 'C1' });
    expect(match(screen([p('1', 'C T R')], snap), '1')).toMatchObject({ rule: 'exact', entryId: 'C1' });
    expect(screen([p('1', 'T R Contractors')], snap).parties[0]!.status).toBe('clear');
  });

  test('one-token contains needs an entity type', () => {
    const r = screen(
      [p('1', 'Victory Life Church'), p('2', 'Acme Center'), p('3', 'Tom Jones Plumbing'), p('4', 'Hikvision USA'), p('5', 'Life Victory Church'), p('6', 'Jones Tom Plumbing')],
      snap,
    );
    expect(r.parties.map((x) => x.status)).toEqual(['clear', 'clear', 'clear', 'flagged', 'clear', 'clear']);
    expect(match(r, '4').rule).toBe('contains');
  });

  test('a one-token listed entity name is contained in any position', () => {
    const r = screen([p('1', 'Oil Company Rosneft'), p('2', 'Global Rosneft Services'), p('3', 'Global Ros-neft Services'), p('4', 'Acme Hikvision')], snap);
    expect(match(r, '1')).toMatchObject({ entryId: 'RN', rule: 'contains', reason: 'contains listed name' });
    expect(match(r, '2')).toMatchObject({ entryId: 'RN', rule: 'contains', reason: 'contains listed name' });
    expect(match(r, '3')).toMatchObject({ entryId: 'RN', rule: 'contains', reason: 'contains listed name ignoring spaces' });
    expect(match(r, '4')).toMatchObject({ entryId: 'K1', rule: 'contains' });
  });

  test('a default generic token is contained only as the first token', () => {
    expect(DEFAULT_GENERIC_TOKENS).toContain('center');
    const r = screen([p('1', 'Acme Center'), p('2', 'Center Acme'), p('3', 'Acme Cen-ter')], snap);
    expect(r.parties.map((x) => x.status)).toEqual(['clear', 'flagged', 'clear']);
    expect(match(r, '2')).toMatchObject({ entryId: 'G1', rule: 'contains' });
    expect(screen([p('1', 'Acme Center')], snap, { genericTokens: [] }).parties[0]!.status).toBe('flagged');
  });

  test('a generic token is contained only as the first token, and the option replaces the default list', () => {
    const generic = screen([p('1', 'Global Rosneft Services'), p('2', 'Rosneft Services'), p('3', 'Global Ros-neft Services'), p('4', 'Ros-neft Services')], snap, { genericTokens: ['ROSNEFT'] });
    expect(generic.parties.map((x) => x.status)).toEqual(['clear', 'flagged', 'clear', 'flagged']);
    expect(generic.matcher.genericTokens).toEqual(['rosneft']);
    const none = screen([p('1', 'Global Rosneft Services')], snap, { genericTokens: [] });
    expect(none.parties[0]!.status).toBe('flagged');
    expect(none.matcher.genericTokens).toEqual([]);
  });

  test('within: party name entirely inside a listed name', () => {
    expect(match(screen([p('1', 'Huawei')], snap), '1')).toMatchObject({ rule: 'within', reason: 'listed name contains party name', entryId: 'H1' });
    expect(screen([p('1', 'AB')], snap).parties[0]!.status).toBe('clear');
  });

  test('within: a one-word generic party name counts only as the listed name\'s first word', async () => {
    const lists = await loadSnapshot(
      cslDocument([
        { id: 'W1', name: 'Sino IC Test' },
        { id: 'W2', name: 'The Test Flying Academy' },
        { id: 'W3', name: 'Oriental Apple Company Pte Ltd' },
        { id: 'W4', name: 'Buy Best Electronic' },
        { id: 'W5', name: 'Bank Melli' },
      ]),
    );
    const r = screen([p('1', 'Test'), p('2', 'Apple Inc'), p('3', 'Best Electronic'), p('4', 'Melli'), p('5', 'Test')], lists, {});
    // "The" is a stop word, so "test" is the first word of W2; it is a later word of W1.
    expect(flagged(r, '1').map((m) => `${m.entryId}:${m.rule}`), 'generic word, first in W2 only').toEqual(['W2:within']);
    expect(r.parties[1]!.status, 'generic word, later in W3').toBe('clear');
    expect(flagged(r, '3').map((m) => `${m.entryId}:${m.rule}`), 'two words, later in W4').toEqual(['W4:within']);
    expect(flagged(r, '4').map((m) => `${m.entryId}:${m.rule}`), 'not a generic word, later in W5').toEqual(['W5:within']);
    // genericPartyTokens replaces the list; without "test" on it, every position counts again.
    const none = screen([p('1', 'Test')], lists, { genericPartyTokens: [] });
    expect(flagged(none, '1').map((m) => m.entryId).sort(), 'no generic party words').toEqual(['W1', 'W2']);
    expect(none.matcher.genericPartyTokens, 'reported').toEqual([]);
    // The listed-name list does not restrict within: "United" was measured only as a listed name.
    const united = await loadSnapshot(cslDocument([{ id: 'U1', name: 'Sudan United Trading' }]));
    expect(flagged(screen([p('1', 'United')], united), '1').map((m) => `${m.entryId}:${m.rule}`), 'listed-name list').toEqual(['U1:within']);
    // Nor does the party-name list restrict contains: a listed one-word "Test" entity still counts anywhere.
    const listedTest = await loadSnapshot(cslDocument([{ id: 'X1', name: 'TEST', type: 'Entity' }]));
    expect(flagged(screen([p('1', 'Acme Test Labs')], listedTest), '1').map((m) => `${m.entryId}:${m.rule}`), 'party-name list').toEqual(['X1:contains']);
  });

  test('within needs a party token of at least max(4, minTokenLength)', () => {
    const r5 = screen([p('1', 'Huawei'), p('2', 'Huaw')], snap, { minTokenLength: 5 });
    expect(match(r5, '1')).toMatchObject({ rule: 'within', entryId: 'H1' });
    expect(r5.parties[1]!.status).toBe('clear');
    expect(screen([p('2', 'Huaw')], snap).parties[0]!.status).toBe('clear');
  });

  test('exact ignoring spaces', () => {
    expect(match(screen([p('1', 'Rosoboron Export')], snap), '1')).toMatchObject({ rule: 'exact', reason: 'exact ignoring spaces', entryId: 'R1', score: 1 });
  });

  test('a separator inserted inside a listed word still contains it', () => {
    const r = screen([p('1', 'Ros neft Trading'), p('2', 'Ros-neft Trading'), p('3', "Ros'neft Trading"), p('4', 'Ro sne-ft Trading')], snap);
    for (const x of r.parties) {
      expect(x.status, x.party.name).toBe('flagged');
      expect(x.status === 'flagged' && x.matches[0], x.party.name).toMatchObject({ entryId: 'RN', rule: 'contains', reason: 'contains listed name ignoring spaces' });
    }
  });

  test('a separator inserted or removed inside a word of a multi-token listed name still contains it', () => {
    const r = screen([p('1', 'Kal-aye Electric Trading'), p('2', 'Kalaye-Elec tric Trading'), p('3', 'Brightwelldynamics Texas')], snap);
    expect(match(r, '1')).toMatchObject({ entryId: 'E1', rule: 'contains', reason: 'contains listed name ignoring spaces' });
    expect(match(r, '2')).toMatchObject({ entryId: 'E1', rule: 'contains', reason: 'contains listed name ignoring spaces' });
    expect(match(r, '3')).toMatchObject({ entryId: 'B1', rule: 'contains', matchedName: 'Brightwell Dynamics', reason: 'contains listed name ignoring spaces' });
  });

  test('runs join at most three adjacent tokens, so a very long party name screens in bounded time', () => {
    // a word split into four pieces is past the run limit
    expect(screen([p('1', 'Ro s-ne ft Trading')], snap).parties[0]!.status).toBe('clear');
    const long = Array.from({ length: 5000 }, (_, i) => `w${i.toString(36)}x`).join(' ');
    const start = Date.now();
    const r = screen([p('1', `Ros neft ${long}`)], snap);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(match(r, '1')).toMatchObject({ entryId: 'RN', rule: 'contains', reason: 'contains listed name ignoring spaces' });
  });

  test('joined party tokens do not reach a listed name of short tokens only', () => {
    expect(screen([p('1', 'Xu-Li Trading'), p('2', 'Xuli Trading')], snap).parties.map((x) => x.status)).toEqual(['clear', 'clear']);
  });

  test('invalid options throw TypeError', () => {
    for (const threshold of [0, -1, 1.1, NaN]) expect(() => screen([], snap, { threshold })).toThrow(TypeError);
    for (const minTokenLength of [0, 2.5, NaN]) expect(() => screen([], snap, { minTokenLength })).toThrow(TypeError);
    expect(() => screen([], snap, { threshold: 1, minTokenLength: 1 })).not.toThrow();
  });

  test('caller stop words are normalised like names', () => {
    const r = screen([p('1', 'Huawei Technologies Inc')], snap, { stopWords: ['Inc', 'L.L.C.'] });
    expect(r.matcher.stopWords).toEqual(['inc', 'llc']);
    expect(r.parties[0]!.partyNameKey).toBe('huawei technologies');
  });

  test('partyNameKey, matcher metadata and snapshot identity are reported', () => {
    const r = screen([p('1', 'Huawei Technologies, Inc.')], snap, { stopWords: ['inc'] });
    expect(r.parties[0]!.partyNameKey).toBe('huawei technologies');
    expect(r.matcher).toEqual({ version: '3', threshold: 0.9, minTokenLength: 3, stopWords: ['inc'], genericTokens: [...DEFAULT_GENERIC_TOKENS].sort(), genericPartyTokens: [...DEFAULT_GENERIC_PARTY_TOKENS].sort() });
    expect(r.snapshot).toBe(snap.identity);
    expect(r.check).toBe('csl');
    const d = screen([], snap);
    expect(d.matcher.stopWords).toEqual([...d.matcher.stopWords].sort());
    expect(d.matcher.stopWords).toContain('llc');
  });

  test('custom stop words change what is screenable', () => {
    const r = screen([p('1', 'Rosoboronexport')], snap, { stopWords: ['rosoboronexport'] });
    expect(r.parties[0]!.status).toBe('unscreenable');
  });
});
