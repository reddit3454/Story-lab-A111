# Story-Lab-A1111 — AI Assistant Guidance
# Status: ACTIVE — Port: 4090 — Last updated: 2026-06-11

Location: E:\TheHub\projects\Story-lab-A111
Master knowledge: story-lab-a1111-master-knowledge.md (read this first for full context)

---

## Critical Rules

1. ESM only — "type": "module", import/export throughout, never require().

2. Database: node:sqlite DatabaseSync (Node 22.5+), NOT better-sqlite3.
   Additive migrations: each ALTER TABLE in its own try { db.exec(...) } catch (_) {}.

3. No new npm dependencies. Core stack: express, ws, cors only.

4. Fire-and-forget image generation: pipeline.generate() is always called with .catch()
   at the call site. HTTP response returns immediately; image arrives via WebSocket.
   Exception: generate-background route is blocking (awaited) so the route can update
   the location row immediately after file creation.

5. broadcast.js is a singleton — never create a second WebSocket server.

6. No GPU calls in the Node backend. A1111 owns the GPU; all calls are plain HTTP.

7. Do NOT modify files in E:\TheHub\projects\story-lab — it is the original, read-only reference.

8. DB_PATH = H:\MEDIA\Story_Lab\data\story-lab.db (defined in src/paths.js — do not hardcode).

9. CLIP skip 2 is always set via override_settings.CLIP_stop_at_last_layers — never omit.

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
     // STUB: <what it is supposed to do> — NOT FUNCTIONAL
   This comment must be on the function/route definition line, not buried inside.

3. Every stub must be listed in the Known Stubs section of this file AND in the
   "Known Stubs and Unimplemented Features" section of the master knowledge doc.

4. When answering "is X implemented?":
     - Working code exists = IMPLEMENTED. Say yes.
     - Stub present = NOT IMPLEMENTED. Say: "A stub exists but is not functional."
     - File absent = NOT IMPLEMENTED. Say: "The file does not exist yet."
   NEVER report a stub or an absent file as implemented.

### Known Stubs (as of 2026-06-11)

No stubs in the current codebase. Planned features are ABSENT from disk entirely —
they are not stubbed. "File does not exist" is not the same as "stub exists."

Services that do not exist on disk (no file, no code, no stub):
- src/services/extractor.js — NOT PRESENT (narrator writes scene block inline)
- src/services/enhancer.js — NOT PRESENT (prompts assembled deterministically)
- src/services/clothing.js — NOT PRESENT (current_clothing flat string used directly)
- src/routes/styles.js — NOT PRESENT

Phase 5 (frontend wiring) — COMPLETE (2026-06-11).
See master knowledge doc Phase 5 section for full change log.
