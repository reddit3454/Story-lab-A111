Run a full post-implementation audit of the Story-Lab repo.

This is a serious engineering audit, not a casual code review.

Your mission:
Verify that the newly implemented clothing-set system is fully correct, fully wired, fully usable in the UI, fully documented in `story-lab-master-knowledge.md`, and that the FaceID + image pipeline still work correctly after the changes.

CRITICAL RULES
1. Treat `story-lab-master-knowledge.md` as the authoritative intended system description.
2. Read the relevant sections of `story-lab-master-knowledge.md` first.
3. Then compare the actual code to the documented intent.
4. Do not assume a feature works because UI exists.
5. Do not assume a feature works because backend exists.
6. End-to-end verification is required.
7. Be blunt, specific, and evidence-based.
8. Prefer exact file names, functions, routes, DB fields, WS events, workflow names, and UI components.
9. Distinguish clearly between:
   - runtime bugs
   - broken wiring
   - incomplete UI support
   - schema/storage mismatches
   - image pipeline regressions
   - FaceID regressions
   - doc drift
   - cleanup-only issues

AUDIT SCOPE

A. Clothing-set architecture
Verify the implementation matches this intended model:
- each character has a JSON list of named clothing sets
- a default clothing set can be selected
- scenario creation allows choosing one saved clothing set per character as the starting outfit
- runtime clothing changes are scenario-scoped only
- character base clothing-set JSON is not overwritten by runtime scenario changes
- narrator reads scenario runtime clothing first
- scene image generation reads scenario runtime clothing first
- character-focused image generation reads scenario runtime clothing first
- fallback order is correct when runtime state is absent

B. UI completeness
Audit whether the UI fully supports the feature end-to-end.

Verify all of the following are truly usable:
1. Character Editor UI
- add clothing set
- edit clothing set
- delete clothing set
- choose default clothing set
- save and reload correctly
- invalid JSON / malformed state handling if raw JSON editor exists

2. Scenario Creation / Edit UI
- clothing set selector per character
- saves correct starting outfit
- editing an existing scenario shows the saved selected outfit
- no silent fallback when selection fails

3. Play UI
- current scenario clothing is visible
- clothing updates appear after changes
- manual clothing edits, if present, write to scenario state only
- no accidental write-back to base character clothing sets

C. Backend and storage
Trace the real data path for:
- character clothing-set JSON storage field(s)
- default outfit field(s)
- scenario starting outfit field(s)
- scenario runtime clothing state field(s)
- routes that read/write them
- services that resolve them
- prompt builders that consume them
- image builders that consume them

D. Prompt and image integration
Verify the actual clothing read order used by:
- narrator prompt construction
- scene image prompt construction
- character-focused image prompt construction
- extraction / continuity / scene card paths where relevant

Check for:
- wrong priority order
- fallback to base outfit when runtime state exists
- stale clothing in extractor context
- scene/image mismatch
- play UI showing one thing while prompts use another

E. FaceID audit
Verify FaceID still works correctly after the clothing-set work.

Audit all relevant FaceID paths:
- single seed-image FaceID path
- batch FaceID path
- batch-control2 FaceID path
- character portrait / fullbody FaceID path
- scene image FaceID path
- face reference resolution path
- reference image staging path
- workflow routing and fallback behavior

Check specifically:
- workflow selection logic
- `preferredfaceworkflow`
- `seedimage`
- `referenceimagepath`
- `referenceimagecount`
- `facereferencepath`
- `facereferencepaths`
- `structureimagepath`
- reference image resolution to source path vs staged path
- ComfyUI input staging correctness
- fallback to default workflow when refs fail
- no broken hardcoded assumptions in workflow node injection
- no route/UI mismatch for reference image management

F. Image pipeline audit
Verify the image pipeline is still correct end-to-end.

Audit:
- `resolveEffectiveImageConfig`
- workflow map correctness
- prompt assembly order
- control2 prompt lane generation
- refiner prompt/negative propagation
- auto-image path
- manual image path
- turn image path
- scene image path
- character-focused image path
- image feedback / prompt profile interactions if touched
- WS events for image readiness / scene image display
- image history / turn-thread injection
- prompt provenance and saved prompt correctness where relevant

Check specifically for:
- wrong workflow chosen at runtime
- stale or ignored config fields
- prompt pieces in wrong order
- prefix/suffix applied incorrectly
- quality tags duplicated or stripped incorrectly
- clothing state not reaching image prompts
- FaceID refs not reaching workflow payload
- control2 pose image not reaching workflow payload
- image routes using different logic than auto-fire paths
- UI showing one config while backend uses another

G. Broken wiring / regressions
Find:
- UI controls that save nothing
- saved fields that are never read
- DB fields that are read but never written
- routes that exist but are not called
- UI labels that imply behavior the code does not implement
- scenario edit paths that lose clothing selection
- websocket or state refresh gaps after clothing changes
- image settings fields that appear editable but are ignored
- FaceID options present in UI but not honored in generation

H. Documentation accuracy
Verify `story-lab-master-knowledge.md` was updated correctly.

Check that the doc accurately reflects:
- character clothing-set JSON structure
- default outfit behavior
- scenario starting outfit selection
- scenario runtime clothing state
- narrator/image clothing priority
- UI areas where the feature is managed
- FaceID routing and workflow behavior
- image pipeline behavior
- DB/API/schema changes introduced

If docs are incomplete or contradictory, flag that clearly.

REQUIRED METHOD
- Trace real call chains, not just symbol names.
- Verify create flow, edit flow, reload flow, and runtime play flow.
- Verify both single-image and background/auto-image paths.
- Verify both character-focused and scene-image paths.
- Check both success path and failure path.
- Confirm whether the UI is genuinely wired or merely present.
- Prefer “what currently happens in code” over assumptions.
- When code and docs differ, say which is wrong.

OUTPUT FORMAT

# 1. Executive Summary
- 5 to 15 bullets
- highest-impact findings first
- no fluff

# 2. Pass / Fail Verdict
State clearly:
- PASS if clothing, FaceID, and the image pipeline are all fully implemented and wired
- FAIL if any important part is broken, misleading, incomplete, or regressed

Then list the exact reasons.

# 3. Critical Findings
For each item include:
- ID: CF-1, CF-2, etc.
- Severity: Critical / High / Medium / Low
- Title
- Why it matters
- Exact evidence:
  - file(s)
  - function(s)
  - route(s)
  - DB field(s)
  - workflow(s)
  - UI component(s)
- Proven actual behavior
- Recommended fix

# 4. UI Audit
Use this structure:
- Character Editor: PASS / FAIL
- Scenario Creation/Edit: PASS / FAIL
- Play UI: PASS / FAIL
- Images Reference UI / FaceID UI: PASS / FAIL
- Settings / Image Config UI: PASS / FAIL

For each one, explain exactly what works, what does not, and what is misleading.

# 5. Data Flow Audit
Map the real end-to-end path:
- where clothing sets live
- where selected scenario start outfit lives
- where runtime clothing state lives
- what the narrator reads
- what scene images read
- what character-focused images read
- how FaceID references are resolved
- how images are staged and submitted
- where the final workflow decision is made

Be explicit.

# 6. FaceID Audit
State PASS / FAIL for:
- seed-image FaceID
- batch FaceID
- batch-control2 FaceID
- character portrait/fullbody FaceID
- scene-image FaceID
- reference image UI wiring
- fallback behavior

# 7. Image Pipeline Audit
State PASS / FAIL for:
- effective config resolution
- prompt assembly order
- workflow map
- control2 lane generation
- auto-image path
- manual image path
- scene-image WS/UI flow
- character-focused image path

# 8. Broken Wiring
List anything half-implemented, unwired, stubbed, or silently ignored.

# 9. Documentation Drift
List every place where `story-lab-master-knowledge.md` is now wrong, incomplete, or vague.

# 10. Fix Order
Give the shortest safe fix order.

# 11. Completion Check
Answer these with YES / NO and one-line proof each:
- Clothing sets editable in UI?
- Default clothing set selectable?
- Scenario starting outfit selectable in UI?
- Scenario edit preserves selected outfit?
- Runtime clothing is scenario-scoped only?
- Runtime clothing never overwrites base clothing-set JSON?
- Narrator reads runtime clothing first?
- Scene image generation reads runtime clothing first?
- Character-focused image generation reads runtime clothing first?
- Play UI reflects live clothing state?
- FaceID seed-image path works?
- Batch FaceID path works?
- Batch-control2 path works?
- Reference image UI is wired to actual generation behavior?
- Workflow routing is correct?
- Image pipeline prompt order is correct?
- Master knowledge file updated accurately?

QUALITY BAR
Do not praise the implementation.
Do not write a generic review.
I want the truth about whether this is really finished.
If something is only “mostly implemented,” mark it as FAIL.