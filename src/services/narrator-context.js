/**
 * Pure helpers for narrator prompt sizing / truncation.
 * narrator_max_tokens = OUTPUT budget (llama max_tokens / Ollama num_predict).
 * Input context must be truncated separately against an input budget (n_ctx - output - margin).
 */

export function estimateTokenCount(textOrMessages) {
  if (textOrMessages == null) return 0;
  if (typeof textOrMessages === 'string') {
    return Math.ceil(String(textOrMessages).length / 4);
  }
  if (Array.isArray(textOrMessages)) {
    const chars = textOrMessages.reduce((sum, m) => sum + String(m?.content || '').length, 0);
    return Math.ceil(chars / 4);
  }
  return Math.ceil(String(textOrMessages).length / 4);
}

/**
 * Resolve how many input tokens we may send before the completion budget.
 * Prefer config.narrator_context_tokens, then llama role n_ctx/ctx_size, else 8192.
 */
export function resolveNarratorInputBudget({ config = {}, llamaRoleConfig = null, maxOutputTokens = 1200 } = {}) {
  const rawCtx =
    config.narrator_context_tokens ??
    llamaRoleConfig?.n_ctx ??
    llamaRoleConfig?.ctx_size ??
    llamaRoleConfig?.context_size ??
    8192;
  const nCtx = Math.max(1024, parseInt(rawCtx, 10) || 8192);
  const out = Math.max(64, parseInt(maxOutputTokens, 10) || 1200);
  const margin = 64;
  return Math.max(512, nCtx - out - margin);
}

/**
 * Truncate system + history so estimateTokenCount(system + messages) <= inputBudgetTokens.
 * Keeps the newest messages (especially the final user turn). Drops oldest history first.
 * If still over budget, hard-truncates the system prompt from the end.
 */
export function truncateNarratorPrompt({ systemPrompt, messages = [], inputBudgetTokens }) {
  const parsedBudget = parseInt(inputBudgetTokens, 10);
  const budget = (Number.isFinite(parsedBudget) && parsedBudget > 0) ? parsedBudget : 4096;
  let system = String(systemPrompt || '');
  let history = Array.isArray(messages) ? messages.map((m) => ({
    role: m.role,
    content: String(m.content || ''),
  })) : [];

  const pack = () => [{ role: 'system', content: system }, ...history];
  let dropped = 0;

  while (estimateTokenCount(pack()) > budget && history.length > 1) {
    // Drop oldest non-final message
    history = history.slice(1);
    dropped += 1;
  }

  const SYS_MARK = '\n\n[SYSTEM PROMPT TRUNCATED TO FIT CONTEXT]';
  const MSG_MARK = '\n[MESSAGE TRUNCATED]';

  // Shrink system until under budget (keep at least last history message).
  let guard = 0;
  while (estimateTokenCount(pack()) > budget && guard < 8) {
    guard += 1;
    const reservedForLast = estimateTokenCount(history.slice(-1)) + 8;
    const systemBudgetTokens = Math.max(1, budget - reservedForLast);
    // Leave room for the truncation marker inside the system body budget.
    const maxChars = Math.max(0, systemBudgetTokens * 4 - SYS_MARK.length);
    if (maxChars <= 0) {
      system = SYS_MARK.trim();
      break;
    }
    if (system.length <= maxChars) break;
    system = system.slice(0, maxChars) + SYS_MARK;
  }

  // Last resort: truncate final message content.
  guard = 0;
  while (estimateTokenCount(pack()) > budget && history.length && guard < 8) {
    guard += 1;
    const last = { ...history[history.length - 1] };
    const others = [{ role: 'system', content: system }, ...history.slice(0, -1)];
    const remain = Math.max(16, budget - estimateTokenCount(others) - estimateTokenCount(MSG_MARK));
    const maxChars = Math.max(0, remain * 4);
    if (last.content.length <= maxChars) break;
    last.content = last.content.slice(0, maxChars) + MSG_MARK;
    history = [...history.slice(0, -1), last];
  }

  return {
    systemPrompt: system,
    messages: history,
    fullMessages: pack(),
    droppedMessages: dropped,
    inputTokens: estimateTokenCount(pack()),
    inputBudgetTokens: budget,
  };
}

export function serializeFetchError(err) {
  const cause = err?.cause;
  const aborted =
    err?.name === 'AbortError' ||
    cause?.name === 'AbortError' ||
    /aborted|timeout/i.test(String(err?.message || ''));
  return {
    message: err?.message || String(err),
    name: err?.name || null,
    code: err?.code || cause?.code || null,
    errno: err?.errno || cause?.errno || null,
    aborted,
    cause: cause
      ? {
          message: cause.message || String(cause),
          name: cause.name || null,
          code: cause.code || null,
          errno: cause.errno || null,
        }
      : null,
  };
}
