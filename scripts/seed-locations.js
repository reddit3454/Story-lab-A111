import db from '../src/db.js';
import fs from 'fs';
import path from 'path';
import { BACKGROUNDS_DIR } from '../src/paths.js';

const LOCATIONS = [
  { name: 'Beach',        background_folder: 'Beach',               time_of_day: 'any' },
  { name: 'Campsite',     background_folder: 'Campsite',            time_of_day: 'night' },
  { name: 'Car',          background_folder: 'Car',                 time_of_day: 'any' },
  { name: 'Apartment',    background_folder: 'Jib_Sarah_Apartment', time_of_day: 'any' },
  { name: 'Motel',        background_folder: 'Motel',               time_of_day: 'night' },
  { name: 'Park (Night)', background_folder: 'Park_night',          time_of_day: 'night' },
  { name: "Sarah's Room", background_folder: 'Sarahs_room',         time_of_day: 'any' },
  { name: 'Bathroom',     background_folder: 'Bathroom',            time_of_day: 'any' },
];

const insertLoc = db.prepare(
  'INSERT OR IGNORE INTO locations (name, background_folder, time_of_day) VALUES (?, ?, ?)'
);
const insertBg = db.prepare(
  'INSERT OR IGNORE INTO location_backgrounds (location_id, filename) VALUES (?, ?)'
);
const setDefault = db.prepare(
  'UPDATE location_backgrounds SET is_default = 1 WHERE location_id = ? AND filename = ?'
);

for (const loc of LOCATIONS) {
  insertLoc.run(loc.name, loc.background_folder, loc.time_of_day);
  const row = db.prepare('SELECT id FROM locations WHERE background_folder = ?').get(loc.background_folder);
  if (!row) continue;
  const folderPath = path.join(BACKGROUNDS_DIR, loc.background_folder);
  if (!fs.existsSync(folderPath)) { console.log(`SKIP (folder missing): ${folderPath}`); continue; }
  const files = fs.readdirSync(folderPath).filter(f => /\.(png|jpg|jpeg)$/i.test(f)).sort();
  for (const filename of files) insertBg.run(row.id, filename);
  if (files.length) setDefault.run(row.id, files[0]);
  console.log(`${loc.name}: ${files.length} background(s) registered`);
}

console.log('Done.');
