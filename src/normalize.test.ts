import { describe, expect, test } from 'vitest';
import { DEFAULT_STOP_WORDS, hasUnreadableCharacters, nameTokens, normalizeName } from './normalize.js';

const SW = new Set(DEFAULT_STOP_WORDS);

describe('normalizeName', () => {
  test('drops legal forms and punctuation', () => {
    expect(normalizeName('Huawei Technologies, Inc.', SW)).toBe('huawei technologies');
    expect(normalizeName('Rosoboronexport LLC', SW)).toBe('rosoboronexport');
    expect(normalizeName('JSC "Example"', SW)).toBe('example');
  });
  test('strips diacritics and maps &', () => {
    expect(normalizeName('Société Générale & Cie', SW)).toBe('societe generale cie');
  });
  test('only stop words or non-Latin script → empty', () => {
    expect(normalizeName('The Company, LLC', SW)).toBe('');
    expect(normalizeName('Рособоронэкспорт', SW)).toBe('');
  });
});

describe('single-character runs', () => {
  test('are joined before stop words are dropped', () => {
    expect(nameTokens('L.L.C.', SW)).toEqual([]);
    expect(nameTokens('C.T.R.', SW)).toEqual(['ctr']);
    expect(nameTokens('D. K. Smith', SW)).toEqual(['dk', 'smith']);
    expect(nameTokens('T R Contractors', SW)).toEqual(['tr', 'contractors']);
    expect(nameTokens('A&B', SW)).toEqual(['a', 'b']);
    expect(nameTokens('A&B', new Set())).toEqual(['a', 'and', 'b']);
    expect(normalizeName('Example L.L.C.', SW)).toBe('example');
  });
  test('no single-letter default stop words remain', () => {
    expect(DEFAULT_STOP_WORDS.filter((w) => w.length === 1)).toEqual([]);
  });
});

describe('nameTokens', () => {
  test('returns the tokens normalizeName joins', () => {
    expect(nameTokens('Huawei Technologies, Inc.', SW)).toEqual(['huawei', 'technologies']);
  });
  test('honours a caller-supplied stop-word set', () => {
    expect(nameTokens('Acme Holdings', new Set(['holdings']))).toEqual(['acme']);
    expect(nameTokens('Acme Inc', new Set())).toEqual(['acme', 'inc']);
  });
});

describe('Latin fold', () => {
  test('format characters and every combining mark are removed, not read as separators', () => {
    for (const c of ['\u200B', '\u200C', '\u2060', '\uFEFF', '\u00AD', '\u200F', '\u202A', '\u061C', '\uFE00', '\u1DC0', '\u20D0', '\uFE20']) {
      expect(nameTokens(`Ros${c}neft Trading`, SW), JSON.stringify(c)).toEqual(['rosneft', 'trading']);
    }
  });
  test('letters with no NFKD decomposition become ASCII', () => {
    expect(nameTokens('Straße Holdings', SW)).toEqual(['strasse', 'holdings']);
    expect(nameTokens('Ærø Shipping', SW)).toEqual(['aero', 'shipping']);
    expect(nameTokens('Łódź Trading', SW)).toEqual(['lodz', 'trading']);
    expect(nameTokens('Þór Đorđe Ðan Œuvre ıstanbul', SW)).toEqual(['thor', 'dorde', 'dan', 'oeuvre', 'istanbul']);
  });
  test('upper-case forms fold to the same tokens', () => {
    expect(nameTokens('STRASSE ẞ ÆØ ŁÐĐ ÞŒ', new Set())).toEqual(['strasse', 'ss', 'aeo', 'ldd', 'thoe']);
  });
});

describe('hasUnreadableCharacters', () => {
  test('is false for Latin names, including folded and accented letters', () => {
    for (const n of ['Acme Corp', 'Müller GmbH', 'Ærø Shipping', 'Łódź Trading', 'Straße Holdings', 'Société Générale & Cie', '', '...', 'Unit 42 - 7']) {
      expect(hasUnreadableCharacters(n), n).toBe(false);
    }
  });
  test('is true for Cyrillic, Greek and mixed-script names', () => {
    for (const n of ['Рособоронэкспорт', 'R\u043esneft', '\u0391lpha Trading', '中国']) {
      expect(hasUnreadableCharacters(n), n).toBe(true);
    }
  });
  test('is true for control, private-use and unassigned characters, but not tab or line breaks', () => {
    for (const n of ['Ros\u0000neft', 'Ros\u0007neft', 'Ros\u007Fneft', 'Ros\u0085neft', 'Ros\uE000neft', 'Ros\u{F0000}neft', 'Ros\u0378neft']) {
      expect(hasUnreadableCharacters(n), JSON.stringify(n)).toBe(true);
    }
    for (const n of ['Acme\tCorp', 'Acme\nCorp', 'Acme\r\nCorp']) expect(hasUnreadableCharacters(n), JSON.stringify(n)).toBe(false);
  });
  test('is false for format characters and marks, which the fold removes', () => {
    for (const n of ['Ros\u200Bneft', 'Ros\u00ADneft', 'Ros\u202Aneft', 'Ros\uFE00neft', 'Ros\u1DC0neft']) {
      expect(hasUnreadableCharacters(n), JSON.stringify(n)).toBe(false);
    }
  });
});
