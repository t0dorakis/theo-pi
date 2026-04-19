import test from 'node:test';
import assert from 'node:assert/strict';
import {
  average,
  chunk,
  dedupeStable,
  median,
  mode,
  normalizeWhitespace,
  parseCsvLine,
  slugify,
  sum,
} from '../src/lib.js';

test('sum handles normal and empty arrays', () => {
  assert.equal(sum([1, 2, 3]), 6);
  assert.equal(sum([]), 0);
});

test('average handles numbers and empty arrays', () => {
  assert.equal(average([2, 4, 6]), 4);
  assert.equal(average([]), 0);
});

test('median handles odd and even lengths', () => {
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([1, 8, 4, 10]), 6);
});

test('mode returns most frequent value and breaks ties deterministically', () => {
  assert.equal(mode([1, 2, 2, 3]), 2);
  assert.equal(mode(['b', 'a', 'b', 'a']), 'b');
  assert.equal(mode([]), null);
});

test('normalizeWhitespace collapses internal whitespace and trims ends', () => {
  assert.equal(normalizeWhitespace('  hello   world\n  again\tthere  '), 'hello world again there');
});

test('slugify lowercases, trims, removes punctuation, and joins with dashes', () => {
  assert.equal(slugify('  Hello, World!  '), 'hello-world');
  assert.equal(slugify('Multiple   Spaces__Here'), 'multiple-spaces-here');
});

test('dedupeStable keeps first occurrence order', () => {
  assert.deepEqual(dedupeStable(['a', 'b', 'a', 'c', 'b', 'd']), ['a', 'b', 'c', 'd']);
});

test('chunk groups arrays by size', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});

test('parseCsvLine handles plain csv', () => {
  assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c']);
});

test('parseCsvLine handles quoted commas and escaped quotes', () => {
  assert.deepEqual(parseCsvLine('a,"b,c",d'), ['a', 'b,c', 'd']);
  assert.deepEqual(parseCsvLine('"say ""hi""",x'), ['say "hi"', 'x']);
});
