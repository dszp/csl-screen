import { describe, expect, test } from 'vitest';
import { fromOneBillSubscribers } from './onebill.js';

describe('fromOneBillSubscribers', () => {
  test('name falls back from companyName to accountName to empty', () => {
    const out = fromOneBillSubscribers([
      { accountNumber: 'A1', companyName: 'Acme Ltd', accountName: 'ignored' },
      { accountNumber: 'A2', accountName: 'Jo Smith' },
      { accountNumber: 'A3' },
    ]);
    expect(out.map((p) => p.name)).toEqual(['Acme Ltd', 'Jo Smith', '']);
    expect(out[0]).toMatchObject({ id: 'A1', source: 'onebill' });
  });

  test('country comes from an address object or the first ISO address in an array', () => {
    const out = fromOneBillSubscribers([
      { accountNumber: 'A1', address: { country: 'us' } },
      { accountNumber: 'A2', address: [{}, { country: 'Canada' }, { country: 'ca' }] },
    ]);
    expect(out.map((p) => p.country)).toEqual(['US', 'CA']);
  });

  test('a non-ISO country yields no country key', () => {
    const [p] = fromOneBillSubscribers([{ accountNumber: 'A1', address: { country: 'United States' } }]);
    expect(p!.country).toBeUndefined();
    expect('country' in p!).toBe(false);
  });

  test('country override and source', () => {
    const [p] = fromOneBillSubscribers([{ accountNumber: 'A1' }], { source: 'billing', country: () => 'DE' });
    expect(p).toEqual({ id: 'A1', name: '', source: 'billing', country: 'DE' });
  });

  test('a whitespace-only companyName falls back to accountName', () => {
    const [p] = fromOneBillSubscribers([{ accountNumber: 'A1', companyName: '  ', accountName: 'Jo Smith' }]);
    expect(p!.name).toBe('Jo Smith');
  });

  test('null entries in an address array are skipped', () => {
    const addr = [null, undefined, { country: 'fr' }] as unknown as { country?: string }[];
    const [p] = fromOneBillSubscribers([{ accountNumber: 'A1', address: addr }]);
    expect(p!.country).toBe('FR');
  });
});
