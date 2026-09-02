import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendStateSnapshotToGuidance, buildRegenerateMessages } from '../turn-regenerate.js';

describe('turn-regenerate', () => {
  it('appendStateSnapshotToGuidance includes moods and bonds', () => {
    const out = appendStateSnapshotToGuidance('Stay soft', {
      moods: [{ name: 'Alice', moodcurrent: 4, arousalcurrent: 6 }],
      relationships: [{ from_name: 'Alice', to_name: 'Bob', relationship_type: 'friend', strength: 3, tags: ['trust'] }],
    });
    assert.match(out, /Stay soft/);
    assert.match(out, /Alice: mood 4\/5, arousal 6\/10/);
    assert.match(out, /Alice -> Bob: friend \(trust\) \[intensity 3\/5\]/);
  });

  it('buildRegenerateMessages still works with empty guidance', () => {
    const msgs = buildRegenerateMessages([{ role: 'user', content_text: 'hi' }], 'old text', '');
    assert.equal(msgs.length, 3);
    assert.match(msgs[2].content, /Rewrite your previous response with a fresh take/);
  });
});
