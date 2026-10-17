import { describe, expect, test } from 'vitest';
import { toCsv, toMarkdown } from './render.js';
import type { Decision, Match, Party, PartyResult, ScreenResult } from './model.js';

const SHA = 'a'.repeat(64);
const match = (over: Partial<Match> = {}): Match => ({
  entryKey: 'Entity List|R1', entryId: 'R1', entryFingerprint: 'fp', matchedName: 'Veltrane Partners',
  listSource: 'Entity List', programs: ['EAR', 'SDN'], entryType: 'Entity', entryCountries: ['RU', 'BY'],
  countryMismatch: false, rule: 'similar', score: 0.9512, reason: 'similar to Veltrane Partners', state: 'new', ...over,
});
const decision = (d: 'cleared' | 'escalated', over: Partial<Decision> = {}): Decision => ({
  check: 'csl', partyId: 'p', entryKey: 'Entity List|R1', partyNameKey: 'k', entryFingerprint: 'fp',
  decision: d, reason: 'checked', reviewer: 'rev', decidedAt: '2026-01-02T03:04:05.000Z', ...over,
});
const party = (id: string, name: string, country?: string): Party => ({ id, name, source: 'crm', ...(country ? { country } : {}) });
const flagged = (p: Party, matches: Match[]): PartyResult => ({ party: p, partyNameKey: 'k', status: 'flagged', matches });
const make = (parties: PartyResult[]): ScreenResult => ({
  check: 'csl',
  matcher: { version: '2', threshold: 0.9, minTokenLength: 3, stopWords: [], genericTokens: [] },
  snapshot: {
    searchPerformedAt: '2026-01-01T00:00:00+00:00',
    sources: [{ source: 'Entity List', sourceLastUpdated: '2026-01-01', lastImported: null }],
    entryCount: 1234, entriesBySource: { 'Entity List': 1234 }, sha256: SHA, contentSha256: SHA,
  },
  counts: {
    parties: parties.length,
    screened: parties.filter((r) => r.status !== 'unscreenable').length,
    unscreenable: parties.filter((r) => r.status === 'unscreenable').length,
    clear: parties.filter((r) => r.status === 'clear').length,
    flagged: parties.filter((r) => r.status === 'flagged').length,
  },
  parties,
});
const opts = { runDate: '2026-02-03' };

describe('toCsv', () => {
  test('header column order, CRLF line endings and one row per match', () => {
    const r = make([
      { party: party('1', 'Acme'), partyNameKey: 'acme', status: 'clear' },
      { party: party('2', ''), partyNameKey: '', status: 'unscreenable', reason: 'empty-name' },
      flagged(party('3', 'Veltrane Partners', 'US'), [match(), match({ entryKey: 'Entity List|R2', entryId: 'R2', state: 'cleared', decision: decision('cleared') })]),
    ]);
    const lines = toCsv(r, opts).split('\r\n');
    expect(lines[0]).toBe('party_id,party_name,source,result,matched_name,list,entry_key,rule,score,reason,entry_countries,party_country,decision,decided_by,decided_at,run_date');
    expect(lines[1]).toBe('1,Acme,crm,clear,,,,,,,,,,,2026-02-03');
    expect(lines[2]).toBe('2,,crm,unscreenable,,,,,,,,,,,2026-02-03');
    expect(lines[3]).toBe('3,Veltrane Partners,crm,flagged-new,Veltrane Partners,Entity List,Entity List|R1,similar,0.95,similar to Veltrane Partners,RU;BY,US,,,,2026-02-03');
    expect(lines[4]).toBe('3,Veltrane Partners,crm,flagged-new,Veltrane Partners,Entity List,Entity List|R2,similar,0.95,similar to Veltrane Partners,RU;BY,US,cleared,rev,2026-01-02T03:04:05.000Z,2026-02-03');
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe('');
  });

  test('quotes commas, quotes and embedded newlines per RFC 4180', () => {
    const r = make([{ party: party('1', 'Smith, "Jo"\nLtd'), partyNameKey: 'k', status: 'clear' }]);
    expect(toCsv(r, opts)).toContain('1,"Smith, ""Jo""\nLtd",crm,clear');
  });

  test('score has two decimals', () => {
    const r = make([flagged(party('1', 'x'), [match({ score: 1 })])]);
    expect(toCsv(r, opts)).toContain(',similar,1.00,');
  });

  test('neutralises spreadsheet formulas before quoting, in party and matched names', () => {
    const r = make([
      { party: party('1', '=HYPERLINK("x")'), partyNameKey: 'k', status: 'clear' },
      { party: party('2', '-1+2'), partyNameKey: 'k', status: 'clear' },
      flagged(party('3', '@SUM(1)'), [match({ matchedName: '+cmd|calc' })]),
    ]);
    const csv = toCsv(r, opts);
    expect(csv).toContain(`1,"'=HYPERLINK(""x"")",crm`);
    expect(csv).toContain(`2,'-1+2,crm`);
    expect(csv).toContain(`3,'@SUM(1),crm,flagged-new,'+cmd|calc,`);
    expect(toCsv(make([{ party: party('4', '\n=1+1'), partyNameKey: 'k', status: 'clear' }]), opts)).toContain(`4,"'\n=1+1",crm`);
  });
});

describe('toMarkdown', () => {
  const full = make([
    { party: party('c', 'Clean Co'), partyNameKey: 'k', status: 'clear' },
    flagged(party('n', 'Veltrane Partners', 'US'), [match({ countryMismatch: true })]),
    flagged(party('e', 'Escalated Co'), [match({ state: 'escalated', decision: decision('escalated', { reason: 'looks bad' }) })]),
    flagged(party('k', 'Cleared Co', 'RU'), [match({ state: 'cleared', decision: decision('cleared', { reason: 'different company' }) })]),
    { party: party('u', ''), partyNameKey: '', status: 'unscreenable', reason: 'empty-name' },
  ]);

  test('header states counts, snapshot identity and matcher', () => {
    const md = toMarkdown(full, { ...opts, expected: 5 });
    expect(md).not.toContain('INCOMPLETE');
    expect(md).toContain(SHA);
    expect(md).toContain('1234');
    expect(md).toContain('2026-01-01T00:00:00+00:00');
    expect(md).toContain('Entity List');
    expect(md).toMatch(/Parties in run: 5 of 5 expected/);
    expect(md).toMatch(/- Screened: 4$/m);
    expect(md).toMatch(/- Unscreenable: 1$/m);
    expect(md).toMatch(/Clear: 1/);
    expect(md).toMatch(/Version 2/);
    expect(md).toMatch(/Threshold: 0\.9/);
    expect(md).not.toContain('Clean Co');
  });

  test('sections appear in order with match detail', () => {
    const md = toMarkdown(full, opts);
    const at = (h: string) => md.indexOf(`## ${h}`);
    expect(at('New flags')).toBeGreaterThan(-1);
    expect(at('New flags')).toBeLessThan(at('Escalated (open)'));
    expect(at('Escalated (open)')).toBeLessThan(at('Unscreenable parties'));
    expect(at('Unscreenable parties')).toBeLessThan(at('Cleared (still matching)'));
    expect(md).toContain('EAR, SDN');
    expect(md).toContain('Entity');
    expect(md).toContain('RU, BY');
    expect(md).toContain('similar to Veltrane Partners');
    expect(md).toContain('escalated by rev at 2026-01-02T03:04:05.000Z');
    expect(md).toContain('looks bad');
    expect(md).toContain('country mismatch');
  });

  test('omits sections that are empty', () => {
    const md = toMarkdown(make([{ party: party('c', 'Clean Co'), partyNameKey: 'k', status: 'clear' }]), opts);
    for (const h of ['New flags', 'Escalated (open)', 'Unscreenable parties', 'Cleared (still matching)']) {
      expect(md, h).not.toContain(h);
    }
  });

  test('first line reports an incomplete run when expected differs', () => {
    const md = toMarkdown(full, { ...opts, expected: 9 });
    expect(md.split('\n')[0]).toBe('INCOMPLETE: 5 parties in run of expected 9');
  });

  test('sourceRecords prints the source count and the number excluded by scope', () => {
    const md = toMarkdown(full, { ...opts, sourceRecords: 8 });
    expect(md).toContain('- Source records: 8');
    expect(md).toContain('- Excluded by scope: 3');
    expect(md).not.toContain('INCOMPLETE');
  });

  test('no excluded line when nothing is excluded or sourceRecords is absent', () => {
    expect(toMarkdown(full, { ...opts, sourceRecords: 5 })).not.toContain('Excluded by scope');
    expect(toMarkdown(full, opts)).not.toContain('Source records');
  });

  test('escapes markdown and collapses newlines in names', () => {
    const r = make([
      flagged(party('1', 'Evil | Co\n# hi\r\n[x](http://e) `c` *b* _i_ <b> \\'), [match({ matchedName: '#Heading|x' })]),
      { party: party('2', 'Bad\nName'), partyNameKey: 'k', status: 'unscreenable', reason: 'empty-name' },
    ]);
    const md = toMarkdown(r, { ...opts, title: '# Title\nInjected' });
    expect(md).toContain('Evil \\| Co # hi \\[x\\](http://e) \\`c\\` \\*b\\* \\_i\\_ \\<b\\> \\\\');
    expect(md).toContain('\\#Heading\\|x');
    const strike = toMarkdown(make([{ party: party('3', '~~gone~~'), partyNameKey: '', status: 'unscreenable', reason: 'empty-name' }]), opts);
    expect(strike).toContain('\\~\\~gone\\~\\~');
    expect(md).toContain('Bad Name');
    expect(md).not.toMatch(/^# hi/m);
    expect(md).not.toMatch(/^Injected/m);
    expect(md).not.toContain('<b>');
    expect(md.split('\n')[0]).toBe('# \\# Title Injected');
  });

  test('a whitespace-only party name renders as (blank name)', () => {
    const md = toMarkdown(make([{ party: party('w', ' \t '), partyNameKey: '', status: 'unscreenable', reason: 'empty-name' }]), opts);
    expect(md).toContain('- (blank name) (id w, source crm)');
  });

  test('each unscreenable party states its reason in plain words', () => {
    const md = toMarkdown(
      make([
        { party: party('a', '...'), partyNameKey: '', status: 'unscreenable', reason: 'empty-name' },
        { party: party('b', 'R\u043esneft'), partyNameKey: 'r sneft', status: 'unscreenable', reason: 'unreadable-characters' },
      ]),
      opts,
    );
    expect(md).toContain('- ... (id a, source crm): name is empty after normalisation');
    expect(md).toContain('- R\u043esneft (id b, source crm): name contains non-Latin or unreadable characters; screen it by hand');
  });

  test('preamble lines print as escaped list items right after the title', () => {
    const md = toMarkdown(full, { ...opts, title: 'T', preamble: ['Parties: crm records fetched 2026-01-01', 'Run: x_y|z\n# no'] });
    const lines = md.split('\n');
    expect(lines.slice(0, 5)).toEqual(['# T', '', '- Parties: crm records fetched 2026-01-01', '- Run: x\\_y\\|z # no', '']);
    expect(lines[5]).toBe('Run date: 2026-02-03');
    expect(toMarkdown(full, { ...opts, title: 'T' }).split('\n').slice(0, 3)).toEqual(['# T', '', 'Run date: 2026-02-03']);
  });

  test('an empty title falls back to the default title', () => {
    const md = toMarkdown(make([]), { ...opts, title: '' });
    expect(md.split('\n')[0]).toBe('# Restricted-party screening report');
  });
});
