# Pose Library — What Was Done Automatically, and What You Do Manually

**Date:** 2026-07-15  
**Library root:** `H:\MEDIA\Model_pose_reference`  
**Catalog output:** `H:\MEDIA\Model_pose_reference\catalog\`

This document explains, in plain English, how the pose library is set up for Story Lab, what the computer already finished for you, and exactly which steps only you can (or should) do by hand.

---

## 1. Big picture (one paragraph)

Story Lab will use poses as **body-layout guides** for Automatic1111 ControlNet (OpenPose / structure maps), alongside FaceID for faces. Your folder is large and only partly sorted. We built a **catalog index** so the app can list, filter, and load poses without crawling every file at runtime. Skeletons and line drawings are preferred; raw photos alone are weaker until converted. A standing / sitting / lying skeleton is usually **not** NSFW or SFW by itself — the **scene** decides that. Only poses that clearly depict sexual acts get tagged NSFW.

---

## 2. Ratings: SFW, NSFW, and Contextual

| Rating | Meaning |
|--------|--------|
| **sfw** | Explicitly filed under Structure/SFW or REG_POSES |
| **nsfw** | Explicitly filed under Structure/NSFW, NSFW_* folders, or filename clearly sexual |
| **contextual** | Unlabelled / openpose mix — **body pose only**. Usable in safe or adult scenes; content comes from prompt, FaceID, clothing, and story |

When the app’s master NSFW setting is **off**, the API shows **sfw + contextual** and hides **nsfw** entries. You do **not** need to tag every sitting/standing pose as SFW or NSFW.

---

## 2b. App integration status (Phase A/B/C - 2026-07-15)

Story Lab Pose Control is wired end-to-end:

1. Settings Image Generation Pose Control (enable, OpenPose model, weight/end, ready-only default, auto-suggest, auto-apply).
2. Play Image Prompt panel: pose grid, Suggest button, Suggested chips from scene card / body_positions.
3. Generation sends optional pose_id; ControlNet order is pose then FaceID.
4. Fail-open: if the pose model or asset is missing, the image still generates without pose; Play toasts and audits record the skip reason.

You still need Manual Step A (A1111 sees the ControlNet model) before pose guidance will actually apply.

## 3. What was done automatically (already completed)

These steps needed no further action from you:

1. **Scanned** the pose library (ignored Python/.venv junk under Structure and LineArt).
2. **Grouped** related files (bone structure + depth + lineart + source photo) into ~**1,687** pose entries.
3. **Chose a preferred ControlNet map** per pose: bone → lineart → depth → source.
4. **Moved 26 loose root images** (reading, sleeping, drinking, etc.) into `source\unfiled\`.
5. **Archived 33 duplicate “- Copy” files** into `_archive\duplicates\` (originals removed from active folders; recoverable from archive).
6. **Wrote catalog files:**
   - `catalog\manifest.json` — full detail  
   - `catalog\manifest.app.json` — lighter file for the API  
   - `catalog\README.md` — short usage notes  
7. **Wired Story Lab:**
   - `GET /api/poses` (filters: category, zone, ready, search; NSFW-aware)  
   - `GET /api/poses/:id` and `/api/poses/:id/asset`  
   - Static files at `/pose-assets/...`  
8. **Rebuild command:** from the project folder run:
   ```bat
   npm run pose:catalog
   ```
   (Organizes root files, archives new `- Copy` dupes, merges OpenPose JSON, rewrites the manifest.)

**Current snapshot (after last rebuild):**

| Metric | Count |
|--------|------:|
| Catalog entries | 1,687 |
| Ready for ControlNet (bone/lineart already exist) | 725 |
| Source-only (need conversion or live OpenPose) | ~962 |
| Contextual | 870 |
| NSFW | 669 |
| SFW | 148 |
| Categories | ~22 |

---

## 4. Manual steps (only you / longer tools)

Do these when you want a better library. Order is recommended; none are required before we start app integration of the **ready** 725 poses.

### Step A0 - Fix AlwaysOn ControlNet script registration  *(required - your current 422)*

Live A1111 check (2026-07-15): `/controlnet/model_list` works and FaceID IP-Adapter models appear, but `/sdapi/v1/script-info` has **no** AlwaysOn script named `controlnet` (only `controlnet m2m`). Story Lab submits `alwayson_scripts.controlnet`, so A1111 returns `Script 'controlnet' not found`.

Also: Settings -> ControlNet -> Models directory is currently `E:\ComfyUI\models\ipadapter`. That is why you only see FaceID models. OpenPoseXL2 is already on disk at:

`E:\ComfyUI\models\controlnet\controlnet-openpose-sdxl-1.0\OpenPoseXL2.safetensors`

Do this:

1. In A1111 WebUI -> Settings -> ControlNet: set models directory to `E:\ComfyUI\models\controlnet` (or copy OpenPose + FaceID models into `K:\stable-diffusion-webui\models\ControlNet`).
2. Restart A1111 fully. Watch the console for `Error loading script: controlnet.py` - if that appears, the AlwaysOn script fails to load (API routes can still work).
3. Confirm AlwaysOn: open `http://127.0.0.1:7860/sdapi/v1/script-info` and find `{ "name": "ControlNet", "is_alwayson": true }`.
4. Confirm models: `http://127.0.0.1:7860/controlnet/model_list` lists OpenPose / Union and FaceID IP-Adapter.

Until step 3 is true, Story Lab will skip ControlNet (pose + FaceID) at preflight instead of 422-retrying.

### Step A — Confirm A1111 can see OpenPose ControlNet  *(~15 min)*

1. Start Automatic1111 with model folders pointing at your ComfyUI tree (checkpoints, controlnet, etc.).
2. Open the WebUI → verify ControlNet extension is installed.
3. Confirm `OpenPoseXL2.safetensors` (or Union SDXL) appears in ControlNet model list.
4. Optional smoke: one generation with a `*_bone_structure.png` as ControlNet Unit 0, module “none” / openpose if using preprocessed image.

**Why:** Story Lab still talks to A1111, not ComfyUI. Models on disk are useless if A1111 cannot load them.

### Step B — Batch-convert source-only photos to bone/depth maps  *(best quality upgrade)*

1. Open `H:\MEDIA\Model_pose_reference\Structure\image_converter\` (your existing converter app — `start.bat` / `app.py`).
2. Point it at folders heavy on **source** images:
   - `source\unfiled\`
   - `Structure\SFW\Standing`, `Sitting`, `Action`, `Dancing`
   - leftover loose photos under `openpose + depth\` that are JPGs, not maps
3. Enable **structure (bone)** at minimum; **depth** is nice to have.
4. Save outputs into matching `Structure\SFW\...` or `Structure\NSFW\...` categories (or a new `Structure\CONTEXTUAL\` if you prefer).
5. From Story Lab project folder run: `npm run pose:catalog`.
6. Check that “Ready (preprocessed)” count went up in `catalog\README.md` / console output.

**Why:** Pre-drawn skeletons are faster and more reliable than asking A1111 to detect pose from a photo every generation.

### Step C — Optionally sort the flat `openpose + depth` folder  *(cleanup)*

1. Browse `openpose + depth\`.
2. Move **clearly sexual** maps into `Structure\NSFW\...` (posing, lying, etc.).
3. Leave neutral standing/sitting/lying maps where they are **or** move them under Structure without forcing an NSFW label — they stay **contextual** in the catalog.
4. Re-run `npm run pose:catalog`.

**Do not** feel obligated to label every pose SFW/NSFW.

### Step D — Fill empty / thin categories  *(optional content)*

Add or generate poses for folders that are empty or nearly empty:

- `NSFW_Kneeling` (empty)
- `Structure\SFW\Kneeling` (empty)
- `Structure\SFW\Interacting` (empty)
- top-level `lying` (empty)

Then run `npm run pose:catalog`.

### Step E — Spot-check catalog quality  *(~20 min)*

1. Start Story Lab (`npm start`).
2. Call (or open in browser):
   - `http://127.0.0.1:4090/api/poses?ready=1`
   - `http://127.0.0.1:4090/api/poses?category=sitting&ready=1`
3. Open a few `/api/poses/<id>/asset` URLs — confirm you see skeleton/lineart, not garbage.
4. With NSFW **off** in Settings, confirm sexual-named poses are hidden; contextual still appear.

### Step F — Do **not** manually delete  *(unless you mean to)*

- `_archive\duplicates\` — keep until you confirm copies were useless.
- `Structure\image_converter\.venv` — tool environment; catalog already ignores it.
- The catalog folder itself — regenerate with `npm run pose:catalog` instead of hand-editing JSON unless you know what you are doing.

---

## 5. Folder map (how to think about the tree)

| Path | Role |
|------|------|
| `Structure\SFW\|NSFW\` | Best organized; many bone+depth pairs |
| `LineArt\` | Line-art control maps (good for ControlNet) |
| `openpose + depth\` | Flat dump; mostly **contextual** until resorted |
| `NSFW_*` top-level buckets | Explicit categories (sitting, suspended, etc.) |
| `source\unfiled\` | Former root loose photos |
| `catalog\` | Machine index for Story Lab |
| `_archive\duplicates\` | Moved “- Copy” clutter |

---

## 6. Rebuilding after you change files

Whenever you add poses, move folders, or run the converter:

```bat
cd /d E:\TheHub\projects\Story-lab-A111
npm run pose:catalog
```

Restart Story Lab if it was already running so it reloads the new manifest (or it reloads on file mtime when the catalog service is hit).

---

## 7. What is **not** done yet (app feature)

Catalog + API exist. The Play UI **pose picker**, Settings toggles for ControlNet pose weight, and dual ControlNet (FaceID + pose) in the image pipeline are **not** shipped yet. That work is in the implementation plan:

`docs/superpowers/plans/2026-07-15-pose-controlnet-integration.md`

---

## 8. Quick decision guide

| Goal | Do this |
|------|--------|
| Use poses soon with least effort | Rely on the **725 ready** entries; skip Steps B–D for now |
| Better coverage / quality | Step B (converter batch) |
| Cleaner ratings | Step C (optional) |
| Ship feature in Story Lab | Follow the implementation plan (settings → pipeline → Play UI) |
