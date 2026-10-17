/** Test harness: builds well-formed CSL bulk-file JSON. Not part of the shipped API. */
export interface RawEntry {
  id: string;
  name: string;
  alt_names: string[] | null;
  source: string;
  type: string | null;
  country: string | null;
  addresses: { country?: string | null }[] | null;
  programs: string[] | null;
  source_list_url: string;
  [key: string]: unknown;
}

export function cslDocument(entries: Partial<RawEntry>[], overrides: Record<string, unknown> = {}): string {
  const results = entries.map((e, i) => ({
    id: `id-${i}`,
    name: `Entry ${i}`,
    alt_names: null,
    source: 'Entity List',
    type: null,
    country: null,
    addresses: null,
    programs: null,
    source_list_url: 'https://example.invalid/list',
    ...e,
  }));
  return JSON.stringify({
    results,
    search_performed_at: '2026-01-01T00:00:00+00:00',
    sources_used: [
      { source: 'Entity List', source_last_updated: '2026-01-01', last_imported: '2026-01-02T00:00:00+00:00', import_rate: 'Daily' },
    ],
    total: results.length,
    offset: 0,
    ...overrides,
  });
}
