import type { Party } from '../model.js';

/** The fields of an Autotask Companies record the adapter reads; extra fields pass through untouched. */
export interface AutotaskCompanyLike {
  id: number | string;
  companyName?: string | null;
  [k: string]: unknown;
}

/**
 * Maps Autotask companies to screening parties. `include` is required so the caller states which
 * companies are in scope (for example active customers) instead of screening everything by default.
 */
export function fromAutotaskCompanies<T extends AutotaskCompanyLike>(
  records: readonly T[],
  opts: { include: (r: T) => boolean; source?: string; country?: (r: T) => string | undefined },
): Party[] {
  const source = opts.source ?? 'autotask';
  return records.filter(opts.include).map((r) => {
    const country = opts.country?.(r);
    return { id: String(r.id), name: r.companyName ?? '', source, ...(country ? { country } : {}) };
  });
}
