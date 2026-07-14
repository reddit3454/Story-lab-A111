import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

test('chat forwards format and options into the Ollama request body', async (t) => {
  let captured = null;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    captured = JSON.parse(init.body);
    return { ok: true, json: async () => ({ message: { content: '{}' } }) };
  });
  const { chat } = await import('../ollama.js');
  await chat({
    model: 'test-model',
    messages: [{ role: 'user', content: 'hi' }],
    options: { temperature: 0.1, num_predict: 50 },
    format: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
  });
  assert.ok(captured, 'fetch was called');
  assert.equal(captured.model, 'test-model');
  assert.equal(captured.stream, false);
  assert.equal(captured.options.temperature, 0.1);
  assert.deepEqual(captured.format, { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] });
});

test('chat omits format when not provided', async (t) => {
  let captured = null;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    captured = JSON.parse(init.body);
    return { ok: true, json: async () => ({ message: { content: 'ok' } }) };
  });
  const { chat } = await import('../ollama.js');
  await chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
  assert.equal('format' in captured, false);
});

test('generate forwards format, system, and options', async (t) => {
  let captured = null;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    captured = JSON.parse(init.body);
    return { ok: true, json: async () => ({ response: '[]' }) };
  });
  const { generate } = await import('../ollama.js');
  await generate({
    model: 'm',
    prompt: 'p',
    system: 's',
    format: 'json',
    options: { temperature: 0.05 },
  });
  assert.equal(captured.system, 's');
  assert.equal(captured.prompt, 'p');
  assert.equal(captured.format, 'json');
  assert.equal(captured.options.temperature, 0.05);
});
