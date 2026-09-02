# Mood, Arousal & Relationships — Full Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mood, arousal, and relationships coherent end-to-end: fix scale/threshold/NSFW bugs, support living bonds (strength, edit, scenario overlay, deltas), and surface author tools (trigger chips, mood-gate feedback, bond-focus guidance, regen emotional snapshot) wired through narrator, Play, Characters, and image-adjacent paths.

**Architecture:** Keep `scenario_character_state` as SoT for runtime mood/arousal and `character_relationships` as SoT for bonds. Add a resolve layer (`resolveRelationshipsForScenario`, arousal helpers) so narrator / emotional update / UI / regen all share one contract. Ship in three phases that each leave the app shippable.

**Tech Stack:** Node (Express, `node:sqlite`), existing Ollama `generate` + JSON schema, vanilla Play/Characters JS, broadcast WS (`moodupdate`, new `relationshipupdate`).

## Global Constraints

- Do not invent Comfy/ImageCore paths; Stay on A1111 + existing Story Lab services.
- Prefer exact column names already in DB (`moodcurrent`, `arousalcurrent`, `arousalmax`, `arousalthreshold`, `arousallockeduntil`, `strength`, `scenario_id`).
- `nsfw_enabled` / `explicit_mode` from `resolveMasterConfig` (and scenario NSFW when present) must hard-clamp explicit arousal behavior.
- Tests: `node --experimental-sqlite --experimental-test-module-mocks --test` — pure unit tests first; no live Ollama/A1111 required for CI.
- Do not commit unless the user asks.
- ASCII-safe UI copy (no emoji).
- One function/phase at a time if executing with one-function discipline; this plan marks phase gates.

## Current Ground Truth (do not rediscover blindly)

| Area | Live today | Gap |
|---|---|---|
| Mood/arousal runtime | `scenario_character_state` + Play bars + `processEmotionalUpdateAfterTurn` | `arousalthreshold` unread; `arousalmax` UI 2–5 vs runtime 1–10 |
| Character sheet | triggers, baseline, lock, max, threshold saved | threshold dead; max scale wrong |
| Relationships | Global CRUD `/api/relationships`; Characters bonds; Play tab add/delete; narrator prints type+desc+strength | No edit UI; strength not in forms; scenario route exists but blocked by `idx_char_rel_global` UNIQUE(from,to) |
| NSFW image tags | `prompt-builder.getArousalTags` gated | Narrator ACTION_BY_AROUSAL not fully NSFW-clamped |

**Critical schema conflict:** Table DDL has `UNIQUE(scenario_id, from_character_id, to_character_id)`, but migration also added `idx_char_rel_global` on `(from_character_id, to_character_id)` only — that prevents true scenario overlays. Phase B must drop the global unique index.

---

## Locked Product Decisions

1. **Arousal scale is 1–10 everywhere.** Migrate existing `arousalmax` 2/3/4/5 → 4/6/8/10 (keep null→10). Characters form options become 2,4,6,8,10 (or full 1–10 select).
2. **`arousalthreshold`** modulates momentum needed to tick arousal (`low=1`, `medium=2`, `high=3`, `veryhigh=4`; when already ≥5, add +2 like today).
3. **Relationships SoT:** `scenario_id = 0` = global default; `scenario_id = N` = scenario override for that pair/direction. Resolver: start from globals for cast, replace/add with scenario rows for matching `(from,to)`.
4. **Reciprocity:** Directional edges stay 1-way. UI offers "Add reverse" checkbox when creating (creates second row if missing).
5. **Tags:** Small fixed set stored as JSON array on the relationship: `attraction`, `trust`, `tension`, `history`, `taboo`. Narrator treats as constraints.
6. **Relationship deltas:** Same emotional LLM pass extended with optional `relationshipUpdates: [{ fromId, toId, strengthDelta }]` (−1..+1); only apply when both ends in cast and a relationship row already exists (global or scenario — apply to the resolved row that is active for the scenario, preferring scenario override).
7. **Decay:** After emotional update, if a character’s `arousalDelta` was 0 and current arousal > max(1, mood-adjacent floor), apply −1 arousal momentum (or soft −1 every N turns) — keep simple: −1 arousal momentum when update arousalDelta==0 and arousal>1.
8. **NSFW off:** Effective ceiling min(character.arousalmax, 3); ACTION bands ≥6 never emitted; image tags already gated.
9. **Author tools:** Trigger chips on cast cards; mood-gate toast when manual/+ path or auto update is capped by lock; “Focus bond with X” prefills guidance; regenerate appends emotional/relationship snapshot into guidance text server-side if client sends `include_state: true` (default true).

---

## File Map

| File | Role |
|---|---|
| `src/services/arousal-rules.js` **(new)** | Pure helpers: clamp, threshold→momentum, NSFW ceiling, migrateMax, moodGateEffective |
| `src/services/relationship-resolve.js` **(new)** | `resolveRelationshipsForScenario(db, scenarioId)`, apply strength delta, tags helpers |
| `src/services/character-state.js` | Use arousal-rules; decay; NSFW clamp; load `arousalthreshold`; mood-gate events |
| `src/services/relationship-emotion.js` **(new)** or extend character-state | Schema + apply for relationshipUpdates |
| `src/services/narrator.js` | Use resolved relationships; NSFW-aware cast behavior block |
| `src/services/turn-regenerate.js` | Optional state snapshot injection into regen guidance |
| `src/db.js` | Drop `idx_char_rel_global`; add `tags_json`; migrate arousalmax; optional `status_flags` |
| `src/routes/global-relationships.js` | tags on CRUD; keep types |
| `src/routes/character-relationships.js` | Already scenario-scoped — verify works after index drop |
| `src/routes/characters.js` | bonds GET include tags; arousalmax validation 1–10 |
| `src/routes/turns.js` | After emotion update, relationship deltas + broadcast; NSFWn regen snapshot |
| `public/js/api.js` | Scenario relationship CRUD helpers if missing; update bond payloads |
| `public/js/views/characters.js` | arousalmax 1–10 UI; strength + tags + edit + reverse on bonds |
| `public/js/views/play.js` | Relationships tab edit/strength/tags/scenario vs global; cast chips; bond focus; mood-gate toast; NSFW hint |
| `src/services/__tests__/arousal-rules.test.js` | Unit |
| `src/services/__tests__/relationship-resolve.test.js` | Unit |
| `src/services/__tests__/character-state-arousal.test.js` | Momentum/threshold/NSFW (mock ollama if needed) |
| `story-lab-a1111-master-knowledge.md` | Sync Known Stubs / scale notes |

---

# Phase A — Coherence (Package A)

**Exit criteria:** Threshold affects ticks; max is 1–10; NSFW clamps behavior; mood-gate feedback works; tests green.

### Task A1: Pure arousal rules module + tests

**Files:**
- Create: `src/services/arousal-rules.js`
- Create: `src/services/__tests__/arousal-rules.test.js`

**Interfaces:**
- Produces:
  - `clampMood(v) -> 1..5`
  - `clampArousal(v, max) -> 1..max`
  - `migrateLegacyArousalMax(v) -> number` (2→4, 3→6, 4→8, 5→10; already ≥6 leave; null→10)
  - `momentumNeededForArousalTick({ arousalthreshold, arousalcurrent }) -> number`
  - `effectiveArousalCeiling({ arousalmax, nsfwEnabled, explicitMode }) -> number`
  - `effectiveArousalForBehavior({ mood, arousal, arousallockeduntil, ceiling }) -> { effective, gated: boolean, reason?: string }`

- [ ] **Step 1:** Write failing tests for mapping, threshold table, NSFW ceiling (nsfw false → ≤3), gate when mood < lock.

- [ ] **Step 2:** Run tests — expect FAIL (module missing).

```bash
node --experimental-sqlite --experimental-test-module-mocks --test src/services/__tests__/arousal-rules.test.js
```

- [ ] **Step 3:** Implement `arousal-rules.js` with the helpers above (no DB).

- [ ] **Step 4:** Re-run tests — expect PASS.

- [ ] **Step 5:** Commit only if user asks.

---

### Task A2: DB migration for arousalmax + drop conflicting unused defaults

**Files:**
- Modify: `src/db.js` (additive migrate block)

**Interfaces:**
- Consumes: `migrateLegacyArousalMax`
- Produces: All characters with `arousalmax` in 1–10 (default 10)

- [ ] **Step 1:** Add migration:
  - `UPDATE characters SET arousalmax = CASE arousalmax WHEN 2 THEN 4 WHEN 3 THEN 6 WHEN 4 THEN 8 WHEN 5 THEN 10 ELSE arousalmax END WHERE arousalmax IS NOT NULL AND arousalmax <= 5;`
  - Then `UPDATE characters SET arousalmax = 10 WHERE arousalmax IS NULL OR arousalmax < 1 OR arousalmax > 10;`
  - Change future default in docs; SQLite can’t easily change column default — new inserts from API use 10.

- [ ] **Step 2:** Manual smoke: query a few characters after boot / script.

- [ ] **Step 3:** Unit test optional: run migrate against `:memory:` copy pattern used by other tests if feasible; else skip.

---

### Task A3: Wire character-state + narrator to arousal-rules

**Files:**
- Modify: `src/services/character-state.js`
- Modify: `src/services/narrator.js` (`buildCastBehaviorBlock` path)
- Modify: `src/routes/characters.js` (validate arousalmax 1–10 on write)
- Create: `src/services/__tests__/character-state-arousal.test.js` (pure parts + mocked momentum application if extracted)

**Interfaces:**
- Consumes: arousal-rules helpers
- Produces: `processEmotionalUpdateAfterTurn` uses threshold for momentum; clamps with NSFW ceiling; returns optional `gated: [{ characterId, reason }]` in result **or** separate list — prefer expanding return to `{ characters: updatedCharacters, gates: [...] }` **breaking** callers in `turns.js` — update both call sites (normal turn + regenerate).

**Caller update contract:**
```js
const emotionResult = await processEmotionalUpdateAfterTurn(...);
const moodUpdates = emotionResult.characters || emotionResult; // temporarily support array for safety
const gates = emotionResult.gates || [];
broadcast.send('moodupdate', { scenarioId, characters: moodUpdates, gates });
```

- [ ] **Step 1:** Refactor `_clamp*` / `_effectiveArousalForBehavior` to delegate to `arousal-rules.js`.

- [ ] **Step 2:** Include `arousalthreshold` in `_getChar` / `_getCast` SELECTs.

- [ ] **Step 3:** Replace hard-coded `arousalThreshold = current >= 5 ? 4 : 2` with `momentumNeededForArousalTick(...)`.

- [ ] **Step 4:** Apply soft decay: if parsed update has `arousalDelta === 0` and arousal > 1, add `arousal_momentum -= 1` (then same tick logic).

- [ ] **Step 5:** Pass `config.nsfw_enabled` / `explicit_mode` into ceiling; when building ACTION lines in `buildCastBehaviorBlock`, use effective ceiling and skip ≥6 bands when NSFW off.

- [ ] **Step 6:** Update `turns.js` both emotion call sites for new return shape + broadcast `gates`.

- [ ] **Step 7:** Tests for momentumNeeded + NSFW cast block (extract pure string builder test if needed).

- [ ] **Step 8:** `npm test` — all green.

---

### Task A4: Characters + Play UI coherence

**Files:**
- Modify: `public/js/views/characters.js` — `char-arousalmax` options 2,4,6,8,10 labeled “of 10”; default 10; hint text under threshold “Controls how fast arousal rises.”
- Modify: `public/js/views/play.js` — on `moodupdate`, if `gates.length`, `showToast` once summarizing (e.g. "Alex's heat capped — mood too cold"); cast card subtitle already shows mood/arousal — add tiny hint when gated if `state.characterStates[id]._gatedReason`.
- Modify: `public/js/views/play.js` cast bars — ensure arousal max button respects character ceiling from loaded character row if available (not always 10).

- [ ] **Step 1:** Update Characters form + save still sends number.

- [ ] **Step 2:** Play: when loading cast, attach `arousalmax` / `arousallockeduntil` onto `state.characterStates` metadata from character list API.

- [ ] **Step 3:** Manual +/- uses `Math.min(ceiling, ...)` where ceiling = character arousalmax (NSFW client hint optional).

- [ ] **Step 4:** Wire WS `moodupdate.gates`.

- [ ] **Step 5:** Manual browser smoke checklist (below Phase A gate).

---

### Phase A Gate — TEST CHECKLIST

1. Character with `arousalthreshold=veryhigh` needs more turns of +deltas to rise than `low`.
2. Character `arousalmax=10` can be raised to 10 on Play bars.
3. Global NSFW off → narrator behavior text never demands explicit initiation; arousal state clamp ≤3 on auto-update.
4. Cold mood + high lock → gate toast when updater or manual tries to push past effective.
5. `npm test` green.

**Do not start Phase B until Phase A gate passes.**

---

# Phase B — Living Bonds (Package B)

**Exit criteria:** Strength/tags/edit/reverse in UI; scenario overlays work; relationship deltas apply; narrator uses resolved set.

### Task B1: Schema — drop global unique; add tags_json

**Files:**
- Modify: `src/db.js`

- [ ] **Step 1:** Migrate:
  - `db.exec("DROP INDEX IF EXISTS idx_char_rel_global");`
  - `ALTER TABLE character_relationships ADD COLUMN tags_json TEXT DEFAULT '[]'` (try/catch migrate helper)
  - Ensure table unique remains `(scenario_id, from_character_id, to_character_id)`.

- [ ] **Step 2:** Document in master knowledge: global rows use `scenario_id=0`.

---

### Task B2: relationship-resolve service + tests

**Files:**
- Create: `src/services/relationship-resolve.js`
- Create: `src/services/__tests__/relationship-resolve.test.js`

**Interfaces:**
- Produces:
  - `parseTags(tags_json) -> string[]`
  - `serializeTags(tags) -> string` (whitelist only)
  - `resolveRelationshipsForScenario(db, scenarioId) -> RelationshipRow[]`  
    Logic: load cast ids; load globals (`scenario_id=0`) where both in cast; load scenario rows (`scenario_id=N`); for each `(from,to)` scenario row wins; include scenario-only pairs too.
  - `applyStrengthDelta(db, { scenarioId, fromId, toId, delta }) -> row|null` — update the **resolved active** row (if only global exists, optionally clone-on-write into scenario override — **locked decision:** clone-on-write so global stays pristine when scenario delta fires).

**Clone-on-write:** First scenario delta for a global pair INSERTs scenario row copying type/desc/tags/strength then applies delta.

- [ ] **Step 1:** Failing tests with `:memory:` DB fixture mirroring columns.

- [ ] **Step 2:** Implement resolver + clone-on-write.

- [ ] **Step 3:** Tests PASS.

---

### Task B3: API — tags + scenario CRUD used by Play

**Files:**
- Modify: `src/routes/global-relationships.js` — accept `tags`/`tags_json` on POST/PUT; return parsed tags
- Modify: `src/routes/character-relationships.js` — same
- Modify: `src/routes/characters.js` GET `/:id/relationships` — include tags
- Modify: `public/js/api.js`:
  - `getScenarioRelationships(sid)`
  - `createScenarioRelationship(sid, data)`
  - `updateScenarioRelationship(sid, relId, data)`
  - `deleteScenarioRelationship(sid, relId)`
  - Extend `createRelationship` / `updateRelationship` bodies with `tags`, `strength`
  - `updateCharacterBond(charId, id, data)` → PUT global

- [ ] **Step 1:** Backend accept whitelist tags: `attraction|trust|tension|history|taboo`.

- [ ] **Step 2:** API client methods.

- [ ] **Step 3:** Smoke via curl or unit on route if pattern exists.

---

### Task B4: Narrator uses resolver

**Files:**
- Modify: `src/services/narrator.js`

- [ ] **Step 1:** Replace `_getRelationships.all(scenario.id, scenario.id)` with `resolveRelationshipsForScenario(db, scenario.id)`.

- [ ] **Step 2:** Format lines to include strength + tags:
  - `Alex -> Sam: romantic partner (attraction, tension) [intensity 4/5] (dating casually)`

- [ ] **Step 3:** For `taboo` tag, append hard rule line in relationship block: `Do not force sexual escalation across taboo edges.`

---

### Task B5: Relationship deltas in emotional pass

**Files:**
- Modify: `src/services/character-state.js` (or new `relationship-emotion.js` imported from it)
- Modify: `src/routes/turns.js`

**Schema extension:**
```js
relationshipUpdates: {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      fromId: { type: 'number' },
      toId: { type: 'number' },
      strengthDelta: { type: 'integer' }, // -1..1
    },
    required: ['fromId', 'toId', 'strengthDelta'],
  },
}
```

- [ ] **Step 1:** Extend `EMOTION_JSON_SCHEMA` + system prompt: only emit relationshipUpdates when the beat meaningfully changed closeness/hostility between two listed characters; strengthDelta −1..1.

- [ ] **Step 2:** Apply via `applyStrengthDelta` clone-on-write.

- [ ] **Step 3:** `broadcast.send('relationshipupdate', { scenarioId, relationships: changedRows })`.

- [ ] **Step 4:** Play WS handler refreshes Relationships tab if open / updates local cache.

---

### Task B6: Characters UI — full bond editor

**Files:**
- Modify: `public/js/views/characters.js` (`loadCharacterBonds`, bond form)

- [ ] **Step 1:** Form fields: type, description, **strength 1–5**, **tag checkboxes**, **Also create reverse** checkbox.

- [ ] **Step 2:** List rows show intensity + tags; **Edit** opens form with `updateRelationship`; Delete unchanged.

- [ ] **Step 3:** Reverse create: if checked, POST second edge to→from with same type/strength/tags (ignore 409).

---

### Task B7: Play Relationships tab — global vs scenario + edit

**Files:**
- Modify: `public/js/views/play.js` `renderRelationshipsTab`

- [ ] **Step 1:** Load `API.getRelationships()` + `API.getScenarioRelationships(scenarioId)` + cast.

- [ ] **Step 2:** UI sections: **Global (defaults)** and **This scenario (overrides)** OR single list with badge `global` / `scenario`.

- [ ] **Step 3:** Add form: strength slider, tags, toggle “Save as scenario override” (default off for global; on writes scenario route).

- [ ] **Step 4:** Edit + delete call correct API by badge.

- [ ] **Step 5:** On `relationshipupdate` WS, re-render if tab active.

---

### Phase B Gate — TEST CHECKLIST

1. Global unique index gone — can insert scenario override for existing global pair.
2. Narrator prompt (log/audit) shows resolved scenario override, not stale global only.
3. Strength/tags editable in Characters and Play; reverse creates second edge.
4. After flirt beat, strength can +1 via emotion pass (mockable unit).
5. `npm test` green.

**Do not start Phase C until Phase B gate passes.**

---

# Phase C — Author Tools (Package C)

**Exit criteria:** Cast chips, bond-focus guidance, regen gets emotional snapshot, optional pair/scene heat display.

### Task C1: Cast card trigger chips + bond focus

**Files:**
- Modify: `public/js/views/play.js` (cast render)

- [ ] **Step 1:** On each cast card, if triggers exist, show truncated chips:
  - Warmth: first 40 chars of `moodtriggerspos`
  - Turn-offs: `moodtriggersneg`
  - Heat: `arousaltriggers`

- [ ] **Step 2:** Button `Focus` per other cast member (or dropdown “Focus bond…”): sets `#guidance-input` to:
  `Focus on the relationship between Alice and Bob this beat. Honor their bond (type/tags).`
  including resolved type if available from cached relationships.

---

### Task C2: Regenerate includes state snapshot

**Files:**
- Modify: `src/services/turn-regenerate.js` — `appendStateSnapshotToGuidance(guidance, { moods, relationships })`
- Modify: `src/routes/turns.js` regenerate handler — build snapshot from `listScenarioCharacterStates` + `resolveRelationshipsForScenario`, pass into messages (append to guidance string before `buildRegenerateMessages`).
- Modify: `public/js/views/play.js` — already sends `guidance`; no change required if server always attaches snapshot (preferred).

- [ ] **Step 1:** Unit test snapshot formatting.

- [ ] **Step 2:** Wire regenerate route.

- [ ] **Step 3:** Manual: regenerate with empty guidance still gets mood lines in narrator input (check logs).

---

### Task C3: Scene heat readout (lightweight pair signal)

**Files:**
- Modify: `public/js/views/play.js` cast or scenario header
- Optional: derive `sceneHeat = max(arousal among non-user present)` from state; display “Scene heat: Desire (5/10)” — no new table.

- [ ] **Step 1:** Pure helper `deriveSceneHeat(states) -> { level, label }`.

- [ ] **Step 2:** Show under Play cast header; refresh on moodupdate.

---

### Task C4: Docs sync

**Files:**
- Modify: `story-lab-a1111-master-knowledge.md`
- Optional: `docs/superpowers/specs/2026-07-15-mood-arousal-relationships-design.md` one-pager linking this plan

- [ ] **Step 1:** Document scale 1–10, threshold behavior, scenario overlay resolve, broadcasts.

- [ ] **Step 2:** Remove outdated “relationships tab stub” language if still present.

---

### Phase C Gate — TEST CHECKLIST

1. Cast chips visible when triggers set.
2. Focus bond prefills guidance; Continue/Narrator uses it.
3. Regenerate without user guidance still informed by current moods (log).
4. Scene heat updates when arousal bars change.
5. Full `npm test` green.

---

## Cross-Cutting: Broadcast Contracts

```js
// existing, extended
moodupdate: {
  scenarioId: number,
  characters: [{ characterId, name, moodcurrent, arousalcurrent }],
  gates?: [{ characterId, name, reason }],
}

// new
relationshipupdate: {
  scenarioId: number,
  relationships: [{ id, scenario_id, from_character_id, to_character_id, from_name, to_name, relationship_type, description, strength, tags }],
}
```

---

## Out of Scope (explicit)

- Pose / OpenPose ControlNet
- Prompt Lab
- Dating-sim calendars / jealousy AI beyond strength deltas
- Separate LLM solely for relationships

---

## Suggested Execution Order

1. Phase A tasks A1→A4  
2. Phase A gate  
3. Phase B tasks B1→B7  
4. Phase B gate  
5. Phase C tasks C1→C4  
6. Phase C gate  
7. User confirmation before any commit

---

## Self-Review (plan)

- [x] No TBDs for required behavior — clone-on-write and tag whitelist locked  
- [x] Schema conflict `idx_char_rel_global` called out with fix  
- [x] Every UI surface named (Characters bonds, Play rel tab, cast bars, guidance, regenerate)  
- [x] Broadcast + narrator + turns callers updated  
- [x] Phases independently shippable  

