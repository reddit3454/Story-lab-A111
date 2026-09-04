# Protected Look Drafts Design

## Goal

Make image Looks safe to refine without changing the live image style until the
user explicitly activates a tested draft.

## Scope

This design covers only:

1. Protected snapshots of existing active Look settings.
2. Draft-first editing and explicit draft activation or discard.
3. Test Generation that uses production prompt assembly and the complete draft
   rendering profile.

It does not add a visual diff interface, automatic prompt or LoRA suggestions,
automatic prompt cleanup, LoRA reordering, weight adjustment, or a Codex
provider. Those are separate, approval-gated work.

## Existing Style Contract

The active `image_looks` row is the production style source. Its protected
contract is the full set of fields that affect image appearance:

- checkpoint, VAE, Clip Skip, restore faces, tiling
- ordered LoRA file and strength entries
- prompt prefix, prompt suffix, and Look negative
- sampler, scheduler, steps, CFG, width, and height

Production generation must continue to assemble prompt text in this order:

`Look prefix -> ordered LoRA tags -> character and FaceID -> action -> scene,
location, and clothing -> Look suffix`

The negative prompt remains:

`Look negative + global master negative`

No migration or draft action may rewrite, normalize, deduplicate, or reorder
any string or LoRA entry in the existing active Look.

## Storage Model

`image_looks` remains the live table and the only table read by the existing
image-generation pipeline. This keeps the production resolution path stable.

Add `image_look_versions` using additive SQLite migration:

| Column | Purpose |
| --- | --- |
| `id` | Version identifier |
| `look_id` | Owning live Look; nullable for a brand-new draft |
| `status` | `baseline`, `draft`, `activated`, or `superseded` |
| `source_version_id` | Snapshot a draft was based on; nullable for a new Look draft |
| `snapshot_json` | Exact serialized Look contract, including ordered LoRAs |
| `created_at` | Creation timestamp |
| `activated_at` | Timestamp when a draft becomes live; otherwise null |

At startup, create one `baseline` version for every existing Look that has no
version history. The snapshot is copied verbatim from its live row. The
migration is idempotent and never updates an already-stored version.

## Draft Workflow

### Existing Look

1. User selects Edit on a Look.
2. Server creates a `draft` version copied exactly from the current live Look.
3. Editor loads the draft and identifies its source Look.
4. Save updates only the draft snapshot, never `image_looks`.
5. Discard deletes only the draft version.
6. Activate runs one transaction:
   - Record the current live Look as a protected `superseded` snapshot.
   - Apply the approved draft snapshot to the owning `image_looks` row.
   - Mark the draft `activated` with a timestamp.
   - Keep the Look's current active/inactive selection unchanged.

The source Look remains the same logical Look and database identifier; image
generation sees a changed style only after explicit activation.

### New Look

1. New Look opens an unattached `draft` with default editor values.
2. Saving updates that draft only.
3. Activation creates its `image_looks` row from the draft snapshot, creates
   its protected `activated` snapshot, and makes it active using the existing
   single-active-Look transaction.
4. Discard removes the unattached draft without creating a Look.

## API Boundary

Existing active-Look reads remain compatible. New endpoints own all mutable
draft behavior:

- `POST /api/looks/:id/drafts` creates a draft from a live Look.
- `POST /api/looks/drafts` creates an unattached new-Look draft.
- `GET /api/looks/drafts/:versionId` returns a draft snapshot.
- `PUT /api/looks/drafts/:versionId` updates an existing draft snapshot only.
- `DELETE /api/looks/drafts/:versionId` discards a draft only.
- `POST /api/looks/drafts/:versionId/activate` promotes a draft transactionally.
- `POST /api/looks/drafts/:versionId/test-generate` creates a test image from
  that exact draft snapshot.

The existing direct `PUT /api/looks/:id` route is retained for compatibility
but the Settings editor must stop using it. It receives a source comment and a
test documenting that it is not used by the draft-first UI.

## Production-Faithful Test Generation

Draft test generation must construct a synthetic Look object from the draft
snapshot and call `buildPrompt()` directly. It passes the test subject as the
scene description and uses the existing global `master_negative` value.

This makes test prompt and negative output match production ordering and
style-word handling. It must also forward the complete draft rendering profile:

- steps, CFG, dimensions, sampler, scheduler, restore faces, and tiling
- VAE and Clip Skip as request-local A1111 overrides
- checkpoint as a request-local A1111 model override, restored after the test

The test endpoint writes only to the existing look-test scratch directory. It
does not modify a live Look, activate a draft, change the globally loaded
checkpoint, create `scene_images`, or change a scenario.

## UI Contract

The Image Generation tab keeps its current Look editor controls and their
meaning. The editor receives only the following workflow changes:

- Existing Look edit opens a named draft, not the live row.
- A clear draft-state label identifies the source Look.
- Save Draft, Test Draft, Activate Draft, and Discard Draft replace direct
  live mutation.
- New Look uses the same draft controls until activation.

The current global master-negative editor, FaceID controls, Pose controls,
Look prompt fields, LoRA controls, and saved test-preview workflow remain in
place. Preload controls and A1111 URL editing are outside this work.

## Failure Handling

- A missing draft returns 404 and does not affect any Look.
- Activation validates that the snapshot contains a nonblank Look name and a
  valid LoRA array before opening its transaction.
- A failed activation rolls back all live Look and version changes.
- An unavailable A1111 service returns a clean test-generation error and
  leaves the draft unchanged.
- A failed checkpoint override cannot alter saved Look state.

## Verification

Automated coverage must prove:

1. Baseline migration creates one immutable snapshot per existing Look and is
   idempotent.
2. Creating and saving a draft leaves its source live Look byte-for-byte
   unchanged, including prompt fields and LoRA order/strength.
3. Draft activation records the previous snapshot and applies only the approved
   draft contract atomically.
4. Discarding a draft never changes its source Look.
5. Test generation invokes `buildPrompt()` and produces the same prompt and
   negative order as production for the same Look/test subject.
6. Test generation forwards checkpoint, VAE, and Clip Skip as request-local
   settings and restores them afterward.
7. Existing Look editor UI does not call direct live `PUT /api/looks/:id`.

Manual verification requires opening an existing Look, changing a visible
prompt word and a LoRA strength in a draft, testing it, discarding it, and
confirming a real scene image still uses the untouched active Look. Repeat
with activation and verify the newly generated scene uses the approved draft.
