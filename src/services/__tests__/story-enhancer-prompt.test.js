import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

test('story-enhancer system prompt is a short 3-line contract', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../story-enhancer.js'), 'utf8');
  const m = src.match(/const SDXL_STORY_SYSTEM_PROMPT = `([\s\S]*?)`;/);
  assert.ok(m, 'prompt constant missing');
  const prompt = m[1];
  assert.ok(prompt.includes('exactly three lines'));
  assert.ok(prompt.includes('Negative prompt:'));
  assert.ok(prompt.includes('Exactly one BREAK'));
  assert.ok(prompt.length < 900, `expected short prompt, got ${prompt.length}`);
  assert.ok(!prompt.includes('SDXL HAS TWO TEXT ENCODERS'));
});
