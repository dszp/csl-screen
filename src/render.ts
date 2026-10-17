import { partyOutcome } from './decisions.js';
import type { Match, PartyResult, ScreenResult } from './model.js';

const COLUMNS = [
  'party_id', 'party_name', 'source', 'result', 'matched_name', 'list', 'entry_key', 'rule', 'score',
  'reason', 'entry_countries', 'party_country', 'decision', 'decided_by', 'decided_at', 'run_date',
] as const;

/** A leading = + - @ (or tab/CR/LF) makes a spreadsheet read the cell as a formula; a leading apostrophe stops that. */
function guardFormula(s: string): string {
  return /^[=+\-@\t\r\n]/.test(s) ? `'${s}` : s;
}

/** Guard first, then RFC 4180 quoting, so the apostrophe sits inside the quotes. */
function csvCell(s: string): string {
  const g = guardFormula(s);
  return /[",\r\n]/.test(g) ? `"${g.replace(/"/g, '""')}"` : g;
}

export function toCsv(result: ScreenResult, opts: { runDate: string }): string {
  const lines: string[] = [COLUMNS.join(',')];
  const row = (cells: string[]) => lines.push(cells.map(csvCell).join(','));
  for (const r of result.parties) {
    const outcome = partyOutcome(r);
    const head = [r.party.id, r.party.name, r.party.source, outcome];
    if (r.status !== 'flagged') {
      row([...head, '', '', '', '', '', '', '', '', '', '', opts.runDate]);
      continue;
    }
    for (const m of r.matches) {
      row([
        ...head, m.matchedName, m.listSource, m.entryKey, m.rule, m.score.toFixed(2), m.reason,
        m.entryCountries.join(';'), r.party.country ?? '',
        m.decision?.decision ?? '', m.decision?.reviewer ?? '', m.decision?.decidedAt ?? '', opts.runDate,
      ]);
    }
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * Names come from client records and the public list, so they are untrusted. Line breaks become spaces
 * (a table row or list item must stay on one line), then every character Markdown or inline HTML could
 * act on is backslash-escaped. `&` is included so an entity such as `&lt;` stays literal text.
 */
function md(s: string): string {
  return s
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/[\\|`*_~<>[\]&]/g, '\\$&')
    .replace(/^(\s*)#/, '$1\\#');
}

const UNSCREENABLE_REASON = {
  'empty-name': 'name is empty after normalisation',
  'unreadable-characters': 'name contains non-Latin or unreadable characters; screen it by hand',
} as const;

const list = (xs: readonly string[]) => (xs.length ? md(xs.join(', ')) : 'none');

function matchLine(r: Extract<PartyResult, { status: 'flagged' }>, m: Match): string {
  const p = r.party;
  const d = m.decision;
  const decision = d ? `${d.decision} by ${md(d.reviewer)} at ${md(d.decidedAt)}: ${md(d.reason)}` : 'none';
  const partyCountry = p.country ? md(p.country) : 'not provided';
  const mismatch = m.countryMismatch ? ' (country mismatch)' : '';
  return [
    `- **${md(p.name)}** (id ${md(p.id)}, source ${md(p.source)}) matched **${md(m.matchedName)}**`,
    `  - List: ${md(m.listSource)}; programs: ${list(m.programs)}; entry type: ${m.entryType ? md(m.entryType) : 'unknown'}`,
    `  - Countries: entry ${list(m.entryCountries)}; party ${partyCountry}${mismatch}`,
    `  - Rule: ${m.rule}, score ${m.score.toFixed(2)}; reason: ${md(m.reason)}`,
    `  - Decision: ${decision}`,
  ].join('\n');
}

export function toMarkdown(
  result: ScreenResult,
  opts: {
    runDate: string;
    title?: string;
    expected?: number;
    sourceRecords?: number;
    /** Caller lines (for example where the parties and the list came from), printed as list items under the title. */
    preamble?: readonly string[];
  },
): string {
  const { counts, snapshot: s, matcher } = result;
  const out: string[] = [];
  if (opts.expected !== undefined && opts.expected !== counts.parties) {
    out.push(`INCOMPLETE: ${counts.parties} parties in run of expected ${opts.expected}`, '');
  }
  out.push(`# ${md(opts.title || 'Restricted-party screening report')}`, '');
  if (opts.preamble?.length) out.push(...opts.preamble.map((l) => `- ${md(l)}`), '');
  out.push(`Run date: ${md(opts.runDate)}`, '');
  const excluded = opts.sourceRecords !== undefined ? opts.sourceRecords - counts.parties : 0;
  out.push(
    ...(opts.sourceRecords !== undefined ? [`- Source records: ${opts.sourceRecords}`] : []),
    opts.expected !== undefined
      ? `- Parties in run: ${counts.parties} of ${opts.expected} expected`
      : `- Parties in run: ${counts.parties}`,
    ...(excluded > 0 ? [`- Excluded by scope: ${excluded}`] : []),
    `- Screened: ${counts.screened}`,
    `- Clear: ${counts.clear}`,
    `- Flagged: ${counts.flagged}`,
    `- Unscreenable: ${counts.unscreenable}`,
    '',
    '## Consolidated Screening List snapshot',
    '',
    `- Search performed at: ${md(s.searchPerformedAt || 'unknown')}`,
    `- Entries: ${s.entryCount}`,
    `- SHA-256: ${s.sha256}`,
    '- Sources:',
    ...s.sources.map((x) => `  - ${md(x.source)}: last updated ${md(x.sourceLastUpdated ?? 'unknown')}`),
    '',
    '## Matcher',
    '',
    `- Version ${md(matcher.version)}`,
    `- Threshold: ${matcher.threshold}`,
    '',
  );

  const flagged = result.parties.filter((r): r is Extract<PartyResult, { status: 'flagged' }> => r.status === 'flagged');
  const section = (title: string, state: Match['state']) => {
    const lines = flagged.flatMap((r) => r.matches.filter((m) => m.state === state).map((m) => matchLine(r, m)));
    if (lines.length) out.push(`## ${title}`, '', ...lines, '');
  };
  section('New flags', 'new');
  section('Escalated (open)', 'escalated');
  const unscreenable = result.parties.filter((r): r is Extract<PartyResult, { status: 'unscreenable' }> => r.status === 'unscreenable');
  if (unscreenable.length) {
    out.push(
      '## Unscreenable parties',
      '',
      ...unscreenable.map(
        (r) =>
          `- ${r.party.name.trim() ? md(r.party.name) : '(blank name)'} (id ${md(r.party.id)}, source ${md(r.party.source)}): ${UNSCREENABLE_REASON[r.reason]}`,
      ),
      '',
    );
  }
  section('Cleared (still matching)', 'cleared');
  return out.join('\n');
}
