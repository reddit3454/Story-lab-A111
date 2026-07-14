import { log, logError } from '../logger.js';

const BASE_URL = 'http://127.0.0.1:11434';
const OLLAMA_TIMEOUT_MS = 120000;

export async function chat({ model, messages, options = {}, format, keep_alive } = {}) {
  const t0 = Date.now();
  log('ollama', 'request', { model, endpoint: '/api/chat', has_format: format !== undefined });
  const body = { model, messages, stream: false, options };
  if (format !== undefined) body.format = format;
  if (keep_alive !== undefined) body.keep_alive = keep_alive;
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
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

export async function generate({ model, prompt, system, options = {}, format, keep_alive } = {}) {
  const t0 = Date.now();
  log('ollama', 'request', { model, endpoint: '/api/generate', has_format: format !== undefined });
  const body = { model, prompt, system, stream: false, options };
  if (format !== undefined) body.format = format;
  if (keep_alive !== undefined) body.keep_alive = keep_alive;
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
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

export async function unloadAllModels() {
  const results = [];
  try {
    const psRes = await fetch(`${BASE_URL}/api/ps`, { signal: AbortSignal.timeout(4000) });
    if (!psRes.ok) {
      results.push({ model: 'all', status: `ps returned http ${psRes.status}` });
      return results;
    }
    const ps = await psRes.json();
    const running = (ps.models || []).map(m => m.name || m.model).filter(Boolean);
    if (!running.length) {
      results.push({ model: 'none', status: 'nothing loaded' });
      return results;
    }
    for (const modelName of running) {
      try {
        await fetch(`${BASE_URL}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelName, keep_alive: 0 }),
          signal: AbortSignal.timeout(6000),
        });
        results.push({ model: modelName, status: 'unloaded' });
      } catch (err) {
        results.push({ model: modelName, status: `error: ${err.message}` });
      }
    }
  } catch (err) {
    results.push({ model: 'all', status: `error: ${err.message}` });
  }
  return results;
}
