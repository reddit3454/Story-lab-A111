// Regression test: createTurnElement must use the narrator-only line-gutter renderer and
// response-ID badge for narrator turns, per
// docs/superpowers/specs/2026-07-15-narrator-line-numbering-design.md. User/guidance turns
// must keep using formatStoryContent (unchanged) — this test also guards against the gutter
// renderer leaking into that branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../views/play.js', import.meta.url), 'utf8');

test('play.js imports narratorResponseLabel and formatNarratorLinesWithGutter from utils.js', () => {
  assert.match(source, /import\s*\{[^}]*narratorResponseLabel[^}]*\}\s*from\s*'\.\.\/utils\.js'/);
  assert.match(source, /import\s*\{[^}]*formatNarratorLinesWithGutter[^}]*\}\s*from\s*'\.\.\/utils\.js'/);
});

test('createTurnElement renders narrator bodies with formatNarratorLinesWithGutter, others with formatStoryContent', () => {
  const match = source.match(/var bodyHtml = turn\.speaker === 'narrator'\s*\n\s*\? formatNarratorLinesWithGutter\(content\)\s*\n\s*: formatStoryContent\(content\);/);
  assert.ok(match, 'expected the narrator/non-narrator body ternary using formatNarratorLinesWithGutter and formatStoryContent');
});

test('createTurnElement computes a response label only for narrator turns', () => {
  const match = source.match(/var responseLabel = turn\.speaker === 'narrator' \? narratorResponseLabel\(state\.turns, turn\) : null;/);
  assert.ok(match, 'expected responseLabel to be gated on turn.speaker === \'narrator\'');
});

test('the guidance/user turn branch still uses escapeHtml directly, untouched by the gutter renderer', () => {
  assert.match(source, /'<div class="turn-text story-font guidance-text">' \+ escapeHtml\(content\) \+ '<\/div>'/);
});
