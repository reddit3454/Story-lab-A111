# Image Pipeline — Manual Verification Checklist

Run after boot from the **current tree**. Prefer scratch port if :4090 may be stale:
`PORT=4097 node --experimental-sqlite src/server.js`

## Boot + health

1. Clean boot (no `look_id` / `scene_images` SQL errors).
2. `GET /api/health` → `ok: true`.
3. `GET /api/health/a1111` → structured `ok` true/false (never a crash).
4. `GET /api/looks/active` → JSON Look object (not SPA HTML).

## Looks / FaceID / Play

5–7. Settings Looks: list, activate, exactly one active.
8–10. FaceID config save; character reference upload/clear.
11–17. Play panel: action, Look, mode, character (portrait/fullbody), Generate on-command only.
18–20. Card Accept / + / − / Delete.
21–22. Snapshot columns + style-word strip.
23–24. No auto-generate on narrator turn; no ComfyUI/ImageCore in live JS.

## Extra checks added in verification pass

25. Re-open a turn image panel → existing images for that turn load via `GET .../images?turnId=`.
26. Change Look in the panel and Generate immediately → new image uses that Look (activate-before-generate).
27. UI served from a non-4090 port still talks to that same origin (relative `API` base).

## Performance and model-boundary checks (added 2026-09-03)

28. Record separate durations for a normal narrator response, every synchronous secondary-model
    call, and the total HTTP turn response. Do not report only one combined duration.
29. Confirm a normal narrator turn remains usable while optional scene state, clothing extraction,
    memory, and image-action assistance are disabled or unavailable. A secondary backend failure
    must be shown as such and must not strand the primary turn.
30. With the selected startup configuration, inspect GPU memory before and after boot. Record which
    of A1111, llama.cpp, and Ollama owns GPU memory; do not assume they can run together without
    contention.
31. Submit one deliberately slow A1111 request. Confirm the application either completes it within
    the configured timeout or explicitly interrupts/tracks the A1111 job. After the client returns,
    `GET /sdapi/v1/progress` must not show an unreported orphaned job.
32. Trigger image warm-up once with the current live ControlNet configuration. A warm-up failure
    must be visible, must not repeat automatically on each interaction, and must not block manual
    image generation.
33. Run `npm test`, then confirm test traffic was written only to a test-local audit path and did
    not add mocked events to `H:\MEDIA\Story_Lab\data\audit.jsonl`.

---

## Full verification results (2026-07-20)

Server: **PORT 4097** (current tree). A1111: **UP** at `127.0.0.1:7860` for live generate;
soft-fail probed by temporarily setting `a1111_url` to `http://127.0.0.1:17999` then restoring.

| Check | Result |
| --- | --- |
| Boot + looks/active | PASS |
| health/a1111 UP | PASS |
| health/a1111 DOWN structured | PASS |
| generate while A1111 DOWN → 502, no new row | PASS |
| live generate + snapshots | PASS |
| GET images list | PASS |
| accept / rate / delete | PASS |
| portrait empty ids → got 0 | PASS |
| prompt-builder tests | 11/11 |
| full npm test | **87/87** |

### Gaps fixed during this pass

- Play now loads existing turn images (`API.getImages`).
- Generate awaits `activateLook` for the panel selection before calling generate.
- `api.js` `BASE_URL` is same-origin (was hardcoded to `:4090`).
