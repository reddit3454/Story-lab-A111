
/** Sync-only: split narrator scene card into plain/tags. No Ollama calls. */
export function applyNarratorSummaryOnly({ sceneCard }) {
  const card = normalizeSceneCard(sceneCard);
  let summary_plain = (card.summary_plain || '').trim();
  let summary_tags = (card.summary_tags || '').trim();

  if (!summary_plain && card.image_prompt && !isTagLike(card.image_prompt)) {
    summary_plain = card.image_prompt.trim();
  }
  if (!summary_tags && card.image_prompt && isTagLike(card.image_prompt)) {
    summary_tags = card.image_prompt.trim();
  }
  if (summary_plain && summary_tags === summary_plain) summary_tags = '';

  const plain_source = summary_plain ? (card.summary_plain ? 'narrator' : 'narrator') : 'empty';
  const tags_source = summary_tags ? 'extractor' : 'empty';

  return normalizeSceneCard(Object.assign({}, card, {
    summary_plain,
    summary_tags,
    image_prompt: summary_tags || summary_plain || card.image_prompt || '',
    _meta: Object.assign({}, card._meta || {}, {
      plain_source: summary_plain ? 'narrator' : 'empty',
      tags_source,
      plain_original: summary_plain,
      tags_original: summary_tags,
      locale: 'en',
    }),
  }));
}
import { normalizeSceneCard, isTagLike } from '../input-parser.js';
import { extractImagePrompt, extractPlainSummary } from './prompt-extractor.js';

/**
 * Populate summary_plain + summary_tags on a scene card.
 * Plain comes from narrator image_prompt when prose; tags from prompt-extractor.
 * Dual-writes image_prompt = tags (legacy pipeline).
 */
export async function enrichSceneCardPrompts({ sceneCard, storyText, characters = [], config = {} }) {
  const card = normalizeSceneCard(sceneCard);
  let summary_plain = (card.summary_plain || '').trim();
  let plain_source = summary_plain ? 'narrator' : 'empty';

  if (!summary_plain && card.image_prompt && !isTagLike(card.image_prompt)) {
    summary_plain = card.image_prompt.trim();
    plain_source = 'narrator';
  }

  let summary_tags = (card.summary_tags || '').trim();
  if (summary_plain && summary_tags === summary_plain) summary_tags = '';

  const needPlain = !summary_plain && !!storyText;
  const needTags = !summary_tags && !!storyText;
  if (needPlain || needTags) {
    const [generated, extracted] = await Promise.all([
      needPlain ? extractPlainSummary({ storyText, characters, config }) : Promise.resolve(''),
      needTags ? extractImagePrompt({ storyText, characters, config }) : Promise.resolve(''),
    ]);
    if (generated) {
      summary_plain = generated.trim();
      plain_source = 'extractor';
    }
    if (extracted) summary_tags = extracted.trim();
  }

  if (summary_plain && summary_tags === summary_plain) summary_tags = '';

  const tags_source = summary_tags ? 'extractor' : 'empty';

  return normalizeSceneCard(Object.assign({}, card, {
    summary_plain,
    summary_tags,
    image_prompt: summary_tags || summary_plain || '',
    _meta: Object.assign({}, card._meta || {}, {
      plain_source,
      tags_source,
      plain_original: summary_plain,
      tags_original: summary_tags,
      locale: 'en',
    }),
  }));
}
