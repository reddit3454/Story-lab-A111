import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const settings = fs.readFileSync(path.join(root, 'public', 'js', 'views', 'settings.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'main.css'), 'utf8');

test('Settings has styled tab and scene-state control contracts', () => {
  assert.match(css, /\.settings-tab-bar\s*\{/);
  assert.match(css, /\.settings-tab-btn\s*\{/);
  assert.match(settings, /id="sd-scene-state-enabled"/);
  assert.match(settings, /id="sd-scene-state-model"/);
  assert.match(settings, /id="sd-scene-state-keep-alive"/);
  assert.match(settings, /id="model-narrator-max-tokens"/);
});
