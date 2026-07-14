# Scenario Append Tags (Start/Middle/End) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user type free-form tags per scenario (Append Start / Append Middle / Append End) in the Scene Info panel, and have those tags automatically spliced into every scenario (scene-mode) image prompt at the front / after character descriptions / at the very end, and spliced into the character-image tag-review box shown before the user edits and submits a character-specific image.

**Architecture:** Three independent insertion points, no shared runtime state:
1. `scenarios` table gains three new TEXT columns, editable from the Scene Info modal via the existing generic `PUT /api/scenarios/:id` field-whitelist mechanism.
2. The deterministic scenario-image prompt assembler (`prompt-builder.js` `buildPrompt()` + `composeEnhancedScenePrompt()`) reads `scenario.append_start/middle/end` directly (the `scenario` param already flows into `buildPrompt()` unused today) and splices them in at construction time. `image-pipeline.js` applies `append_end` exactly once, after every other tail-append (enhancer rewrite, location environment tags) — the true final step before the prompt is sent to A1111. This covers 100% of scenario/scene-mode generation, however it was triggered (automatic or via manual review).
3. The character-image review pipeline (`prompt-preview.js` `buildPromptPreview()`, `target: 'character'` branch) splices the same three fields into the `summary_tags` string that is shown to the user in the Prompt Panel's tag textarea before they edit and submit — this is the "tag prompt submitted to the user for editing and submission" the user described. Character-mode's actual generation pipeline (`buildCharacterPrompt()`) is left untouched; whatever the user submits (with or without edits) is what generates, exactly like today.

**Tech Stack:** Node.js/Express, `node:sqlite` (`DatabaseSync`), vanilla JS frontend, `node:test` + `node:assert/strict` for tests (run via `npm test`, i.e. `node --experimental-sqlite --experimental-test-module-mocks --test`).

## Global Constraints

- ESM only — no `require()`.
- Additive DB migrations only: each new column via its own `migrate("ALTER TABLE ... ADD COLUMN ...")` wrapped in try/catch (already handled by the existing `migrate()` helper in `src/db.js:241-249` — do not add new try/catch blocks around it).
- No new npm dependencies.
- Character-specific image generation (`buildCharacterPrompt()` / `mode: 'character'` in `image-pipeline.js`) must NOT be touched by this feature — append tags for character images are handled entirely in the review layer (`prompt-preview.js`), per explicit user instruction. Verify this with a test that asserts append fields do NOT leak into a character-mode generated prompt.
- Follow the DB_PATH-mocking test harness pattern already used in this repo (see `src/services/__tests__/prompt-preview.test.js` and `src/services/__tests__/image-pipeline.integration.test.js`): mock `../../paths.js` with `DB_PATH: ':memory:'` before importing `db.js`, so tests never touch the real `story-lab.db`.

---

### Task 1: DB schema + route persistence for append_start/append_middle/append_end

**Files:**
- Modify: `src/db.js:300` (end of the "scenario extended wizard fields" migration block)
- Modify: `src/routes/scenarios.js:6-14` (`SCENARIO_FIELDS` array)
- Test: `src/routes/__tests__/scenarios.routes.test.js` (new file)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `scenarios.append_start`, `scenarios.append_middle`, `scenarios.append_end` columns (TEXT, default `''`), persisted via the existing generic `PUT /api/scenarios/:id` handler. Tasks 2-5 read these three column names verbatim off scenario rows (`scenario.append_start`, `scenario.append_middle`, `scenario.append_end`).

- [ ] **Step 1: Write the failing route test**

Create `src/routes/__tests__/scenarios.routes.test.js`:

```js
// Route-level regression test: append_start/append_middle/append_end must be
// persisted through the generic SCENARIO_FIELDS whitelist in routes/scenarios.js,
// and must default to '' on creation (see src/db.js migration).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-scenroute-'));
const DIRS = { data: path.join(ROOT, 'data'), images: path.join(ROOT, 'images') };
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'),
    DATA_DIR: DIRS.data, IMAGES_DIR: DIRS.images,
    BACKGROUNDS_DIR: path.join(ROOT, 'backgrounds'), AUDIO_DIR: path.join(ROOT, 'audio'),
    DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(DIRS.data, 'audit.jsonl'),
  },
});

const { default: db } = await import('../../db.js');
const { default: express } = await import('express');
const { default: scenariosRouter } = await import('../scenarios.js');

const app = express();
app.use(express.json());
app.use('/api/scenarios', scenariosRouter);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

test('scenario defaults append fields to empty string on creation', async () => {
  const res = await fetch(`${baseUrl}/api/scenarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Fresh Scenario' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.append_start, '');
  assert.equal(body.append_middle, '');
  assert.equal(body.append_end, '');
});

test('PUT /api/scenarios/:id persists append_start/append_middle/append_end', async () => {
  const scenarioId = db.prepare(`INSERT INTO scenarios (title) VALUES ('Append Route Test')`).run().lastInsertRowid;

  const res = await fetch(`${baseUrl}/api/scenarios/${scenarioId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      append_start: 'sepia tone',
      append_middle: 'freckles',
      append_end: 'polaroid border',
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.append_start, 'sepia tone');
  assert.equal(body.append_middle, 'freckles');
  assert.equal(body.append_end, 'polaroid border');

  const row = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId);
  assert.equal(row.append_start, 'sepia tone');
  assert.equal(row.append_middle, 'freckles');
  assert.equal(row.append_end, 'polaroid border');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="append"`
Expected: FAIL — `append_start`/`append_middle`/`append_end` are `undefined` in both responses (columns don't exist yet, and the PUT whitelist ignores unknown fields silently).

- [ ] **Step 3: Add the DB migration**

In `src/db.js`, immediately after line 300 (`migrate("ALTER TABLE scenarios ADD COLUMN generation_config TEXT DEFAULT NULL");`) and before the `// character relationships table` comment, add:

```js
migrate("ALTER TABLE scenarios ADD COLUMN append_start  TEXT DEFAULT ''");
migrate("ALTER TABLE scenarios ADD COLUMN append_middle TEXT DEFAULT ''");
migrate("ALTER TABLE scenarios ADD COLUMN append_end    TEXT DEFAULT ''");
```

- [ ] **Step 4: Add the fields to the route whitelist**

In `src/routes/scenarios.js`, change the `SCENARIO_FIELDS` array (lines 6-14) to:

```js
const SCENARIO_FIELDS = [
  'title', 'description', 'system_prompt', 'nsfw_enabled',
  'narrator_model', 'context_turns', 'status',
  'tone', 'premise', 'setting', 'default_start',
  'reply_length', 'lust_level', 'explicitness_level',
  'pacing', 'narrative_pov', 'violence_level', 'tone_modifier',
  'narrator_presence_enabled', 'narrator_presence_mode', 'narrator_presence_config',
  'active_location_id', 'user_character_id', 'ended_at', 'generation_config',
  'append_start', 'append_middle', 'append_end',
];
```

(No change needed to the `POST /` insert statement — new scenarios get `''` from the column default, and `PUT /:id` already builds its `UPDATE` generically off `SCENARIO_FIELDS`.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- --test-name-pattern="append"`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npm test`
Expected: All existing tests still PASS (additive column + additive whitelist entry, no existing behavior changed).

- [ ] **Step 7: Commit**

```bash
git add src/db.js src/routes/scenarios.js src/routes/__tests__/scenarios.routes.test.js
git commit -m "feat: add scenario append_start/append_middle/append_end columns and persistence"
```

---

### Task 2: Splice append tags into the deterministic scenario prompt assembler

**Files:**
- Modify: `src/services/prompt-builder.js:307-522` (`buildPrompt()`, new `_flattenWithMiddleInsert` helper, `composeEnhancedScenePrompt()`)
- Test: `src/services/__tests__/prompt-builder.compose.test.js` (append to existing file)

**Interfaces:**
- Consumes: `scenario.append_start`, `scenario.append_middle`, `scenario.append_end` (Task 1's columns; `scenario` param is already threaded into `buildPrompt()` today, just unused).
- Produces: `buildPrompt()`'s returned `parts` object gains three new keys — `parts.append_start`, `parts.append_middle`, `parts.append_end` (each a normalized string, `''` if unset) — which Task 3 reads in `image-pipeline.js`. `composeEnhancedScenePrompt()` gains two new optional params, `appendStart` and `appendMiddle` (both default `''`), which Task 3 passes through.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/__tests__/prompt-builder.compose.test.js` (after the last existing test, `'buildPrompt does not include empty clothing candidates when unresolved'`):

```js
// --- append_start / append_middle / append_end ---
test('buildPrompt applies append_start/append_middle/append_end from scenario, middle after clothing bucket', () => {
  const char = {
    id: 5, name: 'Sam', role: 'character', gender: 'female',
    hair_color: 'black', hair_style: 'short', eye_color: 'brown', skin_tone: 'tan',
    body_type: 'athletic', current_clothing: '',
  };
  const { prompt, parts } = buildPrompt({
    sceneCard: { image_prompt: 'standing at the shoreline', mood: 'joyful', arousal_level: 1 },
    characters: [char],
    location: null,
    scenario: { append_start: 'sepia tone', append_middle: 'freckles', append_end: 'watermark' },
    config: { master_positive: 'best quality', nsfw_enabled: false, lora_enabled: false },
    resolvedClothingMap: { 5: 'red bikini' },
  });
  assert.ok(prompt.startsWith('sepia tone'), `expected append_start to lead, got: ${prompt}`);
  // append_end is intentionally NOT part of buildPrompt()'s own join — Task 3 applies
  // parts.append_end centrally in image-pipeline.js, after the location-environment
  // tag append, so it is always the true tail regardless of path. Here we only assert
  // it was captured for that later step to use.
  assert.equal(parts.append_end, 'watermark');
  assert.equal(parts.append_middle, 'freckles');
  const clothingIdx = prompt.indexOf('red bikini');
  const middleIdx = prompt.indexOf('freckles');
  assert.ok(clothingIdx > -1 && middleIdx > clothingIdx, `append_middle must come after clothing, got: ${prompt}`);
});

test('buildPrompt leaves prompt unchanged when scenario has no append fields', () => {
  const { prompt, parts } = buildPrompt({
    sceneCard: { image_prompt: 'she waves hello', mood: 'joyful', arousal_level: 1 },
    characters: [{ id: 9, name: 'X', role: 'character', gender: 'female', hair_color: 'black' }],
    location: null,
    scenario: {},
    config: { master_positive: 'best quality', nsfw_enabled: false, lora_enabled: false },
    resolvedClothingMap: {},
  });
  assert.equal(parts.append_start, '');
  assert.equal(parts.append_middle, '');
  assert.equal(parts.append_end, '');
  assert.ok(!prompt.includes('undefined') && !prompt.includes('null'));
});

test('composeEnhancedScenePrompt splices appendStart before prefix and appendMiddle between clothing and suffix', () => {
  const result = composeEnhancedScenePrompt({
    appendStart: 'sepia tone',
    prefix: 'masterpiece, best quality',
    body: 'a woman standing in a doorway',
    clothingBlock: 'red sundress',
    appendMiddle: 'freckles',
    suffix: '8k, detailed',
    loraTags: '',
  });
  assert.ok(result.startsWith('sepia tone'), `expected appendStart to lead, got: ${result}`);
  const clothingIdx = result.indexOf('red sundress');
  const middleIdx = result.indexOf('freckles');
  const suffixIdx = result.indexOf('8k, detailed');
  assert.ok(clothingIdx < middleIdx, `appendMiddle must come after clothing block, got: ${result}`);
  assert.ok(middleIdx < suffixIdx, `appendMiddle must come before suffix, got: ${result}`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="append"`
Expected: FAIL — `parts.append_start`/`append_middle`/`append_end` are `undefined`, `prompt` does not start with `appendStart`, and `composeEnhancedScenePrompt` has no `appendStart`/`appendMiddle` params yet.

- [ ] **Step 3: Add the bucket-aware flatten helper**

In `src/services/prompt-builder.js`, immediately after `flattenSelected()` (currently lines 307-313), add:

```js
function _flattenWithMiddleInsert(selected, middleTag) {
  const out = [];
  for (const name of BUCKET_ORDER) {
    for (const item of selected[name] || []) out.push(item.tag);
    if (name === 'clothing' && middleTag) out.push(middleTag);
  }
  return out;
}
```

- [ ] **Step 4: Update `buildPrompt()` to compute and splice the append fields**

Replace the current `buildPrompt()` (lines 488-522) with:

```js
export function buildPrompt({
  sceneCard, characters, location, scenario, config, isImg2img = false, resolvedClothingMap = {},
}) {
  const { buckets, clothingBlock } = _collectSceneCandidates({
    sceneCard, characters, location, config, isImg2img, resolvedClothingMap,
  });
  const selection = selectPromptTags('scene', buckets);
  const lora = _loraTags(config);

  const appendStart  = _normalizeTag(scenario?.append_start  || '');
  const appendMiddle = _normalizeTag(scenario?.append_middle || '');
  const appendEnd    = _normalizeTag(scenario?.append_end    || '');

  // append_end is deliberately NOT joined into `prompt` here — Task 3 applies
  // parts.append_end centrally in image-pipeline.js, after the location-environment
  // tag append, so it is always the true tail regardless of which path (deterministic
  // or enhancer-rewritten) produced `prompt`. It is still captured in `parts` below.
  const orderedTags = _flattenWithMiddleInsert(selection.selected, appendMiddle);
  const prompt = _join(appendStart, ...orderedTags, lora);

  const parts = {
    mode: isImg2img ? 'img2img' : 'txt2img',
    prefix: _join(config?.master_positive ?? '', config?.prompt_prefix ?? ''),
    scene_image_prompt: sceneCard?.image_prompt ?? '',
    location_tags: (isImg2img || !(sceneCard?.image_prompt || '').trim())
      ? (location?.image_tags || '')
      : '',
    atmosphere_tags: _moodTags(sceneCard?.mood),
    character_block: (characters || []).map((c) => _charAppearanceTags(c).join(', ')).filter(Boolean).join(', '),
    clothing_block: clothingBlock, // authoritative for composeEnhancedScenePrompt
    arousal_tags: getArousalTags(sceneCard?.arousal_level ?? 1, config || {}).join(', '),
    suffix: config?.prompt_suffix ?? '',
    lora_tags: lora,
    append_start: appendStart,
    append_middle: appendMiddle,
    append_end: appendEnd,
    negative: _join(
      config?.master_negative ?? '',
      config?.negative_additions ?? '',
      sceneCard?.negative_prompt_additions ?? '',
    ),
    candidateTags: selection.candidateTags,
    selectedTags: selection.selectedTags,
    dropReasons: selection.dropReasons,
  };

  return { prompt, negative: parts.negative, parts };
}
```

- [ ] **Step 5: Update `composeEnhancedScenePrompt()`**

Replace (current lines 529-531):

```js
export function composeEnhancedScenePrompt({ prefix = '', body = '', clothingBlock = '', suffix = '', loraTags = '' }) {
  return _join(prefix, body, clothingBlock, suffix, loraTags);
}
```

with:

```js
export function composeEnhancedScenePrompt({
  prefix = '', body = '', clothingBlock = '', appendMiddle = '', suffix = '', loraTags = '', appendStart = '',
}) {
  return _join(appendStart, prefix, body, clothingBlock, appendMiddle, suffix, loraTags);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="append"`
Expected: PASS (3 new tests).

- [ ] **Step 7: Run the full test suite to check for regressions**

Run: `npm test`
Expected: All existing tests still PASS — `composeEnhancedScenePrompt`'s 4 pre-existing tests never pass `appendStart`/`appendMiddle`, so they default to `''` and `_join` filters them out, producing identical output to before.

- [ ] **Step 8: Commit**

```bash
git add src/services/prompt-builder.js src/services/__tests__/prompt-builder.compose.test.js
git commit -m "feat: splice scenario append_start/append_middle into buildPrompt and composeEnhancedScenePrompt"
```

---

### Task 3: Apply append_start/append_middle/append_end in the real generation pipeline

**Files:**
- Modify: `src/services/image-pipeline.js:554-560` (composeEnhancedScenePrompt call site), `:573-582` (location-environment append, add append_end immediately after)
- Test: `src/services/__tests__/image-pipeline.integration.test.js` (append to existing file)

**Interfaces:**
- Consumes: `parts.append_start`, `parts.append_middle`, `parts.append_end` from Task 2's `buildPrompt()` return value (already destructured into `parts` at the `generate()` call site, `image-pipeline.js:456-461`).
- Produces: the final `prompt` string sent to `buildA1111Payload()` (`image-pipeline.js:665`) now has `append_start` at the front, `append_middle` after clothing/character description (via Task 2), and `append_end` as the absolute last segment — after the enhancer rewrite and after the location-environment tag append, for every scene/background mode generation. Character mode (`buildCharacterPrompt()`'s `parts`) is untouched — it has no `append_end` key, so the new code is a no-op there.

- [ ] **Step 1: Write the failing integration tests**

Append to `src/services/__tests__/image-pipeline.integration.test.js`, after the last existing test (`'CF-2: falls back to the first non-player cast member...'`):

```js
// ---------------------------------------------------------------------------
// Scenario append_start / append_middle / append_end
// ---------------------------------------------------------------------------

test('scenario append_start/middle/end are applied to the final submitted scene-mode prompt, end after location env tags', async (t) => {
  installFetch(t, {
    '/api/chat': ollamaChatRouter({
      pickerMainSubject: 'Riley',
      enhancerPositive: 'masterpiece, best quality, medium shot, standing near window, warm light',
    }),
    ...CONTROLNET_CATALOG_ROUTES,
    '/sdapi/v1/txt2img': () => fakeA1111Response(),
  });

  const { scenarioId } = seedScenario({ npcNames: ['Riley'], clothingByName: { Riley: 'red silk robe' } });
  const locId = db.prepare(
    `INSERT INTO locations (name, image_tags) VALUES ('Beach', 'sand, waves, sunset')`
  ).run().lastInsertRowid;
  db.prepare(`UPDATE scenarios SET active_location_id = ?, append_start = ?, append_middle = ?, append_end = ? WHERE id = ?`)
    .run(locId, 'sepia tone', 'freckles', 'polaroid border', scenarioId);

  await generate({ mode: 'scene', scenarioId, turnId: null });

  const image = lastSceneImage(scenarioId);
  assert.ok(image.prompt_used.startsWith('sepia tone'),
    `append_start must lead the submitted prompt, got: ${image.prompt_used}`);
  assert.ok(image.prompt_used.includes('sand, waves, sunset'),
    `location env tags must still be present, got: ${image.prompt_used}`);
  assert.ok(image.prompt_used.endsWith('polaroid border'),
    `append_end must be the true tail, after location env tags, got: ${image.prompt_used}`);
  assert.ok(image.prompt_used.includes('freckles'),
    `append_middle must be present, got: ${image.prompt_used}`);
});

test('character mode ignores scenario append fields (handled only in the prompt-preview review layer, not here)', async (t) => {
  installFetch(t, {
    '/api/chat': async () => ({ status: 200, json: { message: { content: '{}' } } }),
    ...CONTROLNET_CATALOG_ROUTES,
    '/sdapi/v1/txt2img': () => fakeA1111Response(),
  });

  const { scenarioId, idByName } = seedScenario({ npcNames: ['Riley'], clothingByName: { Riley: 'green sundress' } });
  db.prepare(`UPDATE scenarios SET append_start = ?, append_middle = ?, append_end = ? WHERE id = ?`)
    .run('sepia tone', 'freckles', 'polaroid border', scenarioId);

  await generate({ mode: 'character', scenarioId, characterId: idByName.Riley, turnId: null });

  const image = lastSceneImage(scenarioId);
  assert.ok(!image.prompt_used.includes('sepia tone'),
    `character-mode prompt must not include scenario append fields, got: ${image.prompt_used}`);
  assert.ok(!image.prompt_used.includes('polaroid border'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="append"`
Expected: FAIL — `image.prompt_used` does not start with `'sepia tone'` or end with `'polaroid border'` yet.

- [ ] **Step 3: Wire appendStart/appendMiddle into the enhancer's composeEnhancedScenePrompt call**

In `src/services/image-pipeline.js`, replace the `composeEnhancedScenePrompt` call (lines 554-560):

```js
          prompt = composeEnhancedScenePrompt({
            prefix,
            body: enhanced.positive,
            clothingBlock: resolvedClothingBlock,
            suffix,
            loraTags: lora,
          });
```

with:

```js
          prompt = composeEnhancedScenePrompt({
            prefix,
            body: enhanced.positive,
            clothingBlock: resolvedClothingBlock,
            appendMiddle: parts?.append_middle || '',
            suffix,
            loraTags: lora,
            appendStart: parts?.append_start || '',
          });
```

- [ ] **Step 4: Apply append_end once, after the location-environment tag append**

In `src/services/image-pipeline.js`, immediately after the existing location-environment block (lines 573-582):

```js
    // Inject location environment into txt2img prompts (no background image selected)
    if (!bgPath && location) {
      const locEnv = [
        location.image_tags || '',
        location.time_of_day && location.time_of_day !== 'any' ? location.time_of_day + ' lighting' : '',
      ].filter(s => s && s.trim()).join(', ');
      if (locEnv.trim()) {
        prompt = prompt ? prompt + ', ' + locEnv : locEnv;
      }
    }
```

add:

```js

    // Append End — user-defined scenario tag that must be the true tail of the
    // assembled prompt. Applied once, here, after every other tail-append above
    // (enhancer rewrite, location environment tags). Only buildPrompt() (scene/
    // background mode) sets parts.append_end — buildCharacterPrompt()'s `parts`
    // never carries it, so this is a no-op for mode: 'character'.
    if (parts?.append_end) {
      prompt = prompt ? prompt + ', ' + parts.append_end : parts.append_end;
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="append"`
Expected: PASS (2 new tests, plus the 3 from Task 2 still passing).

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npm test`
Expected: All existing tests still PASS — every existing test seeds scenarios without `append_*` values, which default to `''` (falsy), so the new `if (parts?.append_end)` branch never fires and `composeEnhancedScenePrompt`'s new params default to `''`.

- [ ] **Step 7: Commit**

```bash
git add src/services/image-pipeline.js src/services/__tests__/image-pipeline.integration.test.js
git commit -m "feat: apply scenario append_start/middle/end in the real scenario-image generation pipeline"
```

---

### Task 4: Splice append tags into the character-image tag-review preview

**Files:**
- Modify: `src/services/prompt-preview.js:92-175` (character branch of `buildPromptPreview()`)
- Test: `src/services/__tests__/prompt-preview.test.js` (append to existing file)

**Interfaces:**
- Consumes: `scenario.append_start/middle/end` — `scenario` is already fetched at `prompt-preview.js:77` (`const scenario = _getScenario(db).get(scenarioId);`) and in scope throughout `buildPromptPreview()`.
- Produces: `buildPromptPreview()`'s returned `summary_tags` (for `target: 'character'` only) has `append_start` prepended, `append_middle` inserted after the character's appearance/clothing tags (before action/brief/setting content), and `append_end` appended — for all three tag-construction branches (`visual_brief` entry, `generic` fallback, and the pre-existing `legacy_extractor` branch, via a single post-branch splice for start/end).

- [ ] **Step 1: Write the failing tests**

Append to `src/services/__tests__/prompt-preview.test.js`, after the last existing test (`'character preview uses prior-turn brief when current turn has no entry for that character'`):

```js
test('character preview splices append_start/middle/end into summary_tags, middle after appearance+clothing', async (t) => {
  installFetchGuard(t);
  const { scenarioId, characterId, turnId } = seed({ withBrief: true });
  db.prepare(`UPDATE scenarios SET append_start = ?, append_middle = ?, append_end = ? WHERE id = ?`)
    .run('sepia tone', 'freckles', 'watermark', scenarioId);

  const result = await buildPromptPreview(db, { scenarioId, turnId, target: 'character', characterId });

  const tags = String(result.summary_tags || '');
  assert.ok(tags.startsWith('sepia tone'), `append_start must lead, got: ${tags}`);
  assert.ok(tags.endsWith('watermark'), `append_end must trail, got: ${tags}`);
  const clothingIdx = tags.indexOf('correct scenario outfit');
  const middleIdx = tags.indexOf('freckles');
  const briefIdx = tags.indexOf('walking through doorway');
  assert.ok(clothingIdx > -1 && middleIdx > -1 && briefIdx > -1, `expected all three segments present, got: ${tags}`);
  assert.ok(clothingIdx < middleIdx, `append_middle must come after clothing, got: ${tags}`);
  assert.ok(middleIdx < briefIdx, `append_middle must come before action/brief content, got: ${tags}`);
});

test('character preview generic-fallback path also splices append tags', async (t) => {
  installFetchGuard(t);
  const { scenarioId, characterId, turnId } = seed({ withBrief: false });
  db.prepare(`UPDATE scenarios SET append_start = ?, append_middle = ?, append_end = ? WHERE id = ?`)
    .run('sepia tone', 'freckles', 'watermark', scenarioId);

  const result = await buildPromptPreview(db, { scenarioId, turnId, target: 'character', characterId });

  const tags = String(result.summary_tags || '');
  assert.ok(tags.startsWith('sepia tone'), `append_start must lead, got: ${tags}`);
  assert.ok(tags.endsWith('watermark'), `append_end must trail, got: ${tags}`);
  assert.ok(tags.includes('freckles'), `append_middle must be present, got: ${tags}`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="append"`
Expected: FAIL — `summary_tags` has no `'sepia tone'`/`'freckles'`/`'watermark'` in it yet.

- [ ] **Step 3: Splice the append fields into the character branch**

In `src/services/prompt-preview.js`, the character branch currently reads (lines 108-175, reproduced here for exact context):

```js
  const appearance = _lockedAppearance(char);
  const clothing = char.current_clothing || getScenarioClothing(scenarioId, char.id) || '';
  const locBit = location
    ? [location.name, location.image_tags || location.image_tags_day || ''].filter(Boolean).join(', ')
    : '';

  let plain = '';
  let tags = '';
  let source = 'generic';

  if (resolved?.entry) {
    // Plain English Summary = selected character_brief (camera-visible state only).
    // Do NOT dump locked appearance / whole-scene moment_summary into the plain field.
    source = 'visual_brief';
    plain = composeCharacterActionFromBrief(resolved.entry, {
      // keep plain focused on the character's visual/action state; setting/shot go in tags
      settingBrief: '',
      shotHint: null,
    });
    // Image Prompt Tags = image-prompt-ready assembly
    tags = [
      'solo',
      'full body',
      'candid',
      appearance,
      clothing,
      resolved.entry.brief,
      resolved.entry.expression,
      resolved.entry.attention ? `attention ${resolved.entry.attention}` : null,
      resolved.brief?.setting_brief || locBit,
      resolved.brief?.shot_hint ? `${resolved.brief.shot_hint} shot` : null,
    ].filter(Boolean).join(', ');
  } else {
    // generic fallback: never mentioned — simple pose, not a scene re-summary
    source = 'generic';
    const action = composeGenericCharacterAction({ location });
    plain = action;
    tags = ['solo', 'full body', 'candid', appearance, clothing, action, locBit]
      .filter(Boolean).join(', ');

    // Legacy LLM extract only if generic empty and model configured (migration safety)
    if (!plain.trim() && !tags.trim()) {
      const extractorModel = (config.prompt_extractor_model || config.narrator_model || '').trim();
      if (extractorModel) {
        try {
          plain = await extractCharacterPlainSummary({
            storyText: turn.content_text || '',
            character: char,
            location,
            sceneCard: card,
            config,
          });
          tags = await extractCharacterImagePrompt({
            storyText: turn.content_text || '',
            character: char,
            location,
            sceneCard: card,
            config,
          });
          source = 'legacy_extractor';
        } catch (_) {}
      }
    }
  }

  plain = (plain || '').trim();
  tags = (tags || '').trim();
  if (plain && tags === plain) tags = '';
```

Replace it with:

```js
  const appearance = _lockedAppearance(char);
  const clothing = char.current_clothing || getScenarioClothing(scenarioId, char.id) || '';
  const locBit = location
    ? [location.name, location.image_tags || location.image_tags_day || ''].filter(Boolean).join(', ')
    : '';

  // User-defined scenario append tags — "middle" means "after all character
  // description tags" (appearance + clothing), before action/setting content;
  // start/end wrap the whole assembled tags string once, after both branches
  // below (including the legacy extractor) have produced it.
  const appendStart  = String(scenario?.append_start  || '').trim();
  const appendMiddle = String(scenario?.append_middle || '').trim();
  const appendEnd    = String(scenario?.append_end    || '').trim();

  let plain = '';
  let tags = '';
  let source = 'generic';

  if (resolved?.entry) {
    // Plain English Summary = selected character_brief (camera-visible state only).
    // Do NOT dump locked appearance / whole-scene moment_summary into the plain field.
    source = 'visual_brief';
    plain = composeCharacterActionFromBrief(resolved.entry, {
      // keep plain focused on the character's visual/action state; setting/shot go in tags
      settingBrief: '',
      shotHint: null,
    });
    // Image Prompt Tags = image-prompt-ready assembly
    tags = [
      'solo',
      'full body',
      'candid',
      appearance,
      clothing,
      appendMiddle || null,
      resolved.entry.brief,
      resolved.entry.expression,
      resolved.entry.attention ? `attention ${resolved.entry.attention}` : null,
      resolved.brief?.setting_brief || locBit,
      resolved.brief?.shot_hint ? `${resolved.brief.shot_hint} shot` : null,
    ].filter(Boolean).join(', ');
  } else {
    // generic fallback: never mentioned — simple pose, not a scene re-summary
    source = 'generic';
    const action = composeGenericCharacterAction({ location });
    plain = action;
    tags = ['solo', 'full body', 'candid', appearance, clothing, appendMiddle || null, action, locBit]
      .filter(Boolean).join(', ');

    // Legacy LLM extract only if generic empty and model configured (migration safety)
    if (!plain.trim() && !tags.trim()) {
      const extractorModel = (config.prompt_extractor_model || config.narrator_model || '').trim();
      if (extractorModel) {
        try {
          plain = await extractCharacterPlainSummary({
            storyText: turn.content_text || '',
            character: char,
            location,
            sceneCard: card,
            config,
          });
          tags = await extractCharacterImagePrompt({
            storyText: turn.content_text || '',
            character: char,
            location,
            sceneCard: card,
            config,
          });
          source = 'legacy_extractor';
        } catch (_) {}
      }
    }
  }

  plain = (plain || '').trim();
  tags = (tags || '').trim();
  if (appendStart || appendEnd) {
    tags = [appendStart, tags, appendEnd].filter(Boolean).join(', ');
  }
  if (plain && tags === plain) tags = '';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="append"`
Expected: PASS (2 new tests).

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npm test`
Expected: All existing tests still PASS — every existing `prompt-preview.test.js` test seeds a scenario without `append_*` values (default `''`), so `appendMiddle || null` is `null` (filtered by `.filter(Boolean)`) and the `if (appendStart || appendEnd)` wrapper never fires, leaving `tags` byte-for-byte identical to today.

- [ ] **Step 6: Commit**

```bash
git add src/services/prompt-preview.js src/services/__tests__/prompt-preview.test.js
git commit -m "feat: splice scenario append tags into the character-image tag review preview"
```

---

### Task 5: Editable Append Start/Middle/End fields in the Scene Info modal

**Files:**
- Modify: `public/js/views/play.js:1810-1844` (`showSceneInfo()`)

**Interfaces:**
- Consumes: `API.updateScenario(id, data)` (already exists, `public/js/api.js:46`, `PUT /api/scenarios/:id`); `state.currentScenario` (already holds `append_start`/`append_middle`/`append_end` after Task 1's migration, since `GET /api/scenarios/:id` does `SELECT *`).
- Produces: no new exports — purely a DOM/behavior change inside `showSceneInfo()`.

No automated test — this repo has no frontend/DOM test harness (`tests/` and `src/__tests__` only cover Node-side backend code; there is no browser or jsdom test runner configured). Verify manually per the checklist in Step 3.

- [ ] **Step 1: Add the three input rows and a Save button to the modal HTML**

In `public/js/views/play.js`, replace the `overlay.innerHTML = ...` assignment (lines 1811-1838):

```js
  var overlay = document.getElementById('modal-overlay');
  overlay.innerHTML =
    '<div class="modal modal-wide">' +
      '<h3 class="modal-title">Scene Info</h3>' +
      '<div class="si-panel" id="si-panel-info">' +
        '<div class="settings-grid" style="padding:8px 0">' +
          infoRow('Title', scenario.title || '-') +
          (scenario.premise
            ? '<div class="setting-row" style="align-items:flex-start">' +
                '<span style="font-weight:600;color:var(--text-muted);min-width:140px">Premise</span>' +
                '<p style="font-size:13px;color:var(--text-muted);margin:0;line-height:1.5;white-space:pre-wrap;flex:1">' + escapeHtml(scenario.premise) + '</p>' +
              '</div>'
            : '') +
          infoRow('Location', locationName) +
          '<div class="setting-row">' +
            '<span style="font-weight:600;color:var(--text-muted);min-width:140px">Image Style</span>' +
            '<span style="color:var(--text)" id="scene-info-img-model">' + escapeHtml(scenario.image_model || 'Default') + '</span>' +
          '</div>' +
          infoRow('Reply Length', scenario.reply_length || 'medium') +
          infoRow('Tone', scenario.tone || '-') +
          infoRow('NSFW', scenario.nsfw_enabled ? 'Yes' : 'No') +
          '<div class="setting-row" style="display:flex;align-items:center;gap:8px">' +
            '<span style="font-weight:600;color:var(--text-muted);min-width:140px">Append Start</span>' +
            '<input type="text" class="form-input" id="si-append-start" style="flex:1;width:auto" placeholder="tag1, tag2, etc" value="' + escapeHtml(scenario.append_start || '') + '">' +
          '</div>' +
          '<div class="setting-row" style="display:flex;align-items:center;gap:8px">' +
            '<span style="font-weight:600;color:var(--text-muted);min-width:140px">Append Middle</span>' +
            '<input type="text" class="form-input" id="si-append-middle" style="flex:1;width:auto" placeholder="tag1, tag2, etc" value="' + escapeHtml(scenario.append_middle || '') + '">' +
          '</div>' +
          '<div class="setting-row" style="display:flex;align-items:center;gap:8px">' +
            '<span style="font-weight:600;color:var(--text-muted);min-width:140px">Append End</span>' +
            '<input type="text" class="form-input" id="si-append-end" style="flex:1;width:auto" placeholder="tag1, tag2, etc" value="' + escapeHtml(scenario.append_end || '') + '">' +
          '</div>' +
          snapshotRows +
        '</div>' +
      '</div>' +

      '<div class="modal-footer">' +
        '<button class="btn btn-ghost" id="close-scene-info">Close</button>' +
        '<button class="btn btn-primary" id="save-scene-info">Save</button>' +
      '</div>' +
    '</div>';

  overlay.classList.remove('hidden');

  document.getElementById('close-scene-info').onclick = function () { overlay.classList.add('hidden'); };
  overlay.onclick = function (e) { if (e.target === overlay) overlay.classList.add('hidden'); };

  document.getElementById('save-scene-info').onclick = function () {
    var btn = document.getElementById('save-scene-info');
    var payload = {
      append_start:  document.getElementById('si-append-start').value.trim(),
      append_middle: document.getElementById('si-append-middle').value.trim(),
      append_end:    document.getElementById('si-append-end').value.trim(),
    };
    btn.disabled = true;
    API.updateScenario(scenario.id, payload)
      .then(function (updated) {
        state.currentScenario = Object.assign({}, state.currentScenario, updated);
        showToast('Scene info saved.', 'success');
        overlay.classList.add('hidden');
      })
      .catch(function (err) { showToast('Save failed: ' + err.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  };
}
```

(This replaces through the closing `}` of `showSceneInfo()` — the old body ended at `document.getElementById('close-scene-info').onclick = ...` / `overlay.onclick = ...` two lines before the function's closing brace; those two lines are kept, just followed by the new Save wiring before the function closes.)

- [ ] **Step 2: Start the app and manually verify**

Run: `npm run dev` (or `npm start`), open the app in a browser, open any scenario's Play view.

- [ ] **Step 3: Manual test checklist**

- Step 1 — Click the Scene Info button. Expect: modal opens showing Title/Premise/Location/Image Style/Reply Length/Tone/NSFW, followed by three new text inputs (Append Start, Append Middle, Append End) with placeholder "tag1, tag2, etc", then the existing Scene Setting/Turn Count/In Scene snapshot rows, then a Close and Save button.
- Step 2 — Type `sepia tone, film grain` into Append Start, `freckles` into Append Middle, `polaroid border` into Append End. Click Save. Expect: a "Scene info saved." toast, and the modal closes.
- Step 3 — Re-open Scene Info. Expect: the three fields still show the values just saved (confirms persistence round-trip through `PUT /api/scenarios/:id` and `state.currentScenario` refresh).
- Step 4 — Generate a scene image (Scene chip in the Prompt Panel, Generate Image). Expect: in `logs/story-lab.log` (or wherever `PROMPT_SUBMITTED` is logged from `image-pipeline.js`), the full submitted prompt starts with `sepia tone, film grain` and ends with `polaroid border`, with `freckles` appearing after the character's clothing tags.
- Step 5 — Switch the Prompt Panel to a character chip and let the tag preview load. Expect: the `#prompt-tags` textarea's content starts with `sepia tone, film grain`, ends with `polaroid border`, and contains `freckles` positioned after the character's appearance/clothing tags and before their action/pose tags.
- Step 6 — Clear all three fields in Scene Info and Save. Expect: subsequent scene and character generations behave exactly as before this feature (no stray leading/trailing commas, no literal `undefined`/`null` in the prompt).

If any step fails, state clearly: "The function is NOT ready for you to test yet." Fix the failure before reporting to the user.

- [ ] **Step 4: Commit**

```bash
git add public/js/views/play.js
git commit -m "feat: add editable Append Start/Middle/End fields to the Scene Info modal"
```

---

## Self-Review Notes

- **Spec coverage:** DB schema + persistence (Task 1); scenario-image splicing at start/middle/end covering all scenario image generation regardless of trigger (Task 2 + 3); character-image tag-review splicing (Task 4); editable UI in the exact panel from the screenshot (Task 5). All four pieces of the user's request are covered.
- **Scope boundary respected:** `buildCharacterPrompt()` / `mode: 'character'` in `image-pipeline.js` is never touched — Task 3's test explicitly asserts append fields do not leak into character-mode generation, keeping character-image handling isolated to the review layer per the user's explicit instruction.
- **Type/name consistency:** `parts.append_start` / `parts.append_middle` / `parts.append_end` (Task 2) are the exact property names Task 3 reads off `parts` in `image-pipeline.js`. `scenario.append_start` / `scenario.append_middle` / `scenario.append_end` (Task 1's columns) are the exact names read in both Task 2 (`prompt-builder.js`) and Task 4 (`prompt-preview.js`). `composeEnhancedScenePrompt`'s new `appendStart`/`appendMiddle` params (Task 2) match exactly what Task 3 passes in.
