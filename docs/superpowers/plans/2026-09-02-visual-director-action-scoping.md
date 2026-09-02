# Visual Director Action Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Story Lab scene images and fullbody images use concise, user-editable visual directions, so RealCartoonXL-v7 receives explicit visible action instead of defaulting to a camera-facing pose.

**Architecture:** Add a versioned per-turn `image_direction_json` record with independently stored scene direction and per-character fullbody directions. A pure service validates and normalizes these directions against the scenario cast; the turn API reads, saves, and suggests them; the image sidebar edits the direction for its active mode; and the image pipeline scopes scene casts or supplies the selected fullbody character's action without mixing the modes. The active Look remains the sole owner of checkpoint, sampler, dimensions, and all other generation settings.

**Tech Stack:** Node 22 ESM, node:sqlite `DatabaseSync`, Express, browser JavaScript, node:test, existing A1111 REST client.

**Spec:** User-approved Visual Director action-scoping proposal in this Codex task, 2026-09-02.

## Global Constraints

- ESM only; use import/export, never `require()`.
- Use `node:sqlite` `DatabaseSync`; database migration is additive and each `ALTER TABLE` is inside its own `try { db.exec(...) } catch (_) {}`.
- Add no npm dependencies.
- Preserve one active Look and its exclusive ownership of checkpoint, sampler, dimensions, and negative/style settings.
- Preserve on-command image generation; never generate on narrator turn advance.
- Preserve the prompt order: active Look -> selected character appearances -> action -> location and clothing -> Look suffix.
- Use ASCII-only source, test, log, and console text.
- Do not modify `E:\TheHub\projects\story-lab`.
- Do not add automatic pose selection, pose-library work, ComfyUI, ImageCore, legacy styles, or a second style system.
- Preserve the existing Look-editor scratch-image boundary: an unsaved test image may be deleted from `IMAGES_DIR/_look-test-scratch`; a saved test image in `IMAGES_DIR/look-test-saves` is never deleted by this feature.

---

### Task 0: Delete an unsaved Look-editor test sample

**Files:**

- Modify: `public/js/views/settings.js:624-628, 760-765, 830-842, 876-895`
- Modify: `src/routes/__tests__/looks.routes.test.js`

**Interfaces:**

- Reuses `API.cleanupTestLookImages([filename])` and the existing `POST /api/looks/test-generate/cleanup` scratch-only endpoint; no new route or dependency.
- A result is deletable only while its filename is present in `_lookEditorState.scratchFilenames` and `result.saved` is false.

- [ ] **Step 1: Write the failing endpoint/UI-contract test**

Extend the existing cleanup route test with one assertion that a generated scratch filename is removed when supplied as the only cleanup value, and that a filename moved by `POST /test-generate/save` is not removed by a later cleanup call. Add a focused pure rendering assertion for `_renderTestResults()` that an unsaved sample produces both `Save` and `Delete` controls while a saved sample produces neither deletion control nor scratch cleanup request.

- [ ] **Step 2: Verify RED**

Run: `node --test src/routes/__tests__/looks.routes.test.js`

Expected: the rendering assertion fails because unsaved sample cards have no Delete control.

- [ ] **Step 3: Add the per-sample Delete behavior**

In `_renderTestResults()`, render `<button type="button" class="btn btn-danger-ghost btn-sm le-test-delete" data-filename="...">Delete</button>` next to the existing Save button only for an unsaved result. In `_wireTestResultButtons(editorEl)`, validate that the clicked filename is a member of `scratchFilenames`, disable the button, call `API.cleanupTestLookImages([filename])`, then remove the filename from `scratchFilenames`, remove that result from `testResults`, and rerender/rebind the result container. On failure, restore the button and show the existing error toast. Do not send a cleanup request for `result.saved === true`.

- [ ] **Step 4: Verify GREEN and regression behavior**

Run: `node --test src/routes/__tests__/looks.routes.test.js`

Expected: PASS. Confirm a test sample can be deleted before Look save, saved samples remain in `look-test-saves`, and closing the editor still cleans only remaining scratch filenames.

- [ ] **Step 5: Commit this bounded slice with the Look editor changes only**

```powershell
git add public/js/views/settings.js src/routes/__tests__/looks.routes.test.js
git commit -m "feat: delete unsaved Look test samples"
```

---

## Data and API contract

`turns.image_direction_json` stores either an empty string or this exact versioned shape:

```json
{
  "version": 1,
  "scene": {
    "action_text": "Riley hands Morgan a book across the table.",
    "subject_ids": [12, 18],
    "framing": "medium"
  },
  "fullbody_by_character": {
    "12": {
      "action_text": "Riley kneels beside an open suitcase, folding a blue shirt.",
      "framing": "auto"
    }
  }
}
```

Rules enforced by the server:

- Each `action_text` uses the existing style stripping and 320-character maximum.
- `scene.subject_ids` is either `[]`, `[id]`, or `[id, id]`; values are positive integer IDs, unique, and each ID belongs to the requested scenario.
- `scene.framing` is one of `auto`, `close`, `medium`, or `wide`. Each `fullbody_by_character[id].framing` is one of `auto`, `medium`, or `wide`; `close` is invalid for fullbody because it contradicts the full-figure composition contract. Framing is prompt wording only and never changes the active Look resolution.
- Empty `subject_ids` means legacy scene behavior: use the whole scenario cast. The UI warns rather than blocks generation when a scene has more than two cast members and no subjects are selected.
- Portrait keeps its existing exactly-one-character requirement and optional Character action field; it does not load, save, or use a visual-direction record in this slice. Fullbody keeps its existing exactly-one-character requirement, but uses that selected character's separate `fullbody_by_character[id]` visual direction as a concise action; it never consumes `scene.subject_ids` or another character's fullbody direction.
- Fullbody is not merely a UI label: every fullbody prompt must include the non-style composition cue `full-body composition, entire figure in frame`. It appears immediately before the selected character's action and is compatible with standing, sitting, kneeling, or crouching actions. It must never add `standing`, `facing camera`, or a generic pose instruction.

The existing endpoints retain their paths and their old `text` field. They gain the following optional fields:

```text
GET /api/scenarios/:scenarioId/turns/:turnId/shot-action?mode=scene|fullbody&characterId=<required-for-fullbody>
  -> { text, subject_ids, framing, source, needs_suggest, placeholder }

PUT /api/scenarios/:scenarioId/turns/:turnId/shot-action
  <- { mode, text, subjectIds?, framing?, characterId? }
  -> { text, subject_ids, framing, source }

POST /api/scenarios/:scenarioId/turns/:turnId/shot-action/suggest
  <- { mode, characterId? }
  -> { text, subject_ids, framing, source, ok, error? }
```

The image-generation request keeps `characterIds`, which already reaches the pipeline, and gains an optional `framing` string. In scene mode `characterIds` means the selected scene subjects when provided. In fullbody mode it remains the existing one selected character, while `actionText` and `framing` may come from the separate fullbody direction. The route rejects IDs not in the scenario cast, rejects more than two scene IDs, and validates `framing` with the same four-value contract before the pipeline is called.

---

### Task 1: Add the visual-direction domain contract and migration

**Files:**

- Create: `src/services/visual-direction.js`
- Create: `src/services/__tests__/visual-direction.test.js`
- Modify: `src/db.js` near the existing `turns` additive migrations

**Interfaces:**

- Produces `normalizeVisualDirection(input, scenarioCast, mode, characterId?)` returning `{ direction, errors }`. Scene direction is `{ action_text, subject_ids, framing }`; fullbody direction is `{ action_text, framing }`, requires a selected cast-member ID, and never accepts subject IDs.
- Produces `parseVisualDirections(raw, scenarioCast)` returning `{ scene, fullbody_by_character }` or an empty versioned record.
- Produces `visualDirectionPromptText(direction, mode)` returning `direction.action_text` with an optional camera-observable framing prefix. For `fullbody`, it always includes `full-body composition, entire figure in frame` before optional medium/wide framing and action text.
- `src/routes/turns.js` and `src/services/image-pipeline.js` consume only these exports; neither reparses JSON independently.

- [ ] **Step 1: Write failing pure-service tests**

Create tests for the exact valid scene and fullbody shapes, unknown cast IDs, duplicate IDs, more than two scene IDs, a fullbody direction supplied with subject IDs, invalid framing, invalid JSON, legacy empty value, and style-word stripping. Use a fixed cast:

```js
const CAST = [{ id: 7, name: 'Riley' }, { id: 9, name: 'Morgan' }, { id: 11, name: 'Avery' }];

test('normalizes a valid two-subject visual direction', () => {
  const { direction, errors } = normalizeVisualDirection({
    text: 'Riley leans toward Morgan across the table.',
    subjectIds: [7, 9],
    framing: 'medium',
  }, CAST);
  assert.deepEqual(errors, []);
  assert.deepEqual(direction, {
    version: 1,
    action_text: 'Riley leans toward Morgan across the table.',
    subject_ids: [7, 9],
    framing: 'medium',
  });
});

test('rejects a subject outside the scenario cast', () => {
  const { errors } = normalizeVisualDirection({ text: 'Riley reads.', subjectIds: [404] }, CAST);
  assert.match(errors.join(' '), /scenario cast/i);
});

test('normalizes a fullbody direction for the selected cast member without scene subjects', () => {
  const { direction, errors } = normalizeVisualDirection({
    text: 'Riley kneels beside an open suitcase, folding a blue shirt.', framing: 'medium',
  }, CAST, 'fullbody', 7);
  assert.deepEqual(errors, []);
  assert.deepEqual(direction, { action_text: 'Riley kneels beside an open suitcase, folding a blue shirt.', framing: 'medium' });
});
```

- [ ] **Step 2: Run the new test file and verify RED**

Run: `node --test src/services/__tests__/visual-direction.test.js`

Expected: FAIL because `visual-direction.js` does not exist.

- [ ] **Step 3: Implement the pure contract**

In `src/services/visual-direction.js`, import `normalizeShotAction` from `image-shot-action.js`; do not duplicate the style-word list or length limit. Reject invalid supplied IDs rather than silently dropping them. Normalize a missing `framing` to `auto`. Return explicit error strings so the HTTP route can return 400 without guessing.

```js
export function visualDirectionPromptText(direction, mode = 'scene') {
  if (!direction?.action_text) return '';
  const framing = direction.framing !== 'auto' ? `${direction.framing} shot` : '';
  const fullbody = mode === 'fullbody' ? 'full-body composition, entire figure in frame' : '';
  return [fullbody, framing, direction.action_text].filter(Boolean).join(', ');
}
```

In `src/db.js`, add exactly one migration after the existing `turns` migrations:

```js
try { db.exec("ALTER TABLE turns ADD COLUMN image_direction_json TEXT DEFAULT ''"); } catch (_) {}
```

Do not remove or repurpose `image_action_draft`; old rows and old clients must remain readable.

- [ ] **Step 4: Run the focused test file and verify GREEN**

Run: `node --test src/services/__tests__/visual-direction.test.js`

Expected: PASS, including malformed stored JSON and every invalid subject-list case.

Also assert that `normalizeVisualDirection({ text: 'Riley kneels.' , framing: 'close' }, CAST, 'fullbody', 7)` returns a framing validation error, and that `visualDirectionPromptText({ action_text: 'Riley kneels.', framing: 'auto' }, 'fullbody')` contains `full-body composition, entire figure in frame` without `standing` or `facing camera`.

- [ ] **Step 5: Run the existing action-helper tests**

Run: `node --test src/services/__tests__/image-shot-action.test.js`

Expected: PASS. If this file does not exist in the checkout, run the action helper's current owning test file identified by `rg -l "normalizeShotAction" src/services/__tests__` and record the actual command in the implementation commit.

- [ ] **Step 6: Commit the self-contained domain slice**

```powershell
git add src/db.js src/services/visual-direction.js src/services/__tests__/visual-direction.test.js
git commit -m "feat: add validated visual direction contract"
```

### Task 2: Make turn APIs read, save, and suggest structured visual direction

**Files:**

- Modify: `src/services/image-shot-action.js`
- Modify: `src/routes/turns.js:332-393`
- Create: `src/routes/__tests__/turns.shot-action.test.js`

**Interfaces:**

- Consumes `parseVisualDirections`, `normalizeVisualDirection`, and `visualDirectionPromptText` from Task 1.
- Produces `resolveVisualDirectionSync(turn, scenarioCast, mode, characterId?)` returning the direction for `scene` or the selected fullbody character as `{ direction, source, needs_suggest }`.
- Produces `suggestVisualDirectionViaLlm({ contentText, cast, config, mode, characterId? })` returning `{ direction, ok, error? }`.
- The route accepts/returns the API shape documented above and does not change the legacy `text` field.

- [ ] **Step 1: Write failing route tests against an in-memory database**

Create an isolated Express app in the same style as `src/routes/__tests__/images.routes.test.js`. Seed a scenario, three cast members, and one narrator turn. Cover all of these independently:

```js
test('PUT saves a two-subject visual direction and GET returns it', async () => { /* exact request and assertions */ });
test('PUT rejects a duplicate or third scene subject with HTTP 400', async () => { /* exact request and assertions */ });
test('PUT rejects a character that belongs to another scenario with HTTP 400', async () => { /* exact request and assertions */ });
test('legacy image_action_draft remains the GET fallback when direction is absent', async () => { /* seed old value */ });
test('malformed stored image_direction_json falls back without throwing', async () => { /* seed invalid JSON */ });
test('suggestion failure returns a usable heuristic and never overwrites a saved user direction', async () => { /* mock fetch failure */ });
test('fullbody suggestion requires exactly one scenario character and writes only that character key', async () => { /* selected character and stored JSON */ });
test('switching fullbody characters returns that character direction, never the prior character direction', async () => { /* two saved per-character entries */ });
```

Assert that a text-only legacy `PUT` is accepted and leaves `subject_ids: []` and `framing: 'auto'`.

- [ ] **Step 2: Run the new route tests and verify RED**

Run: `node --test src/routes/__tests__/turns.shot-action.test.js`

Expected: FAIL because the routes do not expose `subject_ids` or validate them yet.

- [ ] **Step 3: Implement synchronous resolution and persistence compatibility**

Add `resolveVisualDirectionSync` in `image-shot-action.js`. Its precedence is mode-specific:

1. Valid direction from `image_direction_json.scene` for scene mode, or `image_direction_json.fullbody_by_character[String(characterId)]` for fullbody mode.
2. For scene mode only, existing non-empty `image_action_draft`, represented as `{ subject_ids: [], framing: 'auto' }`.
3. For scene mode only, existing scene-card/cached/heuristic action, represented with no selected subjects and `auto` framing. Fullbody with no saved direction returns an empty editable action, not a scene fallback.

For the route, require `mode` to be `scene` or `fullbody`, load the scenario cast using a join on `scenario_characters`, pass it to the normalizer, return HTTP 400 for its validation errors, and merge only the normalized entry into the versioned `image_direction_json` record without overwriting the other mode. A fullbody save requires `characterId` to name one cast member and stores the entry at `fullbody_by_character[String(characterId)]`; this prevents an action written for Riley from being used after the user selects Morgan. On a structured scene save, also write `image_action_draft = direction.action_text` so old UI/client paths retain the currently edited scene action.

- [ ] **Step 4: Implement safe structured suggestion**

Replace the free-text LLM contract only for the suggestion endpoint with small mode-specific JSON. Scene responses contain `subject_1`, `subject_2`, `action_text`, and `framing`; fullbody responses contain only `action_text` and `framing` and are explicitly told the selected character name. Use the configured text instruction model (`scene_state_model`, falling back to `qwen2.5:7b-instruct`), not the roleplay narrator. Map scene subject names case-insensitively to the current cast; unknown, duplicate, and third names become no selection rather than invented IDs.

The LLM system instruction must require camera-observable facts only, a maximum of two named cast members, one concise action, and no dialogue, thoughts, backstory, or style words. If the response is malformed, no model is reachable, or validation fails, return the existing scene heuristic with `subject_ids: []` and `framing: 'auto'` for scene mode; for fullbody, return a selected-character-only editable fallback and `auto` framing. Do not persist a failed suggestion.

- [ ] **Step 5: Run focused route and service tests and verify GREEN**

Run:

```powershell
node --test src/routes/__tests__/turns.shot-action.test.js
node --test src/services/__tests__/visual-direction.test.js
```

Expected: PASS. Confirm the fetch mock proves the saved user direction prevents a second LLM call, and the selected-character mock proves fullbody never reads another character key.

- [ ] **Step 6: Commit the API slice**

```powershell
git add src/services/image-shot-action.js src/routes/turns.js src/routes/__tests__/turns.shot-action.test.js
git commit -m "feat: save structured visual directions per turn"
```

### Task 3: Scope scenes and apply fullbody action without cross-mode leakage

**Files:**

- Modify: `src/routes/images.js:23-42`
- Modify: `src/services/image-pipeline.js:60-255`
- Modify: `src/services/prompt-builder.js:83-128`
- Modify: `src/routes/__tests__/images.routes.test.js`
- Modify: `src/services/__tests__/prompt-builder.test.js`

**Interfaces:**

- Consumes `characterIds` for scene mode and validates them against the scenario cast; fullbody retains its current exactly-one selected character behavior and reads only that character's fullbody direction; portrait remains unchanged.
- Consumes optional `framing` in `buildPrompt`; in scene and fullbody mode it contributes only normalized framing wording before the action text.
- Persists `visual_direction` in the existing `prompt_parts_json`; no `scene_images` schema migration is needed because the image row already snapshots `character_ids_json` and prompt parts.

- [ ] **Step 1: Add failing image-route and prompt-builder tests**

Add tests with a three-character scenario. Capture the outgoing A1111 payload and persisted image row. Cover:

```js
test('scene mode with two selected scenario characters excludes the third character from prompt and snapshot', async () => { /* payload, prompt, character_ids_json */ });
test('scene mode rejects an ID outside the scenario cast before contacting A1111', async () => { /* HTTP 400/502 contract set explicitly */ });
test('scene mode rejects more than two selected IDs before contacting A1111', async () => { /* no fetch generation */ });
test('scene mode without characterIds preserves the legacy whole-cast prompt', async () => { /* regression */ });
test('visual framing text appears in the action part without changing style sections', () => { /* pure builder */ });
test('fullbody uses its selected character saved action when explicit actionText is absent', async () => { /* prompt and character_ids_json */ });
test('fullbody ignores a saved two-person scene direction and another character fullbody direction', async () => { /* prompt and character_ids_json */ });
test('fullbody prompt always includes the full-figure composition cue and never inherits characterAction', async () => { /* prompt inspection */ });
test('portrait or fullbody rejects a character outside the requested scenario before contacting A1111', async () => { /* HTTP 400 and zero generation fetches */ });
test('portrait remains unchanged when a visual-direction record exists', async () => { /* prompt and character_ids_json */ });
```

Use HTTP 400 for request-validation failures in `src/routes/images.js`; reserve the existing HTTP 502 behavior for A1111/pipeline failures. Update the route's error handling accordingly so a client can distinguish invalid selection from an unavailable generator.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test src/routes/__tests__/images.routes.test.js
node --test src/services/__tests__/prompt-builder.test.js
```

Expected: FAIL because scene-mode IDs are not currently cast-validated or capped, and prompt parts have no visual-direction snapshot.

- [ ] **Step 3: Implement cast validation and prompt construction**

In `src/routes/images.js`, destructure `framing` from the request and validate request shape early. Pass it to `generate({ ..., framing })`. In `image-pipeline.js`, accept the same optional `framing`, normalize it with the Task 1 contract, load the scenario cast once, then enforce:

```js
if (mode === 'scene' && Array.isArray(characterIds) && characterIds.length) {
  if (characterIds.length > 2) throw new ValidationError('scene mode allows at most two selected characters');
  const byId = new Map(scenarioCast.map((character) => [character.id, character]));
  castRows = characterIds.map((id) => byId.get(id));
  if (castRows.some((character) => !character)) {
    throw new ValidationError('every selected scene character must belong to this scenario');
  }
}
```

Define and export a small `ValidationError` with `statusCode = 400`; the route converts only that error to HTTP 400. Keep portrait/fullbody's exact-one rule unchanged. Build one `scenarioCastById` map from the scenario-cast join and use it for every mode: scene subject IDs, portrait's one selected ID, and fullbody's one selected ID. Do not use the current global character lookup as authorization; a valid character from a different scenario must be rejected.

Before calling `buildPrompt`, resolve a saved direction only when the request did not provide explicit `actionText`; explicit user text remains authoritative. In scene mode, use `image_direction_json.scene` and its selected subjects only when the explicit request does not provide `characterIds`. In fullbody mode, use only `image_direction_json.fullbody_by_character[String(selectedCharacterId)]`; do not inspect scene subjects or a different character key. In portrait mode, do not use direction text or framing and preserve the current selected-character and optional Character action behavior unchanged. In scene or fullbody mode, use the request `framing` when supplied, otherwise the matching saved direction framing, otherwise `auto`. Use `visualDirectionPromptText(direction, mode)` before passing the action to `buildPrompt`. This produces optional framing for scenes and the required fullbody composition cue for fullbody without changing Look settings. In fullbody mode pass `characterAction: ''` to `buildPrompt`, even if an old browser client sent one; the fullbody visual action is the one and only activity instruction. Preserve `characterAction` only for portrait. Add this exact shape to `built.parts` for scene and fullbody mode:

```js
visual_direction: {
  subject_ids: castRows.map((character) => character.id),
  framing: resolvedDirection.framing,
  source: resolvedDirection.source,
}
```

For fullbody, `subject_ids` contains the one already-selected fullbody character; it is a snapshot only and does not add multi-character fullbody support. Do not alter Look dimensions, checkpoint, sampler, negative prompt, or face-reference behavior.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
node --test src/routes/__tests__/images.routes.test.js
node --test src/services/__tests__/prompt-builder.test.js
```

Expected: PASS, including the legacy all-cast regression and zero A1111 call for invalid scene selections.

- [ ] **Step 5: Run the full server-side suite**

Run: `npm test`

Expected: PASS. Investigate any failures before moving to the browser UI because this task changes route response shapes and image persistence snapshots.

- [ ] **Step 6: Commit the generation slice**

```powershell
git add src/routes/images.js src/services/image-pipeline.js src/services/prompt-builder.js src/routes/__tests__/images.routes.test.js src/services/__tests__/prompt-builder.test.js
git commit -m "feat: apply scoped visual actions to image prompts"
```

### Task 4: Add scene subject chips and fullbody action controls to the image sidebar

**Files:**

- Modify: `public/js/state.js:24-31`
- Modify: `public/js/utils.js:53-71`
- Modify: `public/js/views/play.js:164-196, 1149-1555`
- Modify: `public/css/main.css` near the existing `.play-image-sidebar` rules
- Modify: `public/js/__tests__/image-generation-options.test.js`
- Create: `public/js/__tests__/visual-direction-sidebar.test.js`

**Interfaces:**

- `state.imageGen` gains distinct `sceneCharacterIds`, `sceneFraming`, `fullbodyActionText`, and `fullbodyFraming` values. Fullbody state is always associated with the currently selected character ID.
- `buildImageGenerationOptions({ turnId, mode, sceneText, characterAction, characterId, sceneCharacterIds, sceneFraming, fullbodyActionText, fullbodyFraming })` sends scene `characterIds` and scene framing only in scene mode. It preserves portrait's existing request shape. In fullbody mode it retains the existing one `characterId`/`characterIds` selection and sends only that character's fullbody action and framing.
- The sidebar sends a structured visual-direction save body in scene and fullbody modes. Portrait retains its existing action handling and never calls visual-direction endpoints.

- [ ] **Step 1: Write failing browser-pure tests**

Add exact assertions for the request builder:

```js
test('scene generation sends two selected scene characters and framing', () => {
  assert.deepEqual(buildImageGenerationOptions({
    turnId: 42,
    mode: 'scene',
    sceneText: 'Riley hands Morgan a book.',
    sceneCharacterIds: [7, 9],
    framing: 'medium',
  }), {
    turnId: 42,
    mode: 'scene',
    actionText: 'Riley hands Morgan a book.',
    characterIds: [7, 9],
    framing: 'medium',
  });
});

test('portrait ignores scene character IDs and framing and retains its current exactly-one-character request', () => { /* exact assertion */ });
test('fullbody sends only the selected character and its separate action direction', () => { /* exact assertion */ });
```

In `visual-direction-sidebar.test.js`, extract or add pure helpers from `play.js` that normalize selected chip IDs to positive unique integers and cap the result at two. Test stale response tokens and manual-edit flags so an old suggestion cannot overwrite user-typed text. Add a selected-character key test proving a response for fullbody character 7 is discarded after the user selects character 9.

- [ ] **Step 2: Run the browser-pure tests and verify RED**

Run:

```powershell
node --test public/js/__tests__/image-generation-options.test.js
node --test public/js/__tests__/visual-direction-sidebar.test.js
```

Expected: FAIL because scene character IDs/framing and a separate fullbody action direction are not currently represented in client state or generation options.

- [ ] **Step 3: Implement the compact sidebar controls**

In the existing sidebar markup, add mode-specific controls while preserving the current compact layout:

- A `Subjects in this image` chip row shown only in scene mode, populated from the existing scenario-cast API.
- A short helper text: `Choose up to two people for clearer action scenes. Leave empty to use the full cast.`
- A `Framing` select with `Auto`, `Close`, `Medium`, and `Wide` in scene mode, and `Auto`, `Medium`, and `Wide` in fullbody mode. It is labeled as prompt guidance, not image size.
- In fullbody mode, relabel the existing editable action field to `Fullbody action` and show its own action text and framing for the currently selected character. Keep the existing selected-character chooser. An action such as `Riley kneels beside an open suitcase, folding a blue shirt.` is deliberately action-first, not a camera pose instruction.

Use buttons with `aria-pressed` for subject chips, not a new dependency or custom picker. Prevent selecting a third chip by leaving the first two selected and showing a local status message. Preserve scene selection when opening/closing the sidebar for the same turn, clear it when switching to a different turn, and hide it in portrait/fullbody mode. In fullbody mode, hide and clear the existing optional Character action field; that field remains portrait-only so it cannot conflict with Fullbody action. On every mode change, increment the shared load token, clear the visible action field before loading mode-specific state, and call the correct loader: scene direction for Scene, selected-character fullbody direction for Fullbody, and the existing portrait behavior for Portrait. This prevents a just-loaded scene action from being submitted as the action for a newly selected fullbody character.

Update the existing 600 ms draft save for scene mode to carry `{ mode: 'scene', text, subjectIds, framing }`; use the corresponding fullbody request `{ mode: 'fullbody', text, framing, characterId }` only in fullbody mode. Store `mode` and `characterId` in the pending draft object, not just the text. Preserve portrait's existing text-save behavior unchanged. Change `_flushShotActionDraftSave()` to return the API promise. Generate must await that promise only when it matches the current turn, mode, and selected fullbody character; otherwise discard the stale pending save and generate from the current UI values. If saving fails, keep the user's local edit and still include it in the explicit matching generation request; display the existing non-blocking error style rather than discarding the edit.

When a scene suggestion response arrives, apply its subjects/framing only if the sidebar still targets the same turn, its token is current, the mode is still scene, and the user has not edited text or subjects since the request started. When a fullbody suggestion response arrives, additionally require the same selected character ID. On a mode switch or character switch, re-enable the action field only after the matching request finishes or fails. This prevents stale LLM output from replacing a manual correction or leaking between scene, portrait, or fullbody characters.

- [ ] **Step 4: Implement API wrapper and response handling**

Update the existing `API.saveShotActionDraft` call signature in `public/js/api.js` only as needed to forward the structured body; retain text-only callers. When loading a direction in scene mode, hydrate textarea, selected subject chips, and framing select from `subject_ids` and `framing`; malformed or absent fields become `[]` and `auto`. When loading fullbody, call the direction endpoint with the current `characterId` and hydrate only that character's fullbody action/framing. Switching selected fullbody character reloads before display. Portrait retains its current selected-character loading and does not call a visual-direction suggestion endpoint.

- [ ] **Step 5: Run browser-pure tests and syntax checks**

Run:

```powershell
node --test public/js/__tests__/image-generation-options.test.js
node --test public/js/__tests__/visual-direction-sidebar.test.js
node --check public/js/views/play.js
node --check public/js/utils.js
```

Expected: PASS. Confirm the source uses ASCII only and no HTML is built from unescaped character names.

- [ ] **Step 6: Run the complete suite and commit the UI slice**

Run: `npm test`

Expected: PASS.

```powershell
git add public/js/state.js public/js/utils.js public/js/views/play.js public/js/api.js public/css/main.css public/js/__tests__/image-generation-options.test.js public/js/__tests__/visual-direction-sidebar.test.js
git commit -m "feat: edit scene and fullbody visual actions"
```

### Task 5: Verify integration behavior without creating unwanted story state

**Files:**

- Modify: `VERIFY.md` only if its existing image-generation checklist has an appropriate section; otherwise make no documentation change.
- No production-code changes in this task.

**Interfaces:**

- Consumes the completed Task 1-4 API and UI contracts.
- Produces evidence that the feature is manual, backward compatible, and does not change active Look settings or generate automatically.

- [ ] **Step 1: Run static and automated verification**

Run:

```powershell
git diff --check
npm test
```

Expected: no whitespace errors and a fully passing test suite.

- [ ] **Step 2: Run a read-only API/config preflight**

Verify the live active Look has the same checkpoint, width, height, sampler, scheduler, and negative prompt before and after opening the sidebar. Do not call a generation endpoint in this step.

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:4090/api/looks | Select-Object -ExpandProperty Content
```

Expected: opening or editing the Visual Director controls cannot activate, modify, or resize a Look.

- [ ] **Step 3: Manually exercise the non-generation UI edge cases**

Check each behavior in a disposable or existing test scenario without clicking Generate:

1. Scene with one cast member: select that one; switch portrait/fullbody; return to scene; selection remains valid.
2. Scene with three cast members: select two; verify the third cannot be selected; clear both; verify warning and legacy full-cast guidance.
3. In fullbody mode, save an action for Riley, switch to Morgan, and verify Riley's action never appears for Morgan. Save Morgan's action, switch back, and verify each character reloads only its own direction.
4. Switch turns or selected fullbody characters while an automatic suggestion is pending; verify no old text, subjects, or framing appears on the new target.
5. Type an action, then wait for a suggestion response; verify manual text is not overwritten.
6. Close the panel immediately after changing scene action/subjects/framing or a fullbody action/framing; reopen the same target and verify the values persist.
7. Switch Scene to Fullbody after a scene action has loaded; verify the fullbody field clears while its selected character direction loads, the portrait-only Character action field is hidden, and the scene action is not submitted.
8. Select a Look in the sidebar and verify only the existing Look-activation behavior occurs; no visual-direction edit changes Look settings.

- [ ] **Step 4: Manually verify one controlled generation only after the user approves it**

Use a two-character, medium-framing scene with a short, visible action, then separately use fullbody mode with one selected character and three deliberately non-camera-pose actions: kneeling beside an open suitcase while folding a shirt, walking while carrying a book, and sitting while tying a boot. Inspect each persisted `scene_images` row and its `prompt_parts_json`: the scene row must snapshot only its two selected IDs, while each fullbody row must snapshot only its selected character and that character's action/framing. Every fullbody prompt must contain `full-body composition, entire figure in frame` and must not contain a leftover portrait Character action. Confirm each image is created only from its explicit Generate click.

Do not claim exact-pose control from text-only generation. The acceptance criterion is correct request scoping, persistence, manual control, and visible action in user review across the three representative actions. If the model still repeatedly returns camera poses despite correct stored prompts, record prompt/seed/output evidence; that is the escalation threshold for optional pose-reference control, not a reason to silently add a pose library.

- [ ] **Step 5: Review the final diff against project constraints**

Confirm all of the following before offering completion:

- Exactly one active Look still supplies dimensions and rendering settings.
- Scene selection is optional and legacy empty-selection behavior remains intact.
- No subject outside the scenario cast can reach the image pipeline.
- No more than two selected scene subjects can reach the image pipeline.
- Portrait/fullbody behavior remains exactly-one selected character.
- Fullbody action storage is keyed to the selected cast member and cannot leak between characters or from scene mode.
- Fullbody prompts contain the required full-figure composition cue, reject `close` framing, and do not also receive the portrait-only Character action field.
- No ControlNet, FaceID, pose picker, or auto-generation behavior was introduced or changed.
- No unrequested files outside the listed files were changed.

- [ ] **Step 6: Commit verification-only documentation only if changed**

If and only if `VERIFY.md` was changed:

```powershell
git add VERIFY.md
git commit -m "docs: add visual director verification checklist"
```

Otherwise, do not create an empty commit.

## Plan self-review

### Spec coverage

- Concise visual action for scene and fullbody: Task 1 data contract and Task 2 suggestion contract.
- Explicit actor scoping: Task 3 validation and Task 4 chips.
- User review and manual override: Task 4 preserves editable text and protects it from stale suggestions.
- No pose library: enforced by global constraints and Task 5 review.
- No hidden Look or style changes: global constraints, Task 3 implementation boundary, and Task 5 preflight.
- Reproducibility: Task 3 snapshots selected IDs and visual-direction metadata in each persisted image.
- Error handling and legacy compatibility: Task 1 parsing, Task 2 fallback/HTTP validation, Task 3 all-cast regression, and Task 4 failed-save behavior.

### Edge-case coverage

- Empty, malformed, stale, or legacy saved directions: Tasks 1 and 2.
- Invalid, duplicate, third, or cross-scenario subjects: Tasks 1-3.
- Saved scene direction leaking into fullbody or portrait, and one fullbody character direction leaking into another: Tasks 2-4.
- A mode change carrying a scene action into fullbody, a stale pending save writing under the wrong character, and portrait action conflicting with fullbody action: Task 4.
- Stale asynchronous suggestion overwriting manual input: Task 4.
- A1111 offline or failed generation: existing route regression suite remains required in Task 3.
- Unexpected Look changes or automatic generation: Task 5.
- Text-only SDXL action prompting remaining probabilistic rather than exact pose control: Task 5 requires user-reviewed visual evidence and a defined escalation boundary.

### Consistency check

- `subject_ids` is the persisted/API name; `subjectIds` is the browser request name; conversions occur only at the API boundary.
- Scene `framing` is one of `auto`, `close`, `medium`, or `wide`; fullbody `framing` excludes `close`.
- `characterIds` remains the image-generation request name and is used for scene-selected IDs, preserving existing portrait/fullbody route behavior.
- `fullbody_by_character[String(characterId)]` is the only persisted fullbody lookup path; scene and portrait never use it.
- Fullbody always uses `visualDirectionPromptText(direction, 'fullbody')` and passes a blank `characterAction` to `buildPrompt`.
- The only new database field is `turns.image_direction_json`; image snapshots use existing JSON columns.
