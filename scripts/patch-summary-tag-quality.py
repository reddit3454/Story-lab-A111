# -*- coding: utf-8 -*-
import re
from pathlib import Path

ROOT = Path(r"E:/TheHub/projects/Story-lab-A111")

UTILS = r'''
const GENERIC_SETTING_TAGS = new Set([
  'indoor setting', 'outdoor setting', 'group setting implied',
]);

const DURATION_TAG_RE = /^(?:\d+\s*seconds?|ten seconds|few seconds|for \d+)/i;

export function getLocationTagString(location) {
  if (!location) return '';
  const tod = (location.time_of_day || '').toLowerCase();
  if (tod === 'night' && location.image_tags_night) return location.image_tags_night;
  return location.image_tags_day || location.image_tags || '';
}

export function sanitizePlainSummary(text) {
  let t = (text || '').trim();
  if (!t) return '';
  t = t.replace(/\b(?:for|lasting)\s+(?:about\s+)?(?:a\s+)?(?:few\s+)?\d+\s+seconds?\b/gi, '');
  t = t.replace(/\b(?:for|lasting)\s+(?:a\s+)?(?:few\s+)?(?:seconds?|moments?|minutes?)\b/gi, '');
  t = t.replace(/\bfor\s+ten\s+seconds\b/gi, '');
  t = t.replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').replace(/\s+([.;,])/g, '$1').trim();
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
    locTags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
      if (!existing.includes(t.toLowerCase()) && !toAdd.some(a => a.toLowerCase() === t.toLowerCase())) toAdd.push(t);
    });
  }
  if (!toAdd.length) return tags;
  return (tags ? tags + ', ' : '') + toAdd.join(', ');
}

export function sanitizeImageTags(tags, location) {
  const parts = (tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const hasLocation = !!(location && (location.name || getLocationTagString(location) || location.description || location.full_desc || location.short_desc));
  const filtered = parts.filter(t => {
    const low = t.toLowerCase();
    if (DURATION_TAG_RE.test(low)) return false;
    if (/\bseconds?\b/i.test(low) && /\d|ten|few/i.test(low)) return false;
    if (hasLocation && GENERIC_SETTING_TAGS.has(low)) return false;
    return true;
  });
  return _ensureLocationTags(filtered.join(', '), location);
}

'''

pe_path = ROOT / "src/services/prompt-extractor.js"
pe = pe_path.read_text(encoding="utf-8")

if "sanitizePlainSummary" not in pe:
    pe = pe.replace(
        "import { log, logError } from '../logger.js';\n",
        "import { log, logError } from '../logger.js';\n" + UTILS,
    )

pe = pe.replace(
    '   - NEVER leave the environment empty - if unsure, use "indoor setting" or "outdoor setting"',
    '   - Use the Location block when provided (name, description, image tags)\n'
    '   - Otherwise derive a specific place from the story text\n'
    '   - NEVER use vague placeholders like "indoor setting" or "outdoor setting" when a specific place is known\n'
    '   - NEVER guess indoor vs outdoor against Location or story facts',
)

pe = pe.replace(
    "- 12 to 28 tags total\n- Background/environment tags are MANDATORY - every prompt must have them",
    "- NEVER include duration or timer tags (seconds, minutes, \"ten seconds\")\n"
    "- 12 to 28 tags total\n"
    "- Background/environment tags are MANDATORY - at least one specific place tag from Location or story",
)

pe = pe.replace(
    "Describe only what a camera would see - not thoughts or dialogue.`;",
    "Describe only what a camera would see - not thoughts or dialogue.\n"
    "- ALWAYS name the specific place/setting when Location is provided or the story names one\n"
    "- NEVER mention durations, timers, or how long an action lasts (e.g. \"for ten seconds\")\n"
    "- NEVER invent indoor/outdoor when Location or the story specifies the place.`;",
)

pe = pe.replace(
    "- No comma-separated tags. No bullet lists. No commentary.`;",
    "- No comma-separated tags. No bullet lists. No commentary.\n"
    "- NEVER mention durations or how long an action lasts\n"
    "- ALWAYS include the specific setting from the Location block when provided.`;",
)

pe = pe.replace(
    "- 14 to 26 tags total`;",
    "- NEVER include duration tags (seconds, minutes, timed actions)\n"
    "- REQUIRED: at least 2 environment tags from the Location block when provided (place name and/or location image tags)\n"
    "- NEVER use vague \"indoor setting\", \"outdoor setting\", or \"group setting implied\" when Location gives specifics\n"
    "- Do NOT tag other characters or imply a group unless visible in frame\n"
    "- 14 to 26 tags total`;",
)

pe = pe.replace("function buildLocationBlock", "export function buildLocationBlock")

pe = pe.replace(
    "export async function extractPlainSummary({ storyText, characters = [], config = {} }) {",
    "export async function extractPlainSummary({ storyText, characters = [], location = null, config = {} }) {",
)

if "extractPlainSummary" in pe and "buildLocationBlock(location) ? 'Location:" not in pe.split("extractPlainSummary")[1].split("export async function extractCharacterPlainSummary")[0]:
    pe = pe.replace(
        "  const charLines = buildCharLines(characters);\n  const userMsg = [\n    charLines.length ? 'Characters present:\\n' + charLines.join('\\n') : '',\n    'Story text:\\n' + storyText,\n    '\\nWrite the plain-language shot description now. Output ONLY the paragraph:',\n  ].filter(Boolean).join('\\n\\n');",
        "  const charLines = buildCharLines(characters);\n  const locBlock = buildLocationBlock(location);\n  const userMsg = [\n    locBlock ? 'Location:\\n' + locBlock : '',\n    charLines.length ? 'Characters present:\\n' + charLines.join('\\n') : '',\n    'Story text:\\n' + storyText,\n    '\\nWrite the plain-language shot description now. Output ONLY the paragraph:',\n  ].filter(Boolean).join('\\n\\n');",
        1,
    )

pe = pe.replace(
    "    log('prompt-extractor', 'plain-result', { len: cleaned.length });\n    return cleaned || raw;",
    "    const sanitized = sanitizePlainSummary(cleaned);\n    log('prompt-extractor', 'plain-result', { len: sanitized.length });\n    return sanitized || cleaned || raw;",
)

pe = pe.replace(
    "export async function extractImagePrompt({ storyText, characters = [], config = {} }) {",
    "export async function extractImagePrompt({ storyText, characters = [], location = null, config = {} }) {",
)

if "extractImagePrompt" in pe:
    pe = pe.replace(
        "  const charLines = buildCharLines(characters);\n\n  const userMsg = [\n    charLines.length ? 'Characters present:\\n' + charLines.join('\\n') : '',\n    'Story text:\\n' + storyText,\n    '\\nWrite the image prompt tags now. Output ONLY the comma-separated tags, nothing else:',\n  ].filter(Boolean).join('\\n\\n');",
        "  const charLines = buildCharLines(characters);\n  const locBlock = buildLocationBlock(location);\n\n  const userMsg = [\n    locBlock ? 'Location:\\n' + locBlock : '',\n    charLines.length ? 'Characters present:\\n' + charLines.join('\\n') : '',\n    'Story text:\\n' + storyText,\n    '\\nWrite the image prompt tags now. Output ONLY the comma-separated tags, nothing else:',\n  ].filter(Boolean).join('\\n\\n');",
        1,
    )

pe = pe.replace(
    "    log('prompt-extractor', 'result', { tags: cleaned });\n    return cleaned || raw;",
    "    const sanitized = sanitizeImageTags(cleaned, location);\n    log('prompt-extractor', 'result', { tags: sanitized });\n    return sanitized || cleaned || raw;",
)

pe = pe.replace(
    "    const cleaned = raw.replace(/^(here is|description[:\\s]*|plain[:\\s]*)/i, '').trim();\n    return cleaned || raw;",
    "    const cleaned = raw.replace(/^(here is|description[:\\s]*|plain[:\\s]*)/i, '').trim();\n    return sanitizePlainSummary(cleaned) || cleaned || raw;",
)

pe = pe.replace(
    "    const cleaned = raw.replace(/^(here are the (image )?tags[:\\s]*|tags[:\\s]*|prompt[:\\s]*)/i, '').trim();\n    return cleaned || raw;\n  } catch (err) {\n    logError('prompt-extractor', 'char-tags-failed', err);",
    "    const cleaned = raw.replace(/^(here are the (image )?tags[:\\s]*|tags[:\\s]*|prompt[:\\s]*)/i, '').trim();\n    return sanitizeImageTags(cleaned, location) || cleaned || raw;\n  } catch (err) {\n    logError('prompt-extractor', 'char-tags-failed', err);",
)

pe_path.write_text(pe, encoding="utf-8")
print("prompt-extractor.js ok")

rt_path = ROOT / "src/services/regenerate-tags.js"
rt = rt_path.read_text(encoding="utf-8")
if "sanitizeImageTags" not in rt:
    rt = rt.replace(
        "import { log, logError } from '../logger.js';",
        "import { log, logError } from '../logger.js';\nimport { buildLocationBlock, sanitizeImageTags } from './prompt-extractor.js';",
    )
rt = rt.replace(
    "export async function regenerateTagsFromPlain(db, { plainText, characters = [] })",
    "export async function regenerateTagsFromPlain(db, { plainText, characters = [], location = null })",
)
rt = rt.replace(
    "'12 to 28 tags. Never use looking at viewer or facing camera.',",
    "'12 to 28 tags. Never use looking at viewer or facing camera.',\n"
    "    'NEVER include duration tags (seconds, minutes, timed actions).',\n"
    "    'REQUIRED: include specific environment/setting tags from the Location block when provided.',\n"
    "    'NEVER use vague placeholders like indoor setting or outdoor setting when Location gives specifics.',",
)
rt = rt.replace(
    "const prompt = [charHint, 'Plain summary:\\n' + plain, 'Tags:'].filter(Boolean).join('\\n\\n');",
    "const locBlock = buildLocationBlock(location);\n  const prompt = [locBlock ? 'Location:\\n' + locBlock : '', charHint, 'Plain summary:\\n' + plain, 'Tags:'].filter(Boolean).join('\\n\\n');",
)
rt = rt.replace(
    "const tags = (result.response || '').trim().replace(/\\n+/g, ', ').replace(/,\\s*,/g, ',');",
    "let tags = (result.response || '').trim().replace(/\\n+/g, ', ').replace(/,\\s*,/g, ',');\n    tags = sanitizeImageTags(tags, location);",
)
rt_path.write_text(rt, encoding="utf-8")
print("regenerate-tags.js ok")

turns_path = ROOT / "src/routes/turns.js"
turns = turns_path.read_text(encoding="utf-8")
if "_resolveLocationForTags" not in turns:
    turns = turns.replace(
        "import { regenerateTagsFromPlain } from '../services/regenerate-tags.js';",
        "import { regenerateTagsFromPlain } from '../services/regenerate-tags.js';\n\nfunction _resolveLocationForTags(db, turn, scenarioId) {\n  const scenario = db.prepare('SELECT active_location_id FROM scenarios WHERE id = ?').get(scenarioId);\n  const locId = turn?.location_id || scenario?.active_location_id || null;\n  if (!locId) return null;\n  return db.prepare('SELECT * FROM locations WHERE id = ?').get(locId) || null;\n}",
    )
    turns = turns.replace(
        "const chars = db.prepare('SELECT c.* FROM characters c JOIN scenario_characters sc ON c.id = sc.character_id WHERE sc.scenario_id = ?').all(scenarioId);\n    const result = await regenerateTagsFromPlain(db, { plainText: plain, characters: chars });",
        "const chars = db.prepare('SELECT c.* FROM characters c JOIN scenario_characters sc ON c.id = sc.character_id WHERE sc.scenario_id = ?').all(scenarioId);\n    const location = _resolveLocationForTags(db, turn, scenarioId);\n    const result = await regenerateTagsFromPlain(db, { plainText: plain, characters: chars, location });",
    )
turns_path.write_text(turns, encoding="utf-8")
print("turns.js ok")
