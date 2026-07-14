# Story-Lab-A1111 — Post-Implementation Audit
**Scope:** Clothing-set system, FaceID, image pipeline integrity
**Date:** 2026-07-13
**Method:** story-lab-a1111-master-knowledge.md read against actual code; every finding below traced to file/line and confirmed by direct source read (not inferred from naming).

---

# Status as of audit wrap-up (do not rewrite historical findings)

This overlay records post-audit remediation status. Sections below this block remain the original 2026-07-13 FAIL snapshot and are intentionally **not** rewritten.

| Item | Status | Notes |
| --- | --- | --- |
| CF-1 | **Fixed + tested** | Story-enhancer clothing preservation |
| CF-2 | **Fixed + tested** | FaceID reference via `mainSubject` / character mode |
| CF-3 | **Fixed + tested** | Prompt Preview scenario-resolved clothing |
| CF-4 | **Fixed + tested** | Shared `buildA1111Payload` / `callA1111` for Character Editor |
| CF-5 | **Fixed + tested** | Outfit-sets raw JSON validation |
| CF-6 | **Fixed (docs)** | Master `clothing_changes` schema row corrected |
| CF-7 | **Fixed (UI removal)** | FaceID slot-config UI removed; columns/route remain unread |
| CF-8 | **Fixed + tested** | Images page trimmed to quarantine stub; `images-quarantine.test.js` |
| CF-9 | **Fixed (docs)** | `resolveClothing()` listed in Known Stubs |
| CF-10 | **Fixed + tested** | Both clothing PATCHes require explicit `runtime` boolean; `clothing-runtime.routes.test.js` |
| CF-11 | **Fixed + tested** | TTL-bound `getControlNetCatalog` |
| CF-A1 through CF-A6 | **Fixed + tested** | A1111-native FaceID/IP-Adapter rewrite |
| CF-12 | **Intentional tech debt (safe)** | Unused enricher/`getOptions`/legacy clothing helpers; reset-scene deliberately does not clear runtime clothing (documented). False ORPHAN on `resolveActiveProfile` corrected. |

**Manual / not automated:** live A1111 + ControlNet smoke; Play `controlnetFallback` UI; Settings module/model dropdowns.

Living reference: `story-lab-a1111-master-knowledge.md` section **Handoff / Current Status**. Suite: **98/98** across 14 files (`npm test`). Safe to pause after reading that section.

---

# 1. Executive Summary

- **CRITICAL:** The default/auto scene-image generation path (the most common image-generation flow) silently discards the correctly-resolved scenario clothing. Stage 2b's "story_enhancer" LLM rewrite unconditionally overwrites `prompt` whenever it returns >20 chars, which is effectively always — the enhancer never receives the resolved clothing map as authoritative input. Character-focused portraits are unaffected (different code branch).
- **HIGH:** FaceID/IP-Adapter reference-image resolution ignores which character is actually being generated — it always uses `characters.find(c => c.role !== 'player') || characters[0]`, i.e. alphabetically-first non-player character, regardless of `characterId` or scene subject. In any scenario with 2+ NPCs, portraits/scenes can be generated with the wrong character's face reference. Pre-existing, not caused by the clothing work.
- **HIGH:** Prompt Preview panel (Play UI, character target) builds text from the legacy `characters.current_clothing` field, not scenario runtime state — user-facing and reachable, and can inject clothing that contradicts what `image-pipeline.js` separately (and correctly) resolves for the actual A1111 call.
- **HIGH:** Character Editor's "Generate Reference"/"Generate Fullbody" actions use a second, drifted payload builder (`routes/characters.js` `_buildPayload`) that never received the VAE-override and retry fixes just added to the main pipeline — contradicts the doc's "unified pipeline, no per-type pipeline" claim.
- **MEDIUM:** Character Editor's raw outfit-sets JSON textarea silently discards invalid JSON (empty `catch`) and still shows "Character saved!" — a data-loss bug with a false success signal.
- **MEDIUM:** `story-lab-a1111-master-knowledge.md` documents the wrong `clothing_changes` schema (`{character, change_description}`) forty lines away from its own correct description — a landmine for anyone editing the narrator system prompt next.
- **MEDIUM:** `faceid_ref_count`/`faceid_ref_order` are fully editable and persist correctly in the Character Editor UI, but are never read anywhere in generation — only a single reference image is ever sent.
- **MEDIUM:** The Images page's entire Face/Body/Style reference-slot UI is dead code behind an unconditional early return, and calls API methods that don't exist. Appears intentional (doc says "quarantined") but the dead code itself is misleading to read.
- **LOW (doc violation):** `clothing.js`'s `resolveClothing()` stub is correctly marked in-source but CLAUDE.md's "Known Stubs" section still claims "No stubs in the current codebase" — stale.
- **LOW:** Two independent backend routes can write scenario clothing with opposite default `runtime` semantics; currently safe only because each frontend caller is consistent about which one it uses.
- **LOW:** ControlNet-availability check is cached for the life of the Node process with no invalidation — if ControlNet isn't ready at first generation, FaceID silently stays off until restart.
- **META-FINDING:** `audit_this.md`'s FaceID section (batch FaceID, batch-control2, `preferredFaceWorkflow`, ComfyUI workflow routing, input staging) describes an architecture that **does not exist in this codebase**. The project fully migrated off ComfyUI to a single A1111 REST + one ControlNet/IP-Adapter slot (`story-lab-a1111-master-knowledge.md` line 54: "Dropped: ImageCore, ComfyUI, Batch FaceID..."). This audit evaluates the real single-reference A1111 mechanism instead — flagged explicitly so the gap isn't mistaken for a missing feature.
- **POSITIVE:** The clothing read/write isolation model itself (scenario-scoped runtime state never overwriting character base JSON, correct 3-tier fallback in `getScenarioClothing`) is genuinely and consistently implemented everywhere it was checked except the enhancer-overwrite bug above. Scenario Creation/Edit UI and Play UI wiring for clothing both hold up under scrutiny.

---

# 2. Pass / Fail Verdict

## **FAIL**

Reasons:
1. The default scene-image generation path does not actually use scenario-resolved clothing by the time the prompt reaches A1111 (CF-1) — this defeats the stated purpose of the clothing-set feature for the majority of generated images.
2. FaceID reference resolution is not tied to the character being generated (CF-2) — produces wrong-face images in any multi-NPC scenario.
3. A user-facing UI panel (Prompt Preview) shows clothing that contradicts what's actually sent to the generator (CF-3).
4. A user-facing UI control (Character Editor raw JSON) can silently destroy user edits while reporting success (CF-5).
5. A fully-wired UI control (FaceID ref count/order) has zero effect on generation (CF-7).
6. The master knowledge doc — the project's stated source of truth — contains a self-contradicting schema and stale stub tracking.

None of these are "mostly implemented" — per the audit's own rule, partial wiring is scored FAIL, not PASS.

---

# 3. Critical Findings

### CF-1 — Severity: Critical — Story-enhancer silently discards resolved scenario clothing on the default scene-image path
**Files:** `src/services/image-pipeline.js:304-436`, `src/services/story-enhancer.js:236-238,268-276`, `public/js/views/settings.js` (no `enhancer_model` field exists)

**Why it matters:** This is the path fired for the majority of in-play image generation (any scene image where the user hasn't manually saved edited tags). The clothing-set feature's entire purpose — accurate scenario-scoped outfit in generated images — is defeated here.

**Exact evidence:**
```js
// image-pipeline.js:304 — correctly resolved
const resolvedClothingMap = resolveScenarioClothingMap(scenarioId, characters);
...
({ prompt, negative, parts } = buildPrompt({ ..., resolvedClothingMap }));  // line 337 — parts.clothing_block correct here

// image-pipeline.js:386 — enhancer's clothing input comes from a DIFFERENT, often-null source
const clothingState = pickedMoment?.clothingState || null;   // NOT resolvedClothingMap

// image-pipeline.js:421 — unconditional overwrite whenever enhancer returns >20 chars (effectively always)
if (enhanced?.positive && enhanced.positive.length > 20) {
  prompt = [prefix, enhanced.positive, suffix, lora].filter(...).join(', ');
}
```
`story-enhancer.js`'s own fallback path (`fallbackPositive`, ~line 236) is built purely from character traits (gender/body/hair/eyes/skin) with **no clothing field**, and is always >20 chars — so even total enhancer/LLM failure still produces a clothing-free prompt that passes the length check and overwrites `prompt`. `config.enhancer_model` has no settings UI field (confirmed via grep) so it always falls back to `narrator_model`, meaning this stage is active in every working deployment, not an edge case.

**Proven actual behavior:** For default scene-image generation, `parts.clothing_block` (correct) is computed, logged to the audit trail, and then thrown away before the A1111 call. The audit log itself (`image-pipeline.js:449-453`) logs the pre-overwrite `parts`, making post-hoc debugging misleading too.

**Recommended fix:** Feed `resolvedClothingMap`-derived clothing into the enhancer's `structBits`/scene description as an authoritative field the LLM must preserve verbatim, or re-append `parts.clothing_block` onto `prompt` after the enhancer reassignment. Single-function scope per project discipline — do not bundle with CF-3 (audit-log fix) even though it's the same lines, per the project's own "no bundling" example in CLAUDE.md.

---

### CF-2 — Severity: High — FaceID reference image is not tied to the character actually being generated
**File:** `src/services/image-pipeline.js:490-500` (confirmed via `git diff` to be pre-existing, unchanged by the clothing work except an unrelated field-name fix)

```js
if (config.ipadapter_enabled && !isBackground) {
  const mainCharRef = characters.find(c => c.role !== 'player') || characters[0] || null;
  const refRel = mainCharRef?.reference_image_path || mainCharRef?.reference_image || '';
  ...
}
```
This ignores `characterId`, which is used just a few lines earlier (line 306-312) to select which character the **prompt** is about. `characters` is ordered alphabetically by name (`_getCharacters.all`, `ORDER BY c.name`).

**Proven actual behavior:** In any scenario with 2+ non-player characters, generating a portrait for "Bob" (`mode='character', characterId=<Bob>`) still submits Alice's face reference to ControlNet if Alice sorts first. Same for scene images with multiple NPCs — the face reference is always the alphabetically-first NPC, never necessarily the scene's actual subject.

**Recommended fix:** Resolve `mainCharRef` from the same character used for prompt-building in `mode==='character'`; for scene mode, resolve from whichever character the picker/scene names as primary subject, or explicitly document/enforce single-companion support.

---

### CF-3 — Severity: High — Prompt Preview panel shows stale, non-scenario clothing (user-facing, reachable)
**Files:** `src/services/prompt-preview.js:41,51-73` (confirmed by direct read), `src/services/prompt-extractor.js:110`, `public/js/play/prompt-panel.js`

Confirmed directly: `prompt-preview.js` line 41 fetches characters via a plain JOIN with no clothing resolution, and line 51 finds the character by ID and passes the **raw, unmutated row** straight into `extractCharacterPlainSummary`/`extractCharacterImagePrompt`, which read `c.current_clothing || c.base_clothing` (the legacy character-card field `clothing.js` itself documents as "character-card wardrobe management only", not the scenario-scoped field). `getScenarioClothing`/`resolveScenarioClothingMap` are never called in this file.

**Proven actual behavior:** Clicking a character chip in the Play view's Prompt Panel populates preview text with clothing from the legacy field. If the user generates from that preview text (`directPrompt:true`), the final A1111 prompt can contain the stale clothing baked into the user-edited text **plus** the correct scenario clothing that `image-pipeline.js`'s `mode==='character'` branch separately appends — two contradictory clothing descriptions in one prompt.

**Recommended fix:** In `prompt-preview.js`, before calling the extractors, set `char.current_clothing = getScenarioClothing(scenarioId, char.id)` — mirrors what `image-pipeline.js` already does correctly at lines 311-313. Single, isolated fix.

---

### CF-4 — Severity: High — Duplicate/drifted payload builder for Character Editor reference/fullbody generation
**Files:** `src/routes/characters.js` `_buildPayload` (~lines 102-117), used by `POST /:id/references/generate` (~386) and `POST /:id/fullbody/generate` (~488), vs. `src/services/image-pipeline.js` `_buildA1111Payload` (~42-103)

Contradicts the master doc's explicit claim: *"Unified image generation pipeline — ALL image types... pass through the same single pipeline and config system. There is no separate pipeline per image type."* (master doc line 55). The `characters.js` builder is missing the `sd_vae` override that was just added to `_buildA1111Payload` to fix `AutoencoderKL`/state_dict failures, has no Hires.fix/ADetailer/Refiner support, and calls `a1111.txt2img()` directly instead of the retry-wrapped `_callA1111()` — so it gets none of the recent VAE-failure auto-retry logic.

**Proven actual behavior:** Generating a Reference or Fullbody image from the Character Editor uses logic that is provably out of sync with the just-patched main pipeline and will be exposed to the exact class of error the recent fix addressed, without the fix.

**Recommended fix:** Route both endpoints through `image-pipeline.js`'s shared payload/call functions, or extract them into a module both import.

---

### CF-5 — Severity: Medium — Character Editor: malformed outfit-sets JSON silently discarded with false success toast
**File:** `public/js/views/characters.js:916-923` (confirmed by direct read)

```js
outfit_sets: (function () {
  var ota = document.getElementById('char-outfit-sets-json');
  if (ota && ota.value.trim()) {
    try { var parsed = JSON.parse(ota.value.trim()); return JSON.stringify(parsed); }
    catch (_) {}
  }
  return JSON.stringify(_outfitSets);
}()),
```
No validation on blur/change; the empty `catch` silently falls through to `_outfitSets` (in-memory state, which may not match what the user typed), and save proceeds to an unconditional `showToast('Character saved!', 'success')`.

**Proven actual behavior:** User edits the raw JSON textarea with a typo → clicks Save → sees "Character saved!" → the edit was discarded, not saved.

**Recommended fix:** On save, if the textarea is non-empty and fails `JSON.parse`, abort with an error toast instead of silently reverting.

---

### CF-6 — Severity: Medium — Master knowledge doc documents the wrong `clothing_changes` schema
**File:** `story-lab-a1111-master-knowledge.md` line 991, contradicted by the same doc's correct section at lines 821-829

Doc line 991: `[{ character, change_description }]`. Actual (confirmed): `narrator.js:52` and `clothing.js`'s `applyClothingChanges` (~106-128) both use `[{ character_name/character_id, new_clothing }]`; target is `scenario_character_state.current_clothing`, not a "character_states" table as the doc row implies.

**Why it matters:** If `narrator.js`'s prompt were ever "corrected" to match the wrong doc row, `applyClothingChanges` would silently skip every entry (its guard is `if (!charId || !change.new_clothing) continue;`) with no errors logged — runtime clothing updates from narration would stop working invisibly.

**Recommended fix:** Correct doc line 991 to match the actual schema.

---

### CF-7 — Severity: Medium — `faceid_ref_count`/`faceid_ref_order` fully wired to the DB but never consumed by generation
**Files:** `public/js/views/characters.js:1109-1284` (UI), `src/routes/characters.js:461-471` (`PATCH /:id/faceid-config`), `src/db.js:344-345` (schema) vs. `image-pipeline.js` (consumer — absent)

The Character Editor's FaceID slot-count/drag-reorder UI round-trips correctly to the DB, but `_buildA1111Payload` only ever sends one `image` field (line 93, single base64 string) sourced from `reference_image_path` alone. `faceid_ref_count`/`faceid_ref_order` have zero readers outside the UI file and the one PATCH route.

**Proven actual behavior:** Setting 5 ordered reference images and saving succeeds with a success toast; it has zero effect on any generated image.

**Recommended fix:** Either implement multi-image reference support in the payload builder, or remove the count/order UI and document single-reference support only.

---

### CF-8 — Severity: Medium — Images page reference-slot UI is dead code calling a nonexistent API surface
**File:** `public/js/views/images.js` (lines 84-571 unreachable after an unconditional early return at line 82)

References `API.getFaceIdConfig`, `API.getGallerySlotConfig`, `API.saveGallerySlotConfig`, `API.getCharacterGallery`, and 4 more methods that do not exist anywhere in `public/js/api.js`; `routes/characters.js` has zero gallery/slot-config routes. Consistent with the master doc's note that this page is "quarantined," so likely intentional — but the 487 lines of dead code referencing a nonexistent API surface (including stale copy about a "batch workflow" that no longer exists) is misleading to any future reader, including future AI assistants.

**Recommended fix:** Delete the unreachable code or the file, since Settings Image Profiles has superseded it per the doc.

---

### CF-9 — Severity: Low — Stub not listed in CLAUDE.md Known Stubs (doc-rule violation)
**Files:** `src/services/clothing.js:130-138` (correctly marked `// STUB: layered resolve unused...`) vs. `CLAUDE.md` "Known Stubs (as of 2026-06-11)" section, which states "No stubs in the current codebase."

`resolveClothing()` is confirmed unused anywhere in `src/` (grep). Per the project's own stub rule, every stub must be listed in CLAUDE.md — this one isn't. `resetClothing()` (line 140) is also fully dead (unused, operates on the legacy `characters.current_clothing` field) but not marked as a stub since it is functional code, just orphaned.

**Recommended fix:** Update CLAUDE.md's Known Stubs section, or delete both functions if truly obsolete.

---

### CF-10 — Severity: Low — Two clothing-write routes have opposite default `runtime` semantics
**Files:** `src/routes/characters.js:303-339` (`PATCH /:id/clothing` — omitted `runtime` defaults to **runtime** write) vs. `src/routes/scenario-characters.js:106-137` (`PATCH /:sid/characters/:cid/clothing` — omitted `runtime` defaults to **starting**-outfit write)

Currently safe only because each frontend caller (`play.js` vs `scenario-setup.js`) is consistent about always/never passing the flag — but it's a foot-gun for any future caller that assumes the other route's default.

**Recommended fix:** No urgent action; flag for consolidation, make both routes require an explicit `runtime` boolean rather than defaulting.

---

### CF-11 — Severity: Low — ControlNet-availability cache never invalidates
**File:** `src/services/image-pipeline.js:105-116`

Module-level, process-lifetime cache with no TTL. If ControlNet isn't loaded in A1111 at the time of the first generation after server start, FaceID silently stays disabled for every subsequent generation until the Node process itself restarts, even after A1111 fully comes up.

**Recommended fix:** Add a short TTL or a manual recheck path.

---

### CF-12 — Severity: Low — Miscellaneous cleanup / dead-code items
- `scene-prompt-enricher.js`'s async `enrichSceneCardPrompts()` has zero callers anywhere (`turns.js` only calls the sync `applyNarratorSummaryOnly`).
- `config-resolver.js:33`'s `// ORPHAN: not imported anywhere` comment on `resolveActiveProfile` is **false** — it's called two lines below at line 40. The comment, not the code, is wrong.
- `a1111.js:136`'s `getOptions()` orphan comment is accurate — genuinely unused, safe to delete.
- Master doc (~line 1068) documents `scene_images.prompt_parts_json` as a stored column; no such column exists in `db.js` — `parts` is only ever passed to the in-memory `audit()` call, never persisted.
- `scenario-characters.js:86-91` double-writes runtime clothing on cast-add (`setScenarioStartingOutfit` already does this internally); idempotent, cosmetic only.
- `scenarios.js`'s `POST /:id/reset-scene` does not reset `scenario_character_state.current_clothing`; may be intentional but undocumented either way.

---

# 4. UI Audit

- **Character Editor: FAIL** — CRUD/default/reorder for clothing sets work correctly (add/edit/delete/default/save/reload all confirmed functional), but the raw-JSON power-user path silently discards invalid edits while reporting success (CF-5). Per audit rule, this scores the whole item FAIL, not "mostly pass."
- **Scenario Creation/Edit: PASS** — Per-character starting-outfit selector saves correctly for both new-scenario and edit-existing paths; reopening a scenario correctly shows the prior selection; no silent-fallback-on-failure behavior found.
- **Play UI: PASS** — Current scenario clothing is visible and live; WS `clothingupdate` and `turn_complete.clothing_updates` both correctly patch the DOM; manual inline edits write with `runtime:true` and never touch character-card fields.
- **Images Reference UI / FaceID UI: FAIL** — Two separate surfaces, both broken in different ways: the Images page slot-grid is entirely dead code calling a nonexistent API (CF-8); the Character Editor's FaceID ref-count/order UI is genuinely wired to the DB but has zero effect on actual generation (CF-7). Neither surface delivers what it visually promises.
- **Settings / Image Config UI: PARTIAL FAIL** — General config resolution and structural-key allowlisting are correct (confirmed PASS by direct trace), but the `enhancer_model` config key that governs Stage 2b (CF-1) has no UI field at all, meaning a config value that materially controls prompt quality is invisible and unconfigurable to the user, silently falling back to `narrator_model`.

---

# 5. Data Flow Audit

- **Character base clothing sets** live in `characters.outfit_sets` (JSON array `{name, description, underwear?}`) plus `default_outfit_name`/`default_outfit`. Managed via Character Editor; read/written by `src/routes/characters.js` and `src/services/clothing.js`.
- **Scenario starting outfit selection** lives in `scenario_characters.starting_clothing_set_name`/`starting_clothing`, set at scenario creation/edit via `src/routes/scenario-characters.js`, `clothing.js`'s `setScenarioStartingOutfit`.
- **Scenario runtime clothing state** lives in `scenario_character_state.current_clothing`, written by narrator `clothing_changes` (via `applyClothingChanges`) and by Play manual edits (`runtime:true` PATCH calls); read via `getScenarioClothing`/`resolveScenarioClothingMap`.
- **Narrator prompt construction:** correctly resolves through `resolveScenarioClothingMap` → `buildPrompt`'s `clothing_block` (confirmed correct at the `buildPrompt` call site).
- **Scene image generation:** `resolvedClothingMap` is correctly computed and fed into `buildPrompt` (line 304-341) — but for the default/auto path, Stage 2b's story-enhancer overwrite (CF-1) discards it before the A1111 call. **This is the one broken link in the whole clothing chain**, and it's the highest-traffic path.
- **Character-focused image generation:** correctly overrides `char.current_clothing`/`char.base_clothing` from `resolvedClothingMap`/`getScenarioClothing` at image-pipeline.js:311-313, and this path bypasses the Stage 2b enhancer entirely (`mode !== 'character'` guard) — so it is unaffected by CF-1.
- **FaceID reference resolution:** always `characters.find(c => c.role !== 'player') || characters[0]` (alphabetical-first NPC), independent of scene subject or `characterId` (CF-2) — this is the "final workflow decision" point for which face gets submitted, and it does not consult the same character-selection logic the prompt itself uses.
- **Image staging/submission:** single base64 image read from disk (`IMAGES_DIR` + `reference_image_path`), existence-checked, submitted as one ControlNet unit to A1111 — no multi-reference, no ComfyUI-style node-graph staging (that architecture was removed from this project entirely).

---

# 6. FaceID Audit

| Item | Verdict |
|---|---|
| Seed-image FaceID | **FAIL** — reference not tied to the character/scene subject (CF-2) |
| Batch FaceID | **N/A** — architecture does not exist in this codebase (A1111-only rebuild; see Executive Summary meta-finding) |
| Batch-control2 FaceID | **N/A** — same as above |
| Character portrait/fullbody FaceID | **FAIL** — same root cause as CF-2, plus the separate Character Editor generation path uses a drifted payload builder without the pipeline's recent VAE fix (CF-4) |
| Scene-image FaceID | **FAIL** — same as CF-2 |
| Reference image UI wiring | **FAIL** — Images page is dead code (CF-8); Character Editor ref-count/order is wired to DB but not to generation (CF-7) |
| Fallback behavior | **PASS** — missing reference file is logged and generation proceeds without it; ControlNet-unavailable is pre-checked (though cache never invalidates, CF-11) |

---

# 7. Image Pipeline Audit

| Item | Verdict |
|---|---|
| Effective config resolution | **PASS** — structural-key allowlist correctly prevents profile override of a1111_url/model/hr/ad/lora/nsfw |
| Prompt assembly order | **PASS in isolation** — `buildPrompt`'s ordering matches documented formula; **but FAILS end-to-end** for scene mode because Stage 2b overwrites the result (CF-1) |
| Workflow map | **N/A** — no ComfyUI workflow map in this architecture; mode-based routing (`scene`/`character`/`background`) is correct except for the FaceID reference selection within it (CF-2) |
| Control2 lane generation | **N/A** — concept does not exist in the A1111-only architecture |
| Auto-image path | **FAIL** — same code path as scene mode, inherits CF-1 |
| Manual image path | **PASS** — single shared entrypoint (`image-pipeline.generate()`), no divergent second implementation found for the core scene/character routes (the Character Editor's separate reference/fullbody builder, CF-4, is the one exception) |
| Scene-image WS/UI flow | **PASS** — WS events (`clothingupdate`, `image_ready`) confirmed consistent between emit sites and `play.js` listeners |
| Character-focused image path | **PASS** — correctly resolves scenario clothing and bypasses the Stage 2b enhancer bug |

---

# 8. Broken Wiring

- Character Editor raw-JSON outfit editor: save succeeds visibly while silently discarding invalid input (CF-5).
- `faceid_ref_count`/`faceid_ref_order`: saved, never read by generation (CF-7).
- Images page reference-slot UI: entirely unreachable, calls nonexistent API methods and routes (CF-8).
- Story-enhancer Stage 2b: consumes `pickedMoment?.clothingState` instead of the authoritative `resolvedClothingMap`, and its output unconditionally overwrites the correctly-built prompt (CF-1).
- Prompt Preview: reads legacy `characters.current_clothing` instead of scenario-resolved clothing (CF-3).
- `config.enhancer_model`: referenced in code, no UI field exists to set it (silent fallback to `narrator_model`).
- Duplicate payload builders for the same conceptual operation (character reference/fullbody generation) with diverging feature sets (CF-4).
- Two clothing-write routes with inverted default semantics for an omitted flag (CF-10).
- `enrichSceneCardPrompts()`: exported, fully unwired, zero callers.
- `resolveClothing()`, `resetClothing()`: dead legacy functions on the character-card clothing field.

---

# 9. Documentation Drift

- **CF-6:** `clothing_changes` schema table (doc line 991) contradicts the doc's own correct section 40 lines earlier and the actual `narrator.js`/`clothing.js` implementation.
- **CF-9:** CLAUDE.md's "Known Stubs (as of 2026-06-11)" section is stale — claims zero stubs, but `clothing.js`'s `resolveClothing()` stub was added in the 2026-07-13c clothing rewrite and was never added to that list.
- `scene_images.prompt_parts_json` is documented (~doc line 1068) as a stored column; it does not exist in `db.js` — `parts` is never persisted, only logged in-memory to `audit()`.
- The doc's Play-cast description ("live clothing, inline edit, reset to starting") could be read as implying a dedicated Clothing tab; a defensive migration line in `play.js` (`if (state.currentSidebarTab === 'clothing') ...`) confirms a tab used to exist and no longer does — doc should clarify clothing is inline per-NPC-card, not tabbed.
- `audit_this.md` itself (the audit brief) describes ComfyUI-era FaceID concepts (`preferredFaceWorkflow`, batch/batch-control2, workflow routing, ComfyUI input staging) that do not exist in this codebase's current A1111-only architecture — not a code/doc mismatch, but worth correcting the brief template for future audits of this project.

---

# 10. Fix Order

Each item below is scoped to a single function per this project's one-function-workflow discipline; do not bundle across rows.

1. **CF-1** (Critical) — story-enhancer clothing overwrite. Highest priority: affects the default/most-common image path. Fix scope: the Stage 2b call site in `image-pipeline.js` only.
2. **CF-2** (High) — FaceID reference not character-scoped. Second priority: wrong-face images are a visible, severe correctness failure. Fix scope: the `mainCharRef` resolution block only.
3. **CF-3** (High) — Prompt Preview stale clothing. Small, isolated fix in `prompt-preview.js`.
4. **CF-4** (High) — duplicate Character Editor payload builder. Route through the shared pipeline function or extract a shared module.
5. **CF-5** (Medium) — Character Editor JSON silent fallback + false success toast. Isolated to the save handler.
6. **CF-7** (Medium) — decide: implement multi-ref support, or remove the ref-count/order UI and document single-reference only.
7. **CF-8** (Medium) — delete dead Images-page reference UI code (or the file).
8. **CF-6, CF-9** (Medium/Low) — pure documentation fixes, no code risk, safe to do anytime; do not block on code fixes.
9. **CF-10, CF-11, CF-12** (Low) — cleanup pass; not urgent, no active bugs today.

---

# 11. Completion Check

- Clothing sets editable in UI? **YES** — CRUD/default/save/reload confirmed in `characters.js`, though raw-JSON edit path has a silent-failure bug (CF-5).
- Default clothing set selectable? **YES** — confirmed working.
- Scenario starting outfit selectable in UI? **YES** — confirmed persists and reloads correctly.
- Scenario edit preserves selected outfit? **YES** — confirmed.
- Runtime clothing is scenario-scoped only? **YES** — `scenario_character_state.current_clothing`, isolated from character base JSON.
- Runtime clothing never overwrites base clothing-set JSON? **YES** — confirmed via full write-path trace.
- Narrator reads runtime clothing first? **YES** — via `resolveScenarioClothingMap`/`buildPrompt`.
- Scene image generation reads runtime clothing first? **NO** — CF-1: story-enhancer overwrites it on the default path.
- Character-focused image generation reads runtime clothing first? **YES** — bypasses the Stage 2b enhancer bug entirely.
- Play UI reflects live clothing state? **YES** — WS `clothingupdate` confirmed wired.
- FaceID seed-image path works? **NO** — CF-2: reference image not tied to the character being generated.
- Batch FaceID path works? **N/A** — does not exist in this architecture.
- Batch-control2 path works? **N/A** — does not exist in this architecture.
- Reference image UI is wired to actual generation behavior? **NO** — Images page is dead code (CF-8); Character Editor ref-count/order UI has zero effect on generation (CF-7).
- Workflow routing is correct? **N/A** for ComfyUI-style routing (removed architecture); mode-based routing itself is correct except for FaceID's character-selection bug (CF-2).
- Image pipeline prompt order is correct? **PARTIAL** — correct at assembly time, then overwritten downstream for scene mode (CF-1).
- Master knowledge file updated accurately? **NO** — CF-6 schema contradiction, CF-9 stale stub list, `prompt_parts_json` doc/column mismatch.
