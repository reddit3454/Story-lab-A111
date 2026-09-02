# Pose ControlNet Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user (and optionally the story) pick a pose from the catalog and send it to A1111 as a second ControlNet unit alongside FaceID, with Settings + Play UI fully wired.

**Architecture:** Keep A1111 REST as the only image backend. Extend `buildA1111Payload` so `alwayson_scripts.controlnet.args` can hold **Unit 0 = OpenPose/structure map** and **Unit 1 = IP-Adapter FaceID** (order locked). Pose selection is stored per Play session (and optionally stamped on the scene-image request). Catalog already exists (`pose-catalog-lib` + `/api/poses`); this plan consumes it. Ratings: `sfw | nsfw | contextual` — NSFW master off hides only `nsfw` rows.

**Tech Stack:** Node/Express, existing `image-pipeline.js` / `ipadapter-resolution.js`, A1111 sd-webui-controlnet, vanilla Play/Settings JS, `global_config` keys via `config-resolver.js`.

## Global Constraints

- Do **not** bring back ComfyUI workflows or old `pose-library.js` from pre-A1111 story-lab.
- Pose ControlNet is **optional**; FaceID-only path must keep working if pose is off or no map selected.
- Preprocessed maps (`module: none` or empty preprocessor with bone/lineart PNG) preferred; live openpose preprocess is a Settings fallback only.
- Dual ControlNet weights: scene mode lowers FaceID (already); pose weight separate (`pose_control_weight`).
- ASCII UI copy; no commit unless user asks.
- Tests: `node --experimental-sqlite --experimental-test-module-mocks --test` — mock A1111; no live Ollama required.
- Manual library hygiene: see `docs/POSE_LIBRARY_OPTIMIZATION_AND_MANUAL_STEPS.md` (not a blocker for coding against ready poses).

---

## Current Ground Truth

| Piece | Status |
|-------|--------|
| Catalog + `npm run pose:catalog` | Live (~1687 entries, ~725 ready) |
| `GET /api/poses` + asset routes | Live |
| `/pose-assets` static | Live |
| ControlNet in pipeline | **One** unit = FaceID/IP-Adapter only |
| Settings pose knobs | Missing |
| Play pose picker | Missing |
| Scene-card auto pose match | Not started |

---

## Locked Product Decisions

1. **ControlNet arg order:** `[poseUnit?, faceIdUnit?]`. If pose disabled/missing, FaceID remains sole unit (current behavior).
2. **Default pose module:** `none` when `control_map` is `bone` or `lineart`; if using raw `source` photo, module `openpose` (or catalog module from Settings).
3. **Default model key:** `pose_controlnet_model` from Settings (user picks from `/controlnet/model_list`, expect OpenPoseXL2).
4. **Request field:** `POST` image generate accepts optional `pose_id` (catalog id). Resolves to absolute path via `resolvePoseAssetPath`.
5. **Play UX:** Collapsible “Pose” strip on image panel — category chips, ready-only toggle default on, thumbnail grid, Clear. Selection cached in `play` state `_selectedPoseId`.
6. **Auto-suggest (Phase C):** map scene card `body_positions` / action text to category keywords; suggest top 3; never auto-apply without user confirm except optional “Auto apply suggested” setting (default off).
7. **Contextual rating:** shown when NSFW on or off; NSFW rows gated by `nsfw_enabled`.

---

## File Map

| File | Role |
|------|------|
| `src/db.js` | Defaults for pose_* config keys |
| `src/services/config-resolver.js` | NUMERIC/BOOLEAN pose keys |
| `src/services/pose-controlnet.js` **(new)** | Build pose ControlNet unit; merge with FaceID units |
| `src/services/image-pipeline.js` | Call merger; accept `poseId` / resolved image |
| `src/routes/images.js` (or generate route) | Pass `pose_id` from body into `generate()` |
| `src/routes/a1111.js` | Already exposes controlnet models; reuse |
| `public/js/api.js` | `getPoses`, `getPose`, pose asset URL helper |
| `public/js/views/settings.js` | Pose Control section under Image / Story Dynamics |
| `public/js/views/play.js` + prompt panel | Pose picker UI + pass pose_id |
| `src/services/__tests__/pose-controlnet.test.js` | Unit merge/order/module |
| `src/services/__tests__/image-pipeline.*.js` | Payload contains two CN units when both set |
| `docs/POSE_LIBRARY_...` + master knowledge | Sync after ship |

---

# Phase A — Config + dual ControlNet payload (backend)

**Exit:** Generating with `pose_id` + FaceID produces two ControlNet args; without pose_id unchanged; tests green.

### Task A1: Config keys + Settings persistence

**Files:** `src/db.js`, `src/services/config-resolver.js`

Keys:

| Key | Type | Default |
|-----|------|--------|
| `pose_control_enabled` | bool | `false` |
| `pose_controlnet_model` | string | `` |
| `pose_control_module` | string | `none` |
| `pose_control_weight` | number | `0.75` |
| `pose_control_end` | number | `0.85` |
| `pose_library_ready_only_default` | bool | `true` |
| `pose_auto_suggest_enabled` | bool | `false` |
| `pose_auto_apply_suggested` | bool | `false` |

- [ ] **Step 1:** Add defaults to `_defaults` in `db.js`.
- [ ] **Step 2:** Register BOOLEAN + NUMERIC keys in `config-resolver.js`.
- [ ] **Step 3:** Unit smoke: `resolveMasterConfig` includes new keys after boot with fresh/migrated DB.

### Task A2: `pose-controlnet.js` pure builder + tests

**Files:** create `src/services/pose-controlnet.js`, `src/services/__tests__/pose-controlnet.test.js`

```js
export function resolvePoseModule({ catalogMapType, configModule }) { ... }
export function buildPoseControlNetUnit({ imageBase64, model, module, weight, guidanceEnd }) { ... }
export function mergeControlNetArgs({ poseUnit, faceIdUnit }) {
  // returns args array in order [pose?, faceId?]
}
```

- [ ] **Step 1:** Write failing tests (order, omit null units, module none for bone).
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Tests PASS.

### Task A3: Wire `image-pipeline.js`

**Files:** `src/services/image-pipeline.js`, generate call sites

- [ ] **Step 1:** `generate({ ..., poseId })` — if `pose_control_enabled` and poseId, load file → base64, build pose unit with `pose_controlnet_model` + weight/end.
- [ ] **Step 2:** Replace single-arg FaceID assignment with `mergeControlNetArgs`.
- [ ] **Step 3:** Preflight: validate pose model exists in ControlNet catalog (same as FaceID); if pose model missing, skip pose unit + log (fail-open), keep FaceID if ready.
- [ ] **Step 4:** Extend / add pipeline tests for dual-unit payload.

### Task A4: Route accepts `pose_id`

**Files:** images / generate routes, `public/js/api.js`

- [ ] **Step 1:** Accept `pose_id` on scene + character image generate endpoints.
- [ ] **Step 2:** API client methods: `getPoses(params)`, `getPose(id)`, generate helpers include `pose_id`.

### Phase A Gate

1. FaceID-only still works with pose disabled.  
2. Pose-only (no FaceID ref) works when pose enabled.  
3. Both together → `controlnet.args.length === 2`, pose first.  
4. `npm test` green.

---

# Phase B — Settings UI + Play pose picker

**Exit:** User can enable pose, pick model, browse catalog in Play, and generate with selected pose.

### Task B1: Settings — Pose Control panel

**Files:** `public/js/views/settings.js`

- [ ] **Step 1:** Add “Pose Control” section (Image settings or sibling to Story Dynamics).
- [ ] **Step 2:** Toggles: enable, ready-only default, auto-suggest, auto-apply (disabled until Phase C if needed).
- [ ] **Step 3:** Dropdowns: ControlNet model + module (from existing `/api/a1111/controlnet-*` endpoints).
- [ ] **Step 4:** Sliders: weight, guidance end. Save via existing config PUT.

### Task B2: Play pose picker UI

**Files:** `public/js/views/play.js` (and/or image/prompt panel module)

- [ ] **Step 1:** Pose strip: category select, search, “Ready only” checkbox, grid of thumbs (`/api/poses/:id/asset` or `/pose-assets/...`).
- [ ] **Step 2:** Click selects pose (highlight); Clear button; show rating badge (`contextual` as “Any”).
- [ ] **Step 3:** On Generate / Character image: send `pose_id` if selected and Settings enable is on.
- [ ] **Step 4:** Respect NSFW master — don’t show NSFW-rated tiles when NSFW off.

### Task B3: CSS / polish

- [ ] **Step 1:** Compact grid (no large marketing cards); selected state; loading empty states.

### Phase B Gate

1. Settings save/reload pose keys.  
2. Picker lists ready poses; asset thumbs load.  
3. Selected pose affects generation (visible skeleton fidelity vs cleared).  
4. `npm test` green.

---

# Phase C — Story-aware suggest + hardening

**Exit:** Optional suggestions from scene card; docs synced; failure modes clear.

### Task C1: Suggest from scene card / brief

**Files:** `src/services/pose-suggest.js`, Play UI

- [x] **Step 1:** Keyword / category mapping from `body_positions` + brief text.
- [x] **Step 2:** API `GET /api/poses/suggest?text=...&scenarioId=` (before `/:id`).
- [x] **Step 3:** UI: "Suggested" chips; apply on click; `pose_auto_apply_suggested` optional.

### Task C2: Fail-open UI + logging

- [x] **Step 1:** Toast if pose unit skipped (model missing / file missing).
- [x] **Step 2:** Audit log fields: `pose_id`, `pose_skipped_reason`.

### Task C3: Docs

- [x] **Step 1:** Update `story-lab-a1111-master-knowledge.md` (pose ControlNet + Settings).  
- [x] **Step 2:** Cross-link manual steps doc.

### Phase C Gate

1. Suggest returns relevant sitting poses for “she sat on the couch…”.  
2. Auto-apply off by default.  
3. Full `npm test` green.

---

## Out of Scope

- ComfyUI / ImageCore pose nodes  
- InstantID  
- Multi-person multi-map compositing UI  
- Deleting original pose archives  
- Forcing every pose to be labelled SFW/NSFW  

---

## Suggested Execution Order

1. Phase A (config → pure builder → pipeline → routes)  
2. Phase B (Settings → Play picker)  
3. Phase C (suggest + docs)  
4. User confirms before commit  

## Self-Review

- [x] Ratings include contextual  
- [x] Dual ControlNet order locked  
- [x] Catalog reused, not rebuilt  
- [x] Manual library work separated into companion doc  
