import { describe, expect, test } from 'vitest';
import { fromAutotaskCompanies } from './autotask.js';

const rows = [
  { id: 101, companyName: 'Acme Ltd', kind: 'customer' },
  { id: '102', companyName: 'Dormant Co', kind: 'customer' },
  { id: 103, companyName: null, kind: 'customer' },
];

describe('fromAutotaskCompanies', () => {
  test('applies include and stringifies ids', () => {
    const out = fromAutotaskCompanies(rows, { include: (r) => r.id !== '102' });
    expect(out).toEqual([
      { id: '101', name: 'Acme Ltd', source: 'autotask' },
      { id: '103', name: '', source: 'autotask' },
    ]);
  });

  test('source and country are configurable', () => {
    const out = fromAutotaskCompanies(rows.slice(0, 1), { include: () => true, source: 'psa', country: () => 'US' });
    expect(out).toEqual([{ id: '101', name: 'Acme Ltd', source: 'psa', country: 'US' }]);
  });

  test('include is required', () => {
    // @ts-expect-error opts.include is required
    expect(() => fromAutotaskCompanies(rows, {})).toThrow();
  });
});
