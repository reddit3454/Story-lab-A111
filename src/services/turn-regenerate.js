/**
 * Narrator turn regeneration helpers (replace-in-place).
 */

/**
 * Append current mood/arousal and bond lines to regenerate guidance.
 */
export function appendStateSnapshotToGuidance(guidance, { moods, relationships } = {}) {
  const parts = [];
  const base = String(guidance || '').trim();
  if (base) parts.push(base);

  const moodLines = [];
  for (const m of moods || []) {
    const name = m.name || m.characterId || '?';
    const mood = m.moodcurrent ?? m.mood ?? '?';
    const arousal = m.arousalcurrent ?? m.arousal ?? '?';
    moodLines.push(`- ${name}: mood ${mood}/5, arousal ${arousal}/10`);
  }
  if (moodLines.length) {
    parts.push('Current emotional state:\n' + moodLines.join('\n'));
  }

  const bondLines = [];
  for (const r of relationships || []) {
    const from = r.from_name || r.fromId || '?';
    const to = r.to_name || r.toId || '?';
    const type = r.relationship_type || 'bond';
    const strength = r.strength != null ? r.strength : '?';
    const tags = Array.isArray(r.tags) && r.tags.length ? ` (${r.tags.join(', ')})` : '';
    bondLines.push(`- ${from} -> ${to}: ${type}${tags} [intensity ${strength}/5]`);
  }
  if (bondLines.length) {
    parts.push('Active relationships:\n' + bondLines.join('\n'));
  }

  return parts.join('\n\n');
}

export function buildRegenerateMessages(priorTurns, oldNarratorText, guidance) {
  const messages = (priorTurns || []).map(function (t) {
    return {
      role: t.role === 'user' ? 'user' : 'assistant',
      content: t.content_text || '',
    };
  });

  const prior = String(oldNarratorText || '').trim();
  if (prior) {
    messages.push({ role: 'assistant', content: prior });
  }

  const guide = String(guidance || '').trim();
  messages.push({
    role: 'user',
    content: guide
      ? ('Rewrite your previous response using this guidance. Replace it entirely so the new reply stands alone as the story beat.\n\nGuidance: ' + guide)
      : 'Rewrite your previous response with a fresh take. Replace it entirely so the new reply stands alone as the story beat. Keep continuity with earlier events.',
  });

  return messages;
}
