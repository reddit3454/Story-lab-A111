# Look Editor — Comprehensive Settings + Test Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Look editor (Settings → Image Generation → Looks) into a comprehensive, self-contained settings menu covering every A1111 parameter that affects a generated image's look, with a live in-editor test-generation area, per `docs/superpowers/specs/2026-07-27-look-editor-settings-design.md`.

**Architecture:** Every Look becomes fully self-contained ("full ownership") — checkpoint, VAE, clip skip, restore faces, tiling, a dynamic LoRA list, sampler, scheduler, steps, CFG, and width/height all live directly on the `image_looks` row, with concrete values (no more "blank inherits a hidden master default"). A new pair of backend endpoints let the editor run one-off test generations against the *current unsaved draft* of a Look, writing to a scratch folder that's cleaned up unless the user explicitly saves an image.

**Tech Stack:** Node.js 22 ESM, node:sqlite (`DatabaseSync`), Express, vanilla JS frontend (no framework), `node:test` for tests.

## Global Constraints

- ESM only — `import`/`export`, never `require()`.
- Additive-only DB migrations: every `ALTER TABLE` in its own `try {} catch {}` (or the project's shared `migrate()` helper) — never drop or destructively alter an existing column.
- No new npm dependencies. Core stack stays express, ws, cors only.
- Every enum-like setting (checkpoint, VAE, LoRA files, sampler, scheduler) must be a dropdown populated live from A1111 — never a free-text input for a fetchable set of valid values.
- Looks may never override `a1111_url` (connection) or `master_negative` (safety/anatomy) — these stay master-level (`global_config`) exclusively.
- Hires-fix is explicitly out of scope for this plan.
- Test-generated images are never written to `scene_images` or broadcast over WS — they're editor-local only.

---

### Task 1: `image_looks` schema migration (new columns + one-time data migration)

**Files:**
- Create: `src/image-looks-migration.js`
- Create: `src/__tests__/image-looks-migration.test.js`
- Modify: `src/db.js:314-366` (wire in the new migration module; remove now-dead `global_config` seed keys)

**Interfaces:**
- Produces: `migrateImageLooksSchema(db)` — adds all new `image_looks` columns, idempotent.
- Produces: `migrateImageLooksData(db)` — one-time copy of old override columns into the new columns for existing rows, idempotent.
- Both take a `node:sqlite` `DatabaseSync` instance (or any object with `.exec()` / `.prepare()`), matching every other migration helper in this codebase (e.g. `seedAndMigrateDefaultLooks(db)` in `src/default-look.js`).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/image-looks-migration.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateImageLooksSchema, migrateImageLooksData } from '../image-looks-migration.js';

function createOldSchemaDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE image_looks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      checkpoint TEXT DEFAULT '',
      lora1_file TEXT DEFAULT '',
      lora1_strength REAL DEFAULT 1.0,
      lora2_file TEXT DEFAULT '',
      lora2_strength REAL DEFAULT 1.0,
      prompt_prefix TEXT DEFAULT '',
      prompt_suffix TEXT DEFAULT '',
      negative TEXT DEFAULT '',
      steps_override INTEGER DEFAULT NULL,
      cfg_override REAL DEFAULT NULL,
      sampler_override TEXT DEFAULT NULL,
      is_active INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

test('migrateImageLooksSchema adds all new columns with correct defaults', () => {
  const db = createOldSchemaDb();
  migrateImageLooksSchema(db);
  db.prepare(`INSERT INTO image_looks (name) VALUES ('Fresh Look')`).run();
  const row = db.prepare(`SELECT * FROM image_looks WHERE name = 'Fresh Look'`).get();
  assert.equal(row.vae, '');
  assert.equal(row.clip_skip, null);
  assert.equal(row.restore_faces, 0);
  assert.equal(row.tiling, 0);
  assert.equal(row.loras_json, '[]');
  assert.equal(row.sampler, 'DPM++ 2M SDE');
  assert.equal(row.scheduler, 'Karras');
  assert.equal(row.steps, 30);
  assert.equal(row.cfg, 7);
  assert.equal(row.width, 832);
  assert.equal(row.height, 1216);
});

test('migrateImageLooksSchema is safe to run twice (idempotent, no duplicate-column crash)', () => {
  const db = createOldSchemaDb();
  migrateImageLooksSchema(db);
  assert.doesNotThrow(() => migrateImageLooksSchema(db));
});

test('migrateImageLooksData copies steps/cfg/sampler overrides into the new columns', () => {
  const db = createOldSchemaDb();
  migrateImageLooksSchema(db);
  db.prepare(`
    INSERT INTO image_looks (name, steps_override, cfg_override, sampler_override)
    VALUES ('Old Style Look', 40, 9.5, 'Euler a')
  `).run();

  migrateImageLooksData(db);

  const row = db.prepare(`SELECT * FROM image_looks WHERE name = 'Old Style Look'`).get();
  assert.equal(row.steps, 40);
  assert.equal(row.cfg, 9.5);
  assert.equal(row.sampler, 'Euler a');
});

test('migrateImageLooksData merges lora1/lora2 into loras_json', () => {
  const db = createOldSchemaDb();
  migrateImageLooksSchema(db);
  db.prepare(`
    INSERT INTO image_looks (name, lora1_file, lora1_strength, lora2_file, lora2_strength)
    VALUES ('LoRA Look', 'styleLora', 0.75, 'detailLora', 0.5)
  `).run();

  migrateImageLooksData(db);

  const row = db.prepare(`SELECT * FROM image_looks WHERE name = 'LoRA Look'`).get();
  const loras = JSON.parse(row.loras_json);
  assert.deepEqual(loras, [
    { file: 'styleLora', strength: 0.75 },
    { file: 'detailLora', strength: 0.5 },
  ]);
});

test('migrateImageLooksData leaves rows with no old-style data at their fresh defaults', () => {
  const db = createOldSchemaDb();
  migrateImageLooksSchema(db);
  db.prepare(`INSERT INTO image_looks (name) VALUES ('Bare Look')`).run();

  migrateImageLooksData(db);

  const row = db.prepare(`SELECT * FROM image_looks WHERE name = 'Bare Look'`).get();
  assert.equal(row.steps, 30);
  assert.equal(row.cfg, 7);
  assert.equal(row.sampler, 'DPM++ 2M SDE');
  assert.equal(row.loras_json, '[]');
});

test('migrateImageLooksData is idempotent — running twice does not double-append or corrupt data', () => {
  const db = createOldSchemaDb();
  migrateImageLooksSchema(db);
  db.prepare(`
    INSERT INTO image_looks (name, steps_override, lora1_file)
    VALUES ('Repeat Look', 50, 'someLora')
  `).run();

  migrateImageLooksData(db);
  migrateImageLooksData(db);

  const row = db.prepare(`SELECT * FROM image_looks WHERE name = 'Repeat Look'`).get();
  assert.equal(row.steps, 50);
  assert.deepEqual(JSON.parse(row.loras_json), [{ file: 'someLora', strength: 1.0 }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-sqlite --test src/__tests__/image-looks-migration.test.js`
Expected: FAIL — `Cannot find module '../image-looks-migration.js'`

- [ ] **Step 3: Write the implementation**

Create `src/image-looks-migration.js`:

```js
// Additive schema migration + one-time data migration for image_looks' move
// to "full ownership" Looks (every generation-affecting field lives directly
// on the Look row, with a concrete value, instead of an optional override
// that falls back to a hidden master default).

const NEW_COLUMNS = [
  "ALTER TABLE image_looks ADD COLUMN vae TEXT DEFAULT ''",
  'ALTER TABLE image_looks ADD COLUMN clip_skip INTEGER DEFAULT NULL',
  'ALTER TABLE image_looks ADD COLUMN restore_faces INTEGER DEFAULT 0',
  'ALTER TABLE image_looks ADD COLUMN tiling INTEGER DEFAULT 0',
  "ALTER TABLE image_looks ADD COLUMN loras_json TEXT DEFAULT '[]'",
  "ALTER TABLE image_looks ADD COLUMN sampler TEXT DEFAULT 'DPM++ 2M SDE'",
  "ALTER TABLE image_looks ADD COLUMN scheduler TEXT DEFAULT 'Karras'",
  'ALTER TABLE image_looks ADD COLUMN steps INTEGER DEFAULT 30',
  'ALTER TABLE image_looks ADD COLUMN cfg REAL DEFAULT 7',
  'ALTER TABLE image_looks ADD COLUMN width INTEGER DEFAULT 832',
  'ALTER TABLE image_looks ADD COLUMN height INTEGER DEFAULT 1216',
];

export function migrateImageLooksSchema(db) {
  for (const sql of NEW_COLUMNS) {
    try {
      db.exec(sql);
    } catch (err) {
      if (!err.message.includes('duplicate column') && !err.message.includes('already exists')) {
        console.warn('[image-looks migration]', err.message);
      }
    }
  }
}

// Old columns (lora1_file/lora1_strength/lora2_file/lora2_strength,
// steps_override/cfg_override/sampler_override) are deprecated but kept —
// this codebase never drops columns. Copies old -> new only when the new
// column is still at its fresh-install default AND the old column actually
// has data, so it's safe to call on every startup.
export function migrateImageLooksData(db) {
  const rows = db.prepare('SELECT * FROM image_looks').all();
  for (const row of rows) {
    const updates = {};

    if (row.steps === 30 && row.steps_override != null) updates.steps = row.steps_override;
    if (row.cfg === 7 && row.cfg_override != null) updates.cfg = row.cfg_override;
    if (row.sampler === 'DPM++ 2M SDE' && row.sampler_override) updates.sampler = row.sampler_override;

    if ((row.loras_json === '[]' || !row.loras_json) && (row.lora1_file || row.lora2_file)) {
      const loras = [];
      if (row.lora1_file) loras.push({ file: row.lora1_file, strength: row.lora1_strength ?? 1.0 });
      if (row.lora2_file) loras.push({ file: row.lora2_file, strength: row.lora2_strength ?? 1.0 });
      updates.loras_json = JSON.stringify(loras);
    }

    if (Object.keys(updates).length === 0) continue;

    const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE image_looks SET ${setClause} WHERE id = ?`).run(...Object.values(updates), row.id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-sqlite --test src/__tests__/image-looks-migration.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Wire the migration into `db.js` and remove dead `global_config` seed keys**

In `src/db.js`, add the import near the top (alongside the existing `seedAndMigrateDefaultLooks` import):

```js
import { migrateImageLooksSchema, migrateImageLooksData } from './image-looks-migration.js';
```

Replace this block (currently around `src/db.js:342-366`):

```js
migrate('CREATE UNIQUE INDEX IF NOT EXISTS idx_image_looks_name ON image_looks(name)');

// Default Look seed + safe migration (fresh DB + legacy Photoreal/Cinematic installs).
seedAndMigrateDefaultLooks(db);
```

with:

```js
migrate('CREATE UNIQUE INDEX IF NOT EXISTS idx_image_looks_name ON image_looks(name)');

migrateImageLooksSchema(db);
migrateImageLooksData(db);

// Default Look seed + safe migration (fresh DB + legacy Photoreal/Cinematic installs).
seedAndMigrateDefaultLooks(db);
```

Then, in the `_imageDefaults` array (currently around `src/db.js:318-333`), delete these seven now-unread entries — `resolveEffectiveConfig` (Task 4) will stop reading them, and a Look now always carries a concrete value for each:

```js
  ['a1111_steps',     '30'],
  ['a1111_cfg',       '7'],
  ['a1111_width',     '832'],
  ['a1111_height',    '1216'],
  ['a1111_sampler',   'DPM++ 2M SDE'],
  ['a1111_scheduler', 'Karras'],
  ['a1111_checkpoint', ''],
```

leaving `a1111_url`, `a1111_faceid_model`, `a1111_faceid_module`, and `master_negative` in place. Update the comment directly above the array (currently "Looks may override steps/cfg/sampler/checkpoint per-generation, but never the connection URL") to:

```js
// A1111 connection — structural master config. Every generation-affecting
// setting (steps/cfg/sampler/scheduler/checkpoint/etc.) now lives entirely
// on the active Look (see image_looks table) — Looks may never override
// the connection URL itself.
```

- [ ] **Step 6: Run the full existing test suite to confirm nothing else broke**

Run: `node --experimental-sqlite --test src/`
Expected: All currently-passing tests still pass. (`src/routes/__tests__/looks.routes.test.js` and `src/__tests__/default-look.test.js` will start failing at this point — that's expected and fixed in Tasks 2 and 4, not this one.)

- [ ] **Step 7: Commit**

```bash
git add src/image-looks-migration.js src/__tests__/image-looks-migration.test.js src/db.js
git commit -m "feat: add image_looks full-ownership schema migration"
```

---

### Task 2: `default-look.js` — extend `DEFAULT_LOOK` and untouched-detection for new fields

**Files:**
- Modify: `src/default-look.js` (whole file — small, shown in full below)
- Modify: `src/__tests__/default-look.test.js`

**Interfaces:**
- Consumes: nothing new from Task 1 beyond the migrated schema already being present when `seedAndMigrateDefaultLooks(db)` runs (Task 1, Step 5 already sequences this correctly).
- Produces: `DEFAULT_LOOK` gains concrete values for every new field. `isUntouchedDefaultLook(row)` correctly returns `false` the moment a user edits *any* new field, not just the pre-existing ones.

- [ ] **Step 1: Write the failing test**

In `src/__tests__/default-look.test.js`, update `createLooksDb()`'s schema (insert the new columns right after `sampler_override TEXT DEFAULT NULL,` and before `is_active INTEGER DEFAULT 0,`):

```js
      steps_override INTEGER DEFAULT NULL,
      cfg_override REAL DEFAULT NULL,
      sampler_override TEXT DEFAULT NULL,
      vae TEXT DEFAULT '',
      clip_skip INTEGER DEFAULT NULL,
      restore_faces INTEGER DEFAULT 0,
      tiling INTEGER DEFAULT 0,
      loras_json TEXT DEFAULT '[]',
      sampler TEXT DEFAULT 'DPM++ 2M SDE',
      scheduler TEXT DEFAULT 'Karras',
      steps INTEGER DEFAULT 30,
      cfg REAL DEFAULT 7,
      width INTEGER DEFAULT 832,
      height INTEGER DEFAULT 1216,
      is_active INTEGER DEFAULT 0,
```

and simplify the `global_config` seed (remove the now-dead `a1111_steps`/`a1111_cfg`/`a1111_sampler`/`a1111_checkpoint` rows, matching `db.js`):

```js
    INSERT INTO global_config (key, value) VALUES
      ('a1111_url', 'http://127.0.0.1:7860'),
      ('master_negative', 'lowres, bad anatomy, bad hands');
```

Add these two new tests at the end of the file:

```js
test('fresh DB seeds the default Look with concrete sampling settings, not null overrides', () => {
  const db = createLooksDb();
  seedAndMigrateDefaultLooks(db);
  const row = db.prepare('SELECT * FROM image_looks WHERE is_active = 1').get();
  assert.equal(row.sampler, 'DPM++ 2M SDE');
  assert.equal(row.scheduler, 'Karras');
  assert.equal(row.steps, 30);
  assert.equal(row.cfg, 7);
  assert.equal(row.width, 832);
  assert.equal(row.height, 1216);
  assert.equal(row.loras_json, '[]');
});

test('editing only a new-style field on the default Look is treated as user customization and survives re-seeding', () => {
  const db = createLooksDb();
  seedAndMigrateDefaultLooks(db);
  db.prepare(`UPDATE image_looks SET scheduler = 'Exponential' WHERE name = ?`).run(DEFAULT_LOOK_NAME);

  seedAndMigrateDefaultLooks(db);

  const row = db.prepare(`SELECT * FROM image_looks WHERE name = ?`).get(DEFAULT_LOOK_NAME);
  assert.equal(row.scheduler, 'Exponential', 'user edit to a new-style field must not be silently reset');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-sqlite --test src/__tests__/default-look.test.js`
Expected: FAIL — `row.sampler` is `undefined` (column doesn't exist in `DEFAULT_LOOK` insert yet), and the second new test fails because the current `_refreshUntouchedDefaultLook` WHERE clause has no awareness of `scheduler` at all so it doesn't even matter yet — but the first failure blocks getting there meaningfully. Also several pre-existing tests in this file will already be failing from Task 1's `global_config` seed change (expected, fixed by this task).

- [ ] **Step 3: Rewrite `src/default-look.js`**

Replace the entire file:

```js
/**
 * Default active Look seeding and idempotent migration.
 * Looks are the sole style source — this module never touches content prompts.
 */

export const DEFAULT_LOOK_NAME = 'Stylized 3D Cinematic';

/** Verified present in local A1111 /sdapi/v1/sd-models (2026-07-20). */
export const DEFAULT_LOOK_CHECKPOINT = 'realcartoonXL_v7.safetensors';

export const DEFAULT_LOOK = {
  name: DEFAULT_LOOK_NAME,
  description:
    'Premium stylized 3D character render — hyper-realistic cartoon / animated-film aesthetic. Default for new generations.',
  checkpoint: DEFAULT_LOOK_CHECKPOINT,
  vae: '',
  clip_skip: null,
  restore_faces: 0,
  tiling: 0,
  loras_json: '[]',
  prompt_prefix:
    'high-end stylized 3D character render, hyper-realistic cartoon aesthetic, polished animated-film character design, expressive detailed eyes, smooth realistic skin shading, detailed hair, clean materials, cinematic soft lighting, high quality 3D render',
  prompt_suffix: 'soft cinematic depth of field, polished character render quality',
  negative:
    'photorealistic photograph, realistic photo, live action, flat anime, cel shading, painterly, sketch, watercolor, low poly, crude 3D, plastic skin, grainy, blurry, low detail',
  sampler: 'DPM++ 2M SDE',
  scheduler: 'Karras',
  steps: 30,
  cfg: 7,
  width: 832,
  height: 1216,
};

/** Original system-seeded Looks (pre-2026-07-20) — used to detect untouched legacy rows. */
export const LEGACY_SEED_FINGERPRINTS = {
  Photoreal: {
    description: 'Clean photographic look - default general-purpose Look.',
    checkpoint: '',
    prompt_prefix: 'photo, realistic, detailed skin texture, natural lighting, sharp focus',
    prompt_suffix: '8k uhd, high detail',
    negative: 'cartoon, anime, illustration, painting, drawing, 3d render, cgi',
  },
  Cinematic: {
    description: 'Moody cinematic color grade with dramatic lighting.',
    checkpoint: '',
    prompt_prefix: 'cinematic still, dramatic lighting, film grain, moody atmosphere',
    prompt_suffix: 'anamorphic lens, color graded, high production value',
    negative: 'flat lighting, overexposed, washed out, cartoon, anime',
  },
};

function _rowsMatchFingerprint(row, fp) {
  if (!row || !fp) return false;
  return (
    (row.description || '') === fp.description &&
    (row.checkpoint || '') === fp.checkpoint &&
    (row.prompt_prefix || '') === fp.prompt_prefix &&
    (row.prompt_suffix || '') === fp.prompt_suffix &&
    (row.negative || '') === fp.negative &&
    !(row.lora1_file || '') &&
    !(row.lora2_file || '') &&
    row.steps_override == null &&
    row.cfg_override == null &&
    !(row.sampler_override || '')
  );
}

export function isUntouchedLegacySeedLook(row) {
  if (!row?.name) return false;
  const fp = LEGACY_SEED_FINGERPRINTS[row.name];
  if (!fp) return false;
  return _rowsMatchFingerprint(row, fp);
}

// Stricter than the legacy check above — also verifies every new-style field
// still matches what DEFAULT_LOOK ships, so a user editing e.g. only the
// scheduler on the default Look is correctly detected as "customized."
function _defaultLookRowMatchesShipped(row) {
  if (!row) return false;
  return (
    _rowsMatchFingerprint(row, DEFAULT_LOOK) &&
    (row.vae || '') === DEFAULT_LOOK.vae &&
    (row.clip_skip ?? null) === DEFAULT_LOOK.clip_skip &&
    Number(row.restore_faces || 0) === DEFAULT_LOOK.restore_faces &&
    Number(row.tiling || 0) === DEFAULT_LOOK.tiling &&
    (row.loras_json || '[]') === DEFAULT_LOOK.loras_json &&
    (row.sampler || '') === DEFAULT_LOOK.sampler &&
    (row.scheduler || '') === DEFAULT_LOOK.scheduler &&
    Number(row.steps) === DEFAULT_LOOK.steps &&
    Number(row.cfg) === DEFAULT_LOOK.cfg &&
    Number(row.width) === DEFAULT_LOOK.width &&
    Number(row.height) === DEFAULT_LOOK.height
  );
}

export function isUntouchedDefaultLook(row) {
  if (!row || row.name !== DEFAULT_LOOK_NAME) return false;
  return _defaultLookRowMatchesShipped(row);
}

export function isUserCustomizedLook(row) {
  if (!row?.name) return false;
  if (row.name === DEFAULT_LOOK_NAME) return !isUntouchedDefaultLook(row);
  if (LEGACY_SEED_FINGERPRINTS[row.name]) return !isUntouchedLegacySeedLook(row);
  return true;
}

function _getLookByName(db, name) {
  return db.prepare('SELECT * FROM image_looks WHERE name = ?').get(name);
}

function _activateLookById(db, id) {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE image_looks SET is_active = 0').run();
    db.prepare('UPDATE image_looks SET is_active = 1 WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function _insertDefaultLookIfMissing(db) {
  db.prepare(`
    INSERT OR IGNORE INTO image_looks (
      name, description, checkpoint, vae, clip_skip, restore_faces, tiling, loras_json,
      prompt_prefix, prompt_suffix, negative,
      sampler, scheduler, steps, cfg, width, height,
      is_active
    ) VALUES (
      @name, @description, @checkpoint, @vae, @clip_skip, @restore_faces, @tiling, @loras_json,
      @prompt_prefix, @prompt_suffix, @negative,
      @sampler, @scheduler, @steps, @cfg, @width, @height,
      0
    )
  `).run(DEFAULT_LOOK);
}

// Only fires when the existing row is verified (in JS, via the same
// fingerprint check isUntouchedDefaultLook uses) to still exactly match
// what DEFAULT_LOOK ships — a single source of truth for "untouched",
// instead of duplicating that comparison a second time inside a SQL WHERE.
function _refreshUntouchedDefaultLook(db) {
  const existing = _getLookByName(db, DEFAULT_LOOK_NAME);
  if (!existing || !isUntouchedDefaultLook(existing)) return;

  db.prepare(`
    UPDATE image_looks SET
      description   = @description,
      checkpoint    = @checkpoint,
      vae           = @vae,
      clip_skip     = @clip_skip,
      restore_faces = @restore_faces,
      tiling        = @tiling,
      loras_json    = @loras_json,
      prompt_prefix = @prompt_prefix,
      prompt_suffix = @prompt_suffix,
      negative      = @negative,
      sampler       = @sampler,
      scheduler     = @scheduler,
      steps         = @steps,
      cfg           = @cfg,
      width         = @width,
      height        = @height
    WHERE name = @name
  `).run(DEFAULT_LOOK);
}

export function seedAndMigrateDefaultLooks(db) {
  _insertDefaultLookIfMissing(db);
  _refreshUntouchedDefaultLook(db);

  const defaultRow = _getLookByName(db, DEFAULT_LOOK_NAME);
  if (!defaultRow) return;

  const activeRow = db.prepare('SELECT * FROM image_looks WHERE is_active = 1 LIMIT 1').get();

  if (!activeRow) {
    _activateLookById(db, defaultRow.id);
    return;
  }

  if (activeRow.name === DEFAULT_LOOK_NAME) {
    return;
  }

  if (isUntouchedLegacySeedLook(activeRow)) {
    _activateLookById(db, defaultRow.id);
    return;
  }

  if (isUserCustomizedLook(activeRow)) {
    return;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-sqlite --test src/__tests__/default-look.test.js`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 5: Commit**

```bash
git add src/default-look.js src/__tests__/default-look.test.js
git commit -m "feat: extend default Look and untouched-detection for full-ownership fields"
```

---

### Task 3: `prompt-builder.js` — LoRA tags read from `loras_json`, exported for reuse

**Files:**
- Modify: `src/services/prompt-builder.js:49-54, 84`
- Modify: `src/services/__tests__/prompt-builder.test.js`
- Modify: `src/__tests__/default-look.test.js` (no change needed — `DEFAULT_LOOK` already carries `loras_json: '[]'` from Task 2, verified in Step 3 below)

**Interfaces:**
- Produces: `export function loraTags(look)` — pure, returns `string[]` of `<lora:file:strength>` tags. Used by `buildPrompt` (this task) and by the test-generate route (Task 8).

- [ ] **Step 1: Write the failing test**

In `src/services/__tests__/prompt-builder.test.js`, replace the two fixture objects:

```js
const LOOK_A = {
  id: 1, name: 'Photoreal',
  prompt_prefix: 'photo, realistic, natural lighting',
  prompt_suffix: '8k uhd, high detail',
  negative: 'cartoon, anime, illustration',
  loras_json: '[]',
};

const LOOK_B = {
  id: 2, name: 'Cinematic',
  prompt_prefix: 'cinematic still, dramatic lighting, film grain',
  prompt_suffix: 'anamorphic lens, color graded',
  negative: 'flat lighting, washed out',
  loras_json: '[{"file":"someLora","strength":0.8}]',
};
```

Replace the existing `'formats LoRA tags as <lora:name:strength>'` test with:

```js
  it('formats LoRA tags as <lora:name:strength>', () => {
    const { prompt, loras } = buildPrompt({ look: LOOK_B, actionText: 'walking' });
    assert.deepEqual(loras, ['<lora:someLora:0.8>']);
    assert.match(prompt, /<lora:someLora:0\.8>/);
  });

  it('supports multiple LoRAs and ignores malformed entries', () => {
    const look = {
      ...LOOK_A,
      loras_json: '[{"file":"styleLora","strength":0.6},{"file":"detailLora","strength":1},{"strength":0.5}]',
    };
    const { loras } = buildPrompt({ look, actionText: 'walking' });
    assert.deepEqual(loras, ['<lora:styleLora:0.6>', '<lora:detailLora:1>']);
  });

  it('loraTags returns an empty array for no Look, missing loras_json, or malformed JSON', () => {
    assert.deepEqual(loraTags(null), []);
    assert.deepEqual(loraTags({}), []);
    assert.deepEqual(loraTags({ loras_json: 'not json' }), []);
  });
```

Add `loraTags` to the import at the top of the file:

```js
import { buildPrompt, stripStyleWords, loraTags } from '../prompt-builder.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-sqlite --test src/services/__tests__/prompt-builder.test.js`
Expected: FAIL — `loraTags is not a function` (not exported yet), and the LOOK_B lora test fails since `buildPrompt` still reads `look.lora1_file`, which is now `undefined` on the updated fixture.

- [ ] **Step 3: Update `src/services/prompt-builder.js`**

Replace the `_loraTags` function (currently lines 49-54):

```js
export function loraTags(look) {
  if (!look?.loras_json) return [];
  let list;
  try {
    list = JSON.parse(look.loras_json);
  } catch (_) {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((l) => l && l.file)
    .map((l) => `<lora:${l.file}:${l.strength != null ? l.strength : 1.0}>`);
}
```

And update the one call site inside `buildPrompt` (currently `const loras = _loraTags(look);`):

```js
  const loras = loraTags(look);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-sqlite --test src/services/__tests__/prompt-builder.test.js`
Expected: PASS

Also re-run: `node --experimental-sqlite --test src/__tests__/default-look.test.js`
Expected: still PASS — `DEFAULT_LOOK.loras_json` is `'[]'` from Task 2, so `loraTags(lookRow)` returns `[]`, unchanged from before.

- [ ] **Step 5: Commit**

```bash
git add src/services/prompt-builder.js src/services/__tests__/prompt-builder.test.js
git commit -m "feat: read LoRA tags from loras_json, export loraTags for reuse"
```

---

### Task 4: `config-resolver.js` — full-ownership `resolveEffectiveConfig` rewrite

**Files:**
- Modify: `src/services/config-resolver.js` (whole file — shown in full below)
- Modify: `src/routes/__tests__/looks.routes.test.js:97-127`

**Interfaces:**
- Consumes: `resolveActiveLook(db)` (unchanged), Look rows now always carrying concrete `sampler`/`scheduler`/`steps`/`cfg`/`width`/`height` (Task 1).
- Produces: `resolveEffectiveConfig(db)` returns `{ a1111_url, checkpoint, vae, clip_skip, restore_faces, tiling, sampler, scheduler, steps, cfg, width, height, master_negative, look }`. `vae`/`clip_skip`/`restore_faces`/`tiling` are new keys on this return value — Task 5 consumes them.

- [ ] **Step 1: Write the failing test**

In `src/routes/__tests__/looks.routes.test.js`, replace the two tests currently spanning lines 97-127 (`'resolveEffectiveConfig merges the active Look over master defaults...'` and `'resolveEffectiveConfig falls back to master defaults for any override field the Look leaves null'`) with:

```js
test('resolveEffectiveConfig merges the active Look over the no-Look fallback, never overriding a1111_url', () => {
  const created = db.prepare(`
    INSERT INTO image_looks (name, prompt_prefix, prompt_suffix, negative, steps, cfg, sampler, checkpoint)
    VALUES ('Effective Test Look', 'prefix-x', 'suffix-x', 'neg-x', 40, 9.5, 'Euler a', 'someCheckpoint.safetensors')
  `).run();
  db.prepare('UPDATE image_looks SET is_active = 0').run();
  db.prepare('UPDATE image_looks SET is_active = 1 WHERE id = ?').run(created.lastInsertRowid);

  const effective = resolveEffectiveConfig(db);
  assert.equal(effective.look.id, created.lastInsertRowid);
  assert.equal(effective.steps, 40);
  assert.equal(effective.cfg, 9.5);
  assert.equal(effective.sampler, 'Euler a');
  assert.equal(effective.checkpoint, 'someCheckpoint.safetensors');
  assert.equal(effective.a1111_url, 'http://127.0.0.1:7860', 'Look must never override the connection URL');
  assert.match(effective.master_negative, /bad anatomy/, 'master negative must always be present and untouched by the Look');

  const active = resolveActiveLook(db);
  assert.equal(active.id, created.lastInsertRowid);
});

test("resolveEffectiveConfig reads a Look's own columns even when they are at fresh-install defaults", () => {
  const created = db.prepare(`INSERT INTO image_looks (name) VALUES ('Bare Look')`).run();
  db.prepare('UPDATE image_looks SET is_active = 0').run();
  db.prepare('UPDATE image_looks SET is_active = 1 WHERE id = ?').run(created.lastInsertRowid);

  const effective = resolveEffectiveConfig(db);
  assert.equal(effective.steps, 30);
  assert.equal(effective.cfg, 7);
  assert.equal(effective.sampler, 'DPM++ 2M SDE');
});

test('resolveEffectiveConfig falls back to hardcoded defaults when no Look is active at all', () => {
  db.prepare('UPDATE image_looks SET is_active = 0').run();

  const effective = resolveEffectiveConfig(db);
  assert.equal(effective.look, null);
  assert.equal(effective.steps, 30);
  assert.equal(effective.cfg, 7);
  assert.equal(effective.sampler, 'DPM++ 2M SDE');
  assert.equal(effective.width, 832);
  assert.equal(effective.height, 1216);
});

test('resolveEffectiveConfig exposes vae/clip_skip/restore_faces/tiling from the active Look', () => {
  const created = db.prepare(`
    INSERT INTO image_looks (name, vae, clip_skip, restore_faces, tiling)
    VALUES ('Rendering Test Look', 'someVae.safetensors', 2, 1, 1)
  `).run();
  db.prepare('UPDATE image_looks SET is_active = 0').run();
  db.prepare('UPDATE image_looks SET is_active = 1 WHERE id = ?').run(created.lastInsertRowid);

  const effective = resolveEffectiveConfig(db);
  assert.equal(effective.vae, 'someVae.safetensors');
  assert.equal(effective.clip_skip, 2);
  assert.equal(effective.restore_faces, true);
  assert.equal(effective.tiling, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-sqlite --test src/routes/__tests__/looks.routes.test.js`
Expected: FAIL — `effective.vae` is `undefined` (resolver doesn't produce it yet), and the "Bare Look" test's `INSERT INTO image_looks (name) VALUES (...)` now relies on the Task 1 column defaults rather than the old master-fallback logic, which the current resolver doesn't read that way yet.

- [ ] **Step 3: Rewrite `src/services/config-resolver.js`**

Replace the entire file:

```js
const NUMERIC_KEYS = new Set([
  'narrator_context_tokens', 'narrator_max_tokens',
  'sfw_arousal_ceiling',
]);

const BOOLEAN_KEYS = new Set(['nsfw_enabled', 'explicit_mode', 'summary_learning_enabled', 'arousal_decay_enabled', 'emotion_tracking_enabled', 'relationship_deltas_enabled', 'mood_gate_toasts_enabled', 'regen_state_snapshot_enabled', 'cast_trigger_chips_enabled', 'scene_heat_readout_enabled']);

export function resolveMasterConfig(db) {
  const rows = db.prepare('SELECT key, value FROM global_config').all();
  const config = {};
  for (const { key, value } of rows) {
    if (NUMERIC_KEYS.has(key)) {
      config[key] = parseFloat(value) || 0;
    } else if (BOOLEAN_KEYS.has(key)) {
      config[key] = value === 'true';
    } else {
      config[key] = value ?? '';
    }
  }
  return config;
}

// The single active Look, or null if none is active (image generation should
// still proceed with hardcoded fallback settings in that case — a Look is a
// style overlay, not a hard requirement).
export function resolveActiveLook(db) {
  return db.prepare('SELECT * FROM image_looks WHERE is_active = 1 LIMIT 1').get() || null;
}

// Used only when there is no active Look at all. Every real Look carries its
// own concrete value for each of these (see image-looks-migration.js).
const NO_LOOK_FALLBACK = {
  checkpoint: '',
  vae: '',
  clip_skip: null,
  restore_faces: false,
  tiling: false,
  sampler: 'DPM++ 2M SDE',
  scheduler: 'Karras',
  steps: 30,
  cfg: 7,
  width: 832,
  height: 1216,
};

/**
 * Resolves the complete, concrete generation config. Full ownership: the
 * active Look supplies every generation-affecting field directly — there is
 * no more "blank on the Look falls back to a master default" indirection.
 * a1111_url and master_negative always come from global_config only; a Look
 * may never override either (safety/anatomy negatives, connection URL).
 */
export function resolveEffectiveConfig(db) {
  const master = resolveMasterConfig(db);
  const look = resolveActiveLook(db);
  const src = look || NO_LOOK_FALLBACK;

  return {
    a1111_url: master.a1111_url || 'http://127.0.0.1:7860',
    checkpoint: src.checkpoint || '',
    vae: src.vae || '',
    clip_skip: src.clip_skip ?? null,
    restore_faces: !!src.restore_faces,
    tiling: !!src.tiling,
    sampler: src.sampler || NO_LOOK_FALLBACK.sampler,
    scheduler: src.scheduler || NO_LOOK_FALLBACK.scheduler,
    steps: Math.round(src.steps || NO_LOOK_FALLBACK.steps),
    cfg: Number(src.cfg || NO_LOOK_FALLBACK.cfg),
    width: Math.round(src.width || NO_LOOK_FALLBACK.width),
    height: Math.round(src.height || NO_LOOK_FALLBACK.height),
    master_negative: master.master_negative || '',
    look,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-sqlite --test src/routes/__tests__/looks.routes.test.js`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add src/services/config-resolver.js src/routes/__tests__/looks.routes.test.js
git commit -m "feat: resolveEffectiveConfig reads full-ownership Look fields, no master fallback"
```

---

### Task 5: `image-pipeline.js` — send vae/clip_skip/restore_faces/tiling to A1111

**Files:**
- Modify: `src/services/image-pipeline.js:186-206`
- Modify: `src/routes/__tests__/images.routes.test.js`

**Interfaces:**
- Consumes: `resolveEffectiveConfig(db)`'s new `vae`/`clip_skip`/`restore_faces`/`tiling` fields (Task 4); `loraTags` is already applied inside `buildPrompt` (Task 3) — no separate wiring needed here.
- Produces: no new exports; the A1111 payload gains `restore_faces`, `tiling`, and (when set) `override_settings` / `override_settings_restore_afterwards`.

- [ ] **Step 1: Write the failing test**

In `src/routes/__tests__/images.routes.test.js`, add this test after the existing `'switching the active Look changes the style block...'` test:

```js
test("active Look's vae/clip_skip/restore_faces/tiling and LoRAs reach the actual A1111 payload", async (t) => {
  let capturedPayload = null;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const u = String(url);
    if (u.includes('/sdapi/v1/options')) {
      return { ok: true, json: async () => ({ sd_model_checkpoint: 'baseModel.safetensors [abcd1234]' }) };
    }
    if (u.includes('/sdapi/v1/txt2img')) {
      capturedPayload = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          images: [TINY_PNG_B64],
          info: JSON.stringify({ seed: 42, sd_model_name: 'baseModel', sd_model_hash: 'abcd1234' }),
        }),
      };
    }
    if (u.includes('/controlnet/model_list')) {
      return { ok: true, json: async () => ({ model_list: [] }) };
    }
    throw new Error('unexpected fetch in test: ' + u);
  });

  const { scenarioId } = seedScenario();
  const created = db.prepare(`
    INSERT INTO image_looks (name, prompt_prefix, negative, vae, clip_skip, restore_faces, tiling, loras_json)
    VALUES ('Rendering Test Look', 'test prefix', 'test neg', 'someVae.safetensors', 2, 1, 1, '[{"file":"testLora","strength":0.7}]')
  `).run();
  db.prepare('UPDATE image_looks SET is_active = 0').run();
  db.prepare('UPDATE image_looks SET is_active = 1 WHERE id = ?').run(created.lastInsertRowid);

  await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionText: 'testing' }),
  });

  assert.equal(capturedPayload.restore_faces, true);
  assert.equal(capturedPayload.tiling, true);
  assert.equal(capturedPayload.override_settings.sd_vae, 'someVae.safetensors');
  assert.equal(capturedPayload.override_settings.CLIP_stop_at_last_layers, 2);
  assert.equal(capturedPayload.override_settings_restore_afterwards, true);
  assert.match(capturedPayload.prompt, /<lora:testLora:0\.7>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-sqlite --test src/routes/__tests__/images.routes.test.js`
Expected: FAIL — `capturedPayload.restore_faces` is `undefined`

- [ ] **Step 3: Update `src/services/image-pipeline.js`**

Replace the payload construction block (currently lines 188-200):

```js
    const payload = {
      prompt: built.prompt,
      negative_prompt: built.negative,
      steps: config.steps,
      cfg_scale: config.cfg,
      width: config.width,
      height: config.height,
      sampler_name: config.sampler,
      scheduler: config.scheduler,
      restore_faces: config.restore_faces,
      tiling: config.tiling,
      seed: -1,
      n_iter: 1,
      batch_size: 1,
    };
    if (config.vae || config.clip_skip != null) {
      payload.override_settings = {};
      if (config.vae) payload.override_settings.sd_vae = config.vae;
      if (config.clip_skip != null) payload.override_settings.CLIP_stop_at_last_layers = config.clip_skip;
      payload.override_settings_restore_afterwards = true;
    }
```

(This replaces the old plain `const payload = { ... };` object literal — everything below it, from `if (controlNetUnit) Object.assign(payload, controlNetUnit);` onward, is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-sqlite --test src/routes/__tests__/images.routes.test.js`
Expected: PASS (all tests in the file, including the pre-existing ones — they don't set vae/clip_skip so `override_settings` is simply absent from their payloads, which none of them assert on)

- [ ] **Step 5: Commit**

```bash
git add src/services/image-pipeline.js src/routes/__tests__/images.routes.test.js
git commit -m "feat: send VAE/clip-skip/restore-faces/tiling to A1111 from the active Look"
```

---

### Task 6: A1111 VAE catalog endpoint + missing scheduler client wrapper

**Files:**
- Modify: `src/services/a1111.js:83-89` (add `getVaes` after `getLoras`)
- Modify: `src/routes/a1111.js:27-34` (add `GET /vaes` after `/loras`)
- Modify: `public/js/api.js:154-159` (add `getA1111Vaes`, `getA1111Schedulers`)
- Create: `src/routes/__tests__/a1111.routes.test.js`

**Interfaces:**
- Produces: `a1111.getVaes(baseUrl)` → `Promise<{name: string}[]>`. `GET /api/a1111/vaes` → `{ok: true, vaes: [...]}` or `{ok: false, error}` (502). `API.getA1111Vaes()` / `API.getA1111Schedulers()` on the frontend, consumed by Task 9.

- [ ] **Step 1: Write the failing test**

Create `src/routes/__tests__/a1111.routes.test.js`:

```js
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-a1111-'));
const DIRS = { data: path.join(ROOT, 'data'), images: path.join(ROOT, 'images'), audio: path.join(ROOT, 'audio') };
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'),
    DATA_DIR: DIRS.data, IMAGES_DIR: DIRS.images, AUDIO_DIR: DIRS.audio,
    DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(DIRS.data, 'audit.jsonl'),
  },
});

const realFetch = globalThis.fetch;
await import('../../db.js');
const { default: express } = await import('express');
const { default: a1111Router } = await import('../a1111.js');

const app = express();
app.use(express.json());
app.use('/api/a1111', a1111Router);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

test("GET /api/a1111/vaes proxies A1111's VAE catalog", async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.match(String(url), /\/sdapi\/v1\/sd-vae$/);
    return {
      ok: true,
      json: async () => ([{ model_name: 'vae-ft-mse-840000-ema-pruned.safetensors' }, { model_name: 'Automatic' }]),
    };
  });

  const res = await realFetch(`${baseUrl}/api/a1111/vaes`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.deepEqual(json.vaes.map((v) => v.name), ['vae-ft-mse-840000-ema-pruned.safetensors', 'Automatic']);
});

test('GET /api/a1111/vaes returns 502 with the upstream error when A1111 is unreachable', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:7860'); });

  const res = await realFetch(`${baseUrl}/api/a1111/vaes`);
  assert.equal(res.status, 502);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.match(json.error, /ECONNREFUSED/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-sqlite --test src/routes/__tests__/a1111.routes.test.js`
Expected: FAIL — `404` (no `/vaes` route registered yet)

- [ ] **Step 3: Implement**

In `src/services/a1111.js`, add after `getLoras` (currently ends at line 88):

```js
export async function getVaes(baseUrl) {
  const data = await _fetchJson(`${baseUrl}/sdapi/v1/sd-vae`, {}, CATALOG_TIMEOUT_MS);
  return (data || []).map(function (v) { return { name: v.model_name || v.name }; });
}
```

In `src/routes/a1111.js`, add after the `/loras` route (currently ends at line 34):

```js
router.get('/vaes', async function (req, res) {
  try {
    const vaes = await a1111.getVaes(_baseUrl());
    res.json({ ok: true, vaes });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});
```

In `public/js/api.js`, add after `getA1111Samplers` (currently line 158):

```js
    getA1111Vaes:       function ()  { return request('GET', '/api/a1111/vaes'); },
    getA1111Schedulers: function ()  { return request('GET', '/api/a1111/schedulers'); },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-sqlite --test src/routes/__tests__/a1111.routes.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/a1111.js src/routes/a1111.js public/js/api.js src/routes/__tests__/a1111.routes.test.js
git commit -m "feat: add A1111 VAE catalog endpoint and scheduler client wrapper"
```

---

### Task 7: `routes/looks.js` — persist all new fields on create/update

**Files:**
- Modify: `src/routes/looks.js:28-101` (`POST /` and `PUT /:id` handlers)
- Modify: `src/routes/__tests__/looks.routes.test.js`

**Interfaces:**
- Produces: `POST /api/looks` and `PUT /api/looks/:id` now accept and persist `vae`, `clip_skip`, `restore_faces`, `tiling`, `loras` (array of `{file, strength}`, stored as `loras_json`), `sampler`, `scheduler`, `steps`, `cfg`, `width`, `height`, in addition to the existing `name`/`description`/`checkpoint`/`prompt_prefix`/`prompt_suffix`/`negative`.

- [ ] **Step 1: Write the failing test**

Add to `src/routes/__tests__/looks.routes.test.js`:

```js
test('POST /api/looks persists every full-ownership field', async () => {
  const body = {
    name: 'Full Field Look',
    description: 'covers every setting',
    checkpoint: 'someModel.safetensors',
    vae: 'someVae.safetensors',
    clip_skip: 2,
    restore_faces: true,
    tiling: true,
    loras: [{ file: 'styleLora', strength: 0.6 }, { file: 'detailLora', strength: 1 }],
    prompt_prefix: 'prefix', prompt_suffix: 'suffix', negative: 'neg',
    sampler: 'Euler a', scheduler: 'Exponential', steps: 25, cfg: 6.5, width: 768, height: 1024,
  };
  const created = await post('/api/looks', body);
  assert.equal(created.status, 201);
  assert.equal(created.json.vae, 'someVae.safetensors');
  assert.equal(created.json.clip_skip, 2);
  assert.equal(created.json.restore_faces, true);
  assert.equal(created.json.tiling, true);
  assert.deepEqual(JSON.parse(created.json.loras_json), body.loras);
  assert.equal(created.json.sampler, 'Euler a');
  assert.equal(created.json.scheduler, 'Exponential');
  assert.equal(created.json.steps, 25);
  assert.equal(created.json.cfg, 6.5);
  assert.equal(created.json.width, 768);
  assert.equal(created.json.height, 1024);

  const updated = await realFetch(`${baseUrl}/api/looks/${created.json.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, scheduler: 'Karras', loras: [] }),
  });
  const updatedJson = await updated.json();
  assert.equal(updatedJson.scheduler, 'Karras');
  assert.deepEqual(JSON.parse(updatedJson.loras_json), []);
});

test('POST /api/looks defaults new fields sanely when omitted', async () => {
  const created = await post('/api/looks', { name: 'Minimal Look' });
  assert.equal(created.status, 201);
  assert.equal(created.json.vae, '');
  assert.equal(created.json.clip_skip, null);
  assert.equal(created.json.restore_faces, false);
  assert.equal(created.json.tiling, false);
  assert.equal(created.json.loras_json, '[]');
  assert.equal(created.json.sampler, 'DPM++ 2M SDE');
  assert.equal(created.json.scheduler, 'Karras');
  assert.equal(created.json.steps, 30);
  assert.equal(created.json.cfg, 7);
  assert.equal(created.json.width, 832);
  assert.equal(created.json.height, 1216);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-sqlite --test src/routes/__tests__/looks.routes.test.js`
Expected: FAIL — `created.json.vae` is `undefined` (route doesn't accept/return it yet)

- [ ] **Step 3: Rewrite `POST /` and `PUT /:id` in `src/routes/looks.js`**

Replace the `POST /` handler (currently lines 28-59):

```js
router.post('/', function (req, res) {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  const result = db.prepare(`
    INSERT INTO image_looks (
      name, description, checkpoint, vae, clip_skip, restore_faces, tiling, loras_json,
      prompt_prefix, prompt_suffix, negative,
      sampler, scheduler, steps, cfg, width, height
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    String(b.name).trim(),
    b.description ?? '',
    b.checkpoint ?? '',
    b.vae ?? '',
    b.clip_skip != null && b.clip_skip !== '' ? parseInt(b.clip_skip, 10) : null,
    b.restore_faces ? 1 : 0,
    b.tiling ? 1 : 0,
    JSON.stringify(Array.isArray(b.loras) ? b.loras : []),
    b.prompt_prefix ?? '',
    b.prompt_suffix ?? '',
    b.negative ?? '',
    b.sampler || 'DPM++ 2M SDE',
    b.scheduler || 'Karras',
    b.steps != null && b.steps !== '' ? parseInt(b.steps, 10) : 30,
    b.cfg != null && b.cfg !== '' ? Number(b.cfg) : 7,
    b.width != null && b.width !== '' ? parseInt(b.width, 10) : 832,
    b.height != null && b.height !== '' ? parseInt(b.height, 10) : 1216,
  );

  const row = db.prepare('SELECT * FROM image_looks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(_clean(row));
});
```

Replace the `PUT /:id` handler (currently lines 61-101):

```js
router.put('/:id', function (req, res) {
  const existing = db.prepare('SELECT * FROM image_looks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Look not found' });
  const b = req.body || {};

  db.prepare(`
    UPDATE image_looks SET
      name           = ?,
      description    = ?,
      checkpoint     = ?,
      vae            = ?,
      clip_skip      = ?,
      restore_faces  = ?,
      tiling         = ?,
      loras_json     = ?,
      prompt_prefix  = ?,
      prompt_suffix  = ?,
      negative       = ?,
      sampler        = ?,
      scheduler      = ?,
      steps          = ?,
      cfg            = ?,
      width          = ?,
      height         = ?
    WHERE id = ?
  `).run(
    b.name != null && String(b.name).trim() ? String(b.name).trim() : existing.name,
    b.description ?? existing.description,
    b.checkpoint ?? existing.checkpoint,
    b.vae ?? existing.vae,
    b.clip_skip !== undefined ? (b.clip_skip === '' || b.clip_skip === null ? null : parseInt(b.clip_skip, 10)) : existing.clip_skip,
    b.restore_faces !== undefined ? (b.restore_faces ? 1 : 0) : existing.restore_faces,
    b.tiling !== undefined ? (b.tiling ? 1 : 0) : existing.tiling,
    b.loras !== undefined ? JSON.stringify(Array.isArray(b.loras) ? b.loras : []) : existing.loras_json,
    b.prompt_prefix ?? existing.prompt_prefix,
    b.prompt_suffix ?? existing.prompt_suffix,
    b.negative ?? existing.negative,
    b.sampler || existing.sampler,
    b.scheduler || existing.scheduler,
    b.steps != null && b.steps !== '' ? parseInt(b.steps, 10) : existing.steps,
    b.cfg != null && b.cfg !== '' ? Number(b.cfg) : existing.cfg,
    b.width != null && b.width !== '' ? parseInt(b.width, 10) : existing.width,
    b.height != null && b.height !== '' ? parseInt(b.height, 10) : existing.height,
    req.params.id,
  );

  const row = db.prepare('SELECT * FROM image_looks WHERE id = ?').get(req.params.id);
  res.json(_clean(row));
});
```

Update `_clean` (currently lines 7-10) so `restore_faces`/`tiling` are booleans in API responses, matching `is_active`'s existing treatment:

```js
function _clean(row) {
  if (!row) return row;
  return { ...row, is_active: !!row.is_active, restore_faces: !!row.restore_faces, tiling: !!row.tiling };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-sqlite --test src/routes/__tests__/looks.routes.test.js`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add src/routes/looks.js src/routes/__tests__/looks.routes.test.js
git commit -m "feat: persist all full-ownership Look fields through the Looks API"
```

---

### Task 8: Test-generation endpoints (`POST /api/looks/test-generate`, `/save`, `/cleanup`)

**Files:**
- Modify: `src/routes/looks.js` (add three new routes at the end, before `export default router;`)
- Modify: `src/routes/__tests__/looks.routes.test.js`

**Interfaces:**
- Consumes: `loraTags` from `src/services/prompt-builder.js` (Task 3), `a1111.txt2img` from `src/services/a1111.js` (unchanged), `IMAGES_DIR` from `src/paths.js`, `resolveMasterConfig` for `master_negative`.
- Produces: `POST /api/looks/test-generate` → `{ok, filename, url, seed, generation_time_ms}`. `POST /api/looks/test-generate/save` → `{ok: true, url}`. `POST /api/looks/test-generate/cleanup` → `{ok: true, deleted: number}`.

- [ ] **Step 1: Write the failing test**

Add to `src/routes/__tests__/looks.routes.test.js` (needs `fs`/`path` already imported at the top of the file — they are):

```js
test('POST /api/looks/test-generate runs one txt2img with the draft settings and writes to the scratch folder', async (t) => {
  let capturedPayload = null;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const u = String(url);
    if (u.includes('/sdapi/v1/txt2img')) {
      capturedPayload = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          images: ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
          info: JSON.stringify({ seed: 99, sd_model_name: 'baseModel', sd_model_hash: 'abcd1234' }),
        }),
      };
    }
    throw new Error('unexpected fetch in test: ' + u);
  });

  const res = await post('/api/looks/test-generate', {
    prompt_prefix: 'draft prefix', prompt_suffix: 'draft suffix', negative: 'draft neg',
    loras: [{ file: 'draftLora', strength: 0.9 }],
    sampler: 'Euler a', scheduler: 'Karras', steps: 20, cfg: 6, width: 512, height: 512,
    test_subject: 'a woman standing in a park, full body',
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.seed, 99);
  assert.ok(res.json.filename);
  assert.equal(res.json.url, '/story-images/_look-test-scratch/' + res.json.filename);
  assert.ok(fs.existsSync(path.join(DIRS.images, '_look-test-scratch', res.json.filename)));

  assert.match(capturedPayload.prompt, /<lora:draftLora:0\.9>/);
  assert.match(capturedPayload.prompt, /draft prefix/);
  assert.match(capturedPayload.prompt, /a woman standing in a park, full body/);
  assert.match(capturedPayload.prompt, /draft suffix/);
  assert.match(capturedPayload.negative_prompt, /draft neg/);
  assert.match(capturedPayload.negative_prompt, /bad anatomy/, 'server must always append master_negative itself');
  assert.equal(capturedPayload.width, 512);
  assert.equal(capturedPayload.n_iter, 1);
  assert.equal(capturedPayload.batch_size, 1);
});

test('POST /api/looks/test-generate/save moves the file into the permanent saves folder', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (String(url).includes('/sdapi/v1/txt2img')) {
      return {
        ok: true,
        json: async () => ({
          images: ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
          info: JSON.stringify({ seed: 1 }),
        }),
      };
    }
    throw new Error('unexpected fetch in test: ' + String(url));
  });

  const gen = await post('/api/looks/test-generate', { test_subject: 'test subject' });
  const scratchPath = path.join(DIRS.images, '_look-test-scratch', gen.json.filename);
  assert.ok(fs.existsSync(scratchPath));

  const saved = await post('/api/looks/test-generate/save', { filename: gen.json.filename });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.ok, true);
  assert.equal(saved.json.url, '/story-images/look-test-saves/' + gen.json.filename);

  assert.ok(!fs.existsSync(scratchPath), 'file must be moved out of scratch, not copied');
  assert.ok(fs.existsSync(path.join(DIRS.images, 'look-test-saves', gen.json.filename)));
});

test('POST /api/looks/test-generate/cleanup deletes only the listed scratch files', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (String(url).includes('/sdapi/v1/txt2img')) {
      return {
        ok: true,
        json: async () => ({
          images: ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
          info: JSON.stringify({ seed: 1 }),
        }),
      };
    }
    throw new Error('unexpected fetch in test: ' + String(url));
  });

  const genA = await post('/api/looks/test-generate', { test_subject: 'a' });
  const genB = await post('/api/looks/test-generate', { test_subject: 'b' });

  const cleanup = await post('/api/looks/test-generate/cleanup', { filenames: [genA.json.filename, 'nonexistent-file.png'] });
  assert.equal(cleanup.status, 200);
  assert.equal(cleanup.json.ok, true);

  assert.ok(!fs.existsSync(path.join(DIRS.images, '_look-test-scratch', genA.json.filename)), 'listed file must be deleted');
  assert.ok(fs.existsSync(path.join(DIRS.images, '_look-test-scratch', genB.json.filename)), 'unlisted file must survive');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-sqlite --test src/routes/__tests__/looks.routes.test.js`
Expected: FAIL — `404` on `POST /api/looks/test-generate` (route doesn't exist yet)

- [ ] **Step 3: Implement the three routes**

In `src/routes/looks.js`, add these imports at the top (alongside the existing ones):

```js
import fs from 'fs';
import path from 'path';
import { IMAGES_DIR } from '../paths.js';
import { resolveMasterConfig } from '../services/config-resolver.js';
import { loraTags } from '../services/prompt-builder.js';
import * as a1111 from '../services/a1111.js';
```

Add these three routes at the end of the file, immediately before `export default router;`:

```js
const SCRATCH_DIR = path.join(IMAGES_DIR, '_look-test-scratch');
const SAVES_DIR = path.join(IMAGES_DIR, 'look-test-saves');

function _a1111BaseUrl() {
  const config = resolveMasterConfig(db);
  return config.a1111_url || 'http://127.0.0.1:7860';
}

router.post('/test-generate', async function (req, res) {
  const b = req.body || {};
  try {
    const master = resolveMasterConfig(db);
    const loras = loraTags({ loras_json: JSON.stringify(Array.isArray(b.loras) ? b.loras : []) });
    const promptParts = [...loras, b.prompt_prefix || '', b.test_subject || '', b.prompt_suffix || ''].filter(Boolean);
    const prompt = promptParts.join(', ');
    const negative = [b.negative || '', master.master_negative || ''].filter(Boolean).join(', ');

    const payload = {
      prompt,
      negative_prompt: negative,
      steps: b.steps != null && b.steps !== '' ? parseInt(b.steps, 10) : 30,
      cfg_scale: b.cfg != null && b.cfg !== '' ? Number(b.cfg) : 7,
      width: b.width != null && b.width !== '' ? parseInt(b.width, 10) : 832,
      height: b.height != null && b.height !== '' ? parseInt(b.height, 10) : 1216,
      sampler_name: b.sampler || 'DPM++ 2M SDE',
      scheduler: b.scheduler || 'Karras',
      restore_faces: !!b.restore_faces,
      tiling: !!b.tiling,
      seed: -1,
      n_iter: 1,
      batch_size: 1,
    };
    if (b.vae || (b.clip_skip != null && b.clip_skip !== '')) {
      payload.override_settings = {};
      if (b.vae) payload.override_settings.sd_vae = b.vae;
      if (b.clip_skip != null && b.clip_skip !== '') payload.override_settings.CLIP_stop_at_last_layers = parseInt(b.clip_skip, 10);
      payload.override_settings_restore_afterwards = true;
    }

    fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const savePath = path.join(SCRATCH_DIR, filename);

    const result = await a1111.txt2img(_a1111BaseUrl(), payload, savePath);
    res.json({
      ok: true,
      filename: result.filename,
      url: `/story-images/_look-test-scratch/${result.filename}`,
      seed: result.seed,
      generation_time_ms: result.generation_time_ms,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post('/test-generate/save', function (req, res) {
  const { filename } = req.body || {};
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return res.status(400).json({ ok: false, error: 'valid filename is required' });
  }
  const from = path.join(SCRATCH_DIR, filename);
  if (!fs.existsSync(from)) return res.status(404).json({ ok: false, error: 'scratch file not found' });

  fs.mkdirSync(SAVES_DIR, { recursive: true });
  const to = path.join(SAVES_DIR, filename);
  fs.renameSync(from, to);
  res.json({ ok: true, url: `/story-images/look-test-saves/${filename}` });
});

router.post('/test-generate/cleanup', function (req, res) {
  const { filenames } = req.body || {};
  let deleted = 0;
  for (const filename of Array.isArray(filenames) ? filenames : []) {
    if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) continue;
    const p = path.join(SCRATCH_DIR, filename);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      deleted++;
    }
  }
  res.json({ ok: true, deleted });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-sqlite --test src/routes/__tests__/looks.routes.test.js`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Run the full backend test suite**

Run: `node --experimental-sqlite --test src/`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/looks.js src/routes/__tests__/looks.routes.test.js
git commit -m "feat: add Look test-generation, save, and cleanup endpoints"
```

---

### Task 9: `public/js/api.js` — test-generation wrappers + pure form-payload helper

**Files:**
- Modify: `public/js/api.js` (add after `activateLook`, currently line 168)
- Create: `public/js/look-editor-form.js`
- Create: `public/js/__tests__/look-editor-form.test.js`

**Interfaces:**
- Produces: `API.testGenerateLook(draft)`, `API.saveTestLookImage(filename)`, `API.cleanupTestLookImages(filenames)`. Also produces pure, DOM-free helpers consumed by Task 10's UI: `collectLookPayload(formEl)`, `addLoraRow(loras)`, `removeLoraRow(loras, index)` — matching this codebase's established pattern (`public/js/outfit-sets-validation.js`) of extracting DOM-free logic into its own tested module rather than burying it in inline event handlers.

- [ ] **Step 1: Write the failing test**

Create `public/js/__tests__/look-editor-form.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addLoraRow, removeLoraRow, buildLookPayload } from '../look-editor-form.js';

test('addLoraRow appends a blank row without mutating the input array', () => {
  const before = [{ file: 'a', strength: 1 }];
  const after = addLoraRow(before);
  assert.equal(before.length, 1, 'input array must not be mutated');
  assert.equal(after.length, 2);
  assert.deepEqual(after[1], { file: '', strength: 1.0 });
});

test('removeLoraRow removes exactly the row at the given index', () => {
  const before = [{ file: 'a', strength: 1 }, { file: 'b', strength: 0.5 }, { file: 'c', strength: 0.8 }];
  const after = removeLoraRow(before, 1);
  assert.deepEqual(after, [{ file: 'a', strength: 1 }, { file: 'c', strength: 0.8 }]);
});

test('buildLookPayload trims name, filters blank LoRA rows, and coerces numeric fields', () => {
  const payload = buildLookPayload({
    name: '  My Look  ', description: 'desc', checkpoint: 'model.safetensors',
    vae: '', clip_skip: '', restore_faces: true, tiling: false,
    loras: [{ file: 'realLora', strength: '0.7' }, { file: '', strength: 1 }],
    prompt_prefix: 'p', prompt_suffix: 's', negative: 'n',
    sampler: 'Euler a', scheduler: 'Karras', steps: '25', cfg: '6.5', width: '768', height: '1024',
  });
  assert.equal(payload.name, 'My Look');
  assert.equal(payload.clip_skip, null);
  assert.equal(payload.restore_faces, true);
  assert.deepEqual(payload.loras, [{ file: 'realLora', strength: 0.7 }]);
  assert.equal(payload.steps, 25);
  assert.equal(payload.cfg, 6.5);
  assert.equal(payload.width, 768);
  assert.equal(payload.height, 1024);
});

test('buildLookPayload returns ok:false when name is blank', () => {
  const payload = buildLookPayload({ name: '   ' });
  assert.equal(payload.ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test public/js/__tests__/look-editor-form.test.js`
Expected: FAIL — `Cannot find module '../look-editor-form.js'`

- [ ] **Step 3: Create `public/js/look-editor-form.js`**

```js
// Pure, DOM-free Look-editor form logic. Kept separate from views/settings.js
// so it's unit-testable with node:test even though it's served to the browser.

export function addLoraRow(loras) {
  return [...(loras || []), { file: '', strength: 1.0 }];
}

export function removeLoraRow(loras, index) {
  return (loras || []).filter((_, i) => i !== index);
}

function _numOrDefault(v, def) {
  if (v === '' || v == null) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function _intOrNull(v) {
  if (v === '' || v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Builds the request body for POST/PUT /api/looks (and the equivalent draft
 * shape for POST /api/looks/test-generate, which accepts the same field
 * names) from a plain object of raw form values. Returns { ok: false } if
 * required fields are missing — never throws.
 */
export function buildLookPayload(fields) {
  const name = String(fields.name || '').trim();
  if (!name) return { ok: false, error: 'Name is required.' };

  return {
    ok: true,
    name,
    description: fields.description || '',
    checkpoint: fields.checkpoint || '',
    vae: fields.vae || '',
    clip_skip: _intOrNull(fields.clip_skip),
    restore_faces: !!fields.restore_faces,
    tiling: !!fields.tiling,
    loras: (fields.loras || [])
      .filter((l) => l && l.file)
      .map((l) => ({ file: l.file, strength: _numOrDefault(l.strength, 1.0) })),
    prompt_prefix: fields.prompt_prefix || '',
    prompt_suffix: fields.prompt_suffix || '',
    negative: fields.negative || '',
    sampler: fields.sampler || 'DPM++ 2M SDE',
    scheduler: fields.scheduler || 'Karras',
    steps: _numOrDefault(fields.steps, 30),
    cfg: _numOrDefault(fields.cfg, 7),
    width: _numOrDefault(fields.width, 832),
    height: _numOrDefault(fields.height, 1216),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test public/js/__tests__/look-editor-form.test.js`
Expected: PASS

- [ ] **Step 5: Add the API wrappers**

In `public/js/api.js`, add after `activateLook` (currently line 168):

```js
    testGenerateLook:     function (draft)     { return request('POST', '/api/looks/test-generate', draft); },
    saveTestLookImage:    function (filename)   { return request('POST', '/api/looks/test-generate/save', { filename }); },
    cleanupTestLookImages: function (filenames) { return request('POST', '/api/looks/test-generate/cleanup', { filenames }); },
```

- [ ] **Step 6: Commit**

```bash
git add public/js/api.js public/js/look-editor-form.js public/js/__tests__/look-editor-form.test.js
git commit -m "feat: add Look test-generation API wrappers and pure form-payload helper"
```

---

### Task 10: `settings.js` — rebuild the Look editor UI

**Files:**
- Modify: `public/js/views/settings.js:1-12` (imports, remove dead `ITZ_SAMPLERS`/`ITZ_SCHEDULERS`)
- Modify: `public/js/views/settings.js:620-714` (`showLookEditor` — full rewrite)

**Interfaces:**
- Consumes: `API.getA1111Models/Loras/Samplers/Schedulers/Vaes` (Task 6), `API.createLook/updateLook` (Task 7), `API.testGenerateLook/saveTestLookImage/cleanupTestLookImages` (Task 9), `buildLookPayload/addLoraRow/removeLoraRow` from `../look-editor-form.js` (Task 9).
- No new exports — this is the final integration task, consumed only by the browser.

This task is UI wiring with no automated test (matches this codebase's existing pattern — `showLookEditor` itself has never had a test; the pure logic it depends on was already tested in Task 9). Verify manually per Step 4.

- [ ] **Step 1: Remove the dead ComfyUI-style sampler/scheduler lists and add the new import**

In `public/js/views/settings.js`, delete lines 6-12 (`var ITZ_SAMPLERS = [...]` and `var ITZ_SCHEDULERS = [...]` — both are dead/wrong: `ITZ_SCHEDULERS` is never referenced anywhere, and `ITZ_SAMPLERS` currently feeds the sampler dropdown with invalid ComfyUI-style names like `dpmpp_2m_sde` instead of A1111's actual `DPM++ 2M SDE`).

Update the import line (currently line 3):

```js
import { showToast, showConfirm, setLoading, statusDotsHtml } from '../ui.js';
import { buildLookPayload, addLoraRow, removeLoraRow } from '../look-editor-form.js';
```

- [ ] **Step 2: Add module-level state for the editor's in-progress draft**

Add near the top of the file, alongside the existing `var ITZ_SAMPLERS` line that was just removed (i.e. where that used to be):

```js
var _lookEditorState = null; // { loras: [], testResults: [], scratchFilenames: Set }
var _a1111Catalog = null;    // { models, vaes, loras, samplers, schedulers } — fetched once per editor open
```

- [ ] **Step 3: Rewrite `showLookEditor`**

Replace the entire `showLookEditor` function (currently `public/js/views/settings.js:620-714`) with:

```js
var SCHEDULER_FALLBACK = ['Automatic', 'Karras', 'Exponential', 'Normal', 'Simple', 'SGM Uniform'];
var RESOLUTION_PRESETS = [
  { label: '832\u00d71216 Portrait', width: 832, height: 1216 },
  { label: '1024\u00d71024 Square', width: 1024, height: 1024 },
  { label: '1216\u00d7832 Landscape', width: 1216, height: 832 },
];

function _cleanupLookEditorScratch() {
  if (_lookEditorState && _lookEditorState.scratchFilenames.size) {
    API.cleanupTestLookImages(Array.from(_lookEditorState.scratchFilenames)).catch(function () {});
  }
  _lookEditorState = null;
}

function showLookEditor(look) {
  var editorEl = document.getElementById('look-editor');
  if (!editorEl) return;
  var isNew = !look;
  var l = look || {};

  _lookEditorState = {
    loras: (function () {
      try { return JSON.parse(l.loras_json || '[]'); } catch (_) { return []; }
    })(),
    testResults: [],
    scratchFilenames: new Set(),
  };

  editorEl.style.display = '';
  editorEl.innerHTML = '<div class="loading-state">Loading A1111 catalog...</div>';

  Promise.all([
    API.getA1111Models().catch(function () { return { ok: false, models: [] }; }),
    API.getA1111Vaes().catch(function () { return { ok: false, vaes: [] }; }),
    API.getA1111Loras().catch(function () { return { ok: false, loras: [] }; }),
    API.getA1111Samplers().catch(function () { return { ok: false, samplers: [] }; }),
    API.getA1111Schedulers().catch(function () { return { ok: false, schedulers: [] }; }),
  ]).then(function (results) {
    _a1111Catalog = {
      models: results[0].models || [],
      vaes: results[1].vaes || [],
      loras: results[2].loras || [],
      samplers: results[3].samplers || [],
      schedulers: (results[4].schedulers && results[4].schedulers.length) ? results[4].schedulers : SCHEDULER_FALLBACK,
    };
    _renderLookEditor(editorEl, look, isNew);
  });
}

function _optionsHtml(values, current, blankLabel) {
  var html = '';
  if (blankLabel) html += '<option value=""' + (!current ? ' selected' : '') + '>' + blankLabel + '</option>';
  html += values.map(function (v) {
    var value = typeof v === 'string' ? v : (v.title || v.model_name || v.name);
    var label = typeof v === 'string' ? v : (v.title || v.model_name || v.name);
    return '<option value="' + escapeHtml(value) + '"' + (current === value ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
  }).join('');
  return html;
}

function _renderLoraRows() {
  return _lookEditorState.loras.map(function (lora, i) {
    return '<div class="lora-row" data-idx="' + i + '" style="display:grid;grid-template-columns:1fr 90px 32px;gap:8px;margin-bottom:6px">' +
      '<select class="form-input le-lora-file" data-idx="' + i + '">' +
        _optionsHtml(_a1111Catalog.loras.map(function (x) { return x.name; }), lora.file, '-- select LoRA --') +
      '</select>' +
      '<input type="number" step="0.05" min="0" max="2" class="form-input le-lora-strength" data-idx="' + i + '" value="' + (lora.strength != null ? lora.strength : 1.0) + '">' +
      '<button type="button" class="btn btn-ghost btn-xs le-lora-remove" data-idx="' + i + '" title="Remove">\u2715</button>' +
    '</div>';
  }).join('');
}

function _renderTestResults() {
  if (!_lookEditorState.testResults.length) return '<p class="text-muted" style="font-size:12px">No test images generated yet this session.</p>';
  return _lookEditorState.testResults.map(function (r, i) {
    return '<div class="test-result-card" data-idx="' + i + '" style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:10px">' +
      '<img src="' + r.url + '" style="width:100%;display:block">' +
      '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;font-size:11px;color:var(--text-muted)">' +
        '<span>seed ' + r.seed + ' \u2022 ' + Math.round(r.generation_time_ms / 100) / 10 + 's</span>' +
        '<button type="button" class="btn btn-xs btn-secondary le-test-save" data-idx="' + i + '" style="margin-left:auto" ' + (r.saved ? 'disabled' : '') + '>' + (r.saved ? 'Saved' : 'Save') + '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function _renderLookEditor(editorEl, look, isNew) {
  var l = look || {};
  var cat = _a1111Catalog;

  editorEl.innerHTML =
    '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:14px">' +
      '<h3 style="margin:0 0 12px;font-size:14px">' + (isNew ? 'New Look' : 'Edit: ' + escapeHtml(l.name || '')) + '</h3>' +

      '<h4 style="margin:14px 0 8px;font-size:12px;text-transform:uppercase;color:var(--text-muted)">Model &amp; Rendering</h4>' +
      '<div class="form-group"><label class="form-label">Checkpoint</label>' +
        '<select class="form-input" id="le-checkpoint">' + _optionsHtml(cat.models, l.checkpoint || '', '-- use currently loaded --') + '</select></div>' +
      '<div class="form-group"><label class="form-label">VAE</label>' +
        '<select class="form-input" id="le-vae">' + _optionsHtml(cat.vaes.map(function (v) { return v.name; }), l.vae || '', '-- use A1111 default --') + '</select></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">' +
        '<div class="form-group"><label class="form-label">Clip Skip <span class="form-hint">(1-12, blank = default)</span></label>' +
          '<input type="number" min="1" max="12" class="form-input" id="le-clip-skip" value="' + (l.clip_skip != null ? l.clip_skip : '') + '"></div>' +
        '<div class="form-group"><label class="form-label">Restore Faces</label>' +
          '<label style="display:flex;align-items:center;gap:6px;height:34px"><input type="checkbox" id="le-restore-faces" ' + (l.restore_faces ? 'checked' : '') + '> On</label></div>' +
        '<div class="form-group"><label class="form-label">Tiling</label>' +
          '<label style="display:flex;align-items:center;gap:6px;height:34px"><input type="checkbox" id="le-tiling" ' + (l.tiling ? 'checked' : '') + '> On</label></div>' +
      '</div>' +

      '<h4 style="margin:14px 0 8px;font-size:12px;text-transform:uppercase;color:var(--text-muted)">LoRAs</h4>' +
      '<div id="le-lora-rows">' + _renderLoraRows() + '</div>' +
      '<button type="button" class="btn btn-ghost btn-xs" id="le-lora-add">+ Add LoRA</button>' +

      '<h4 style="margin:14px 0 8px;font-size:12px;text-transform:uppercase;color:var(--text-muted)">Sampling</h4>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<div class="form-group"><label class="form-label">Sampler</label>' +
          '<select class="form-input" id="le-sampler">' + _optionsHtml(cat.samplers, l.sampler || 'DPM++ 2M SDE') + '</select></div>' +
        '<div class="form-group"><label class="form-label">Scheduler</label>' +
          '<select class="form-input" id="le-scheduler">' + _optionsHtml(cat.schedulers, l.scheduler || 'Karras') + '</select></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<div class="form-group"><label class="form-label">Steps</label>' +
          '<input type="number" class="form-input" id="le-steps" value="' + (l.steps != null ? l.steps : 30) + '"></div>' +
        '<div class="form-group"><label class="form-label">CFG</label>' +
          '<input type="number" step="0.5" class="form-input" id="le-cfg" value="' + (l.cfg != null ? l.cfg : 7) + '"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<div class="form-group"><label class="form-label">Width</label>' +
          '<input type="number" class="form-input" id="le-width" value="' + (l.width != null ? l.width : 832) + '"></div>' +
        '<div class="form-group"><label class="form-label">Height</label>' +
          '<input type="number" class="form-input" id="le-height" value="' + (l.height != null ? l.height : 1216) + '"></div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:10px">' +
        RESOLUTION_PRESETS.map(function (p, i) {
          return '<button type="button" class="btn btn-ghost btn-xs le-res-preset" data-w="' + p.width + '" data-h="' + p.height + '">' + p.label + '</button>';
        }).join('') +
      '</div>' +

      '<h4 style="margin:14px 0 8px;font-size:12px;text-transform:uppercase;color:var(--text-muted)">Prompt</h4>' +
      '<div class="form-group"><label class="form-label">Prompt Prefix <span class="form-hint">(style — goes first)</span></label>' +
        '<textarea class="form-input" id="le-prefix" rows="2">' + escapeHtml(l.prompt_prefix || '') + '</textarea></div>' +
      '<div class="form-group"><label class="form-label">Prompt Suffix <span class="form-hint">(style — goes last)</span></label>' +
        '<textarea class="form-input" id="le-suffix" rows="2">' + escapeHtml(l.prompt_suffix || '') + '</textarea></div>' +
      '<div class="form-group"><label class="form-label">Negative <span class="form-hint">(style only — anatomy/safety negatives are handled separately and always applied)</span></label>' +
        '<textarea class="form-input" id="le-negative" rows="2">' + escapeHtml(l.negative || '') + '</textarea></div>' +

      '<h4 style="margin:14px 0 8px;font-size:12px;text-transform:uppercase;color:var(--text-muted)">Test Generation</h4>' +
      '<div class="form-group"><label class="form-label">Test Subject</label>' +
        '<input type="text" class="form-input" id="le-test-subject" value="a woman standing in a park, full body"></div>' +
      '<button type="button" class="btn btn-secondary btn-sm" id="le-test-generate" style="margin-bottom:10px">Generate Test Image</button>' +
      '<div id="le-test-results">' + _renderTestResults() + '</div>' +

      '<h4 style="margin:14px 0 8px;font-size:12px;text-transform:uppercase;color:var(--text-muted)">Save as Look</h4>' +
      '<div class="form-group"><label class="form-label">Name</label>' +
        '<input type="text" class="form-input" id="le-name" value="' + escapeHtml(l.name || '') + '"></div>' +
      '<div class="form-group"><label class="form-label">Description</label>' +
        '<input type="text" class="form-input" id="le-description" value="' + escapeHtml(l.description || '') + '"></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button class="btn btn-primary btn-sm" id="le-save">' + (isNew ? 'Create Look' : 'Save Changes') + '</button>' +
        '<button class="btn btn-ghost btn-sm" id="le-cancel">Cancel</button>' +
      '</div>' +
    '</div>';

  _wireLookEditorEvents(editorEl, look, isNew);
}

function _collectDraftFields() {
  return {
    name: document.getElementById('le-name').value,
    description: document.getElementById('le-description').value.trim(),
    checkpoint: document.getElementById('le-checkpoint').value,
    vae: document.getElementById('le-vae').value,
    clip_skip: document.getElementById('le-clip-skip').value,
    restore_faces: document.getElementById('le-restore-faces').checked,
    tiling: document.getElementById('le-tiling').checked,
    loras: _lookEditorState.loras,
    prompt_prefix: document.getElementById('le-prefix').value.trim(),
    prompt_suffix: document.getElementById('le-suffix').value.trim(),
    negative: document.getElementById('le-negative').value.trim(),
    sampler: document.getElementById('le-sampler').value,
    scheduler: document.getElementById('le-scheduler').value,
    steps: document.getElementById('le-steps').value,
    cfg: document.getElementById('le-cfg').value,
    width: document.getElementById('le-width').value,
    height: document.getElementById('le-height').value,
  };
}

function _wireLookEditorEvents(editorEl, look, isNew) {
  editorEl.querySelectorAll('.le-lora-file').forEach(function (sel) {
    sel.onchange = function () { _lookEditorState.loras[Number(sel.dataset.idx)].file = sel.value; };
  });
  editorEl.querySelectorAll('.le-lora-strength').forEach(function (inp) {
    inp.onchange = function () { _lookEditorState.loras[Number(inp.dataset.idx)].strength = Number(inp.value) || 1.0; };
  });
  editorEl.querySelectorAll('.le-lora-remove').forEach(function (btn) {
    btn.onclick = function () {
      _lookEditorState.loras = removeLoraRow(_lookEditorState.loras, Number(btn.dataset.idx));
      document.getElementById('le-lora-rows').innerHTML = _renderLoraRows();
      _wireLookEditorEvents(editorEl, look, isNew);
    };
  });
  document.getElementById('le-lora-add').onclick = function () {
    _lookEditorState.loras = addLoraRow(_lookEditorState.loras);
    document.getElementById('le-lora-rows').innerHTML = _renderLoraRows();
    _wireLookEditorEvents(editorEl, look, isNew);
  };

  editorEl.querySelectorAll('.le-res-preset').forEach(function (btn) {
    btn.onclick = function () {
      document.getElementById('le-width').value = btn.dataset.w;
      document.getElementById('le-height').value = btn.dataset.h;
    };
  });

  document.getElementById('le-test-generate').onclick = function () {
    var btn = document.getElementById('le-test-generate');
    var draft = _collectDraftFields();
    draft.test_subject = document.getElementById('le-test-subject').value.trim();
    setLoading(btn, true, 'Generating...');
    API.testGenerateLook(draft).then(function (result) {
      setLoading(btn, false);
      if (!result.ok) { showToast('Test generation failed: ' + (result.error || 'unknown error'), 'error'); return; }
      _lookEditorState.scratchFilenames.add(result.filename);
      _lookEditorState.testResults.unshift({ url: result.url, filename: result.filename, seed: result.seed, generation_time_ms: result.generation_time_ms, saved: false });
      if (_lookEditorState.testResults.length > 12) _lookEditorState.testResults.length = 12;
      document.getElementById('le-test-results').innerHTML = _renderTestResults();
      _wireTestResultButtons(editorEl);
    }).catch(function (e) {
      setLoading(btn, false);
      showToast('Test generation failed: ' + e.message, 'error');
    });
  };
  _wireTestResultButtons(editorEl);

  document.getElementById('le-cancel').onclick = function () {
    _cleanupLookEditorScratch();
    editorEl.style.display = 'none';
    editorEl.innerHTML = '';
  };

  document.getElementById('le-save').onclick = function () {
    var saveBtn = document.getElementById('le-save');
    var payload = buildLookPayload(_collectDraftFields());
    if (!payload.ok) { showToast(payload.error, 'error'); return; }
    delete payload.ok;

    setLoading(saveBtn, true, 'Saving...');
    var promise = isNew ? API.createLook(payload) : API.updateLook(look.id, payload);
    promise.then(function () {
      showToast(isNew ? 'Look created.' : 'Look saved.', 'success');
      _lookEditorState.scratchFilenames.clear(); // saved images (if any) were kept via Save; the rest is abandoned scratch
      _cleanupLookEditorScratch();
      editorEl.style.display = 'none';
      editorEl.innerHTML = '';
      loadLooksList();
    }).catch(function (e) {
      showToast('Save failed: ' + e.message, 'error');
      setLoading(saveBtn, false);
    });
  };
}

function _wireTestResultButtons(editorEl) {
  editorEl.querySelectorAll('.le-test-save').forEach(function (btn) {
    btn.onclick = function () {
      var idx = Number(btn.dataset.idx);
      var result = _lookEditorState.testResults[idx];
      if (!result || result.saved) return;
      btn.disabled = true;
      API.saveTestLookImage(result.filename).then(function () {
        result.saved = true;
        _lookEditorState.scratchFilenames.delete(result.filename);
        btn.textContent = 'Saved';
        showToast('Image saved.', 'success');
      }).catch(function (e) {
        btn.disabled = false;
        showToast('Save failed: ' + e.message, 'error');
      });
    };
  });
}
```

- [ ] **Step 4: Manual verification**

Start the app (`npm run dev` or `node --experimental-sqlite --watch src/server.js`) and confirm A1111 is reachable at the configured URL (`Settings → Image Generation` shows "Connected"). Then:

1. Go to Settings → Image Generation → Looks → "+ New Look". Confirm Checkpoint, VAE, Sampler, and Scheduler are dropdowns populated with real values from your A1111 instance (not the old ComfyUI-style names) — Step 1 - PASS if every one of them shows real A1111 model/sampler/scheduler names.
2. Add two LoRA rows, pick files from the dropdown, remove one — Step 2 - PASS if exactly one row remains with the correct file.
3. Set a test subject, click "Generate Test Image" — Step 3 - PASS if an image appears with a seed and timing, and the button re-enables afterward.
4. Click "Save" on that test result — Step 4 - PASS if the button changes to "Saved" and stays disabled; confirm the file exists in `H:\MEDIA\Story_Lab\images\look-test-saves\` (or your configured `IMAGES_DIR`).
5. Generate a second test image without saving it, then click "Cancel" — Step 5 - PASS if the file for that second, unsaved image is gone from `IMAGES_DIR\_look-test-scratch\` afterward (the saved one from step 4 is untouched).
6. Fill in Name + Description at the bottom, click "Create Look" — Step 6 - PASS if the new Look appears in the Looks list above with all the settings you configured.
7. Edit that Look again — Step 7 - PASS if every field (checkpoint, VAE, LoRAs, sampler, scheduler, steps, CFG, resolution, clip skip, restore faces, tiling) is pre-filled with what you saved.
8. Activate the new Look and generate a real image from Play mode — Step 8 - PASS if generation still works end-to-end (confirms Task 5's payload changes didn't break the real pipeline).

If any step fails, state clearly which step and stop — do not proceed to commit.

- [ ] **Step 5: Commit**

```bash
git add public/js/views/settings.js
git commit -m "feat: rebuild Look editor with full settings coverage and test generation"
```

---

## Self-Review Notes

- **Spec coverage:** Schema (Task 1), default-look untouched-detection (Task 2), LoRA prompt embedding (Task 3), full-ownership resolver (Task 4), image-pipeline payload (Task 5), VAE catalog + scheduler wrapper (Task 6), Looks CRUD (Task 7), test-generate/save/cleanup (Task 8), frontend API wrappers + pure form helper (Task 9), full editor UI rewrite (Task 10) — every section of the design spec maps to a task.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code.
- **Type consistency:** `loraTags(look)` (Task 3) is the one and only LoRA-tag formatter, reused by `buildPrompt` (Task 3) and the test-generate route (Task 8) via the same `{loras_json}`-shaped input. `resolveEffectiveConfig`'s new keys (`vae`, `clip_skip`, `restore_faces`, `tiling`) match exactly what Task 5's payload construction reads. `buildLookPayload`'s output field names (Task 9) match exactly what `routes/looks.js`'s `POST`/`PUT` handlers read (Task 7).
