import * as ollama from './ollama.js';
import { resolveMasterConfig } from './config-resolver.js';
import { getSummaryExemplarsForRegen } from './exemplar-promotion.js';
import { log, logError } from '../logger.js';
import { buildLocationBlock, sanitizeImageTags } from './prompt-extractor.js';
import { buildRegenTagSystem } from './tag-dialect.js';

const REFUSAL_PHRASES = ['i cannot', "i can't", 'as an ai', 'here are the tags', 'what changed'];

function _validateTags(text) {
  const t = (text || '').trim();
  if (t.length < 20) return false;
  if (/^[\-\*\u2022]|\n[\-\*\u2022]/.test(t)) return false;
  const lower = t.toLowerCase();
  for (const p of REFUSAL_PHRASES) { if (lower.includes(p)) return false; }
  return true;
}

function _buildFewShot(exemplars) {
  if (!exemplars.length) return '';
  return exemplars.slice(0, 8).map(function (ex, i) {
    return 'Example ' + (i + 1) + ' (rating ' + ex.content_rating + '):\nPlain: ' + ex.summary_plain + '\nTags: ' + ex.summary_tags;
  }).join('\n\n');
}

export async function regenerateTagsFromPlain(db, { plainText, characters = [], location = null }) {
  const plain = (plainText || '').trim();
  if (!plain) return { error: 'Plain summary is required', status: 400 };
  const config = resolveMasterConfig(db);
  const model = (config.prompt_extractor_model || config.narrator_model || '').trim();
  if (!model) return { error: 'Configure prompt_extractor_model or narrator_model in Settings', status: 400 };

  const fewShot = _buildFewShot(getSummaryExemplarsForRegen(db, 8));
  const charHint = characters.length ? 'Characters: ' + characters.map(c => c.name).filter(Boolean).join(', ') : '';
  const system = buildRegenTagSystem({ fewShot });
  const locBlock = buildLocationBlock(location);
  const prompt = [locBlock ? 'Location:\n' + locBlock : '', charHint, 'Plain summary:\n' + plain, 'Tags:'].filter(Boolean).join('\n\n');

  try {
    const result = await ollama.generate({ model, prompt, system });
    let tags = (result.response || '').trim().replace(/\n+/g, ', ').replace(/,\s*,/g, ',');
    tags = sanitizeImageTags(tags, location);
    if (!_validateTags(tags)) return { error: 'Invalid tag output from model', status: 422 };
    log('regenerate-tags', 'success', { model, tag_len: tags.length });
    return { ok: true, tags };
  } catch (err) {
    logError('regenerate-tags', 'failed', err);
    const msg = err.message || String(err);
    if (msg.includes('timeout') || msg.includes('fetch')) return { error: 'Ollama unavailable: ' + msg, status: 503 };
    return { error: 'Tag regeneration failed: ' + msg, status: 502 };
  }
}
