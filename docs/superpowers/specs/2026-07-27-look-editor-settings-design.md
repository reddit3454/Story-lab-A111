# Look Editor — Comprehensive Settings + Test Generation — Design Spec
Date: 2026-07-27
Status: Approved

---

## Context

Story-Lab's image style is controlled entirely by "Looks" (`image_looks` table) — exactly one
Look is active at a time, and it is the sole source of style per `CLAUDE.md` rule 6. Today the
Look editor (Settings → Image Generation → Looks) only exposes a small subset of what A1111
can actually control:

- Checkpoint — free-text input ("exact filename")
- 2 fixed LoRA slots — free-text file names
- Prompt prefix / suffix / negative
- Steps / CFG / Sampler — optional overrides; if blank, fall back to master `global_config`
  keys (`a1111_steps`, `a1111_cfg`, `a1111_sampler`)

Width, height, and scheduler have **no UI at all** — they are hardcoded fallbacks inside
`config-resolver.js` (832×1216, Karras) with matching but likewise UI-less `global_config`
seed rows. VAE, clip skip, restore faces, and tiling are not configurable anywhere. The
sampler dropdown is a hardcoded static list, not fetched from A1111, despite the backend
already exposing `/api/a1111/samplers`, `/loras`, `/models`, `/schedulers` catalog endpoints
that no frontend code currently calls.

There is also no way to preview a Look's output before committing to it — a user must save a
Look, activate it, then generate a real scene image in Play to see what it looks like.

## Goals

- Turn the Look editor into a comprehensive settings menu covering every A1111 parameter that
  affects a generated image's look, matching what A1111 itself exposes.
- Every enum-like setting (checkpoint, VAE, LoRA files, sampler, scheduler) is a dropdown
  populated live from A1111 — never free text, per standing project convention.
- Add an in-editor test-generation area: generate sample images against the *current unsaved
  draft* of the settings, before deciding to save them as a Look.
- Test images are never saved to the permanent gallery/DB by default; a per-image "Save"
  button keeps a copy on disk.
- Move "save these settings as a new/updated Look" (Name, Description, Create/Save button) to
  the bottom of the editor, after the test area — matches the natural authoring flow of
  configure → preview → commit.

## Non-Goals

- Hires-fix (second-pass upscale) — explicitly deferred, out of scope for this pass.
- Any change to how a Look is *selected/activated* for real scenario generation, or to the
  Play-mode image pipeline's UI.
- Any change to `master_negative`, `a1111_url`, or FaceID config — these remain master-level
  per CLAUDE.md rule 6 (Looks may never override safety negatives or the connection URL).
- A gallery/history view of saved test images — "Save" just keeps the file on disk; no DB
  tracking, no browsing UI for them in this pass.

---

## 1. Schema changes — `image_looks` (additive only, no destructive migration)

This codebase's convention is additive-only migrations (`ALTER TABLE ... ADD COLUMN`, one per
`try {} catch {}`), and no existing column is ever dropped. New columns:

| Column | Type | Default | Meaning |
|---|---|---|---|
| `vae` | TEXT | `''` | blank = use A1111's currently loaded VAE |
| `clip_skip` | INTEGER | `NULL` | `NULL` = don't send an override |
| `restore_faces` | INTEGER (0/1) | `0` | |
| `tiling` | INTEGER (0/1) | `0` | |
| `loras_json` | TEXT | `'[]'` | `[{"file": "...", "strength": 1.0}, ...]` — dynamic list, replaces the 2 fixed slots for all new/edited Looks |
| `sampler` | TEXT | `'DPM++ 2M SDE'` | always concrete now (no more "blank inherits master") |
| `scheduler` | TEXT | `'Karras'` | new column — previously had no UI or per-Look storage at all |
| `steps` | INTEGER | `30` | always concrete |
| `cfg` | REAL | `7` | always concrete |
| `width` | INTEGER | `832` | new — previously master-only, no UI |
| `height` | INTEGER | `1216` | new — previously master-only, no UI |

`checkpoint` is unchanged (existing TEXT column). It stays optional: blank means "don't switch
models, use whatever is already loaded" — this is a deliberate, visible choice in the new UI
(a real dropdown option, not a hidden fallback table), so it still satisfies "full ownership."

**Old columns kept, deprecated:** `lora1_file`, `lora1_strength`, `lora2_file`, `lora2_strength`,
`steps_override`, `cfg_override`, `sampler_override`. No new code reads them after this change.

**One-time data migration** (idempotent, runs at startup like other `db.js` data migrations):
for every existing `image_looks` row where the new columns are still at their fresh-install
defaults, copy forward from the old columns:
- `steps_override`/`cfg_override`/`sampler_override` → `steps`/`cfg`/`sampler` (only if the old
  value is non-null; otherwise the new column keeps its hardcoded default, matching today's
  effective behavior exactly)
- `lora1_file`/`lora1_strength` + `lora2_file`/`lora2_strength` → merged into `loras_json` as
  up to two entries (skipping any with an empty file name)

**`default-look.js` updates:**
- `DEFAULT_LOOK` gains concrete values for every new field (`sampler: 'DPM++ 2M SDE'`,
  `scheduler: 'Karras'`, `steps: 30`, `cfg: 7`, `width: 832`, `height: 1216`, `vae: ''`,
  `clip_skip: null`, `restore_faces: 0`, `tiling: 0`, `loras_json: '[]'`) instead of relying on
  `null`-means-inherit-master.
- `_rowsMatchFingerprint` / `isUntouchedDefaultLook` grow to compare the new fields too, so a
  user who edits e.g. scheduler or resolution on the shipped default Look is correctly detected
  as "customized" and `_refreshUntouchedDefaultLook` won't silently stomp their change on next
  startup.
- `LEGACY_SEED_FINGERPRINTS` (Photoreal/Cinematic detection) is untouched — it only inspects
  the old override columns, which keep their current semantics.

**`global_config` seed data:** `a1111_steps`, `a1111_cfg`, `a1111_width`, `a1111_height`,
`a1111_sampler`, `a1111_scheduler`, `a1111_checkpoint` are removed from the `_imageDefaults`
seed list in `db.js` (dead weight once nothing reads them). `a1111_url`, `a1111_faceid_model`,
`a1111_faceid_module`, and `master_negative` are untouched — still master-level.

`src/__tests__/default-look.test.js` references the removed `global_config` keys directly and
will need updating as part of implementation (tracked in the plan, not re-litigated here).

---

## 2. Backend changes

### New A1111 service function + route
- `a1111.getVaes(baseUrl)` — `GET {baseUrl}/sdapi/v1/sd-vae`, same shape/error-handling pattern
  as `getModels`/`getLoras`.
- `GET /api/a1111/vaes` route, mirroring the existing `/models`/`/loras`/`/samplers` routes.
- `public/js/api.js` gains `getA1111Vaes()` and the missing `getA1111Schedulers()` wrapper
  (the backend route already exists; nothing currently calls it).

### LoRA prompt embedding
A1111's plain REST API has no dedicated "loras" payload field — LoRAs are applied by embedding
`<lora:filename:strength>` tags directly into the prompt text (Automatic1111 "extra networks"
convention). A new small helper (in `prompt-builder.js`, alongside the existing prompt assembly
logic) turns a Look's `loras_json` (or a test-draft's in-memory LoRA list) into a leading
` <lora:file:strength> <lora:file2:strength2> ...` string. Both the real `image-pipeline.js`
generation path and the new test-generate endpoint call this same helper — no duplicated logic.

### VAE / clip skip / restore faces / tiling in the actual A1111 call
- `restore_faces` and `tiling` are direct top-level boolean fields on the txt2img/img2img
  payload — added straightforwardly.
- VAE and clip skip are global A1111 *options*, not per-request payload fields in older
  versions — sent via the payload's `override_settings: { sd_vae, CLIP_stop_at_last_layers }`
  with `override_settings_restore_afterwards: true`, so a generation can use a specific
  VAE/clip-skip without permanently changing A1111's own settings for other callers.

### `config-resolver.js` — `resolveEffectiveConfig()` rewrite
The active Look (if any) now supplies every generation-affecting field directly. Hardcoded
literals (same numbers shipped today: 832×1216, Karras, 30 steps, CFG 7, DPM++ 2M SDE, no
checkpoint override, no VAE override, no clip skip, faces/tiling off) are used only when there
is no active Look at all — matching the existing "Look is a style overlay, not a hard
requirement" comment already in the code. `a1111_url` and `master_negative` continue to come
from `global_config` exclusively, per rule 6.

### `image-pipeline.js` payload construction
Extended to pull `vae`, `clip_skip`, `restore_faces`, `tiling`, and LoRA-tagged prompt text
from the (now fuller) `resolveEffectiveConfig()` output, in addition to the fields it already
sends (steps, cfg, width, height, sampler, scheduler).

### New test-generation endpoints (Look editor only — never touches `scene_images`)
- `POST /api/looks/test-generate` — body is the *entire current draft form state* (checkpoint,
  vae, clip_skip, restore_faces, tiling, loras, sampler, scheduler, steps, cfg, width, height,
  prompt_prefix, prompt_suffix, negative) plus a free-text `test_subject` string. Server builds
  `prompt = "<lora tags> {prefix} {test_subject} {suffix}"`, `negative = "{negative}, {master_negative}"`
  (server always appends `master_negative` itself — never client-supplied, consistent with the
  existing safety rule), runs one `a1111.txt2img()` call (seed -1, n_iter 1, batch_size 1),
  saves the result to a scratch folder (`IMAGES_DIR/_look-test-scratch/`), and returns
  `{ ok, filename, url, seed, generation_time_ms }`. Never inserts into `scene_images` or
  broadcasts a WS event — this is editor-local, not part of the scenario image pipeline.
- `POST /api/looks/test-generate/save` — body `{ filename }`; moves that file from the scratch
  folder into a permanent `IMAGES_DIR/look-test-saves/` folder (`fs.renameSync`). No DB row —
  purely "keep this file so scratch cleanup won't delete it."
- `POST /api/looks/test-generate/cleanup` — body `{ filenames: [...] }`; deletes each from the
  scratch folder if present. Called by the frontend when the editor closes (Cancel, successful
  Create/Save Changes, or navigating away from the tab), for every scratch file the user didn't
  explicitly save. Best-effort — a page reload/crash leaving an orphaned scratch file is an
  accepted minor edge case (no periodic sweep job in this pass).

Both new save-path folders are already reachable through the existing `/story-images/*` static
route since they live under `IMAGES_DIR`.

---

## 3. Look editor UI (`public/js/views/settings.js`, Settings → Image Generation → Looks)

`showLookEditor(look)` is restructured into these sections, top to bottom (Name/Description
move from the top to the bottom, per explicit request):

**1. Model & Rendering**
- Checkpoint — dropdown, live from `/api/a1111/models`; first option "— use currently loaded —"
  (value `''`, preserves today's pass-through behavior)
- VAE — dropdown, live from `/api/a1111/vaes`; first option "— use A1111 default —"
- Clip Skip — number input, range 1–12, blank = no override (not a fetchable enum, so a number
  input is correct here, not a dropdown)
- Restore Faces / Tiling — two toggle checkboxes

**2. LoRAs**
- Dynamic row list: each row is a dropdown (live from `/api/a1111/loras`) + strength number
  input + remove button; "+ Add LoRA" button appends a blank row

**3. Sampling**
- Sampler — dropdown, live from `/api/a1111/samplers` (replaces the current hardcoded
  `ITZ_SAMPLERS` list)
- Scheduler — dropdown, live from `/api/a1111/schedulers`; if the catalog call returns empty
  (older A1111 builds without a `/schedulers` endpoint — `a1111.getSchedulers()` already
  degrades to `[]` rather than throwing), fall back to a small static list (`Automatic`,
  `Karras`, `Exponential`, `Normal`, `Simple`, `SGM Uniform`) so the field stays usable
- Steps, CFG — number inputs (unchanged from today)
- Width / Height — two number inputs, plus a row of quick-preset buttons (832×1216 Portrait /
  1024×1024 Square / 1216×832 Landscape) that just fill the two fields — not a dropdown, since
  arbitrary custom resolutions are valid and A1111 doesn't expose a fixed enum of them

**4. Prompt**
- Prompt Prefix / Suffix / Negative — existing textareas, unchanged

**5. Test Generation**
- Editable "Test Subject" text field, defaulting to
  `"a woman standing in a park, full body"` (freely editable, not a placeholder)
- "Generate Test Image" button — POSTs the entire current (unsaved) form state via
  `/api/looks/test-generate`; disabled while a generation is in flight
- Results list — newest first, each entry shows the generated thumbnail, seed, generation time,
  and a "Save" button (which calls the save endpoint, then disables itself and shows "Saved");
  soft cap of ~12 visible results per session to avoid runaway memory
- On editor close (Cancel, successful Create/Save Changes, or leaving the Image Generation tab)
  the frontend calls the cleanup endpoint with every generated-but-not-saved filename

**6. Save as Look**
- Name, Description
- "Create Look" / "Save Changes" button (same validation as today — name required)
- "Cancel" button

The Looks list above the editor (Activate / Edit / Delete rows) is unchanged.

---

## Testing

- `src/__tests__/default-look.test.js` updated for the removed `global_config` keys and the
  expanded `DEFAULT_LOOK` fingerprint fields.
- `src/routes/__tests__/looks.routes.test.js` extended to cover the new columns round-tripping
  through create/update, and the new test-generate/save/cleanup routes.
- Manual verification: create a Look with a non-default VAE/clip-skip/LoRA/resolution, generate
  a test image, confirm the actual A1111 payload reflects every field; save the test image and
  confirm it lands in `IMAGES_DIR/look-test-saves/`; cancel without saving another test image
  and confirm it's removed from the scratch folder.
