# Performance Regression Audit - 2026-09-03

## Scope

Read-only reassessment of the live Story Lab startup and the current source tree after the
2026-09-02 changes. No application code, configuration, service, or process was changed by this
audit.

## Measured facts

- The current database has `scene_state_enabled=true` and
  `scene_state_model=qwen2.5:7b-instruct`.
- A real 2026-09-03 turn logged a llama.cpp narrator request of 18,714 ms followed by a
  synchronous scene-state Ollama request of 12,778 ms. The narrator turn could not be returned
  until both completed, adding at least 12.8 seconds to that turn's user-visible response.
- A second real turn logged 15,072 ms narrator time followed by 15,293 ms scene-state time.
- The startup script starts `start-llamacpp2.bat` automatically. That launches the 12B Mag-Mell
  model with `-ngl 99`, `--mlock`, and a 12,288-token context on port 8080.
- During the live startup check, Story Lab (:4090), A1111 (:7860), llama.cpp (:8080), and Ollama
  (:11434) were listening. llama.cpp returned HTTP 503 while its model loaded. GPU memory rose
  from about 8,191 MiB to about 9,636 MiB during this interval; after startup it returned HTTP 200.
  This proves concurrent startup and GPU allocation. It does not by itself quantify rendering or
  narrator VRAM contention.
- One A1111 scene request completed in 234,558 ms. A later request failed in Story Lab with
  `UND_ERR_HEADERS_TIMEOUT` after roughly five minutes. The following request found A1111 still
  rendering at 19 percent with an ETA of about 1,479 seconds. The client therefore stopped waiting
  while the A1111 job continued to occupy the backend.
- Image warm-up requests failed repeatedly with A1111 HTTP 500 and
  `UnboundLocalError: local variable 'h' referenced before assignment`.
- A manual image-action suggestion using `eva-qwen2.5-14b-v0.2:q4_k_m` took 25,473 ms and
  26,682 ms in two recorded calls. This is on-demand, not part of every narrator turn.
- `npm test` passed: 195 tests, 0 failures, 2.5 seconds. The suite writes mocked Ollama and
  scene-state events into the live `H:\MEDIA\Story_Lab\data\audit.jsonl`, so it cannot prove
  live performance and currently contaminates operational audit data.

## Root-cause assessment

1. Confirmed user-visible text-turn latency: scene-state extraction is awaited in
   `src/routes/turns.js` before the response is returned. This is the direct source of the added
   12.8-15.3 seconds in recorded normal turns.
2. Confirmed image-backend availability failure: the current fetch path can receive an Undici
   headers timeout before the intended six-minute AbortSignal timeout, without interrupting or
   tracking the still-running A1111 job.
3. Confirmed startup coupling: Story Lab starts llama.cpp and A1111 together, even before the
   active narrator backend is verified. GPU contention remains a plausible contributor that needs
   a controlled before/after measurement before it is called the root cause.
4. Confirmed warm-up defect: the warm-up endpoint currently fails against the running A1111
   configuration. Its performance effect is not yet measured, but repeated failed background calls
   are unacceptable noise and must not remain automatic.

## Required recovery order

1. Restore a responsive primary turn boundary before adding Codex: make scene-state/clothing work
   asynchronous or explicitly optional, preserving an honest pending/failed state and local
   fallback.
2. Repair A1111 lifecycle handling so timeout, interrupt, progress, and retry semantics agree.
3. Decouple GPU-heavy service startup from `start.bat` unless the selected configuration requires
   the service.
4. Diagnose and either repair or disable the warm-up payload before it fires automatically.
5. Redirect test logging to isolated temporary paths.
6. Re-measure the live stack after each isolated change. Do not add the Codex provider until this
   baseline is healthy.

## Non-findings

- No live Codex backend exists in the current tree, so Codex did not cause this regression.
- The passing test suite does not establish live service performance.
- The audit did not prove GPU contention because no controlled run compared A1111 alone against
  A1111 plus llama.cpp/Ollama.
