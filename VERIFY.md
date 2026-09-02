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
