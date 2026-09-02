# Image Tools — Prompt Lab (deferred)

Date: 2026-07-14  
Status: Planned — **Test Zone implemented first**; Prompt Lab UI stubs remain.

## Locked decisions (from brainstorm)
- Hybrid C: Test Zone = Sandbox | Live Config; Prompt Lab Send = story pipeline when scenario open.
- Prompt Lab keeps planned behavior:
  1. Load Last Story Prompt → latest `scene_images.prompt_used` for active scenario
  2. Image Profile select → `GET /api/profiles` (rename off “Style”)
  3. Enhance → `POST /api/prompt-lab/enhance` → `story-enhancer.buildSdxlPrompt`
  4. Send to A1111 → scenario `images/generate` with `directPrompt` + `rawPrompt` (rename off ComfyUI)
  5. Save as Style Prefix → `POST /api/profiles` with `prompt_prefix`

## Test Zone shipped
- `POST /api/a1111/txt2img-test` + `src/services/test-zone.js`
- UI: `public/js/views/image-tools-testzone.js` (Sandbox / Live, full options)
