/*
 * Context windows the providers' model lists do not say (C.1, D-075). Most
 * lists carry the window (OpenRouter `context_length`, Anthropic
 * `max_input_tokens`, Gemini `inputTokenLimit`, Mistral, Groq, LM Studio,
 * Ollama, ChatGPT); OpenAI's `/models` does not, and the harnesses report the
 * concrete model that served a request (`claude-sonnet-5-5`), not the alias the
 * user chose. Values from the providers' documentation (October 2026); the
 * lists, when they answer, win.
 */

const K = 1000;
const M = 1_000_000;

/** Claude: 1M on the 4.6 family and later, 200k before; `[1m]` asks for 1M on older ones. */
function claudeWindow(id: string): number | undefined {
  const m = id.toLowerCase();
  if (!/claude|^(opus|sonnet|haiku|fable|mythos)\b/.test(m)) return undefined;
  if (m.includes('[1m]')) return M;
  if (/fable|mythos/.test(m)) return M;
  // Aliases of the binary resolve to the newest models (1M).
  if (/^(opus|sonnet|haiku)$/.test(m)) return M;
  if (/haiku-4/.test(m)) return 200 * K;
  const v = /(opus|sonnet|haiku)-(\d{1,2})(?!\d)(?:[-.](\d)(?!\d))?/.exec(m);
  if (v) {
    const major = Number(v[2]);
    const minor = v[3] !== undefined ? Number(v[3]) : 0;
    if (major >= 5) return M;
    if (major === 4 && minor >= 6) return M;
    return 200 * K;
  }
  // claude-3-5-sonnet, claude-3-opus…
  return 200 * K;
}

/** OpenAI models (Chat Completions and Codex). */
function openaiWindow(id: string): number | undefined {
  const m = id.toLowerCase().replace(/^openai\//, '');
  if (/^gpt-4\.1/.test(m)) return 1_047_576;
  if (/^gpt-5/.test(m) || /codex/.test(m)) return 400 * K;
  if (/^o[134]/.test(m)) return 200 * K;
  if (/^gpt-4o|^chatgpt-4o|^gpt-4-turbo/.test(m)) return 128 * K;
  if (/^gpt-4/.test(m)) return 8192;
  if (/^gpt-3\.5/.test(m)) return 16_385;
  return undefined;
}

/** The window of a model when its provider's list does not say it; undefined when unknown. */
export function knownContextWindow(provider: string, model: string): number | undefined {
  const id = model.includes('/') ? model.slice(model.indexOf('/') + 1) : model;
  switch (provider) {
    case 'anthropic':
    case 'claude-agent':
      return claudeWindow(id);
    case 'openai':
    case 'chatgpt':
    case 'codex':
      return openaiWindow(id);
    default:
      if (/^anthropic\//.test(model)) return claudeWindow(id);
      if (/^openai\//.test(model)) return openaiWindow(id);
      return undefined;
  }
}
