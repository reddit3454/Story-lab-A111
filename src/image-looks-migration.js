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
