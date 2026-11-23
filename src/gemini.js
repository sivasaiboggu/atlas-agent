// Atlas — Google Gemini API client (streaming, browser fetch).
// No key is bundled. The caller passes the user's own free key.
// Endpoints: v1beta streamGenerateContent with alt=sse.
// Supports plain chat (streamReply) and the agent loop (streamGenerate
// with tools + systemInstruction), which can return functionCall parts.
// Errors are surfaced as plain text from the API, never hidden or faked:
//   400 API_KEY_INVALID -> the key is wrong
//   404                 -> the model name is not available for this key
//   429                 -> quota / rate limit
//   other               -> the message Google returned

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
];

export function isValidModel(model) {
  return MODELS.some((m) => m.id === model);
}

export function modelLabel(model) {
  return MODELS.find((m) => m.id === model)?.label ?? model;
}

export function buildRequestBody(history, userText) {
  const contents = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));
  contents.push({ role: 'user', parts: [{ text: userText }] });
  return {
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
  };
}

export function streamUrl(model, apiKey) {
  return `${GEMINI_BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
}

export class GeminiError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.code = code;
  }
}

// Turn a non-2xx response into a plain-language error.
export async function errorFromResponse(res) {
  let detail = '';
  let statusText = '';
  try {
    const data = await res.json();
    detail = data?.error?.message || data?.error?.status || '';
    statusText = data?.error?.status || '';
  } catch (err) { /* body is not JSON */ }
  const status = res.status;
  if (status === 400 && (/API key not valid/i.test(detail) || /API_KEY_INVALID/i.test(detail) || /API_KEY_INVALID/i.test(statusText))) {
    return new GeminiError('That API key looks wrong. Check it in Settings — get a free key at Google AI Studio.', 400, 'API_KEY_INVALID');
  }
  if (status === 404) {
    return new GeminiError(`Google says this model is not available (${detail || 'not found'}). Try another model in the picker.`, 404, 'MODEL_NOT_FOUND');
  }
  if (status === 429) {
    return new GeminiError(`Google rate-limited the request (${detail || 'quota reached'}). Wait a minute and try again.`, 429, 'RATE_LIMITED');
  }
  return new GeminiError(detail ? `Google returned an error (${status}): ${detail}` : `Google returned an error (HTTP ${status}).`, status, '');
}

// Parse one SSE chunk. Returns { text, functionCalls, usage, done, error }.
// `buffer` is the leftover partial line from the previous chunk.
// functionCalls is [{ name, args }] — args is an object (parsed from
// JSON when the API sends it as a string).
export function parseSseChunk(chunkText, buffer = '') {
  const combined = buffer + chunkText;
  const lines = combined.split('\n');
  const nextBuffer = lines.pop() ?? '';
  let text = '';
  let usage = null;
  let error = null;
  const functionCalls = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let data;
    try {
      data = JSON.parse(payload);
    } catch (err) {
      continue; // partial JSON — wait for the rest in the next chunk
    }
    if (data.error) {
      error = data.error.message || data.error.status || 'Unknown streaming error';
      continue;
    }
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (typeof part.text === 'string') text += part.text;
      if (part.functionCall && part.functionCall.name) {
        let args = part.functionCall.args ?? {};
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch (err) { args = {}; }
        }
        if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
        functionCalls.push({ name: part.functionCall.name, args });
      }
    }
    if (data.usageMetadata) {
      usage = {
        prompt: data.usageMetadata.promptTokenCount ?? null,
        candidates: data.usageMetadata.candidatesTokenCount ?? null,
        total: data.usageMetadata.totalTokenCount ?? null,
      };
    }
  }
  return { text, functionCalls, usage, error, buffer: nextBuffer };
}

export function formatUsage(usage) {
  if (!usage) return '';
  const parts = [];
  if (usage.prompt != null) parts.push(`${usage.prompt} in`);
  if (usage.candidates != null) parts.push(`${usage.candidates} out`);
  if (usage.total != null) parts.push(`${usage.total}`);
  return parts.length ? `${parts.join(' · ')} tokens` : '';
}

function assertKeyAndModel(model, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new GeminiError('No API key set. Add your free Gemini key in Settings.', 0, 'NO_KEY');
  }
  if (!isValidModel(model)) {
    throw new GeminiError(`Unknown model "${model}". Pick one from the model picker.`, 0, 'BAD_MODEL');
  }
}

// Stream one generateContent call with an arbitrary request body.
// onToken(textSoFar) is called as text arrives.
// Returns { text, functionCalls, usage }. Throws GeminiError on failure.
// `fetchImpl` is injectable for tests.
export async function streamGenerate({ model, apiKey, body, signal, fetchImpl = fetch, onToken = () => {}, onUsage = () => {} }) {
  assertKeyAndModel(model, apiKey);
  const res = await fetchImpl(streamUrl(model, apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await errorFromResponse(res);
  if (!res.body) {
    throw new GeminiError('Google returned an empty stream. Try again.', 0, 'EMPTY_STREAM');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  let usage = null;
  const functionCalls = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const parsed = parseSseChunk(decoder.decode(value, { stream: true }), buffer);
    buffer = parsed.buffer;
    if (parsed.error) throw new GeminiError(parsed.error, 0, 'STREAM_ERROR');
    if (parsed.text) {
      full += parsed.text;
      onToken(full);
    }
    if (parsed.functionCalls.length) functionCalls.push(...parsed.functionCalls);
    if (parsed.usage) {
      usage = parsed.usage;
      onUsage(usage);
    }
  }
  // flush any trailing line
  if (buffer.trim()) {
    const parsed = parseSseChunk('\n', buffer);
    if (parsed.text) {
      full += parsed.text;
      onToken(full);
    }
    if (parsed.functionCalls.length) functionCalls.push(...parsed.functionCalls);
    if (parsed.usage) {
      usage = parsed.usage;
      onUsage(usage);
    }
  }
  return { text: full, functionCalls, usage };
}

// Stream a plain chat reply. onToken(textSoFar) is called as text arrives.
// onUsage(usage) is called if Google reports token counts.
// Returns the full text. Throws GeminiError on failure.
// `fetchImpl` is injectable for tests.
export async function streamReply({ model, apiKey, history, userText, signal, fetchImpl = fetch, onToken = () => {}, onUsage = () => {} }) {
  const { text, usage } = await streamGenerate({
    model,
    apiKey,
    body: buildRequestBody(history, userText),
    signal,
    fetchImpl,
    onToken,
    onUsage,
  });
  return { text, usage };
}
