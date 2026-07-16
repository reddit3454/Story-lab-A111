// Regression tests for the narrator response line-numbering feature (A{n}-{line} addressing
// scheme). Pure functions, no DOM — see docs/superpowers/specs/2026-07-15-narrator-line-numbering-design.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narratorResponseLabel, formatNarratorLinesWithGutter } from '../utils.js';

test('narratorResponseLabel returns null for a non-narrator turn', () => {
  const turns = [{ turn_number: 1, speaker: 'user' }];
  assert.equal(narratorResponseLabel(turns, turns[0]), null);
});

test('narratorResponseLabel labels the first narrator turn A1', () => {
  const turns = [
    { turn_number: 1, speaker: 'user' },
    { turn_number: 2, speaker: 'narrator' },
  ];
  assert.equal(narratorResponseLabel(turns, turns[1]), 'A1');
});

test('narratorResponseLabel counts narrator turns only, ignoring interleaved user turns', () => {
  const turns = [
    { turn_number: 1, speaker: 'user' },
    { turn_number: 2, speaker: 'narrator' },
    { turn_number: 3, speaker: 'user' },
    { turn_number: 4, speaker: 'narrator' },
    { turn_number: 5, speaker: 'user' },
    { turn_number: 6, speaker: 'narrator' },
  ];
  assert.equal(narratorResponseLabel(turns, turns[1]), 'A1');
  assert.equal(narratorResponseLabel(turns, turns[3]), 'A2');
  assert.equal(narratorResponseLabel(turns, turns[5]), 'A3');
});

test('narratorResponseLabel falls back to .role when .speaker is absent', () => {
  const turns = [
    { turn_number: 1, role: 'user' },
    { turn_number: 2, role: 'narrator' },
  ];
  assert.equal(narratorResponseLabel(turns, turns[1]), 'A1');
});

test('formatNarratorLinesWithGutter numbers non-blank lines and skips blank lines as spacers', () => {
  const input = 'First line.\n\nSecond paragraph line one.\nSecond paragraph line two.';
  const expected =
    '<div class="turn-line-gutter">' +
      '<div class="turn-line"><span class="turn-line-num">1</span><span class="turn-line-content">First line.</span></div>' +
      '<div class="turn-line-spacer"></div>' +
      '<div class="turn-line"><span class="turn-line-num">2</span><span class="turn-line-content">Second paragraph line one.</span></div>' +
      '<div class="turn-line"><span class="turn-line-num">3</span><span class="turn-line-content">Second paragraph line two.</span></div>' +
    '</div>';
  assert.equal(formatNarratorLinesWithGutter(input), expected);
});

test('formatNarratorLinesWithGutter collapses consecutive blank lines into a single spacer', () => {
  const input = 'A\n\n\n\nB';
  const expected =
    '<div class="turn-line-gutter">' +
      '<div class="turn-line"><span class="turn-line-num">1</span><span class="turn-line-content">A</span></div>' +
      '<div class="turn-line-spacer"></div>' +
      '<div class="turn-line"><span class="turn-line-num">2</span><span class="turn-line-content">B</span></div>' +
    '</div>';
  assert.equal(formatNarratorLinesWithGutter(input), expected);
});

test('formatNarratorLinesWithGutter escapes HTML special characters per line', () => {
  const input = '<script>alert(1)</script>';
  const expected =
    '<div class="turn-line-gutter">' +
      '<div class="turn-line"><span class="turn-line-num">1</span><span class="turn-line-content">&lt;script&gt;alert(1)&lt;/script&gt;</span></div>' +
    '</div>';
  assert.equal(formatNarratorLinesWithGutter(input), expected);
});

test('formatNarratorLinesWithGutter converts *word* to <em>word</em> per line', () => {
  const input = 'She whispered *softly* to him.';
  const expected =
    '<div class="turn-line-gutter">' +
      '<div class="turn-line"><span class="turn-line-num">1</span><span class="turn-line-content">She whispered <em>softly</em> to him.</span></div>' +
    '</div>';
  assert.equal(formatNarratorLinesWithGutter(input), expected);
});

test('formatNarratorLinesWithGutter returns empty string for falsy input', () => {
  assert.equal(formatNarratorLinesWithGutter(''), '');
  assert.equal(formatNarratorLinesWithGutter(null), '');
  assert.equal(formatNarratorLinesWithGutter(undefined), '');
});

test('formatNarratorLinesWithGutter handles a single-line response', () => {
  const expected =
    '<div class="turn-line-gutter">' +
      '<div class="turn-line"><span class="turn-line-num">1</span><span class="turn-line-content">Just one line.</span></div>' +
    '</div>';
  assert.equal(formatNarratorLinesWithGutter('Just one line.'), expected);
});
