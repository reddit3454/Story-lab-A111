// Regression test: the WS 'logline' handler in play.js must unwrap the broadcast
// envelope's payload before handing it to _debugConsole.push(). broadcast.js sends
// { type, payload: { cat, msg, ts }, ts }; pushing the raw envelope leaves
// entry.cat / entry.msg undefined in debug-console.js's _makeLine(), so the log
// window silently renders blank lines instead of the log text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../views/play.js', import.meta.url), 'utf8');

test('logline WS case unwraps data.payload before pushing to the debug console', () => {
  const match = source.match(/case 'logline':\s*\n\s*if \(window\._debugConsole[^\n]*\)\s*window\._debugConsole\.push\(([^)]*)\);/);
  assert.ok(match, 'logline case not found in play.js WS handler');
  assert.equal(match[1].trim(), 'data.payload || data',
    'logline handler must push data.payload (falling back to data), matching every other case in the switch');
});
