# @dszp/csl-screen

Screen organisation names against the US Consolidated Screening List (CSL). The library normalises names, matches them against every listed name and alias, and records a reviewer's ruling on each flag so the same flag does not come back until something changes. It has no runtime dependencies and runs in Node 20.19+ and Cloudflare Workers. It is an ES module; `require()` loads it on Node versions with `require(esm)` support (20.19+, 22.12+).

This is a screening aid, not legal advice. A clear result does not prove that a party is permitted, and a flag does not prove a violation. A person must review flags.

Scope: it screens organisations against the US CSL only. It does not screen against other countries' lists, and it does not transliterate non-Latin names (a name with letters outside the Latin alphabet, or with unreadable characters, cannot be matched safely and is reported as unscreenable).

## Install

```sh
npm install @dszp/csl-screen
```

## Example

The library does no I/O. You fetch the CSL JSON file and your party records, and pass them in.

```ts
import { loadSnapshot, screen, applyDecisions, partyOutcome, toCsv } from '@dszp/csl-screen';
import { fromAutotaskCompanies } from '@dszp/csl-screen/autotask';

// 1. Fetch the CSL bulk JSON file. Use GET: a HEAD request returns 404.
const res = await fetch('https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json');
if (!res.ok) throw new Error(`CSL download failed: HTTP ${res.status}`);
const bytes = new Uint8Array(await res.arrayBuffer());

// 2. Validate it and build the snapshot. Pass last run's counts to refuse a truncated file
//    or one that has lost a list.
const snapshot = await loadSnapshot(bytes, {
  previousEntryCount: last?.entryCount,
  previousEntriesBySource: last?.entriesBySource,
});

// 3. Turn your records into parties. `include` is required: you choose who is in scope.
const parties = fromAutotaskCompanies(companies, { include: (c) => c.id !== 0 });

// 4. Screen, then apply the rulings reviewers have already made.
const result = applyDecisions(screen(parties, snapshot), savedDecisions);

// 5. Write the evidence.
const csv = toCsv(result, { runDate: '2026-01-31' });
// Store result.snapshot (the snapshot identity) as `last` for the next run.

// 6. Branch on the outcome.
console.log(result.counts); // { parties, screened, unscreenable, clear, flagged }
for (const r of result.parties) {
  if (partyOutcome(r) === 'flagged-new') console.log(r.party.name, r.status === 'flagged' && r.matches);
}
```

`loadSnapshot` throws a `CslSnapshotError` whose `kind` says why: `parse` (not JSON), `shape` (missing `results` or `search_performed_at`, a malformed entry, or `alt_names` or `programs` that is not an array of strings), `total-mismatch`, `sharp-drop` (the entry count fell more than `maxDropRatio`, default 0.1, below `previousEntryCount`) or `source-drop` (a list in `previousEntriesBySource` is missing, or has fewer than half its previous entries). The snapshot identity carries `entriesBySource`, the entry count per list, to pass as `previousEntriesBySource` next time.

`partyOutcome` returns `clear`, `unscreenable`, `flagged-new`, `flagged-escalated` or `flagged-cleared`; a party is `flagged-new` while any of its matches still needs review. `toMarkdown(result, { runDate, title, expected })` writes a report. Pass `expected` (the number of parties you meant to screen) and the report starts with an `INCOMPLETE` line if the run has a different count. Pass `sourceRecords` (the number of records you were given before choosing who is in scope) and the header prints `Source records` and, when some were left out, `Excluded by scope`. Pass `preamble` (an array of strings) to print your own lines, such as where the parties and the list came from, as list items under the title. They are escaped like names.

To record a ruling on a flag, call `makeDecision(result, { partyId, entryKey, decision, reason, reviewer, decidedAt, runId })`. `decision` is `'cleared'` or `'escalated'`; `reason` and `reviewer` must not be blank. `runId` is optional: pass your identifier for the run whose result the reviewer read, and it is copied into the ruling. Store the returned object and pass it to `applyDecisions` on later runs. When you read stored rulings back from a file or database, run them through `parseDecisions(value)` first: it throws a `TypeError` naming the index and field of the first malformed record. `applyDecisions` also ignores any record whose `decision` is not `cleared` or `escalated`, or whose `reason` is blank, or whose `check` is not `'csl'`.

## Adapters

Each adapter is a separate entry point and returns `Party[]` (`{ id, name, source, country? }`). You can also build parties by hand.

- `@dszp/csl-screen/autotask`: `fromAutotaskCompanies(records, { include, source?, country? })`. The `source` defaults to `'autotask'`.
- `@dszp/csl-screen/onebill`: `fromOneBillSubscribers(records, { source?, country? })`. The `source` defaults to `'onebill'`. The name is `companyName`, or `accountName` if that is empty. The country is the first address country that is a two-letter code; any other value (such as `United States`) is dropped.

A party's `country` only annotates a match, and flags a mismatch with the entry's countries. It never removes a match.

## How matching works

Names are lowercased, stripped of diacritics (letters with no decomposition fold to ASCII: `ß` is `ss`, `æ` is `ae`, `ø` is `o`, `ł` is `l`), split on anything that is not a letter or digit, and stripped of legal-form words such as `llc`, `inc` and `gmbh` (configurable with `stopWords`). Runs of single-letter tokens join, so `L.L.C.` is `llc` and `D. K. Smith` is `dk smith`. The party is then compared with every listed name and alias that shares a token of at least three characters (`minTokenLength`). A match carries the first rule below that applies:

1. **exact**: the normalised names are equal, ignoring spaces ("Rosoboron Export" matches "Rosoboronexport").
2. **contains**: every token of the listed name appears in the party's name ("Hikvision USA" matches "Hikvision"). Runs of two or three adjacent party tokens also count joined without spaces, so a separator typed inside a listed word does not hide it ("Ros-neft Trading" matches "Rosneft", with reason `contains listed name ignoring spaces`). A listed name of one token counts only when the entry is not an Individual, Vessel or Aircraft, which keeps ship names and personal nicknames from flagging unrelated companies. It counts in any position ("Global Rosneft Services" matches "Rosneft"), except a word in `genericTokens` (default `DEFAULT_GENERIC_TOKENS`: `center`, `focus`, `technology`, `united`), which counts only as the party's first token. Those words are listed one-word names that, measured on real customer names, flagged only unrelated organisations using them as ordinary words. Pass your own `genericTokens` to replace the list; every word on it is a listed name that can be hidden behind another word.
3. **within**: every token of the party's name appears in the listed name, and the party has a token of four or more characters ("Huawei" matches "Huawei Technologies Co., Ltd.").
4. **similar**: Jaro-Winkler similarity of the normalised names, capped by how many tokens they share, at or above `threshold` (default 0.9).

Combining marks and invisible format characters (zero-width spaces, soft hyphens, bidi marks, variation selectors) are deleted before splitting, so one typed inside a word leaves the word whole.

A party name is reported unscreenable (`reason: 'unreadable-characters'`), for a person to screen, when after that fold it still has a letter outside the Latin alphabet, or a control character (other than tab and line breaks), a private-use character or an unassigned code point. Otherwise a look-alike letter from another script, such as a Cyrillic `о` in "Rоsneft", or an unreadable character would split the word and hide a listed match. `hasUnreadableCharacters(name)` runs the same check.

A name with no token of three or more characters (for example `Xu Li` or `D Company`) can only match by the exact rule. Such a party is still screened. The `within` rule needs a party token of at least four characters, or `minTokenLength` if that is larger.

Known gaps:

- A misspelling inside a single token ("Rosoboronexpot") shares no token with the listed name, so it is not found. Finding it needs a character n-gram index, which this library does not have.
- A listed one-word name in `genericTokens` is found only as the party's first token, so "Acme Center" does not match a listed "Center". Pass a shorter `genericTokens` list (or `[]`) to trade more flags for that coverage.
- A listed word split into four or more pieces by separators ("Ro s-ne ft Trading") is not joined back, unless the whole party name is that word.

## Decisions

A ruling is keyed by the party id and the entry key, `source|id`. The CSL `id` alone is not unique, because an entry that sits on two lists shares it.

A `cleared` or `escalated` ruling applies only while both of these are unchanged since the reviewer made it:

- the party's normalised name, and
- the fingerprint of the whole CSL entry (a hash of every field of the raw entry).

If the party is renamed, or the entry changes in any field, the match returns to `new` and needs a fresh review. The latest ruling for a party and entry wins, comparing the `decidedAt` instants. If two rulings have the same instant, `escalated` wins.

Persist rulings yourself (a file, a database, a Worker's storage). The library only creates and applies them. Rulings contain your party names and reviewers, so keep them out of version control for a public repository.

## Outputs

`toCsv` writes one row per match, and one row for each clear or unscreenable party, with CRLF line endings. A cell that starts with `=`, `+`, `-`, `@`, a tab or a line break gets a leading apostrophe so a spreadsheet does not run it as a formula. `toMarkdown` escapes names before it prints them.

The report header lists the parties in the run, how many were screened, and how many were clear, flagged and unscreenable, plus the CSL snapshot (time, entry count, SHA-256) and the matcher version, so a result can be tied to the exact list it was checked against.

## Identifying a list version

A snapshot carries two hashes. `sha256` covers the downloaded bytes, so it changes whenever the file is republished, including when only `search_performed_at` or a list's `last_imported` moved. `contentSha256` covers the entries alone: it hashes each entry's `key` and `fingerprint`, sorted by key, so it changes only when an entry is added, removed or edited. Compare `contentSha256` to decide whether the list changed. `contentHashOf(entries)` computes the same value from any array of `{ key, fingerprint }`.

trade.gov publishes only the current list. [dszp/csl-history](https://github.com/dszp/csl-history) keeps a public history of it: one commit per content change, and each month's raw download as a release asset. To prove which list a run screened against, find its `contentSha256` in that history. Its `sha256` matches a release asset only when the run used that month's archived download.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

## Changes

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).
