const LOOK_FIELDS = [
  'name', 'description', 'checkpoint', 'vae', 'clip_skip', 'restore_faces',
  'tiling', 'loras_json', 'prompt_prefix', 'prompt_suffix', 'negative',
  'sampler', 'scheduler', 'steps', 'cfg', 'width', 'height', 'is_active',
];

function parseLoras(raw) {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

export function snapshotLook(row) {
  const snapshot = {};
  for (const field of LOOK_FIELDS) snapshot[field] = row[field];
  snapshot.loras = parseLoras(row.loras_json);
  return snapshot;
}

export function parseLookSnapshot(json) {
  const snapshot = typeof json === 'string' ? JSON.parse(json) : json;
  if (!snapshot || typeof snapshot !== 'object') throw new Error('invalid Look snapshot');
  return snapshot;
}

export function migrateLookVersionSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS image_look_versions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      look_id           INTEGER REFERENCES image_looks(id) ON DELETE CASCADE,
      status            TEXT NOT NULL,
      source_version_id INTEGER REFERENCES image_look_versions(id),
      snapshot_json     TEXT NOT NULL,
      created_at        TEXT DEFAULT (datetime('now')),
      activated_at      TEXT DEFAULT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_image_look_versions_look_id ON image_look_versions(look_id)');
}

export function seedLookBaselines(db) {
  const rows = db.prepare('SELECT * FROM image_looks').all();
  const hasBaseline = db.prepare("SELECT 1 FROM image_look_versions WHERE look_id = ? AND status = 'baseline' LIMIT 1");
  const insert = db.prepare("INSERT INTO image_look_versions (look_id, status, snapshot_json) VALUES (?, 'baseline', ?)");
  for (const row of rows) {
    if (hasBaseline.get(row.id)) continue;
    insert.run(row.id, JSON.stringify(snapshotLook(row)));
  }
}
