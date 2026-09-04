# Codex-Assisted Story State and Reference-First Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Codex as an optional secondary-reasoning backend while retaining Ollama, and make local FaceID, OpenPose, wardrobe state, location, and Look the authority for image construction.

**Architecture:** Story Lab owns all persisted state and all A1111 prompt assembly. A provider-neutral secondary-reasoning contract returns validated scene, clothing, memory, or visual facts. Codex never receives FaceID assets or writes a finished diffusion prompt; it may only propose bounded facts that the local pipeline validates.

**Tech Stack:** Node 22 ESM, Express, node:sqlite DatabaseSync, native fetch, existing Ollama/A1111 adapters, and a Codex App Server or SDK only after local feasibility verification.

**Spec:** Conversation-approved design, 2026-09-03; no separate spec was requested.

## Global Constraints

- Preserve Ollama as the default and selectable backend for every secondary role.
- Do not change the narrator backend.
- Add no npm dependencies unless a feasibility probe proves one essential and the user approves that exception.
- Keep `src/services/image-pipeline.js` as the sole image orchestrator and generation on-command only.
- Preserve the one-active-Look rule and style-word stripping.
- Keep the existing dirty working tree isolated from this work.
- All output must be ASCII-only.

## File Structure

- `src/services/secondary-reasoning.js`: provider-neutral validation and dispatch.
- `src/services/ollama-secondary-reasoning.js`: current behavior moved behind the shared contracts.
- `src/services/codex-secondary-reasoning.js`: optional local Codex bridge, created only if the probe succeeds.
- `src/services/secondary-reasoning-config.js`: per-role provider and fallback resolution.
- `src/services/image-facts.js`: validates facts without writing an A1111 prompt.
- `src/services/scene-state.js`, `src/services/memory.js`, `src/services/image-shot-action.js`: thin callers of the shared contracts.
- `src/services/image-pipeline.js`: reference-first control resolution and deterministic prompt assembly.
- `src/db.js`, `src/routes/config.js`, `public/js/api.js`, `public/js/views/settings.js`: persisted settings and visible fallback status.

## Task 1: Baseline and Codex Feasibility Gate

**Files:**

- Create: `docs/audits/codex-secondary-reasoning-feasibility-2026-09-03.md`
- Test: `src/services/__tests__/scene-state.test.js`

**Produces:** Measured current latency and an evidence-based decision on the exact Codex runtime interface, auth path, schema reliability, and timeout behavior.

- [ ] **Step 1: Measure current behavior before changing configuration**

Run `npm test -- --test-name-pattern="scene-state"`. Record narrator latency separately from scene-state latency, plus Node and Ollama process CPU/RAM. Do not use a combined turn duration as the only measurement.

- [ ] **Step 2: Probe the installed Codex runtime with a non-sensitive fixture**

Send only a two-character fictional prose fixture and this strict response shape:

```json
{"scene_mood":"neutral","scene_arousal":1,"characters":[{"character_id":1,"mood":3,"arousal":1}],"clothing_changes":[]}
```

Do not send FaceID images, credentials, absolute media paths, or production campaign history.

- [ ] **Step 3: Record the gate result**

The audit must name the actual runtime command/interface, authentication mode, cold/warm latency, JSON validation result, timeout behavior, and whether the worker can operate without filesystem-write tools. If it fails any contract requirement, mark Codex unavailable and stop before creating a provider.

## Task 2: Extract Existing Secondary Calls Behind Contracts

**Files:**

- Create: `src/services/secondary-reasoning.js`
- Create: `src/services/ollama-secondary-reasoning.js`
- Modify: `src/services/scene-state.js`
- Modify: `src/services/memory.js`
- Modify: `src/services/image-shot-action.js`
- Test: `src/services/__tests__/secondary-reasoning.test.js`

**Interfaces:** `extractSceneStateFacts(input)`, `summarizeMemoryFacts(input)`, and `suggestImageActionFacts(input)` return validated values or explicit unavailable results.

- [ ] **Step 1: Write failing contract tests**

```js
test('scene state rejects unknown character ids', async () => {
  const result = await extractSceneStateFacts({ narratorText: '...', cast: [{ id: 1, name: 'A' }] });
  assert.deepEqual(result, EMPTY_SCENE_STATE);
});
test('memory rejects an empty model response', async () => {
  const result = await summarizeMemoryFacts({ turns: [] });
  assert.equal(result.ok, false);
});
```

- [ ] **Step 2: Run the new tests**

Run `npm test -- src/services/__tests__/secondary-reasoning.test.js`. Expected: failure because the module and exports do not exist.

- [ ] **Step 3: Implement the minimal shared contracts and Ollama adapter**

Preserve the current scene-state JSON schema, low temperature, `keep_alive`, output limits, model defaults, and soft-failure semantics. Do not alter the persisted scene-card shape.

- [ ] **Step 4: Verify and commit the isolated refactor**

Run `npm test -- src/services/__tests__/secondary-reasoning.test.js src/services/__tests__/scene-state.test.js`. Expected: pass. Commit only the files listed for this task with message `refactor: isolate secondary reasoning contracts`.

## Task 3: Add Codex Only If Task 1 Passed

**Files:**

- Create: `src/services/codex-secondary-reasoning.js`
- Create: `src/services/secondary-reasoning-config.js`
- Modify: `src/services/secondary-reasoning.js`
- Test: `src/services/__tests__/codex-secondary-reasoning.test.js`

**Interfaces:** The adapter accepts role-specific bounded text plus allowed IDs/schema and returns only the Task 2 contracts.

- [ ] **Step 1: Write failing mocked-runtime tests**

```js
test('Codex adapter parses schema output', async () => {
  const result = await runCodexSceneState({ narratorText: '...', cast: [{ id: 1, name: 'A' }] });
  assert.equal(result.characters[0].characterId, 1);
});
test('Codex adapter returns unavailable on timeout', async () => {
  const result = await runCodexSceneState({ narratorText: '...', timeoutMs: 1 });
  assert.equal(result.reason, 'timeout');
});
```

- [ ] **Step 2: Run the tests**

Run `npm test -- src/services/__tests__/codex-secondary-reasoning.test.js`. Expected: failure because the adapter does not exist.

- [ ] **Step 3: Implement the verified bridge**

Use the actual Task 1 interface and timeout. Pass no FaceID data, file paths, project instructions, or tool authority. Parse only one JSON response, validate it through Task 2, and record requested provider, actual provider, role, duration, fallback flag, and a non-sensitive failure reason.

- [ ] **Step 4: Verify and commit**

Run `npm test -- src/services/__tests__/codex-secondary-reasoning.test.js src/services/__tests__/secondary-reasoning.test.js`. Expected: pass with no live Codex dependency. Commit with `feat: add optional Codex secondary reasoning`.

## Task 4: Add Per-Role Settings and Visible Fallback

**Files:**

- Modify: `src/db.js`
- Modify: `src/routes/config.js`
- Modify: `public/js/api.js`
- Modify: `public/js/views/settings.js`
- Test: `src/routes/__tests__/config.routes.test.js`
- Test: `public/js/__tests__/settings-secondary-reasoning.test.js`

**Produces:** Settings for `scene_state`, `memory`, and `image_action`, each defaulting to `ollama` and showing unavailable/fallback status.

- [ ] **Step 1: Write failing route and UI tests**

```js
test('config rejects an unknown secondary provider', async () => {
  const res = await request(app).put('/api/config').send({ secondary_reasoning_scene_state_provider: 'invalid' });
  assert.equal(res.status, 400);
});
test('scene state defaults to Ollama', () => {
  assert.equal(readConfig().secondary_reasoning_scene_state_provider, 'ollama');
});
```

- [ ] **Step 2: Run tests and confirm absence**

Run `npm test -- src/routes/__tests__/config.routes.test.js public/js/__tests__/settings-secondary-reasoning.test.js`. Expected: failure for the absent keys/controls.

- [ ] **Step 3: Add additive config and UI**

Use individual `try { db.exec(...) } catch (_) {}` migrations. Offer Codex only when Task 1's health check succeeds. Never silently switch a saved choice when the catalog/runtime is unavailable.

- [ ] **Step 4: Verify and commit**

Re-run Step 2. Expected: pass. Commit with `feat: configure secondary reasoning providers`.

## Task 5: Implement the Reference-First Image Contract

**Files:**

- Create: `src/services/image-facts.js`
- Modify: `src/services/image-pipeline.js`
- Modify: `src/services/character-appearance.js`
- Modify: `src/services/a1111.js`
- Test: `src/services/__tests__/image-facts.test.js`
- Test: `src/services/__tests__/image-pipeline-reference-lock.test.js`

**Produces:** A local image contract containing selected characters, stored clothing, FaceID availability, pose metadata, Look, location, factual action/framing, and reference-lock status. It never returns a final prompt.

- [ ] **Step 1: Write failing contract and capacity tests**

```js
test('image facts remove style words from an action', () => {
  assert.equal(validateImageFacts({ action: 'cinematic embrace' }).action.includes('cinematic'), false);
});
test('two FaceID references plus one pose require three units', async () => {
  const result = await resolveReferenceLock({ selectedCharacters: [{ id: 1 }, { id: 2 }], poseId: 'pair', capacity: 2 });
  assert.equal(result.mode, 'primary_faceid_plus_pose');
});
```

- [ ] **Step 2: Run tests and confirm the contract is absent**

Run `npm test -- src/services/__tests__/image-facts.test.js src/services/__tests__/image-pipeline-reference-lock.test.js`. Expected: missing module/export failure.

- [ ] **Step 3: Make local state authoritative**

Derive identity from selected records and reference availability, clothes from `getScenarioClothing()`, pose from verified library metadata, and style from the active Look. A secondary provider may fill only a short factual action/framing/location gap after validation. It must not replace face identity, pose, clothing, Look, or the negative prompt.

- [ ] **Step 4: Add explicit lock modes**

Support `off`, `primary_faceid_plus_pose`, and `all_faceids_plus_pose`. The all-face two-person mode needs two FaceID units and one OpenPose unit. If the verified live capacity or catalog cannot support the requested mode, report the actual available mode and warning; never claim both identities are locked.

- [ ] **Step 5: Verify and commit**

Run `npm test -- src/services/__tests__/image-facts.test.js src/services/__tests__/image-pipeline-reference-lock.test.js src/services/__tests__/a1111.test.js`. Then query the live catalog and capacity. Do not claim all-face mode works until a manual pair render confirms it. Commit with `feat: add reference-first image contract`.

## Task 6: End-to-End Validation

**Files:**

- Modify: `VERIFY.md`
- Test: focused tests above and `npm test`

- [ ] **Step 1: Add manual cases**

Cover Ollama default, Codex healthy, Codex timeout with visible fallback, clothing persistence to a later image, one-person FaceID plus pose, two-person available lock mode, and manual-only image generation.

- [ ] **Step 2: Run the full suite**

Run `npm test`. Expected: pass without a live Codex account, live A1111 render, or live local model response.

- [ ] **Step 3: Perform the live checklist and record facts**

Record selected and actual provider, fallback status, ControlNet capacity, compatible model/module pairs, and user-observed pose/identity adherence.

## Plan Self-Review

- Task 1 gates feasibility and baseline performance before new backend code.
- Tasks 2-4 preserve the existing local option and make the alternate path explicit.
- Task 5 keeps image identity, pose, clothing, and style local and deterministic.
- Task 6 requires automated and manual evidence before a completion claim.
