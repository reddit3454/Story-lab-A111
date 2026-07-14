# Visual Brief Extraction Design

**Date:** 2026-07-13  
**Status:** Implemented (2026-07-13h)  
**Approach:** Store `visual_brief` inside `turns.scene_card_json` (Approach 1)  
**Related:** Phase 9 scene-picker / story-enhancer; local-model prompt work 2026-07-13g

---

## 1. Job change (not storage change)

This is a **role / job change**, not merely a new field on the turn card.

| Before | After |
| --- | --- |
| "Summarizer" / scene-picker produced a prose moment or pick-and-summarize candidate | **Visual state extractor** produces structured, camera-visible state only |
| Image paths leaned on narrator `image_prompt` / `summary_plain` prose | **`visual_brief` is the primary source of truth** for scene-image focus and character-image prompt composition |
| Character preview re-summarized story via Ollama extractors | Character path **reads stored briefs** (or historical brief / generic fallback) — **no whole-scene prose summarization** |

**Explicit rules:**

1. **`visual_brief` replaces scene summarization for image generation.** Do not treat paragraph summaries as the main input to scene or character image prompts.
2. **`image_prompt` (and prose `summary_plain` used as image fodder) is legacy / migration fallback only.** Keep parsing and UI compatibility during the transition; do not invent new prose-summary LLM jobs for images.
3. The extractor runs **once per narrator turn** so later `[Img]` and character preview/gen **do not re-analyze** the scene.

---

## 2. Goal

After every successful narrator turn (after clothing application):

1. Call one schema-enforced local-model job (Ollama `format` + low temperature).
2. Store the result as `scene_card_json.visual_brief` on that turn.
3. Drive:
   - **Scene images** from `main_subject` + relevant supporting `character_briefs` + setting/camera context.
   - **Character images / preview** from the selected character’s brief + locked character description + resolved clothing + location (+ optional shot hint).

---

## 3. Storage

**Location:** `turns.scene_card_json.visual_brief` (nested object). **Exact runtime column name:** `scene_card_json` (snake_case on the `turns` row). Do not document or invent `scenecardjson` / camelCase column aliases. No new DB column in v1.

**Why:** Play and image pipelines already load the narrator turn’s scene card; clothing changes and mood already live here. Nesting keeps one read path.

**Ownership:**

| Field | Owner | Role for images |
| --- | --- | --- |
| `visual_brief` | Visual extractor (post-turn) | **Primary** image source of truth |
| `clothing_changes` / clothing resolution | Narrator + clothing service | Authoritative wardrobe (unchanged) |
| `mood`, `arousal_level`, NSFW triad | Narrator scene card | State / gates; not prose summary |
| `image_prompt` | Narrator (optional short line) | **Legacy fallback only** if `visual_brief` missing |
| `summary_plain` / `summary_tags` | UI / learning panel | Not primary image drivers; may mirror `moment_summary` for display |

---

## 4. Schema

```json
{
  "main_subject": "Jake",
  "moment_summary": "Jake stands on the coffee table yelling for attention",
  "setting_brief": "living room with couch and coffee table",
  "shot_hint": "medium wide",
  "character_briefs": [
    {
      "character_id": 12,
      "character_name": "Jake",
      "role": "main",
      "visible": true,
      "brief": "standing on the coffee table, arms raised, yelling for attention",
      "expression": "urgent",
      "attention": "toward the room"
    }
  ]
}
```

### Field contracts

| Field | Required | Notes |
| --- | --- | --- |
| `main_subject` | yes | Prefer a cast character name when possible (scene-image focus) |
| `moment_summary` | yes | One short camera-visible sentence — **not** a story paragraph |
| `setting_brief` | yes | Place + concrete anchors |
| `shot_hint` | optional | e.g. close-up, medium, medium wide, wide |
| `character_briefs` | yes (array; may be empty only if no one is visually relevant — rare) | **Sparse on purpose** |

### `character_briefs[]` item

| Field | Required | Notes |
| --- | --- | --- |
| `character_name` | yes | Match cast when possible |
| `character_id` | when resolvable | Server fills/overlays by name→cast id after model response; model may omit |
| `role` | yes | `main` \| `support` \| similar short enum |
| `visible` | yes | boolean |
| `brief` | yes | Short practical visual/action state (pose + action + attention) |
| `expression` | optional | short |
| `attention` | optional | where gaze/attention goes |

### Inclusion rule (mandatory)

**Only include characters in `character_briefs[]` if they are visible, directly involved, or contextually relevant to the current moment.**  
Do **not** force every scenario cast member into every turn brief.

### Post-process (server)

After JSON parse:

1. Resolve `character_id` from cast by case-insensitive name match when missing.
2. Drop briefs that cannot map to cast **only if** product policy requires — default: keep unmapped name with `character_id: null` for debug, but image path prefers id-matched entries.
3. Ensure `main_subject` prefers a name present in `character_briefs` when possible.

### Legacy aliases (migration helpers)

Consumers may map during transition:

- `setting_brief` → former `setting`
- `shot_hint` → former `shotType`
- main / moment line → former `visibleAction` / prose `image_prompt` consumers

These aliases are compatibility shims, not a second source of truth.

---

## 5. When the extractor runs

**Hook:** `src/routes/turns.js` after:

1. Narrator response parse  
2. Turn row insert with scene card  
3. `applyClothingChanges`  

Then:

1. Build extractor input: this turn's `content_text`; cast `{id,name}` with **resolved current clothing** per character (from `getScenarioClothing` / `resolveScenarioClothingMap` **after** clothing application); location name/tags; NSFW flag.
2. Call extractor (`format` schema + `temperature ≈ 0.1`).  
3. Merge `visual_brief` into that turn’s `scene_card_json` and UPDATE the turn.  
4. Failures: log; leave card without brief (image path uses fallback below). Never fail the turn HTTP response solely because extraction failed.

**Model config:** Prefer `picker_model`, else `prompt_extractor_model`, else `narrator_model` (same family as existing advisory LLMs).

---

## 6. Scene image generation

**Source of truth:** `visual_brief` on the target turn (the turn whose `[Img]` was clicked, else the latest narrator turn). Loaded from that turn's `scene_card_json.visual_brief`.

**Primary subject / FaceID:** `visual_brief.main_subject` is the **primary subject for scene-image focus** and the **first priority for FaceID / reference image selection** (via existing `resolvePrimaryCharacterForReference` / `mainSubject` handoff). Prefer an id-resolved cast member whose name matches `main_subject`.

Also use:

- That subject's `character_briefs[]` entry + other **included** supporting briefs
- `setting_brief`, `shot_hint`
- Resolved scenario clothing (unchanged)
- Existing enhancer / prompt-builder as composers — **fed by brief fields**, not by re-summarizing story

**Do not** call live scene-picker at generate time when `visual_brief` is present.

**Fallback if brief missing (migration only):** one extract attempt **or** narrator `image_prompt` / deterministic builder. `image_prompt` is **legacy fallback only**, not a parallel SoT.

## 7. Character image / preview generation

For selected character `C` (fallback chain **exactly**: current-turn brief → prior brief → generic from character description + clothing + location + simple pose):

1. **This turn:** entry in `visual_brief.character_briefs` matching `character_id` or name.  
2. Else **history:** walk prior narrator turns newest→oldest; use first matching brief.  
3. Else **generic (no LLM scene summary):** locked character description (character page) + resolved current clothing + location card + simple generic pose.

Also attach optional `shot_hint` / setting from the **turn that supplied the brief** (or current location if generic).

**Do not** call `extractCharacterPlainSummary` / character tag Ollama paths when a stored brief is available. Those extractors become **fallback-only** (legacy), same status as image_prompt.

---

## 8. Narrator scene card

- Keep slim machine card (mood, arousal, NSFW triad, clothing_changes).  
- Further shrink or de-emphasize long `image_prompt` prose: optional short line OK; **not** primary for images.  
- UI may display `visual_brief.moment_summary` instead of treating `summary_plain` as the image brief.

---

## 9. Module layout

| Module | Responsibility |
| --- | --- |
| `src/services/scene-picker.js` *or* new `visual-brief.js` | Schema, system prompt, `extractVisualBrief()`, parse/normalize, `resolveCharacterBrief({ character, turns })` |
| `src/routes/turns.js` | Invoke extract + persist after clothing |
| `src/services/image-pipeline.js` | Compose scene prompts from `visual_brief`; skip live pick when present |
| `src/services/prompt-preview.js` | Character preview composition from stored brief |
| `src/services/prompt-extractor.js` | Prefer brief; demote story→tags/plain extractors to fallback |
| `src/services/prompt-resolution.js` | Resolve primary FaceID subject from `main_subject` / brief |
| `src/services/narrator.js` | Optional image_prompt wording pass as legacy |
| `src/services/ollama.js` | Already: `format` + options |

Rename: prefer exporting `extractVisualBrief` as the real name; keep `pickBestMoment` as thin deprecated wrapper only if tests/callers need a bridge during migration.

---

## 10. Out of scope

- Memory/plot auto-summarizer (continuity) — unchanged  
- Rebuilding learning exemplar system around briefs (may ingest `moment_summary` later)  
- New DB table / column for briefs in v1  
- Requiring NSFW sex-act fields inside `visual_brief` (use narrator card when needed)

---

## 11. Tests (required)

- Schema builder / parse rejects empty moment or invalid shape  
- Extractor request includes `format` + low temperature (fetch body assert)  
- Post-turn path writes `visual_brief` onto `scene_card_json` (route or service unit with mocked Ollama)  
- `character_id` filled when name matches cast  
- Sparse cast: brief omits uninvolved characters; consumer must not assume full cast  
- Character brief resolution: current → historical → generic (no Ollama)  
- Scene path uses `main_subject` from brief when present; does not call live picker  
- Legacy: missing brief still allows generate via `image_prompt` fallback  
- Docs: master knowledge + this spec language (job change; replaces summarization for images; image_prompt legacy)

---

## 12. Docs

Update `story-lab-a1111-master-knowledge.md`:

- Visual extractor role, storage path, image SoT  
- Job-change wording mirrored from §1  
- Test count after implementation  

---

## 13. Success criteria

- After a narrator turn, that turn’s card contains a usable `visual_brief` when the model is configured and Ollama succeeds.  
- Scene `[Img]` focuses on `main_subject` + briefs + setting without a second analysis call.  
- Character chip preview uses selected character brief (or history/generic), not a new whole-scene summary.  
- Automated tests encode SoT + fallback + sparse inclusion rules.

---

## 14. Implementation order (for the plan)

1. Schema + `extractVisualBrief` + normalize (`character_id`) + resolve helpers  
2. Wire `turns.js` post-clothing  
3. Image-pipeline scene path  
4. Character preview / character image path  
5. Demote prompt-extractor character LLM to fallback  
6. Narrator image_prompt legacy note / slim  
7. Master knowledge + tests  
