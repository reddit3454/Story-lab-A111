import * as ollama from './ollama.js';
import { resolveNarratorModel } from './model-resolver.js';

export function shouldGenerateMemory(turnNumber, interval = 20) {
  return turnNumber > 0 && turnNumber % interval === 0;
}

export async function generateMemory({ db, scenarioId, turns, config }) {
  const model = config?.narrator_model || await resolveNarratorModel(db);

  const recentTurns = turns.slice(-20);
  const turnText = recentTurns
    .map(function (t) { return `${t.role}: ${t.content_text}`; })
    .join('\n\n');

  const prompt =
    'The following is a sequence of story turns. Summarize the 2-3 most important facts or ' +
    'events worth remembering for future story continuity. Be concise — one sentence per fact.\n\n' +
    turnText + '\n\nKey facts to remember:';

  const response = await ollama.chat({
    model,
    messages: [
      { role: 'system', content: 'You are a story memory assistant. Summarize key facts concisely.' },
      { role: 'user', content: prompt },
    ],
    options: { num_predict: 200 },
  });
  const summaryText = (response.message?.content || '').trim();
  if (!summaryText) {
    console.warn('[memory] generateMemory returned empty content — model may not have responded');
    return null;
  }

  const lastTurn = recentTurns[recentTurns.length - 1];
  const result = db.prepare(
    'INSERT INTO memories (scenario_id, content, memory_type, turn_number) VALUES (?, ?, ?, ?)'
  ).run(scenarioId, summaryText, 'auto', lastTurn?.turn_number || 0);

  return db.prepare('SELECT * FROM memories WHERE id = ?').get(result.lastInsertRowid);
}

// ORPHAN: not imported anywhere — safe to delete if unneeded
export function getRecentMemories(db, scenarioId, limit = 10) {
  return db.prepare(
    'SELECT * FROM memories WHERE scenario_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(scenarioId, limit);
}
