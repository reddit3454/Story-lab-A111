import * as ollama from './ollama.js';
import { log, logError } from '../logger.js';
import { buildSceneTagSystem, buildCharacterTagSystem } from './tag-dialect.js';

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


const SYSTEM = buildSceneTagSystem();



const PLAIN_SYSTEM = `You write plain-language image shot descriptions for illustrators.
Output ONE paragraph of 50 to 70 words. Observable facts only: who is visible, what they are doing, clothing or nudity, setting, lighting.
No comma-separated tags. No bullet lists. No commentary. No JSON. No markdown headers.
Describe only what a camera would see - not thoughts or dialogue.
- ALWAYS name the specific place/setting when Location is provided or the story names one
- NEVER mention durations, timers, or how long an action lasts (e.g. "for ten seconds")
- NEVER invent indoor/outdoor when Location or the story specifies the place.`;

function buildCharLines(characters) {
  return characters
    .filter(c => c.appearance_prompt || c.name)
    .map(c => {
      const parts = [];
      if (c.name) parts.push(c.name);
      const traits = [];
      if (c.gender) traits.push(c.gender);
      if (c.body_type) traits.push(c.body_type + ' build');
      const hair = [c.hair_color, c.hair_style].filter(Boolean);
      if (hair.length) traits.push(hair.join(' ') + ' hair');
      if (c.eye_color) traits.push(c.eye_color + ' eyes');
      if (c.skin_tone) traits.push(c.skin_tone + ' skin');
      if (traits.length) parts.push('(' + traits.join(', ') + ')');
      else if (c.appearance_prompt) parts.push('(' + c.appearance_prompt + ')');
      const clothing = c.current_clothing || c.base_clothing;
      if (clothing) parts.push('wearing: ' + clothing);
      return parts.join(' ');
    });
}

export async function extractPlainSummary({ storyText, characters = [], location = null, config = {} }) {
  const model = config.prompt_extractor_model || config.narrator_model || '';
  if (!model) {
    logError('prompt-extractor', 'no model for plain summary');
    return '';
  }
  const charLines = buildCharLines(characters);
  const locBlock = buildLocationBlock(location);
  const userMsg = [
    locBlock ? 'Location:\n' + locBlock : '',
    charLines.length ? 'Characters present:\n' + charLines.join('\n') : '',
    'Story text:\n' + storyText,
    '\nWrite the plain-language shot description now. Output ONLY the paragraph:',
  ].filter(Boolean).join('\n\n');
  try {
    log('prompt-extractor', 'plain-request', { model });
    const result = await ollama.generate({
      model,
      system: PLAIN_SYSTEM,
      prompt: userMsg,
      options: { num_predict: 200, temperature: 0.3, top_p: 0.9, stop: ['---'] /* do not use \n\n - models often emit a preamble then blank line before the real output */ },
    });
    const raw = (result.response || '').trim();
    const cleaned = raw
      .replace(/^(here is|plain (language )?summary[:\s]*|description[:\s]*|image prompt[:\s]*)/i, '')
      .trim();
    const sanitized = sanitizePlainSummary(cleaned);
    log('prompt-extractor', 'plain-result', { len: sanitized.length });
    return sanitized || cleaned || raw;
  } catch (err) {
    logError('prompt-extractor', 'plain-failed', err);
    return '';
  }
}

const CHARACTER_PLAIN_SYSTEM = `You write plain-language shot descriptions for candid FULL-BODY action photographs of ONE character.
This is NOT a portrait, headshot, bust shot, or close-up. The full body should read head to toe in frame.
Output ONE paragraph of 50 to 80 words. Observable facts only.
CRITICAL RULES:
- ONLY the named focus character appears in frame. Solo subject. NOT a group photo.
- Do NOT name, describe, or include any other characters from the story.
- Describe a CANDID moment in mid-action or natural motion - sitting, walking, reaching, turning, reacting - not a posed studio portrait or profile photo.
- Use location name, description, and tags for setting, props (benches, paths, furniture), time of day, and lighting.
- Include what their whole body is doing - legs, posture, hands - not just face and shoulders.
- Expression reflects emotional state in the story (e.g. extreme anticipation, nervous excitement).
- Camera feels documentary or candid - like a still from a scene, not a character headshot.
- Prefer looking off-screen or averted gaze. Do not describe looking at the viewer or posing for the camera.
- No comma-separated tags. No bullet lists. No commentary.
- NEVER mention durations or how long an action lasts
- ALWAYS include the specific setting from the Location block when provided.`;

const CHARACTER_TAG_SYSTEM = buildCharacterTagSystem();


export function buildLocationBlock(location) {
  if (!location) return '';
  const parts = [];
  if (location.name) parts.push('Name: ' + location.name);
  const desc = location.full_desc || location.description || location.short_desc || '';
  if (desc) parts.push('Description: ' + desc);
  const tod = (location.time_of_day || '').toLowerCase();
  const tagSet = (tod === 'night' && location.image_tags_night)
    ? location.image_tags_night
    : (location.image_tags_day || location.image_tags || '');
  if (tagSet) parts.push('Image tags: ' + tagSet);
  if (location.tags) parts.push('Labels: ' + location.tags);
  if (location.time_of_day && location.time_of_day !== 'any') parts.push('Time of day: ' + location.time_of_day);
  return parts.join('\n');
}

function buildSceneCardBlock(sceneCard) {
  if (!sceneCard) return '';
  const parts = [];
  if (sceneCard.mood) parts.push('Scene mood: ' + sceneCard.mood);
  if (sceneCard.nudity_state) parts.push('Nudity state: ' + sceneCard.nudity_state);
  if (sceneCard.body_positions) parts.push('Body positions: ' + sceneCard.body_positions);
  return parts.join('\n');
}

function buildFocusCharLine(character) {
  const lines = buildCharLines([character]);
  return lines.length ? lines[0] : (character.name || 'Focus character');
}

export async function extractCharacterPlainSummary({ storyText, character, location = null, sceneCard = null, config = {} }) {
  const model = config.prompt_extractor_model || config.narrator_model || '';
  if (!model || !character) return '';
  const locBlock = buildLocationBlock(location);
  const sceneBlock = buildSceneCardBlock(sceneCard);
  const userMsg = [
    'Focus character (ONLY person in frame):\n' + buildFocusCharLine(character),
    locBlock ? 'Location:\n' + locBlock : '',
    sceneBlock ? 'Scene context:\n' + sceneBlock : '',
    'Story text:\n' + storyText,
    '\nWrite a solo candid full-body action shot description for ' + (character.name || 'the focus character') + '. Output ONLY the paragraph:',
  ].filter(Boolean).join('\n\n');
  try {
    log('prompt-extractor', 'char-plain-request', { model, character: character.name });
    const result = await ollama.generate({
      model,
      system: CHARACTER_PLAIN_SYSTEM,
      prompt: userMsg,
      options: { num_predict: 220, temperature: 0.35, top_p: 0.9, stop: ['---'] },
    });
    const raw = (result.response || '').trim();
    const cleaned = raw.replace(/^(here is|description[:\s]*|plain[:\s]*)/i, '').trim();
    return sanitizePlainSummary(cleaned) || cleaned || raw;
  } catch (err) {
    logError('prompt-extractor', 'char-plain-failed', err);
    return '';
  }
}

export async function extractCharacterImagePrompt({ storyText, character, location = null, sceneCard = null, config = {} }) {
  const model = config.prompt_extractor_model || config.narrator_model || '';
  if (!model || !character) return '';
  const locBlock = buildLocationBlock(location);
  const sceneBlock = buildSceneCardBlock(sceneCard);
  const userMsg = [
    'Focus character (ONLY person in frame):\n' + buildFocusCharLine(character),
    locBlock ? 'Location:\n' + locBlock : '',
    sceneBlock ? 'Scene context:\n' + sceneBlock : '',
    'Story text:\n' + storyText,
    '\nWrite solo candid full-body action SDXL tags for ' + (character.name || 'the focus character') + '. Output ONLY comma-separated tags:',
  ].filter(Boolean).join('\n\n');
  try {
    log('prompt-extractor', 'char-tags-request', { model, character: character.name });
    const result = await ollama.generate({
      model,
      system: CHARACTER_TAG_SYSTEM,
      prompt: userMsg,
      options: { num_predict: 320, temperature: 0.2, top_p: 0.9, stop: ['---'] },
    });
    const raw = (result.response || '').trim();
    const cleaned = raw.replace(/^(here are the (image )?tags[:\s]*|tags[:\s]*|prompt[:\s]*)/i, '').trim();
    return sanitizeImageTags(cleaned, location) || cleaned || raw;
  } catch (err) {
    logError('prompt-extractor', 'char-tags-failed', err);
    return '';
  }
}
export async function extractImagePrompt({ storyText, characters = [], location = null, config = {} }) {
  const model = config.prompt_extractor_model || config.narrator_model || '';
  if (!model) {
    logError('prompt-extractor', 'no model configured — set prompt_extractor_model in settings');
    return '';
  }

  const charLines = buildCharLines(characters);
  const locBlock = buildLocationBlock(location);

  const userMsg = [
    locBlock ? 'Location:\n' + locBlock : '',
    charLines.length ? 'Characters present:\n' + charLines.join('\n') : '',
    'Story text:\n' + storyText,
    '\nWrite the image prompt tags now. Output ONLY the comma-separated tags, nothing else:',
  ].filter(Boolean).join('\n\n');

  try {
    log('prompt-extractor', 'request', { model });
    const result = await ollama.generate({
      model,
      system: SYSTEM,
      prompt: userMsg,
      options: {
        num_predict: 350,
        temperature: 0.2,
        top_p: 0.9,
        stop: ['---'],
      },
    });
    const raw = (result.response || '').trim();
    const cleaned = raw
      .replace(/^(here are the (image )?tags[:\s]*|image prompt[:\s]*|tags[:\s]*|prompt[:\s]*)/i, '')
      .trim();
    const sanitized = sanitizeImageTags(cleaned, location);
    log('prompt-extractor', 'result', { tags: sanitized });
    return sanitized || cleaned || raw;
  } catch (err) {
    logError('prompt-extractor', 'failed', err);
    return '';
  }
}
