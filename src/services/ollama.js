import { log, logError } from '../logger.js';

const BASE_URL = 'http://127.0.0.1:11434';

export async function chat({ model, messages, options = {} }) {
  const t0 = Date.now();
  log('ollama', 'request', { model, endpoint: '/api/chat' });
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false, options }),
    });
  } catch (err) {
    logError('ollama', 'error', err);
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Ollama chat failed for model ${model}: HTTP ${res.status}`);
    logError('ollama', 'error', err);
    throw err;
  }
  const data = await res.json();
  log('ollama', 'response', { model, duration_ms: Date.now() - t0 });
  return data;
}

export async function generate({ model, prompt, system, options = {} }) {
  const t0 = Date.now();
  log('ollama', 'request', { model, endpoint: '/api/generate' });
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, system, stream: false, options }),
    });
  } catch (err) {
    logError('ollama', 'error', err);
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Ollama generate failed for model ${model}: HTTP ${res.status}`);
    logError('ollama', 'error', err);
    throw err;
  }
  const data = await res.json();
  log('ollama', 'response', { model, duration_ms: Date.now() - t0 });
  return data;
}

export async function listModels() {
  try {
    const res = await fetch(`${BASE_URL}/api/tags`);
    if (!res.ok) throw new Error(`Ollama listModels failed: HTTP ${res.status}`);
    const data = await res.json();
    return (data.models || []).map(function (m) {
      return { name: m.name, size: m.size, modified_at: m.modified_at };
    });
  } catch (err) {
    logError('ollama', 'listModels', err);
    throw err;
  }
}

export async function checkHealth() {
  try {
    const res = await fetch(`${BASE_URL}/`);
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
