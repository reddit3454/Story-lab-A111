import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const ROOT_DIR        = join(__dirname, '..');
export const PUBLIC_DIR      = join(ROOT_DIR, 'public');
export const DATA_DIR        = 'H:\\MEDIA\\Story_Lab\\data';
export const AUDIO_DIR       = 'H:\\MEDIA\\Story_Lab\\audio';
export const IMAGES_DIR      = 'H:\\MEDIA\\Story_Lab\\images';
export const DB_PATH         = join(DATA_DIR, 'story-lab.db');
export const AUDIT_LOG_PATH  = join(DATA_DIR, 'audit.jsonl');
export const POSE_LIBRARY_DIR = process.env.STORYLAB_POSE_LIBRARY_DIR || 'H:\\MEDIA\\Model_pose_reference\\storylab_pose_library';

function ensureDirectories() {
  for (const dir of [DATA_DIR, AUDIO_DIR, IMAGES_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

ensureDirectories();
