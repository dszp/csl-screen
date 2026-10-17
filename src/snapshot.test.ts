import { describe, expect, test } from 'vitest';
import { canonicalJson, sha256Hex } from './canonical.js';
import { CslSnapshotError, contentHashOf, loadSnapshot } from './snapshot.js';
import { cslDocument } from './testkit.js';
import type { RawEntry } from './testkit.js';

const base = { id: 'e1', name: 'Example Arms', source: 'Entity List', country: 'ru', addresses: [{ country: 'BY' }, { country: 'RU' }], programs: ['EAR'] };

describe('loadSnapshot', () => {
  test('identity from a well-formed document', async () => {
    const doc = cslDocument([base]);
    const s = await loadSnapshot(doc);
    expect(s.identity.entryCount).toBe(1);
    expect(s.identity.sha256).toBe(await sha256Hex(doc));
    expect(s.identity.sources).toEqual([{ source: 'Entity List', sourceLastUpdated: '2026-01-01', lastImported: '2026-01-02T00:00:00+00:00' }]);
    expect(s.entries[0].countries).toEqual(['RU', 'BY']);
    expect(s.entries[0].fingerprint).toBe(await sha256Hex(canonicalJson(JSON.parse(doc).results[0])));
  });

  test('accepts bytes and ArrayBuffer with the same hash as the string', async () => {
    const doc = cslDocument([base]);
    const bytes = new TextEncoder().encode(doc);
    const a = await loadSnapshot(bytes);
    const b = await loadSnapshot(bytes.buffer.slice(0) as ArrayBuffer);
    expect(a.identity.sha256).toBe(b.identity.sha256);
    expect(a.identity.sha256).toBe(await sha256Hex(doc));
  });

  test('null and absent optional fields become empty values', async () => {
    const s = await loadSnapshot(cslDocument([{ id: 'e2', name: 'N', alt_names: null, programs: null, addresses: null, country: null, type: null }]));
    expect(s.entries[0]).toMatchObject({ altNames: [], programs: [], countries: [], type: null });
  });

  test('fingerprint ignores key order, sees any field change', async () => {
    const doc = cslDocument([base]);
    const entry = JSON.parse(doc).results[0] as Record<string, unknown>;
    const reversed = Object.fromEntries(Object.entries(entry).reverse());
    const reorderedDoc = JSON.stringify({ ...JSON.parse(doc), results: [reversed] });
    // guard: the serialised entries really differ in key order
    expect(JSON.stringify(reversed)).not.toBe(JSON.stringify(entry));
    const a = (await loadSnapshot(doc)).entries[0].fingerprint;
    const b = (await loadSnapshot(reorderedDoc)).entries[0].fingerprint;
    expect(b).toBe(a);
    const fp = async (e: Record<string, unknown>) => (await loadSnapshot(cslDocument([e]))).entries[0].fingerprint;
    expect(await fp({ ...base, programs: ['EAR', 'SDN'] })).not.toBe(a);
    expect(await fp({ ...base, extra_field: 'x' })).not.toBe(a);
  });

  test('empty results -> shape', async () => {
    await expect(loadSnapshot('{"results":[],"total":0}')).rejects.toMatchObject({ kind: 'shape' });
  });

  test('same id on two sources loads with distinct keys', async () => {
    const s = await loadSnapshot(cslDocument([
      { id: 'x1', name: 'A', source: 'List One' },
      { id: 'x1', name: 'A', source: 'List Two' },
    ]));
    expect(s.entries.map((e) => e.key)).toEqual(['List One|x1', 'List Two|x1']);
  });

  test('same source and id twice -> shape', async () => {
    const e = { id: 'x1', name: 'A', source: 'List One' };
    await expect(loadSnapshot(cslDocument([e, e]))).rejects.toMatchObject({ kind: 'shape' });
  });

  test('results.length !== total -> total-mismatch', async () => {
    await expect(loadSnapshot(cslDocument([{ id: 'e1', name: 'A' }], { total: 2 }))).rejects.toMatchObject({ kind: 'total-mismatch' });
  });

  test('truncated JSON -> parse', async () => {
    const doc = cslDocument([base]);
    await expect(loadSnapshot(doc.slice(0, -10))).rejects.toMatchObject({ kind: 'parse' });
  });

  test('HTML body -> parse', async () => {
    await expect(loadSnapshot('<html><body>Service Unavailable</body></html>')).rejects.toMatchObject({ kind: 'parse' });
  });

  test('missing results array -> shape', async () => {
    await expect(loadSnapshot('{"total":0}')).rejects.toMatchObject({ kind: 'shape' });
  });

  test('entry without id/name/source -> shape', async () => {
    await expect(loadSnapshot(cslDocument([{ id: undefined }]))).rejects.toMatchObject({ kind: 'shape' });
  });

  test('drop beyond ratio -> sharp-drop; within ratio passes', async () => {
    const doc = cslDocument([base]);
    await expect(loadSnapshot(doc, { previousEntryCount: 100 })).rejects.toMatchObject({ kind: 'sharp-drop' });
    await expect(loadSnapshot(doc, { previousEntryCount: 1 })).resolves.toBeDefined();
    await expect(loadSnapshot(doc, { previousEntryCount: 100, maxDropRatio: 0.995 })).resolves.toBeDefined();
  });

  test('maxDropRatio outside [0, 1) or NaN throws TypeError instead of disabling the check', async () => {
    const doc = cslDocument([base]);
    for (const maxDropRatio of [NaN, -0.1, 1, 1.5, Infinity]) {
      await expect(loadSnapshot(doc, { previousEntryCount: 100, maxDropRatio }), String(maxDropRatio)).rejects.toThrow(TypeError);
    }
    await expect(loadSnapshot(doc, { previousEntryCount: 1, maxDropRatio: 0 })).resolves.toBeDefined();
  });

  test('search_performed_at missing or not a string -> shape', async () => {
    const doc = JSON.parse(cslDocument([base])) as Record<string, unknown>;
    const { search_performed_at: _drop, ...without } = doc;
    await expect(loadSnapshot(JSON.stringify(without))).rejects.toMatchObject({ kind: 'shape', message: expect.stringMatching(/search_performed_at/) });
    await expect(loadSnapshot(cslDocument([base], { search_performed_at: 20260101 }))).rejects.toMatchObject({ kind: 'shape' });
    await expect(loadSnapshot(cslDocument([base], { search_performed_at: null }))).rejects.toMatchObject({ kind: 'shape' });
  });

  test.each([
    ['alt_names a string', { alt_names: 'Example' }, /results\[0\]\.alt_names/],
    ['alt_names with a non-string', { alt_names: ['ok', 5] }, /results\[0\]\.alt_names/],
    ['programs an object', { programs: { a: 1 } }, /results\[0\]\.programs/],
    ['programs with null inside', { programs: ['EAR', null] }, /results\[0\]\.programs/],
  ])('%s -> shape', async (_n, over, pattern) => {
    await expect(loadSnapshot(cslDocument([{ ...base, ...over } as Partial<RawEntry>]))).rejects.toMatchObject({ kind: 'shape', message: expect.stringMatching(pattern) });
  });

  test('absent alt_names and programs are empty', async () => {
    // JSON.stringify drops undefined, so these keys are absent from the document.
    const doc = cslDocument([{ ...base, alt_names: undefined, programs: undefined }]);
    expect(doc).not.toMatch(/alt_names|programs/);
    expect((await loadSnapshot(doc)).entries[0]).toMatchObject({ altNames: [], programs: [] });
  });

  test('entriesBySource counts entries per source, keys sorted', async () => {
    const s = await loadSnapshot(cslDocument([
      { id: 'a', source: 'SDN' }, { id: 'b', source: 'Entity List' }, { id: 'c', source: 'SDN' },
    ]));
    expect(s.identity.entriesBySource).toEqual({ 'Entity List': 1, SDN: 2 });
    expect(Object.keys(s.identity.entriesBySource)).toEqual(['Entity List', 'SDN']);
  });

  test('sources named like Object.prototype members are counted as ordinary sources', async () => {
    const s = await loadSnapshot(cslDocument([{ id: 'a', source: 'constructor' }, { id: 'b', source: '__proto__' }, { id: 'c', source: '__proto__' }]));
    expect(Object.entries(s.identity.entriesBySource)).toEqual([['__proto__', 2], ['constructor', 1]]);
    expect(Object.getPrototypeOf(s.identity.entriesBySource)).toBe(Object.prototype);
    expect(Object.hasOwn(s.identity.entriesBySource, '__proto__')).toBe(true);
    const doc = cslDocument([{ id: 'a', source: 'SDN' }]);
    const previous = JSON.parse('{"__proto__": 4, "constructor": 4}') as Record<string, number>;
    const err = await loadSnapshot(doc, { previousEntriesBySource: previous }).catch((e) => e);
    expect(err).toMatchObject({ kind: 'source-drop' });
    expect(String(err.message)).toContain('__proto__');
  });

  describe('source-drop against previousEntriesBySource', () => {
    const many = (source: string, n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `${source}-${from + i}`, source }));
    const doc = cslDocument([...many('SDN', 10), ...many('Entity List', 5)]);

    test('a source missing from the new file fails, naming the source and both counts', async () => {
      const err = await loadSnapshot(doc, { previousEntriesBySource: { SDN: 10, 'Entity List': 5, 'Denied Persons List': 3 } }).catch((e) => e);
      expect(err).toBeInstanceOf(CslSnapshotError);
      expect(err.kind).toBe('source-drop');
      expect(err.message).toMatch(/Denied Persons List/);
      expect(err.message).toMatch(/\b3\b/);
      expect(err.message).toMatch(/\b0\b/);
    });

    test('a source below half its previous count fails; exactly half passes', async () => {
      const err = await loadSnapshot(doc, { previousEntriesBySource: { SDN: 21, 'Entity List': 5 } }).catch((e) => e);
      expect(err).toMatchObject({ kind: 'source-drop', message: expect.stringMatching(/SDN.*21.*10|SDN.*10.*21/) });
      await expect(loadSnapshot(doc, { previousEntriesBySource: { SDN: 20, 'Entity List': 5 } })).resolves.toBeDefined();
    });

    test('a non-numeric previous count throws instead of disabling the check', async () => {
      const bad = { SDN: '10' } as unknown as Record<string, number>;
      await expect(loadSnapshot(doc, { previousEntriesBySource: bad })).rejects.toThrow(TypeError);
    });

    test('growth and new sources pass; no previous map means no check', async () => {
      await expect(loadSnapshot(doc, { previousEntriesBySource: { SDN: 4 } })).resolves.toBeDefined();
      await expect(loadSnapshot(doc, { previousEntriesBySource: {} })).resolves.toBeDefined();
      await expect(loadSnapshot(doc)).resolves.toBeDefined();
    });
  });
});

describe('contentSha256', () => {
  const a = { id: 'a1', name: 'Alpha Trading', source: 'List One' };
  const b = { id: 'b1', name: 'Beta Holdings', source: 'List Two' };

  test('ignores search_performed_at and last_imported, while the file sha256 differs', async () => {
    const one = await loadSnapshot(cslDocument([a, b]));
    const two = await loadSnapshot(cslDocument([a, b], {
      search_performed_at: '2026-02-02T00:00:00+00:00',
      sources_used: [{ source: 'List One', source_last_updated: '2026-01-01', last_imported: '2026-02-03T00:00:00+00:00' }],
    }));
    expect(two.identity.sha256).not.toBe(one.identity.sha256);
    expect(two.identity.contentSha256).toBe(one.identity.contentSha256);
  });

  test('changes when one entry changes', async () => {
    const one = await loadSnapshot(cslDocument([a, b]));
    const two = await loadSnapshot(cslDocument([a, { ...b, programs: ['EAR'] }]));
    expect(two.identity.contentSha256).not.toBe(one.identity.contentSha256);
  });

  test('does not depend on entry order', async () => {
    const one = await loadSnapshot(cslDocument([a, b]));
    const two = await loadSnapshot(cslDocument([b, a]));
    expect(two.identity.contentSha256).toBe(one.identity.contentSha256);
  });

  test('contentHashOf hashes key-sorted "key<TAB>fingerprint<LF>" lines in byte order', async () => {
    // 'B' (0x42) sorts before 'a' (0x61) in byte order; localeCompare would put 'a' first.
    const entries = [
      { key: 'a|1', fingerprint: 'f-a' },
      { key: 'B|1', fingerprint: 'f-B' },
    ];
    const expected = await sha256Hex('B|1\tf-B\na|1\tf-a\n');
    expect(await contentHashOf(entries)).toBe(expected);
    expect(await contentHashOf([...entries].reverse())).toBe(expected);
  });
});
