# Story-Lab - AI Assistant Guidance
# Status: ACTIVE - Port: 4090 - Last updated: 2026-09-02

Location: E:\TheHub\projects\Story-lab-A111
Master knowledge: story-lab-a1111-master-knowledge.md (read this first for full context)
Rebuild handoff: IMAGE_PIPELINE_REBUILD_HANDOFF.md
Manual verify checklist: VERIFY.md

Image generation was purged on 2026-07-19, then rebuilt from a clean slate (2026-07-19/20).
The live stack is A1111-direct (port 7860) with Looks as the only style source. Do not
reintroduce ComfyUI, ImageCore, legacy styles/image_profiles, or dual style systems.

---

## Critical Rules

1. ESM only - "type": "module", import/export throughout, never require().

2. Database: node:sqlite DatabaseSync (Node 22.5+), NOT better-sqlite3.
   Additive migrations: each ALTER TABLE in its own try { db.exec(...) } catch (_) {}.

3. No new npm dependencies. Core stack: express, ws, cors only.

4. broadcast.js is a singleton - never create a second WebSocket server.

5. Do NOT modify files in E:\TheHub\projects\story-lab - it is the original, read-only reference.

6. DB_PATH = H:\MEDIA\Story_Lab\data\story-lab.db (defined in src/paths.js - do not hardcode).
   IMAGES_DIR = H:\MEDIA\Story_Lab\images (generated + FaceID reference files).

7. Image generation is on-command only. Never auto-generate on narrator turn advance.
   Single orchestrator: `src/services/image-pipeline.js` for scene / portrait / fullbody.
   Prompt order every time: Style (active Look) -> Character + FaceID -> Action -> Location + clothing.
   Content stages must strip style words (`prompt-builder.stripStyleWords`). Exactly one active Look.
   Soft-fail when A1111 or FaceID/ControlNet is unavailable (clean HTTP error / skip FaceID, no crash).

8. Scene state (mood / arousal / clothing changes) is NOT self-reported by the narrator.
   The narrator writes prose only; `src/services/scene-state.js` `extractSceneState()` makes
   one focused Ollama call over the finished prose (flat, fully-required schema; model
   `config.scene_state_model`, default `qwen2.5:7b-instruct` - a text instruction model,
   never the RP narrator model, never a vision model). `turns.js` builds `scene_card_json`
   from it and caps per-turn arousal movement to +/-3. Verified 2026-09-01: the RP narrator
   silently stops emitting an appended JSON block once context fills. Do NOT re-add a
   `buildSceneCardInstruction()` / `---SCENE---` block to the narrator prompt.

9. Never make a menu option that requires the user to hand-type a specific file name.
   For checkpoints, VAEs, LoRAs, ControlNet models/preprocessors, workflows, or any other
   installed/service-provided asset, load a verified runtime catalog and present a dropdown.
   If valid choices depend on one another, present only verified compatible pairs. Do not
   guess filenames or silently replace a saved value when a catalog is unavailable; show a
   clear unavailable or legacy-config state instead.

10. Performance and inference-boundary rules are mandatory:
    - Never add an LLM call, image job, model warm-up, catalog probe, or other slow remote/local
      operation to the user-visible narrator-turn response without a measured before/after latency
      result and explicit user approval. Secondary state work must be asynchronous unless the
      user explicitly accepts its latency as a hard prerequisite for returning the turn.
    - Every background model job needs a named trigger, an opt-in/configurable enable switch, a
      timeout, one bounded retry policy (or none), an observable result/failure state, and a
      fallback that leaves the primary interaction usable.
    - A launcher must not automatically start a GPU-heavy inference service merely because it is
      installed. Start only the backend selected by current configuration, or require an explicit
      user launch. Document GPU/VRAM ownership whenever A1111, llama.cpp, and Ollama can coexist.
    - A client timeout for A1111 must not orphan a server-side generation. The implementation must
      either wait through a verified compatible timeout, interrupt the A1111 job, or surface that
      the job is still running and prevent duplicate submissions.
    - Do not add fire-and-forget warm-ups until a real live request succeeds. Failed warm-ups must
      be rate-limited, visible in the UI/audit trail, and disabled after failure rather than retried
      on every user interaction.
    - Tests must direct logs and audit output to test-local temporary paths. Never pollute
      `H:\MEDIA\Story_Lab\data\audit.jsonl` with mocked test traffic.
    - Before calling a performance-sensitive feature complete, verify live p50/p95 latency for its
      exact trigger and report the narrator, secondary-model, and A1111 durations separately.

---

## Image pipeline (current)

| Piece | Path / route |
| --- | --- |
| A1111 client | `src/services/a1111.js` -> `/api/a1111/*`, `GET /api/health/a1111` |
| Looks (style lock) | `image_looks` table, `src/routes/looks.js`, Settings -> Image Generation |
| Character FaceID | `characters.reference_image_path`, `POST/DELETE /api/characters/:id/face-ref` |
| Prompt assembly | `src/services/prompt-builder.js` |
| Orchestrator | `src/services/image-pipeline.js` -> `POST /api/scenarios/:id/images/generate` |
| Static images | `/story-images/*` -> IMAGES_DIR |
| UI | Play turn image panel; Settings Looks + FaceID; Characters FaceID upload |

Config keys (global_config): `a1111_url`, `a1111_steps/cfg/width/height/sampler/scheduler/checkpoint`,
`a1111_faceid_model` (empty = FaceID off), `a1111_faceid_module`, `master_negative`.

---

## Stub and Placeholder Code Rule

THIS RULE IS NON-NEGOTIABLE. Violating it causes false "yes it's implemented" answers
that corrupt the user's mental model and break downstream work.

A stub is any code that is present but does not perform its stated job:
empty function body, "return TODO", route that returns 200 with no real work,
service that logs a message but calls nothing.

Rules:

1. Stubs are LAST RESORT ONLY. Write them only when there is genuinely no other option.

2. When a stub is unavoidable, mark it unmistakably in source:
     // STUB: <what it is supposed to do> - NOT FUNCTIONAL
   This comment must be on the function/route definition line, not buried inside.

3. Every stub must be listed in the Known Stubs section of this file AND in the
   "Known Stubs and Unimplemented Features" section of the master knowledge doc.

4. When answering "is X implemented?":
     - Working code exists = IMPLEMENTED. Say yes.
     - Stub present = NOT IMPLEMENTED. Say: "A stub exists but is not functional."
     - File absent = NOT IMPLEMENTED. Say: "The file does not exist yet."
   NEVER report a stub or an absent file as implemented.

### Known Stubs (as of 2026-07-20)

| Stub | Location | Notes |
| --- | --- | --- |
| `resolveClothing()` | `src/services/clothing.js` | Marked `// STUB: layered resolve unused...`. Unused; scenario runtime uses `applyClothingChanges` + `getScenarioClothing`. |

Planned features that are ABSENT from disk entirely are not stubs. "File does not exist" is not the same as "stub exists."

Services / routes that do not exist on disk (no file, no code, no stub):
- src/services/extractor.js - NOT PRESENT. Scene state now comes from
  `src/services/scene-state.js` `extractSceneState()` (post-turn call over the prose),
  NOT an inline narrator block (removed 2026-09-01, see Critical Rule 8).
- src/services/enhancer.js / story-enhancer.js - NOT PRESENT
- src/routes/styles.js - NOT PRESENT (Looks replaced legacy styles)

Removed 2026-09-01: `processEmotionalUpdateAfterTurn` + `EMOTION_JSON_SCHEMA` (the separate
mood/arousal delta call). Replaced by `applySceneStateToCharacters()` fed from
`extractSceneState()`. `relationship_deltas_enabled` is now dormant (no producer).
