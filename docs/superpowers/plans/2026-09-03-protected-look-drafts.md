# Protected Look Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect live image style profiles by editing and testing drafts before explicit activation.

**Architecture:** Keep `image_looks` as the production read model so `image-pipeline.js` does not need a style-resolution redesign. Add an immutable-version table for baseline, draft, activated, and superseded snapshots; routes manage drafts transactionally. The Look editor works against draft routes, and draft test generation delegates prompt construction to the production `buildPrompt()` function.

**Tech Stack:** Node 22 ESM, node:sqlite `DatabaseSync`, Express, existing A1111 client, browser JavaScript, node:test.

**Spec:** `docs/superpowers/specs/2026-09-03-protected-look-drafts-design.md`

## Global Constraints

- ESM only; no `require()`.
- Use node:sqlite additive migrations; each `ALTER TABLE` in its own guarded migration.
- Add no npm dependencies.
- `image_looks` remains the live production style table and current image pipeline reader.
- Never automatically rewrite, normalize, deduplicate, or reorder prompt text or LoRAs.
- Existing global negative, FaceID, Pose, and current Image Generation layout remain intact.
- A1111 preloading and URL controls are out of scope.
- Tests must be written and observed failing before production implementation.

---

### Task 1: Add version storage and baseline migration

**Files:**
- Modify: `src/db.js`
- Create: `src/services/look-version.js`
- Test: `src/services/__tests__/look-version.test.js`

**Interfaces:**
- Produces: `snapshotLook(row)`, `parseLookSnapshot(json)`, and `seedLookBaselines(db)`.
- Consumes: `image_looks` rows with the current complete Look contract.
- Used by: draft routes in Task 2 and activation in Task 3.

- [ ] **Step 1: Write failing migration and snapshot tests**

```js
test('baseline migration snapshots every existing Look exactly once', () => {
  seedLookBaselines(db);
  seedLookBaselines(db);
  const versions = db.prepare('SELECT * FROM image_look_versions WHERE status = ?').all('baseline');
  assert.equal(versions.length, 1);
  assert.deepEqual(JSON.parse(versions[0].snapshot_json).loras, [
    { file: 'style.safetensors', strength: 0.7 },
    { file: 'detail.safetensors', strength: 1 },
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --test-name-pattern="baseline migration snapshots"`

Expected: FAIL because `seedLookBaselines` and `image_look_versions` do not exist.

- [ ] **Step 3: Add the table, snapshot helpers, and idempotent baseline seed**

Create `image_look_versions` with `look_id`, `status`, `source_version_id`,
`snapshot_json`, `created_at`, and `activated_at`. Implement `snapshotLook` to
copy every appearance-affecting field as-is, including the parsed ordered LoRA
array. Implement `seedLookBaselines` using `NOT EXISTS` so it never overwrites
or duplicates a baseline.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- --test-name-pattern="baseline migration snapshots"`

Expected: PASS.

- [ ] **Step 5: Commit the storage foundation**

```bash
git add src/db.js src/services/look-version.js src/services/__tests__/look-version.test.js
git commit -m "Add protected Look version storage"
```

### Task 2: Add isolated draft creation, reads, saves, and discard routes

**Files:**
- Modify: `src/routes/looks.js`
- Modify: `src/services/look-version.js`
- Test: `src/routes/__tests__/looks.routes.test.js`

**Interfaces:**
- Consumes: `snapshotLook`, `parseLookSnapshot`, and `image_look_versions` from Task 1.
- Produces: `POST /api/looks/:id/drafts`, `POST /api/looks/drafts`, `GET/PUT/DELETE /api/looks/drafts/:versionId`.
- Used by: browser editor changes in Task 4.

- [ ] **Step 1: Write failing isolation tests**

```js
test('saving a draft never changes its source live Look', async () => {
  const draft = await post('/api/looks/1/drafts', {});
  await put('/api/looks/drafts/' + draft.json.id, {
    prompt_prefix: 'draft-only prefix',
    loras: [{ file: 'draft.safetensors', strength: 0.55 }],
  });
  const live = await get('/api/looks/1');
  assert.equal(live.json.prompt_prefix, 'original prefix');
  assert.deepEqual(JSON.parse(live.json.loras_json), [{ file: 'original.safetensors', strength: 0.8 }]);
});

test('discard deletes only the draft', async () => {
  const draft = await post('/api/looks/1/drafts', {});
  const discarded = await del('/api/looks/drafts/' + draft.json.id);
  assert.equal(discarded.status, 200);
  assert.equal((await get('/api/looks/1')).status, 200);
  assert.equal((await get('/api/looks/drafts/' + draft.json.id)).status, 404);
});
```

- [ ] **Step 2: Run draft-route tests and verify RED**

Run: `npm test -- --test-name-pattern="saving a draft|discard deletes"`

Expected: FAIL because draft routes do not exist.

- [ ] **Step 3: Implement draft-only routes and validation**

Create existing-Look drafts from an exact snapshot. Create unattached new-Look
drafts with the current editor defaults. Only permit `status = 'draft'` to be
read, updated, or discarded. Validate nonblank names on writes and serialize
the LoRA array without reordering it.

- [ ] **Step 4: Run draft-route tests and verify GREEN**

Run: `npm test -- --test-name-pattern="saving a draft|discard deletes"`

Expected: PASS.

- [ ] **Step 5: Commit isolated draft routes**

```bash
git add src/routes/looks.js src/services/look-version.js src/routes/__tests__/looks.routes.test.js
git commit -m "Add isolated Look drafts"
```

### Task 3: Activate drafts atomically

**Files:**
- Modify: `src/routes/looks.js`
- Test: `src/routes/__tests__/looks.routes.test.js`

**Interfaces:**
- Consumes: a valid `draft` snapshot from Task 2.
- Produces: `POST /api/looks/drafts/:versionId/activate`.
- Used by: editor activation control in Task 4.

- [ ] **Step 1: Write failing activation tests**

```js
test('activating a draft snapshots the previous live Look then applies the draft atomically', async () => {
  const draft = await post('/api/looks/1/drafts', {});
  await put('/api/looks/drafts/' + draft.json.id, { prompt_suffix: 'approved suffix' });
  const activated = await post('/api/looks/drafts/' + draft.json.id + '/activate', {});
  assert.equal(activated.status, 200);
  assert.equal((await get('/api/looks/1')).json.prompt_suffix, 'approved suffix');
  const prior = db.prepare("SELECT snapshot_json FROM image_look_versions WHERE look_id = 1 AND status = 'superseded'").get();
  assert.equal(JSON.parse(prior.snapshot_json).prompt_suffix, 'original suffix');
});
```

- [ ] **Step 2: Run activation test and verify RED**

Run: `npm test -- --test-name-pattern="activating a draft snapshots"`

Expected: FAIL because the activation endpoint does not exist.

- [ ] **Step 3: Implement transactional activation**

For an attached draft, begin a transaction, snapshot the current live Look as
`superseded`, apply all snapshot fields to the original `image_looks` row, and
mark the draft `activated`. For an unattached draft, create a new Look row,
snapshot it as activated, and use the existing single-active-Look transaction.
Rollback the whole operation on any failure.

- [ ] **Step 4: Run activation test and verify GREEN**

Run: `npm test -- --test-name-pattern="activating a draft snapshots"`

Expected: PASS.

- [ ] **Step 5: Commit draft activation**

```bash
git add src/routes/looks.js src/routes/__tests__/looks.routes.test.js
git commit -m "Activate Look drafts transactionally"
```

### Task 4: Make draft test generation match production prompt construction

**Files:**
- Modify: `src/routes/looks.js`
- Test: `src/routes/__tests__/looks.routes.test.js`
- Test: `src/services/__tests__/prompt-builder.test.js`

**Interfaces:**
- Consumes: draft snapshot and `buildPrompt()`.
- Produces: `POST /api/looks/drafts/:versionId/test-generate`.
- Used by: draft editor Test Draft control in Task 5.

- [ ] **Step 1: Write failing production-parity tests**

```js
test('draft test generation uses the production prompt order and negative composition', async () => {
  const draft = await createDraftWith({
    prompt_prefix: 'prefix',
    loras: [{ file: 'style', strength: 0.7 }],
    prompt_suffix: 'suffix',
    negative: 'look negative',
  });
  await post('/api/looks/drafts/' + draft.id + '/test-generate', { test_subject: 'test subject' });
  assert.equal(capturedPayload.prompt, 'prefix, <lora:style:0.7>, test subject, suffix');
  assert.equal(capturedPayload.negative_prompt, 'look negative, master negative');
});

test('draft test generation uses request-local checkpoint, VAE, and Clip Skip overrides', async () => {
  const draft = await createDraftWith({ checkpoint: 'test.safetensors', vae: 'test.vae', clip_skip: 2 });
  await post('/api/looks/drafts/' + draft.id + '/test-generate', { test_subject: 'test subject' });
  assert.equal(capturedPayload.override_settings.sd_model_checkpoint, 'test.safetensors');
  assert.equal(capturedPayload.override_settings.sd_vae, 'test.vae');
  assert.equal(capturedPayload.override_settings.CLIP_stop_at_last_layers, 2);
  assert.equal(capturedPayload.override_settings_restore_afterwards, true);
});
```

- [ ] **Step 2: Run parity tests and verify RED**

Run: `npm test -- --test-name-pattern="draft test generation uses"`

Expected: FAIL because draft test generation does not exist and current generic
test generation assembles its own different prompt order.

- [ ] **Step 3: Implement the draft test route with `buildPrompt()`**

Build a synthetic Look from the exact draft snapshot. Call `buildPrompt` with
the test subject as scene description and the stored global master negative.
Forward the draft sampling values. Put checkpoint, VAE, and Clip Skip in
`override_settings` and set `override_settings_restore_afterwards: true`.
Write only a scratch test image and never modify live Look data.

- [ ] **Step 4: Run parity tests and verify GREEN**

Run: `npm test -- --test-name-pattern="draft test generation uses"`

Expected: PASS.

- [ ] **Step 5: Commit production-faithful draft tests**

```bash
git add src/routes/looks.js src/routes/__tests__/looks.routes.test.js src/services/__tests__/prompt-builder.test.js
git commit -m "Match Look draft tests to production prompts"
```

### Task 5: Convert the Look editor to draft-first controls

**Files:**
- Modify: `public/js/api.js`
- Modify: `public/js/views/settings.js`
- Test: `public/js/__tests__/look-editor-form.test.js`
- Test: `public/js/__tests__/settings-foundation.test.js`

**Interfaces:**
- Consumes: draft endpoints from Tasks 2-4.
- Produces: draft-aware editor state `{ draftId, sourceLookId, isNew }`.
- Preserves: existing prompt, LoRA, catalog, editor, and saved test-preview controls.

- [ ] **Step 1: Write failing UI-contract tests**

```js
test('existing Look edit starts a draft rather than calling the direct Look update route', () => {
  assert.match(settingsSource, /API\.createLookDraft\(look\.id\)/);
  assert.doesNotMatch(settingsSource, /API\.updateLook\(look\.id, payload\)/);
});

test('draft editor exposes save, test, activate, and discard controls', () => {
  assert.match(settingsSource, /Save Draft/);
  assert.match(settingsSource, /Test Draft/);
  assert.match(settingsSource, /Activate Draft/);
  assert.match(settingsSource, /Discard Draft/);
});
```

- [ ] **Step 2: Run UI-contract tests and verify RED**

Run: `npm test -- --test-name-pattern="existing Look edit starts|draft editor exposes"`

Expected: FAIL because the editor currently saves directly to `PUT /api/looks/:id`.

- [ ] **Step 3: Add API client methods and draft editor state**

Add API client methods for all draft endpoints. On Edit, create and load a
draft. On New Look, create and load an unattached draft. Replace Save Changes
with Save Draft, Generate Test Image with Test Draft, add Activate Draft and
Discard Draft. Keep the existing editor fields, test-result save controls, and
catalog controls unchanged.

- [ ] **Step 4: Run UI-contract tests and verify GREEN**

Run: `npm test -- --test-name-pattern="existing Look edit starts|draft editor exposes"`

Expected: PASS.

- [ ] **Step 5: Commit draft-first editor**

```bash
git add public/js/api.js public/js/views/settings.js public/js/__tests__/look-editor-form.test.js public/js/__tests__/settings-foundation.test.js
git commit -m "Edit Looks through protected drafts"
```

### Task 6: Verify the full protected-style workflow

**Files:**
- Modify: `VERIFY.md`
- Test: existing full test suite

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a concise manual verification path for protected Look editing.

- [ ] **Step 1: Add the manual Look protection checklist**

Add a checklist that creates a draft from an active Look, changes one visible
prefix token and one LoRA weight, generates a draft test, discards the draft,
and confirms a scene image still uses the prior active Look. Repeat the process
with activation and confirm a new scene image uses the approved draft.

- [ ] **Step 2: Run focused Look tests**

Run: `npm test -- --test-name-pattern="baseline migration|saving a draft|discard deletes|activating a draft|draft test generation|existing Look edit starts|draft editor exposes"`

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 4: Check the final diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only intentional protected-Look files changed.

- [ ] **Step 5: Commit verification checklist and sync**

```bash
git add VERIFY.md
git commit -m "Document protected Look verification"
git push origin main
```

## Plan Self-Review

- Spec coverage: Tasks 1-3 cover protected snapshots and transaction-safe
  drafts; Task 4 covers production-faithful tests; Task 5 preserves the editor
  fields while changing only the mutation flow; Task 6 supplies manual and
  automated verification.
- Placeholder scan: no deferred implementation placeholders are present; later
  visual diff and recommendation features are explicitly excluded from scope.
- Interface consistency: every browser draft method maps to a named route, and
  all route work uses snapshot helpers created in Task 1.
