import { describe, expect, test } from 'vitest';
import { canonicalJson, sha256Hex } from './canonical.js';

describe('canonicalJson', () => {
  test('sorts keys recursively, keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  });
  test('keeps a field named __proto__, so it changes the hash', async () => {
    const withField = JSON.parse('{"a":1,"__proto__":{"x":1}}');
    expect(canonicalJson(withField)).toBe('{"__proto__":{"x":1},"a":1}');
    expect(canonicalJson(JSON.parse('{"a":1,"__proto__":2}'))).toBe('{"__proto__":2,"a":1}');
    expect(await sha256Hex(canonicalJson(withField))).not.toBe(await sha256Hex(canonicalJson({ a: 1 })));
  });
});

describe('sha256Hex', () => {
  test('known vector, string and bytes agree', async () => {
    const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(await sha256Hex('abc')).toBe(abc);
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(abc);
  });
});
