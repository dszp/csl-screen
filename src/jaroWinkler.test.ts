import { expect, test } from 'vitest';
import { jaroWinkler } from './jaroWinkler.js';

test('jaroWinkler reference values', () => {
  expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.9611, 4);
  expect(jaroWinkler('dwayne', 'duane')).toBeCloseTo(0.84, 2);
  expect(jaroWinkler('dixon', 'dicksonx')).toBeCloseTo(0.8133, 4);
  expect(jaroWinkler('abc', 'abc')).toBe(1);
  expect(jaroWinkler('', 'abc')).toBe(0);
});

test('jaroWinkler is symmetric and zero for disjoint strings', () => {
  expect(jaroWinkler('crate', 'trace')).toBeCloseTo(jaroWinkler('trace', 'crate'), 10);
  expect(jaroWinkler('abc', 'xyz')).toBe(0);
});
