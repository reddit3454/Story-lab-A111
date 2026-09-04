import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPosePreviewOption, renderPosePickerHtml } from '../../public/js/pose-picker.js';

test('pose picker renders supplied library previews instead of a static visual-only prototype', () => {
  const poses = [
    { id: 'sitting-demo-01', label: 'sitting demo', category: 'sitting', orientation: 'left', subjects: 1, preview_url: '/api/poses/sitting-demo-01/preview' },
    { id: 'standing-demo-01', label: 'standing demo', category: 'standing', orientation: 'front', subjects: 1, preview_url: '/api/poses/standing-demo-01/preview' },
  ];
  const selected = getPosePreviewOption(poses, 'sitting-demo-01');
  assert.equal(selected.label, 'sitting demo');

  const html = renderPosePickerHtml(poses, 'sitting-demo-01');

  // two library poses + the explicit "No pose" card
  assert.equal((html.match(/data-pose-preview-id=/g) || []).length, 3);
  assert.match(html, /data-pose-preview-id=""/);
  assert.match(html, /sitting demo/);
  assert.match(html, /\/api\/poses\/sitting-demo-01\/preview/);
  assert.doesNotMatch(html, /visual prototype/);
  assert.match(html, /data-pose-preview-id="sitting-demo-01"[^>]*aria-pressed="true"/);
});

test('pose picker greys out poses whose subject count does not match the current image', () => {
  const poses = [
    { id: 'solo-01', label: 'solo', category: 'standing', subjects: 1, preview_url: '/p/1' },
    { id: 'couple-01', label: 'couple', category: 'couple', subjects: 2, preview_url: '/p/2' },
  ];
  const html = renderPosePickerHtml(poses, null, 1);
  // the 2-person pose is disabled, the 1-person pose is not
  assert.match(html, /data-pose-preview-id="couple-01"[^>]*disabled/);
  assert.doesNotMatch(html, /data-pose-preview-id="solo-01"[^>]*disabled/);
  assert.match(html, /2 people/);
});
