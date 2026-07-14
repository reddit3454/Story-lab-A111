# Visual Brief Extraction Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Replace image-oriented scene summarization with per-turn structured `visual_brief` stored on `turns.scene_card_json`, driving scene and character image composition without image-time re-analysis.

**Architecture:** New `src/services/visual-brief.js` extracts schema JSON via Ollama `format` after clothing apply in `turns.js`. Image pipeline and prompt-preview read stored briefs; `image_prompt` is legacy fallback only. Character brief resolution: current-turn brief -> prior brief -> generic (no LLM).

**Tech Stack:** Node 22+, Express, Ollama `/api/chat` with `format`, existing `node:test`.

## Global Constraints

- Exact column name `scene_card_json`; nested key `visual_brief`
- Job change: visual extraction replaces summarization for images
- `image_prompt` legacy fallback only
- Include resolved clothing in extractor input
- `main_subject` = scene focus + FaceID priority
- Sparse `character_briefs` (no force full cast)
- Dependency-free; update master knowledge

---

### Task 1: `visual-brief.js` core + unit tests

- [x] Schema, normalize, attachCharacterIds, resolveCharacterBriefFromTurns, composeSceneDescriptionFromBrief, extractVisualBrief
- [x] Tests for normalize, ids, fallback chain, format in fetch body

### Task 2: Wire `turns.js` post-clothing

- [x] After `applyClothingChanges`, extract + merge into card + UPDATE `scene_card_json`
- [x] Do not fail the turn on extract failure

### Task 3: `image-pipeline.js` scene + character paths

- [x] Prefer stored brief; skip live picker when present
- [x] `main_subject` -> FaceID `mainSubject`
- [x] Character mode: brief chain before summary_plain/image_prompt/generic

### Task 4: `prompt-preview.js`

- [x] Character preview from stored/history brief + appearance + clothing + location; generic if none
- [x] Scene preview surfaces `moment_summary` when present

### Task 5: Docs + full test run

- [x] Master knowledge
- [x] `npm test` green
