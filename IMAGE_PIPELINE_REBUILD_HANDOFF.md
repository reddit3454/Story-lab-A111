# Image Pipeline Rebuild — Handoff

Status as of 2026-07-20 (full verification pass): **Working end-to-end.** Wiring gaps found
and fixed. Tests **87/87**. Scratch boot :4097 clean. A1111 up/down soft-fail verified.
Live generate + accept/rate/delete + list verified on :4097.

---

## Wiring matrix (verification result)

| UI control | Client | Route | Backend | Result |
| --- | --- | --- | --- | --- |
| Play image panel open | — | — | — | WIRED |
| Play Look select | `activateLook` | `POST /api/looks/:id/activate` | `image_looks` | WIRED (+ activate-before-generate) |
| Play mode / char / action / Generate | `generateImage` | `POST .../images/generate` | `image-pipeline` → `scene_images` | WIRED |
| Play load existing images | `getImages` | `GET .../images?turnId=` | `scene_images` | **FIXED** (was MISSING UI) |
| Play Accept / + / − / Delete | accept/rate/deleteImage | PUT/DELETE | `scene_images` | WIRED |
| Play `imageready` WS | `location.host` WS | broadcast `{type,payload}` | `image-pipeline` | WIRED |
| Settings A1111 status | `getHealthA1111` | `GET /api/health/a1111` | `a1111.checkHealth` | WIRED |
| Settings Looks CRUD/activate | looks API | `/api/looks/*` | `image_looks` | WIRED |
| Settings FaceID config | `getConfig`/`setConfigs` | `/api/config` | `a1111_faceid_*` | WIRED |
| Characters FaceID upload/clear | set/clearCharacterFaceRef | face-ref | `reference_image_path` | WIRED |
| API `BASE_URL` | fetch | same origin | — | **FIXED** (was hardcoded `:4090`) |
| Narrator auto-generate | — | — | — | ABSENT (correct) |
| Location background img2img UI | — | — | `background_image_path` col exists | intentional no UI (pipeline-ready) |
| Unused A1111 catalog client helpers | getModels/Loras/… | routes exist | — | unused helpers only (not blocking) |

---

## Fixes this verification pass

1. **Play panel did not call `getImages`** — opening a turn image panel now loads existing
   `scene_images` for that turn into `.turn-image-result`.
2. **Look select race** — Generate now `activateLook`s the panel selection before
   `generateImage` (no longer relies only on the async change handler).
3. **`public/js/api.js` hardcoded `http://localhost:4090`** — now same-origin (`BASE_URL = ''`)
   so scratch ports and restarts keep UI ↔ API aligned (WS already used `location.host`).

---

## Runtime results (PORT 4097)

| Check | Result |
| --- | --- |
| Clean boot + looks/active JSON | PASS |
| A1111 UP health | PASS |
| A1111 DOWN (url → :17999): health structured `ok:false` | PASS |
| A1111 DOWN: generate `502 {ok:false,error}` + zero new DB rows | PASS |
| Live generate scene + snapshot fields | PASS |
| GET images lists row | PASS |
| Accept / rate / delete | PASS |
| Portrait empty `characterIds` → `got 0` | PASS |
| Prompt-builder unit tests | 11/11 |
| Full `npm test` | **87/87** |

On-command only, Look lock, Style→Character→Action→Location+clothing, style strip: intact
(covered by existing unit/route tests + live look activate path).

---

## Residual risks (real only)

- Long-lived process on **:4090** may still be an older binary — restart from current tree to
  pick up Play/API fixes. Prefer hard refresh after restart.
- Location `background_image_path` enables img2img in the pipeline but has no Settings/Locations
  upload UI yet (column + pipeline path only).
- Unused `getA1111Models` / Loras / Samplers / `setA1111Model` client helpers are unused by UI
  (routes exist); not required for generate (checkpoint comes from Look/config-resolver).

---

## How to run

```bash
npm test
set PORT=4097
node --experimental-sqlite src/server.js
```

See `VERIFY.md` for checklist + this pass's results.

---

## Play layout note (2026-07-20)

Image generation UI moved out of per-turn cards into a **page-level right sidebar**
(`#play-image-sidebar`). Story/narration column stays full width. Selected turn is marked
with `.is-image-selected` only (no card width change). State: `state.imageGen`.

