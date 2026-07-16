# Narrator Response Line Numbering — Design

**Status:** Approved, ready for implementation plan
**Date:** 2026-07-15

## Purpose

Add a lightweight, stable addressing scheme for narrator responses in the Play view, so
specific parts of the story can later be referenced (e.g. by future features) as
`A5-11` — the 11th line of the 5th narrator response. This pass only makes the
addressing scheme visible and deterministic on screen; resolving a reference string like
`"A5-11"` back into data is explicitly out of scope and left for a future feature once its
consumer is known.

## Numbering scheme

- **Response ID** (`A5`): a running count of `role === 'narrator'` turns only, in
  `turn_number` order, within a scenario. The 5th narrator turn is `A5` regardless of how
  many `user`/other-role turns are interleaved. Independent of the existing raw
  `turn_number` column (which counts every turn, not just narrator ones).
- **Line number** (the `11` in `A5-11`): source lines of that turn's raw `content_text`,
  split on `\n`. Blank lines (paragraph breaks) do not consume a number — they are purely
  visual spacing. Line 11 is the 11th non-empty line as the narrator wrote it.
- Both values are computed at render time from `state.turns` — nothing is persisted to the
  database. If a turn is deleted or regenerated, numbering recomputes to match current
  state on the next render, the same way the existing `turn_number` badge already behaves.
- Scope: narrator turns only (`role`/`speaker === 'narrator'`). User and any other-role
  turns are untouched — no ID, no line gutter, same rendering as today.

## Visual design

- **Response ID badge**: a small, faint label (`A5`) added into the existing turn header
  (next to `~ Narrator ~` or the detected speaker name), styled off `--text-faint` to match
  the existing `.turn-meta-num` badge's visual weight — not a new visual language.
- **Line gutter**: for narrator turns, replaces the current paragraph-only rendering
  (`formatStoryContent`, which wraps `<p>`/`<br>`) with per-line rows: a narrow, faint,
  `user-select: none` number column on the left, line text on the right. Blank lines
  between paragraphs still produce vertical spacing, just without a number.
- Inline formatting (`*word*` → `<em>`) is preserved per line via a shared helper factored
  out of `formatStoryContent`, so the regex isn't duplicated.
- User/guidance turn rendering is completely unchanged.

## Implementation shape

- **`public/js/utils.js`**
  - Extract the shared inline-formatting step (HTML-escape + `*em*` conversion) out of
    `formatStoryContent` into a small internal helper.
  - Add `formatNarratorLinesWithGutter(text)` — splits on `\n`, numbers non-blank lines,
    reuses the extracted inline-formatting helper per line, returns the gutter HTML.
    `formatStoryContent` itself keeps its current behavior (still used for memory
    summaries and anywhere else it's already called).

- **`public/js/views/play.js`**
  - In `createTurnElement`, when `turn.speaker === 'narrator'`: compute the response index
    by counting narrator turns in `state.turns` at or before this turn's `turn_number`,
    render the `A{n}` badge in the header, and call `formatNarratorLinesWithGutter`
    instead of `formatStoryContent` for the body.
  - `state.turns` is already kept in sync before every call site that builds a turn element
    (full re-render, incremental append, and replace-in-place all update `state.turns`
    first), so the same counting logic gives consistent numbers regardless of which path
    triggered the render.
  - User/guidance branch is untouched.

- **`public/css/main.css`**
  - New rules: `.turn-line-gutter`, `.turn-line-num`, `.turn-response-id` — faint,
    small, non-bold, consistent with `.turn-meta-num`'s existing styling.

## Out of scope

- Any backend/API change. This is purely a Play-view rendering feature.
- Resolving an `"A5-11"` string back into turn/line data — deferred until a concrete
  consumer (a "planned addition") needs it.
- User-editable custom titles per response (considered and explicitly deferred — auto ID
  only for now).
- Line numbering for non-narrator turns.

## Edge cases

- Empty/whitespace-only narrator content: no gutter rows render, nothing throws.
- Single-line narrator response: still gets its `A{n}` badge, one gutter row.
- Turn deleted or regenerated: numbering recomputes from current `state.turns` on next
  render — no stale numbers persist anywhere since nothing is stored.

## Testing

- Unit tests for `formatNarratorLinesWithGutter` (pure function, `node:test`, no DOM):
  blank-line handling, inline `*em*` formatting per line, line count/order correctness.
- Manual verification in the Play view: confirm `A{n}` badges are sequential across a
  scenario with interleaved user/narrator turns, confirm gutter numbers match source line
  breaks, confirm user/guidance turns are visually unchanged.
