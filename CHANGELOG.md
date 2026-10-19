# Changelog

All notable changes to `@dszp/csl-screen` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-10-19

### Changed

- The `within` rule matches a one-token party name only as the listed name's first token, so a
  company named "Test" no longer flags every listed name containing the word "test". Party names of
  two or more tokens are unchanged. `MATCHER_VERSION` is `3`.

## [0.1.1] — 2026-10-18

The library's code and API are unchanged from 0.1.0.

### Changed

- Releases are published from GitHub Actions through npm trusted publishing, so each version from
  0.1.1 on carries a provenance statement linking it to the commit and workflow that built it.
- Tests cover the content hash for an added entry, a removed entry, and an empty list.
- The README links [dszp/csl-history](https://github.com/dszp/csl-history), a public history of the
  list that a run's `contentSha256` or `sha256` can be looked up in.

## [0.1.0] — 2026-10-17

First release.

### Added

- `loadSnapshot` parses the Consolidated Screening List bulk JSON file into a compact snapshot. The
  snapshot records the list's identity: search time, per-list update times, entry count, per-list
  entry counts, and a SHA-256 of the downloaded bytes. Loading fails with a typed
  `CslSnapshotError` when the file is truncated, empty, malformed, shorter than its own `total`, or
  has lost entries since a previous load (`previousEntryCount`, `previousEntriesBySource`).
- `screen` matches parties against every listed name and alias with four rules: exact (also
  ignoring spaces), contains, within, and similar (Jaro-Winkler capped by token coverage). The
  threshold, stop words and index token length are options. Contains also joins two or three
  adjacent party tokens, so a separator typed inside a listed word does not hide it. A one-word
  listed entity name matches in any position of the party name, except the words in
  `genericTokens` (default `DEFAULT_GENERIC_TOKENS`), which match only as the first token.
- `makeDecision`, `applyDecisions` and `parseDecisions` record a reviewer's ruling on a flag. A
  clearance holds only while the party's normalised name and a fingerprint of the whole list entry
  are unchanged.
- `toCsv` and `toMarkdown` render evidence. The CSV guards against spreadsheet formula injection,
  and the Markdown escapes names.
- `@dszp/csl-screen/autotask` and `@dszp/csl-screen/onebill` map source records to parties.
- `SnapshotIdentity.contentSha256` and `contentHashOf`: a hash of the entries alone, unchanged by
  `search_performed_at` or a list's `last_imported`, so it changes only when the list's content does.

- Names are folded to ASCII for Latin letters that have no accent decomposition (`ß`, `æ`, `œ`, `ø`,
  `ł`, `đ`, `ð`, `þ`, `ı`), and every combining mark and format character (zero-width space, soft
  hyphen, bidi mark, variation selector) is deleted, so an invisible character inside a word does
  not split it. A party name that still has a letter outside the Latin alphabet, or a control,
  private-use or unassigned character, is reported as unscreenable
  (`reason: 'unreadable-characters'`, exported check `hasUnreadableCharacters`), because such a
  character would otherwise split a word and hide a listed match.

### Known limitations

- A misspelling inside a word (for example a dropped letter) is not caught.
- A listed one-word name in `genericTokens` matches only as the party's first token. The list is
  an option.
- A listed word split into four or more pieces inside a longer party name is not caught.
- Only organisation names are screened, and only against the US list. Names with letters outside the
  Latin alphabet are reported as unscreenable.
