import { canonicalJson, sha256Hex } from './canonical.js';

export interface SnapshotIdentity {
  searchPerformedAt: string;
  sources: { source: string; sourceLastUpdated: string | null; lastImported: string | null }[];
  entryCount: number;
  /** Entries per CSL `source` (list name), keys sorted. Feeds the next run's `previousEntriesBySource`. */
  entriesBySource: Record<string, number>;
  /** SHA-256 of the downloaded bytes. Changes on every republish, even when no entry changed. */
  sha256: string;
  /** Hash of the entries alone (see `contentHashOf`). Unchanged by `search_performed_at` and per-list `last_imported`. */
  contentSha256: string;
}

export interface SlimEntry {
  /** `${source}|${id}`. The CSL `id` alone is not unique: an entry on two lists shares it. */
  key: string;
  id: string;
  name: string;
  altNames: string[];
  source: string;
  type: string | null;
  countries: string[];
  programs: string[];
  sourceListUrl: string | null;
  /** SHA-256 of the canonical JSON of the whole raw entry; changes when any field changes. */
  fingerprint: string;
}

export interface Snapshot {
  identity: SnapshotIdentity;
  entries: SlimEntry[];
}

export class CslSnapshotError extends Error {
  constructor(
    public kind: 'parse' | 'shape' | 'total-mismatch' | 'sharp-drop' | 'source-drop',
    message: string,
  ) {
    super(message);
    this.name = 'CslSnapshotError';
  }
}

export interface LoadSnapshotOptions {
  /** Entry count of the snapshot being replaced; enables the sharp-drop check. */
  previousEntryCount?: number;
  /** Largest tolerated fractional shrink against previousEntryCount. Default 0.1. */
  maxDropRatio?: number;
  /**
   * `entriesBySource` of the snapshot being replaced; enables the source-drop check. A source in this map that is
   * missing from the new file, or has fewer than half its previous entries, fails the load. Catches the loss of
   * one small list, which the whole-file sharp-drop check cannot see.
   */
  previousEntriesBySource?: Record<string, number>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const MIN_SOURCE_RATIO = 0.5;

/** Null or absent is an empty list; anything else must be an array of strings, so a format change fails loudly. */
function strings(v: unknown, where: string): string[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new CslSnapshotError('shape', `${where} must be an array of strings, null or absent`);
  }
  return v;
}

/**
 * SHA-256 hex over the lines `${key}\t${fingerprint}\n`, sorted by key in byte order (plain `<` on strings, not
 * `localeCompare`, so the result does not depend on the runtime's locale), concatenated. Entry order in the file
 * does not matter; any change to an entry's fingerprint, or to the set of keys, does.
 */
export async function contentHashOf(entries: readonly { key: string; fingerprint: string }[]): Promise<string> {
  const sorted = [...entries].sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return sha256Hex(sorted.map((e) => `${e.key}\t${e.fingerprint}\n`).join(''));
}

export async function loadSnapshot(
  input: Uint8Array | ArrayBuffer | string,
  opts: LoadSnapshotOptions = {},
): Promise<Snapshot> {
  const bytes =
    typeof input === 'string' ? new TextEncoder().encode(input)
    : input instanceof Uint8Array ? input
    : new Uint8Array(input);
  const sha256 = await sha256Hex(bytes);

  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    throw new CslSnapshotError('parse', `CSL file is not valid JSON: ${(e as Error).message}`);
  }
  if (!isObj(doc) || !Array.isArray(doc.results)) {
    throw new CslSnapshotError('shape', 'CSL file has no "results" array');
  }
  const raw = doc.results;
  if (raw.length === 0) {
    throw new CslSnapshotError('shape', 'CSL file has an empty "results" array');
  }
  if (typeof doc.search_performed_at !== 'string') {
    throw new CslSnapshotError('shape', 'CSL file has no "search_performed_at" string');
  }
  const searchPerformedAt = doc.search_performed_at;
  if (typeof doc.total !== 'number' || raw.length !== doc.total) {
    throw new CslSnapshotError('total-mismatch', `results has ${raw.length} entries but total is ${String(doc.total)}`);
  }
  const previous = opts.previousEntryCount;
  const maxDrop = opts.maxDropRatio ?? 0.1;
  // NaN or a ratio of 1 or more would silently disable the check.
  if (!(typeof maxDrop === 'number' && maxDrop >= 0 && maxDrop < 1)) {
    throw new TypeError(`maxDropRatio must be a number in [0, 1), got ${String(maxDrop)}`);
  }
  if (previous !== undefined && previous > 0 && raw.length < previous * (1 - maxDrop)) {
    throw new CslSnapshotError('sharp-drop', `entry count fell from ${previous} to ${raw.length}, beyond the ${maxDrop} allowed drop`);
  }

  const entries: SlimEntry[] = [];
  const seenKeys = new Set<string>();
  for (const [i, r] of raw.entries()) {
    if (!isObj(r) || typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.source !== 'string') {
      throw new CslSnapshotError('shape', `results[${i}] lacks a string id, name or source`);
    }
    const countries = new Set<string>();
    const addCountry = (c: unknown) => {
      if (typeof c === 'string' && c) countries.add(c.toUpperCase());
    };
    addCountry(r.country);
    if (Array.isArray(r.addresses)) for (const a of r.addresses) if (isObj(a)) addCountry(a.country);
    const key = `${r.source}|${r.id}`;
    if (seenKeys.has(key)) {
      throw new CslSnapshotError('shape', `duplicate entry key ${key} at results[${i}]`);
    }
    seenKeys.add(key);
    entries.push({
      key,
      id: r.id,
      name: r.name,
      altNames: strings(r.alt_names, `results[${i}].alt_names`),
      source: r.source,
      type: strOrNull(r.type),
      countries: [...countries],
      programs: strings(r.programs, `results[${i}].programs`),
      sourceListUrl: strOrNull(r.source_list_url),
      fingerprint: await sha256Hex(canonicalJson(r)),
    });
  }

  // Null-prototype maps: a source named "constructor" or "__proto__" is an ordinary key.
  const counted: Record<string, number> = Object.create(null);
  for (const e of entries) counted[e.source] = (counted[e.source] ?? 0) + 1;
  // The published identity is a plain object (callers may use its prototype methods); fromEntries still makes
  // "__proto__" an own data property. Lookups below stay on the null-prototype map.
  const entriesBySource: Record<string, number> = Object.fromEntries(Object.keys(counted).sort().map((k) => [k, counted[k]!]));
  for (const [source, before] of Object.entries(opts.previousEntriesBySource ?? {})) {
    if (typeof before !== 'number' || !Number.isFinite(before) || before < 0) {
      throw new TypeError(`previousEntriesBySource["${source}"] must be a non-negative number, got ${JSON.stringify(before)}`);
    }
    const now = counted[source] ?? 0;
    if (now < before * MIN_SOURCE_RATIO) {
      throw new CslSnapshotError(
        'source-drop',
        `source "${source}" fell from ${before} to ${now} entries${now === 0 ? ' (missing from the file)' : ''}, below ${MIN_SOURCE_RATIO * 100}% of the previous count`,
      );
    }
  }

  const sourcesUsed = Array.isArray(doc.sources_used) ? doc.sources_used : [];
  const identity: SnapshotIdentity = {
    searchPerformedAt,
    sources: sourcesUsed.filter(isObj).map((s) => ({
      source: typeof s.source === 'string' ? s.source : '',
      sourceLastUpdated: strOrNull(s.source_last_updated),
      lastImported: strOrNull(s.last_imported),
    })),
    entryCount: entries.length,
    entriesBySource,
    sha256,
    contentSha256: await contentHashOf(entries),
  };
  return { identity, entries };
}
