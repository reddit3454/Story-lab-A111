import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupAcceptedImagesByTurn,
  renderAcceptedStoryImages,
} from '../utils.js';

test('groupAcceptedImagesByTurn keeps only accepted images attached to a turn', () => {
  const grouped = groupAcceptedImagesByTurn([
    { id: 1, turn_id: 10, accepted: 1, filename: 'accepted.png' },
    { id: 2, turn_id: 10, accepted: 0, filename: 'draft.png' },
    { id: 3, turn_id: null, accepted: 1, filename: 'orphan.png' },
    { id: 4, turn_id: 11, accepted: true, filename: 'second.png' },
  ]);

  assert.deepEqual(Object.keys(grouped).sort(), ['10', '11']);
  assert.deepEqual(grouped[10].map((image) => image.id), [1]);
  assert.deepEqual(grouped[11].map((image) => image.id), [4]);
});

test('renderAcceptedStoryImages renders persisted accepted images for the story thread', () => {
  const html = renderAcceptedStoryImages(7, [
    { id: 12, filename: 'scene one.png', mode: 'scene' },
  ]);

  assert.match(html, /class="turn-accepted-images"/);
  assert.match(html, /data-story-image-id="12"/);
  assert.match(html, /src="\/story-images\/7\/scene%20one\.png"/);
  assert.match(html, /alt="Accepted scene image"/);
  assert.match(html, /loading="lazy"/);
});

test('renderAcceptedStoryImages returns no container when a turn has no accepted images', () => {
  assert.equal(renderAcceptedStoryImages(7, []), '');
});
