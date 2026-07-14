const fs = require("fs");
const path = require("path");
const root = "E:/TheHub/projects/Story-lab-A111";

// --- prompt-extractor.js ---
const pePath = path.join(root, "src/services/prompt-extractor.js");
let pe = fs.readFileSync(pePath, "utf8");

const utilBlock = `import * as ollama from './ollama.js';
import { log, logError } from '../logger.js';

const GENERIC_SETTING_TAGS = new Set([
  'indoor setting', 'outdoor setting', 'group setting implied',
]);

const DURATION_TAG_RE = /^(?:\\d+\\s*seconds?|ten seconds|few seconds|for \\d+)/i;

export function getLocationTagString(location) {
  if (!location) return '';
  const tod = (location.time_of_day || '').toLowerCase();
  if (tod === 'night' && location.image_tags_night) return location.image_tags_night;
  return location.image_tags_day || location.image_tags || '';
}

export function sanitizePlainSummary(text) {
  let t = (text || '').trim();
  if (!t) return '';
  t = t.replace(/\\b(?:for|lasting)\\s+(?:about\\s+)?(?:a\\s+)?(?:few\\s+)?\\d+\\s+seconds?\\b/gi, '');
  t = t.replace(/\\b(?:for|lasting)\\s+(?:a\\s+)?(?:few\\s+)?(?:seconds?|moments?|minutes?)\\b/gi, '');
  t = t.replace(/\\bfor\\s+ten\\s+seconds\\b/gi, '');
  t = t.replace(/\\s+,/g, ',').replace(/,\\s*,/g, ',').replace(/\\s{2,}/g, ' ').replace(/\\s+([.;,])/g, '$1').trim();
  return t;
}

function _ensureLocationTags(tags, location) {
  if (!location) return tags;
  const locName = (location.name || '').trim();
  const locTags = getLocationTagString(location);
  const existing = (tags || '').toLowerCase();
  const toAdd = [];
  if (locName && !existing.includes(locName.toLowerCase())) toAdd.push(locName);
  if (locTags) {
    locTags.split(',').map(t => t.trim()).filter(Boolean).forEach(function (t) {
      if (!existing.includes(t.toLowerCase()) && !toAdd.some(function (a) { return a.toLowerCase() === t.toLowerCase(); })) {
        toAdd.push(t);
      }
    });
  }
  if (!toAdd.length) return tags;
  return (tags ? tags + ', ' : '') + toAdd.join(', ');
}

export function sanitizeImageTags(tags, location) {
  const parts = (tags || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  const hasLocation = !!(location && (location.name || getLocationTagString(location) || location.description || location.full_desc || location.short_desc));
  const filtered = parts.filter(function (t) {
    const low = t.toLowerCase();
    if (DURATION_TAG_RE.test(low)) return false;
    if (/\\bseconds?\\b/i.test(low) && /\\d|ten|few/i.test(low)) return false;
    if (hasLocation && GENERIC_SETTING_TAGS.has(low)) return false;
    return true;
  });
  return _ensureLocationTags(filtered.join(', '), location);
}

`;

if (!pe.startsWith("import * as ollama")) { console.error("unexpected pe start"); process.exit(1); }
pe = pe.replace(/^import \* as ollama[\s\S]*?^const SYSTEM = `/m, utilBlock + "const SYSTEM = `");

pe = pe.replace(
  /   - NEVER leave the environment empty - if unsure, use "indoor setting" or "outdoor setting"/,
  '   - Use the Location block when provided (name, description, image tags)\n   - Otherwise derive a specific place from the story text\n   - NEVER use vague placeholders like "indoor setting" or "outdoor setting" when a specific place is known\n   - NEVER guess indoor vs outdoor against Location or story facts'
);

pe = pe.replace(
  /- 12 to 28 tags total\n- Background\/environment tags are MANDATORY - every prompt must have them/,
  '- NEVER include duration or timer tags (seconds, minutes, "ten seconds")\n- 12 to 28 tags total\n- Background/environment tags are MANDATORY - at least one specific place tag from Location or story'
);

pe = pe.replace(
  /Describe only what a camera would see - not thoughts or dialogue\.`;/,
  `Describe only what a camera would see - not thoughts or dialogue.
- ALWAYS name the specific place/setting when Location is provided or the story names one
- NEVER mention durations, timers, or how long an action lasts (e.g. "for ten seconds")
- NEVER invent indoor/outdoor when Location or the story specifies the place.`;
);

pe = pe.replace(
  /- No comma-separated tags\. No bullet lists\. No commentary\.`;/,
  `- No comma-separated tags. No bullet lists. No commentary.
- NEVER mention durations or how long an action lasts
- ALWAYS include the specific setting from the Location block when provided.`;
);

pe = pe.replace(
  /- 14 to 26 tags total`;/,
  `- NEVER include duration tags (seconds, minutes, timed actions)
- REQUIRED: at least 2 environment tags from the Location block when provided (place name and/or location image tags)
- NEVER use vague "indoor setting", "outdoor setting", or "group setting implied" when Location gives specifics
- Do NOT tag other characters or imply a group unless visible in frame
- 14 to 26 tags total`;
);

pe = pe.replace(/^function buildLocationBlock/m, 'export function buildLocationBlock');

// extractPlainSummary - add location param and sanitization
pe = pe.replace(
  /export async function extractPlainSummary\(\{ storyText, characters = \[\], config = \{\} \}\) \{/,
  'export async function extractPlainSummary({ storyText, characters = [], location = null, config = {} }) {'
);
pe = pe.replace(
  /(export async function extractPlainSummary[\s\S]*?const charLines = buildCharLines\(characters\);\r?\n  const userMsg = \[)\r?\n    charLines\.length/,
  '$1\n    buildLocationBlock(location) ? \'Location:\\n\' + buildLocationBlock(location) : \'\',\n    charLines.length'
);
pe = pe.replace(
  /(export async function extractPlainSummary[\s\S]*?const cleaned = raw\r?\n      \.replace\([\s\S]*?\)\r?\n      \.trim\(\);\r?\n    log\('prompt-extractor', 'plain-result')/,
  function (m) {
    return m.replace(
      /\.trim\(\);\r?\n    log\('prompt-extractor', 'plain-result'/,
      ".trim();\n    const sanitized = sanitizePlainSummary(cleaned);\n    log('prompt-extractor', 'plain-result'"
    ).replace(
      /return cleaned \|\| raw;/,
      'return sanitized || cleaned || raw;'
    );
  }
);

// Fix extractPlainSummary return - the above might not work, do simpler replacements
if (!pe.includes('sanitizePlainSummary(cleaned)')) {
  pe = pe.replace(
    "    log('prompt-extractor', 'plain-result', { len: cleaned.length });\n    return cleaned || raw;",
    "    const sanitized = sanitizePlainSummary(cleaned);\n    log('prompt-extractor', 'plain-result', { len: sanitized.length });\n    return sanitized || cleaned || raw;"
  );
}

// extractImagePrompt - location + sanitization
pe = pe.replace(
  /export async function extractImagePrompt\(\{ storyText, characters = \[\], config = \{\} \}\) \{/,
  'export async function extractImagePrompt({ storyText, characters = [], location = null, config = {} }) {'
);
if (!pe.includes('extractImagePrompt') || !pe.match(/extractImagePrompt[\s\S]*?buildLocationBlock\(location\)/)) {
  pe = pe.replace(
    /(export async function extractImagePrompt[\s\S]*?const charLines = buildCharLines\(characters\);\r?\n\r?\n  const userMsg = \[)\r?\n    charLines\.length/,
    '$1\n    buildLocationBlock(location) ? \'Location:\\n\' + buildLocationBlock(location) : \'\',\n    charLines.length'
  );
}
pe = pe.replace(
  "    log('prompt-extractor', 'result', { tags: cleaned });\n    return cleaned || raw;",
  "    const sanitized = sanitizeImageTags(cleaned, location);\n    log('prompt-extractor', 'result', { tags: sanitized });\n    return sanitized || cleaned || raw;"
);

// character plain sanitization
pe = pe.replace(
  /(export async function extractCharacterPlainSummary[\s\S]*?const cleaned = raw\.replace\([\s\S]*?\)\.trim\(\);\r?\n    return cleaned \|\| raw;)/,
  function (m) {
    return m.replace('return cleaned || raw;', 'return sanitizePlainSummary(cleaned) || cleaned || raw;');
  }
);

// character tags sanitization
pe = pe.replace(
  /(export async function extractCharacterImagePrompt[\s\S]*?const cleaned = raw\.replace\([\s\S]*?\)\.trim\(\);\r?\n    return cleaned \|\| raw;)/,
  function (m) {
    return m.replace('return cleaned || raw;', 'return sanitizeImageTags(cleaned, location) || cleaned || raw;');
  }
);

fs.writeFileSync(pePath, pe);
console.log("prompt-extractor.js updated");

// --- regenerate-tags.js ---
const rtPath = path.join(root, "src/services/regenerate-tags.js");
let rt = fs.readFileSync(rtPath, "utf8");
if (!rt.includes('buildLocationBlock')) {
  rt = rt.replace(
    "import { log, logError } from '../logger.js';",
    "import { log, logError } from '../logger.js';\nimport { buildLocationBlock, sanitizeImageTags } from './prompt-extractor.js';"
  );
}
rt = rt.replace(
  /export async function regenerateTagsFromPlain\(db, \{ plainText, characters = \[\] \}\)/,
  'export async function regenerateTagsFromPlain(db, { plainText, characters = [], location = null })'
);
rt = rt.replace(
  `'Convert plain-language shot descriptions into comma-separated SDXL image tags.',
    'Output ONLY one line of tags. Include explicit nudity and sexual acts exactly as described.',
    '12 to 28 tags. Never use looking at viewer or facing camera.',`,
  `'Convert plain-language shot descriptions into comma-separated SDXL image tags.',
    'Output ONLY one line of tags. Include explicit nudity and sexual acts exactly as described.',
    '12 to 28 tags. Never use looking at viewer or facing camera.',
    'NEVER include duration tags (seconds, minutes, timed actions).',
    'REQUIRED: include specific environment/setting tags from the Location block when provided.',
    'NEVER use vague placeholders like indoor setting or outdoor setting when Location gives specifics.',`
);
rt = rt.replace(
  "const prompt = [charHint, 'Plain summary:\\n' + plain, 'Tags:'].filter(Boolean).join('\\n\\n');",
  "const locBlock = buildLocationBlock(location);\n  const prompt = [locBlock ? 'Location:\\n' + locBlock : '', charHint, 'Plain summary:\\n' + plain, 'Tags:'].filter(Boolean).join('\\n\\n');"
);
rt = rt.replace(
  "const tags = (result.response || '').trim().replace(/\\n+/g, ', ').replace(/,\\s*,/g, ',');",
  "let tags = (result.response || '').trim().replace(/\\n+/g, ', ').replace(/,\\s*,/g, ',');\n    tags = sanitizeImageTags(tags, location);"
);
fs.writeFileSync(rtPath, rt);
console.log("regenerate-tags.js updated");

// --- turns.js - pass location ---
const turnsPath = path.join(root, "src/routes/turns.js");
let turns = fs.readFileSync(turnsPath, "utf8");
if (!turns.includes('_resolveLocationForTags')) {
  turns = turns.replace(
    "import { regenerateTagsFromPlain } from '../services/regenerate-tags.js';",
    "import { regenerateTagsFromPlain } from '../services/regenerate-tags.js';\n\nfunction _resolveLocationForTags(db, turn, scenarioId) {\n  const scenario = db.prepare('SELECT active_location_id FROM scenarios WHERE id = ?').get(scenarioId);\n  const locId = turn?.location_id || scenario?.active_location_id || null;\n  if (!locId) return null;\n  return db.prepare('SELECT * FROM locations WHERE id = ?').get(locId) || null;\n}"
  );
  turns = turns.replace(
    "const chars = db.prepare('SELECT c.* FROM characters c JOIN scenario_characters sc ON c.id = sc.character_id WHERE sc.scenario_id = ?').all(scenarioId);\n    const result = await regenerateTagsFromPlain(db, { plainText: plain, characters: chars });",
    "const chars = db.prepare('SELECT c.* FROM characters c JOIN scenario_characters sc ON c.id = sc.character_id WHERE sc.scenario_id = ?').all(scenarioId);\n    const location = _resolveLocationForTags(db, turn, scenarioId);\n    const result = await regenerateTagsFromPlain(db, { plainText: plain, characters: chars, location });"
  );
}
fs.writeFileSync(turnsPath, turns);
console.log("turns.js updated");
console.log("done");
