import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateTokenCount,
  resolveNarratorInputBudget,
  truncateNarratorPrompt,
  serializeFetchError,
} from '../narrator-context.js';

test('estimateTokenCount uses ~4 chars per token', () => {
  assert.equal(estimateTokenCount('abcd'), 1);
  assert.equal(estimateTokenCount([{ content: 'abcdefgh' }, { content: 'ijkl' }]), 3);
});

test('resolveNarratorInputBudget subtracts output max from n_ctx', () => {
  const budget = resolveNarratorInputBudget({
    config: {},
    llamaRoleConfig: { n_ctx: 4096 },
    maxOutputTokens: 1200,
  });
  assert.equal(budget, 4096 - 1200 - 64);
});

test('resolveNarratorInputBudget prefers narrator_context_tokens', () => {
  const budget = resolveNarratorInputBudget({
    config: { narrator_context_tokens: 6000 },
    llamaRoleConfig: { n_ctx: 4096 },
    maxOutputTokens: 1000,
  });
  assert.equal(budget, 6000 - 1000 - 64);
});

test('truncateNarratorPrompt drops oldest history before truncating system', () => {
  const systemPrompt = 'SYS:' + 'x'.repeat(400); // ~100 tokens
  const messages = [];
  for (let i = 0; i < 20; i++) {
    messages.push({ role: i % 2 ? 'assistant' : 'user', content: `turn-${i}-` + 'y'.repeat(200) });
  }
  const last = messages[messages.length - 1].content;
  const result = truncateNarratorPrompt({
    systemPrompt,
    messages,
    inputBudgetTokens: 250,
  });
  assert.ok(result.droppedMessages > 0);
  assert.ok(result.inputTokens <= 250);
  assert.equal(result.messages[result.messages.length - 1].content.startsWith('turn-19-') || result.messages.at(-1).content.includes('turn-19'), true);
  assert.ok(result.fullMessages[0].role === 'system');
  // last user turn preserved (possibly truncated but starts with turn-19)
  assert.match(result.messages.at(-1).content, /turn-19/);
  void last;
});

test('truncateNarratorPrompt hard-truncates oversized system when history alone still exceeds budget', () => {
  const result = truncateNarratorPrompt({
    systemPrompt: 'S'.repeat(20000),
    messages: [{ role: 'user', content: 'hi' }],
    inputBudgetTokens: 200,
  });
  assert.ok(result.systemPrompt.includes('SYSTEM PROMPT TRUNCATED') || result.inputTokens <= 200);
  assert.ok(result.inputTokens <= 200);
});

test('serializeFetchError captures cause and abort', () => {
  const err = new Error('fetch failed');
  err.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  const s = serializeFetchError(err);
  assert.equal(s.message, 'fetch failed');
  assert.equal(s.cause.code, 'ECONNREFUSED');
  assert.equal(s.aborted, false);

  const abortErr = new Error('This operation was aborted');
  abortErr.name = 'AbortError';
  assert.equal(serializeFetchError(abortErr).aborted, true);
});
