import type { Party } from '../model.js';

/** The fields of a OneBill subscriber record the adapter reads. */
export interface OneBillSubscriberLike {
  accountNumber: string;
  companyName?: string;
  accountName?: string;
  address?: { country?: string }[] | { country?: string };
}

const ISO2 = /^[A-Za-z]{2}$/;

function defaultCountry(r: OneBillSubscriberLike): string | undefined {
  const addrs = Array.isArray(r.address) ? r.address : r.address ? [r.address] : [];
  const hit = addrs.find((a) => typeof a?.country === 'string' && ISO2.test(a.country));
  return hit?.country?.toUpperCase();
}

/** Maps OneBill subscribers to screening parties. Only a two-letter country code is kept; other values are dropped. */
export function fromOneBillSubscribers<T extends OneBillSubscriberLike>(
  records: readonly T[],
  opts: { source?: string; country?: (r: T) => string | undefined } = {},
): Party[] {
  const source = opts.source ?? 'onebill';
  return records.map((r) => {
    const country = opts.country ? opts.country(r) : defaultCountry(r);
    return { id: r.accountNumber, name: r.companyName?.trim() || r.accountName || '', source, ...(country ? { country } : {}) };
  });
}
