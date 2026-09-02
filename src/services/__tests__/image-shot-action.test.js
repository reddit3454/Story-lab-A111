import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeShotAction,
  extractFromSceneCard,
  heuristicFromNarration,
  resolveShotActionSync,
  isImageReadySummary,
  SHOT_ACTION_MAX_LEN,
} from '../image-shot-action.js';

const LONG_NARRATION =
  "As Riley's hot mouth enveloped Jib's sensitive cock, he let out a low groan. " +
  "His hands instinctively reached out to steady himself against the wall while the room grew warmer. She leaned closer, breath quickening, the sheets tangled at their feet as shadows shifted across the dresser and mirror.";

describe('image-shot-action - scene card preferred', () => {
  it('uses summary_plain from scene card when image-ready', () => {
    const turn = {
      role: 'narrator',
      content_text: LONG_NARRATION,
      scene_card_json: JSON.stringify({
        mood: 'neutral',
        summary_plain: 'Two adults in a bedroom, one kneeling before the other, intimate close-up, warm lamp light',
      }),
    };
    const resolved = resolveShotActionSync(turn);
    assert.equal(resolved.source, 'scene_card');
    assert.match(resolved.text, /bedroom/i);
    assert.ok(resolved.text.length < LONG_NARRATION.length);
  });

  it('prefers image_prompt over summary_plain when both exist', () => {
    const card = {
      summary_plain: 'standing in a hallway, neutral lighting',
      image_prompt: 'Two adults seated on a couch, facing each other, living room, soft window light',
    };
    const text = extractFromSceneCard(card);
    assert.match(text, /couch/i);
  });
});

describe('image-shot-action - raw narration never used wholesale', () => {
  it('does not return full narrator prose for long turns', () => {
    const turn = {
      role: 'narrator',
      content_text: LONG_NARRATION,
      scene_card_json: '{}',
    };
    const resolved = resolveShotActionSync(turn);
    assert.notEqual(resolved.text, LONG_NARRATION);
    assert.ok(resolved.text.length < LONG_NARRATION.length * 0.5 || resolved.text === '');
    assert.equal(resolved.needs_suggest, true);
  });

  it('heuristic never returns the entire narration string', () => {
    const h = heuristicFromNarration(LONG_NARRATION);
    assert.notEqual(h, LONG_NARRATION);
    if (h) assert.ok(h.length < LONG_NARRATION.length);
  });
});

describe('image-shot-action - length cap and whitespace normalization', () => {
  it('collapses whitespace and caps length', () => {
    const raw = '  two   people   standing   ' + 'by a window, '.repeat(40);
    const out = normalizeShotAction(raw, 120);
    assert.ok(!/\s{2,}/.test(out));
    assert.ok(out.length <= 120);
  });

  it('rejects tag-soup scene card summaries', () => {
    const card = {
      summary_plain: 'masterpiece, best quality, cinematic, photoreal, anime, 8k, hdr, bokeh, film grain, studio lighting',
    };
    assert.equal(extractFromSceneCard(card), null);
  });
});

describe('image-shot-action - persisted user edit wins', () => {
  it('user draft overrides scene card and narration', () => {
    const turn = {
      role: 'narrator',
      image_action_draft: 'Custom user shot: two figures at a kitchen table, morning light',
      content_text: LONG_NARRATION,
      scene_card_json: JSON.stringify({ summary_plain: 'bedroom scene with lamp light' }),
    };
    const resolved = resolveShotActionSync(turn);
    assert.equal(resolved.source, 'user_draft');
    assert.match(resolved.text, /kitchen table/i);
    assert.equal(resolved.needs_suggest, false);
  });
});

describe('image-shot-action - style words stripped from content', () => {
  it('normalizeShotAction removes style vocabulary', () => {
    const out = normalizeShotAction(
      'Two adults in a bedroom, cinematic lighting, photoreal masterpiece, warm lamp glow',
    );
    assert.ok(!/cinematic/i.test(out));
    assert.ok(!/photoreal/i.test(out));
    assert.ok(!/masterpiece/i.test(out));
    assert.match(out, /bedroom/i);
    assert.match(out, /lamp/i);
  });

  it('isImageReadySummary accepts plain visual descriptions', () => {
    assert.equal(
      isImageReadySummary('Two adults in a bedroom, one kneeling, intimate close-up, warm lamp light'),
      true,
    );
  });
});
