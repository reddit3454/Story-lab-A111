# Narrator Response Line Numbering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every narrator response in the Play view a stable `A{n}` ID and a faint per-line gutter, so a specific line can be referenced as `A5-11` (line 11 of narrator response 5).

**Architecture:** Two new pure functions in `public/js/utils.js` (`narratorResponseLabel`, `formatNarratorLinesWithGutter`), consumed by `public/js/views/play.js`'s `createTurnElement` for `narrator`-role turns only. Everything is computed at render time from `state.turns` / `turn.content_text` — no DB or API changes. New CSS rules style the badge and gutter to match the existing faint `.turn-meta-num` visual weight.

**Tech Stack:** Vanilla ESM JS (no framework), `node:test` for unit tests, plain CSS with existing custom properties.

## Global Constraints

- No new npm dependencies (project CLAUDE.md rule 3: express/ws/cors only).
- ESM only — `import`/`export`, never `require()` (project CLAUDE.md rule 1).
- No DB/schema changes — this is a pure frontend rendering feature (spec: "Out of scope").
- Scope strictly to `role`/`speaker === 'narrator'` turns — user/guidance turns must render exactly as before (spec: numbering scheme + visual design sections).
- Line numbers count only non-blank source lines (`\n`-split); blank lines are spacing only, never numbered (spec: numbering scheme).
- Response ID is a narrator-only running count (`A1`, `A2`, ...), independent of the raw `turn_number` column (spec: numbering scheme).

---

### Task 1: Add pure helper functions to `public/js/utils.js`

**Files:**
- Modify: `public/js/utils.js:12-24` (existing `formatStoryContent`, refactor to share inline-formatting logic; add two new exports after it)
- Test: `public/js/__tests__/narrator-line-numbering.test.js` (create)

**Interfaces:**
- Produces: `narratorResponseLabel(turns, targetTurn)` — `turns` is an array of turn objects each with `.turn_number` (number) and `.speaker` or `.role` (string); `targetTurn` is one such object. Returns a string like `"A5"` if `targetTurn`'s role is `'narrator'`, otherwise `null`.
- Produces: `formatNarratorLinesWithGutter(text)` — `text` is a string (or falsy). Returns an HTML string: `''` for falsy/empty input, otherwise `<div class="turn-line-gutter">...</div>` containing one `<div class="turn-line">` per non-blank source line (each with a `<span class="turn-line-num">` and `<span class="turn-line-content">`), and one `<div class="turn-line-spacer"></div>` per run of one-or-more consecutive blank lines.
- `formatStoryContent(text)` keeps its exact current signature and behavior (still used by memory summaries) — only its internal escaping/em-conversion step is factored into a shared helper.

- [ ] **Step 1: Write the failing tests**

Create `public/js/__tests__/narrator-line-numbering.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- public/js/__tests__/narrator-line-numbering.test.js`
Expected: FAIL — `narratorResponseLabel` and `formatNarratorLinesWithGutter` are not exported from `utils.js` yet (`SyntaxError` or `undefined is not a function`).

- [ ] **Step 3: Implement the functions in `public/js/utils.js`**

Replace the existing `formatStoryContent` function (currently `public/js/utils.js:12-24`):

```js
export function formatStoryContent(text) {
  if (!text) return '';
  var escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  var paras = escaped.split(/\n\n+/);
  return paras
    .filter(function (p) { return p.trim(); })
    .map(function (p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; })
    .join('');
}
```

with:

```js
function _formatInline(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

export function formatStoryContent(text) {
  if (!text) return '';
  var escaped = _formatInline(text);
  var paras = escaped.split(/\n\n+/);
  return paras
    .filter(function (p) { return p.trim(); })
    .map(function (p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; })
    .join('');
}

// Response ID for the "A5-11" addressing scheme (see
// docs/superpowers/specs/2026-07-15-narrator-line-numbering-design.md). Counts narrator-role
// turns only, in turn_number order, ignoring interleaved user/other-role turns. Returns null
// for a non-narrator turn.
export function narratorResponseLabel(turns, targetTurn) {
  if (!targetTurn) return null;
  var targetRole = targetTurn.speaker || targetTurn.role;
  if (targetRole !== 'narrator') return null;
  var targetNum = targetTurn.turn_number || 0;
  var count = 0;
  (turns || []).forEach(function (t) {
    var role = t.speaker || t.role;
    if (role === 'narrator' && (t.turn_number || 0) <= targetNum) count += 1;
  });
  return 'A' + count;
}

// Renders a narrator turn's raw content_text as numbered source lines with a faint gutter,
// instead of formatStoryContent's paragraph/<br> rendering. Blank lines (paragraph breaks)
// are spacing only and never consume a line number; consecutive blank lines collapse into a
// single spacer so the gutter never shows duplicate gaps.
export function formatNarratorLinesWithGutter(text) {
  if (!text) return '';
  // Inline formatting (_formatInline) runs per-line, AFTER splitting on '\n' — not on the
  // whole text first. Running it first would let the *em* regex match across a line break
  // (its char class doesn't exclude '\n'), producing an unclosed <em> in one line's span and
  // an orphan </em> in the next once the lines are split into separate DOM elements.
  var rawLines = String(text).split('\n');
  var lineNum = 0;
  var prevWasSpacer = false;
  var rows = [];
  rawLines.forEach(function (line) {
    if (!line.trim()) {
      if (!prevWasSpacer) rows.push('<div class="turn-line-spacer"></div>');
      prevWasSpacer = true;
      return;
    }
    prevWasSpacer = false;
    lineNum += 1;
    rows.push(
      '<div class="turn-line">' +
        '<span class="turn-line-num">' + lineNum + '</span>' +
        '<span class="turn-line-content">' + _formatInline(line) + '</span>' +
      '</div>'
    );
  });
  return '<div class="turn-line-gutter">' + rows.join('') + '</div>';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- public/js/__tests__/narrator-line-numbering.test.js`
Expected: `# pass 10`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add public/js/utils.js public/js/__tests__/narrator-line-numbering.test.js
git commit -m "feat: add narrator response ID and line-gutter helpers to utils.js"
```

---

### Task 2: Wire the helpers into `public/js/views/play.js`

**Files:**
- Modify: `public/js/views/play.js:2` (import line)
- Modify: `public/js/views/play.js:489-520` (`createTurnElement`'s narrator branch)
- Test: `public/js/__tests__/narrator-turn-numbering-wiring.test.js` (create)

**Interfaces:**
- Consumes: `narratorResponseLabel(turns, targetTurn)` and `formatNarratorLinesWithGutter(text)` from Task 1, exactly as defined there.
- Produces: no new exports — this task only changes `createTurnElement`'s rendered HTML for `turn.speaker === 'narrator'` turns.

This task follows the codebase's existing pattern for regression-testing behavior embedded in the large `play.js` view module (see `public/js/__tests__/logline-panel-wiring.test.js`): a source-pattern check via `fs.readFileSync`, since `createTurnElement` is not itself exported for direct unit testing.

- [ ] **Step 1: Write the failing wiring test**

Create `public/js/__tests__/narrator-turn-numbering-wiring.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- public/js/__tests__/narrator-turn-numbering-wiring.test.js`
Expected: FAIL — none of the new patterns exist in `play.js` yet (`assert.ok(match, ...)` fails, `assert.match` fails).

- [ ] **Step 3: Update the import line**

In `public/js/views/play.js:2`, replace:

```js
import { escapeHtml, formatStoryContent, avatarHtml, imageSrc } from '../utils.js';
```

with:

```js
import { escapeHtml, formatStoryContent, formatNarratorLinesWithGutter, narratorResponseLabel, avatarHtml, imageSrc } from '../utils.js';
```

- [ ] **Step 4: Update `createTurnElement`'s narrator branch**

In `public/js/views/play.js`, replace this block (currently around lines 489-520):

```js
    var speakerChar = speakerName
      ? npcChars.find(function (c) { return c.name === speakerName; }) || null
      : null;
    if (speakerName) div.classList.add('turn-npc');
    var speakerHtml = speakerName
      ? '<div class="turn-header">' +
          avatarHtml(speakerChar, 'turn-avatar') +
          '<div class="turn-speaker turn-speaker-npc">' + escapeHtml(speakerName) + '</div>' +
        '</div>'
      : '<div class="narrator-label">~ Narrator ~</div>';
    var npcTextStyle = '';
    if (speakerChar) {
      var speakerIdx = 0;
      npcChars.forEach(function (c, i) { if (c.id === speakerChar.id) speakerIdx = i; });
      npcTextStyle = ' style="color:' + getNpcColor(speakerChar.id, speakerIdx) + '"';
    }
    var ratingUp   = turn.user_rating ===  1 ? ' active-up'   : '';
    var ratingDown = turn.user_rating === -1 ? ' active-down'  : '';
    var imageHtml  = turn.image_filename
      ? buildTurnImageHtml({
          filename:          turn.image_filename,
          imageId:           turn.image_id           || null,
          visualPrompt:      turn.image_visual_prompt || '',
          videostatus:       turn.image_videostatus   || '',
          videoclipfilename: turn.image_videoclipfilename || '',
          accepted:          turn.image_accepted      || 0
        })
      : '';
    div.innerHTML = numHtml +
      '<div class="turn-inner">' +
        speakerHtml +
        '<div class="turn-text story-font"' + npcTextStyle + '>' + formatStoryContent(content) + '</div>' +
```

with:

```js
    var speakerChar = speakerName
      ? npcChars.find(function (c) { return c.name === speakerName; }) || null
      : null;
    if (speakerName) div.classList.add('turn-npc');
    var responseLabel = turn.speaker === 'narrator' ? narratorResponseLabel(state.turns, turn) : null;
    var responseIdHtml = responseLabel ? '<span class="turn-response-id">' + escapeHtml(responseLabel) + '</span>' : '';
    var speakerHtml = speakerName
      ? '<div class="turn-header">' +
          avatarHtml(speakerChar, 'turn-avatar') +
          '<div class="turn-speaker turn-speaker-npc">' + escapeHtml(speakerName) + '</div>' +
          responseIdHtml +
        '</div>'
      : '<div class="narrator-label">~ Narrator ~' + (responseIdHtml ? ' ' + responseIdHtml : '') + '</div>';
    var npcTextStyle = '';
    if (speakerChar) {
      var speakerIdx = 0;
      npcChars.forEach(function (c, i) { if (c.id === speakerChar.id) speakerIdx = i; });
      npcTextStyle = ' style="color:' + getNpcColor(speakerChar.id, speakerIdx) + '"';
    }
    var ratingUp   = turn.user_rating ===  1 ? ' active-up'   : '';
    var ratingDown = turn.user_rating === -1 ? ' active-down'  : '';
    var imageHtml  = turn.image_filename
      ? buildTurnImageHtml({
          filename:          turn.image_filename,
          imageId:           turn.image_id           || null,
          visualPrompt:      turn.image_visual_prompt || '',
          videostatus:       turn.image_videostatus   || '',
          videoclipfilename: turn.image_videoclipfilename || '',
          accepted:          turn.image_accepted      || 0
        })
      : '';
    var bodyHtml = turn.speaker === 'narrator'
      ? formatNarratorLinesWithGutter(content)
      : formatStoryContent(content);
    div.innerHTML = numHtml +
      '<div class="turn-inner">' +
        speakerHtml +
        '<div class="turn-text story-font"' + npcTextStyle + '>' + bodyHtml + '</div>' +
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- public/js/__tests__/narrator-turn-numbering-wiring.test.js`
Expected: `# pass 4`, `# fail 0`

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npm test`
Expected: all existing tests still pass (no `# fail` lines other than `0`).

- [ ] **Step 7: Commit**

```bash
git add public/js/views/play.js public/js/__tests__/narrator-turn-numbering-wiring.test.js
git commit -m "feat: render narrator turns with A{n} response badge and per-line gutter"
```

---

### Task 3: Style the badge and gutter in `public/css/main.css`

**Files:**
- Modify: `public/css/main.css:1815-1826` (insert new rules after `.narrator-label`)

**Interfaces:**
- Consumes: the class names introduced by Task 2's HTML — `.turn-response-id`, `.turn-line-gutter`, `.turn-line`, `.turn-line-num`, `.turn-line-content`, `.turn-line-spacer`.
- Produces: nothing consumed by later tasks — this is the last code task.

- [ ] **Step 1: Add the new CSS rules**

In `public/css/main.css`, find this existing block:

```css
/* Narrator label */
.narrator-label {
  text-align: center;
  font-family: var(--font-story);
  font-size: 11px;
  font-style: italic;
  color: var(--text-faint);
  letter-spacing: 0.14em;
  margin-bottom: 8px;
  opacity: 0.7;
}

/* Entrance animations */
```

Replace it with:

```css
/* Narrator label */
.narrator-label {
  text-align: center;
  font-family: var(--font-story);
  font-size: 11px;
  font-style: italic;
  color: var(--text-faint);
  letter-spacing: 0.14em;
  margin-bottom: 8px;
  opacity: 0.7;
}

/* Narrator response ID badge ("A5") and per-line numbering gutter (A5-11 addressing scheme) */
.turn-response-id {
  font-size: 10px;
  color: var(--text-faint);
  opacity: 0.75;
  margin-left: 4px;
  letter-spacing: 0.04em;
  user-select: none;
}
.turn-line-gutter {
  display: flex;
  flex-direction: column;
}
.turn-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.turn-line-num {
  flex-shrink: 0;
  min-width: 22px;
  text-align: right;
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: var(--text-faint);
  opacity: 0.55;
  user-select: none;
}
.turn-line-content {
  flex: 1;
  min-width: 0;
}
.turn-line-spacer {
  height: var(--story-paragraph-space);
}

/* Entrance animations */
```

- [ ] **Step 2: Commit**

```bash
git add public/css/main.css
git commit -m "style: add faint narrator response ID and line-gutter CSS"
```

---

### Task 4: Manual verification in the browser

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server starts on port 4090 with no errors.

- [ ] **Step 2: Open the Play view for a scenario with existing turns**

Navigate to `http://localhost:4090` in a browser, open any scenario with at least 3-4 narrator responses already in its history, and go to the Play view.

- [ ] **Step 3: Confirm response IDs are sequential and narrator-only**

Expected: each narrator turn's header (either `~ Narrator ~` or the detected speaker name) shows a small faint `A1`, `A2`, `A3`, ... badge, sequential and increasing top-to-bottom regardless of how many user turns are interleaved. User/guidance turns show no badge.

- [ ] **Step 4: Confirm the line gutter renders correctly**

Expected: each narrator response's text is broken into rows with a small faint number on the left of each line; paragraph breaks show as blank vertical space with no number; italic (`*word*`) formatting still renders correctly inline.

- [ ] **Step 5: Confirm user/guidance turns are visually unchanged**

Expected: user turns render exactly as before — no gutter, no badge, same "Guidance" bubble styling.

- [ ] **Step 6: Send a new turn and confirm the new narrator response gets the next sequential ID**

Type a message and submit it. Expected: the new narrator response appears with the next `A{n}` badge (e.g. if the last existing one was `A4`, the new one is `A5`) and its own line gutter, without a full page reload.

- [ ] **Step 7: Report results**

Note pass/fail for each of steps 3-6 with a one-sentence observation each, per this project's UI-verification convention.
