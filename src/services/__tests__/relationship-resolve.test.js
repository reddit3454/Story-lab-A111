import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  parseTags,
  serializeTags,
  resolveRelationshipsForScenario,
  applyStrengthDelta,
  formatRelationshipLine,
} from '../relationship-resolve.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE characters (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE scenario_characters (scenario_id INTEGER, character_id INTEGER);
    CREATE TABLE character_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario_id INTEGER NOT NULL,
      from_character_id INTEGER NOT NULL,
      to_character_id INTEGER NOT NULL,
      relationship_type TEXT NOT NULL DEFAULT 'friend',
      description TEXT DEFAULT '',
      strength INTEGER DEFAULT 3,
      tags_json TEXT DEFAULT '[]',
      UNIQUE(scenario_id, from_character_id, to_character_id)
    );
  `);
  db.prepare('INSERT INTO characters (id, name) VALUES (1, ?), (2, ?), (3, ?)').run('Alice', 'Bob', 'Cara');
  db.prepare('INSERT INTO scenario_characters (scenario_id, character_id) VALUES (10,1),(10,2)').run();
  return db;
}

describe('relationship-resolve', () => {
  it('parseTags whitelists only', () => {
    assert.deepEqual(parseTags('["attraction","nope","trust"]'), ['attraction', 'trust']);
    assert.equal(serializeTags(['attraction', 'evil']), '["attraction"]');
  });

  it('resolve prefers scenario overlay over global', () => {
    const db = makeDb();
    db.prepare(`
      INSERT INTO character_relationships
        (scenario_id, from_character_id, to_character_id, relationship_type, strength, tags_json)
      VALUES (0, 1, 2, 'friend', 2, '["trust"]')
    `).run();
    db.prepare(`
      INSERT INTO character_relationships
        (scenario_id, from_character_id, to_character_id, relationship_type, strength, tags_json)
      VALUES (10, 1, 2, 'rival', 4, '["tension"]')
    `).run();
    const rows = resolveRelationshipsForScenario(db, 10);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].relationship_type, 'rival');
    assert.equal(rows[0].strength, 4);
    assert.deepEqual(rows[0].tags, ['tension']);
    assert.equal(rows[0]._source, 'scenario');
  });

  it('applyStrengthDelta clone-on-write from global', () => {
    const db = makeDb();
    db.prepare(`
      INSERT INTO character_relationships
        (scenario_id, from_character_id, to_character_id, relationship_type, strength, tags_json)
      VALUES (0, 1, 2, 'friend', 3, '["trust"]')
    `).run();
    const changed = applyStrengthDelta(db, { scenarioId: 10, fromId: 1, toId: 2, delta: 1 });
    assert.ok(changed);
    assert.equal(changed.scenario_id, 10);
    assert.equal(changed.strength, 4);
    const global = db.prepare('SELECT strength FROM character_relationships WHERE scenario_id = 0').get();
    assert.equal(global.strength, 3);
  });

  it('formatRelationshipLine includes tags and intensity', () => {
    const line = formatRelationshipLine({
      from_name: 'Alex', to_name: 'Sam', relationship_type: 'romantic partner',
      tags: ['attraction', 'tension'], strength: 4, description: 'dating casually',
    });
    assert.match(line, /Alex -> Sam: romantic partner \(attraction, tension\) \[intensity 4\/5\] \(dating casually\)/);
  });
});
