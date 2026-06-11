import * as ollama from './ollama.js';

export async function resolveNarratorModel(db) {
  const row = db.prepare('SELECT value FROM global_config WHERE key = ?').get('narrator_model');
  const configured = (row?.value || '').trim();
  if (configured) return configured;

  const models = await ollama.listModels();
  if (!models.length) {
    throw new Error('No narrator model configured and no Ollama models found');
  }
  return models[0].name;
}

export async function resolveModels(db) {
  const narrator = await resolveNarratorModel(db);
  return { narrator };
}
