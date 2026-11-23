// Atlas — tests for the agent loop.
// The model is mocked with scripted SSE responses; the executor is a
// stub, so no network or key is needed.
// Run: npm test (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runAgent, buildAgentContents, MAX_AGENT_TURNS } from '../src/agent.js';
import { GeminiError } from '../src/gemini.js';

function sseStream(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

function sseData(payload) {
  return `data: ${JSON.stringify(payload)}\n`;
}

function textPart(text) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

function callPart(name, args) {
  return { candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] };
}

// Scripted fetch: each call consumes the next response spec.
function scriptedFetch(specs) {
  let i = 0;
  return async () => {
    const spec = specs[Math.min(i, specs.length - 1)];
    i += 1;
    if (spec.status && spec.status >= 400) {
      return { ok: false, status: spec.status, json: async () => spec.body };
    }
    return { ok: true, status: 200, body: sseStream(spec.chunks) };
  };
}

describe('runAgent — one tool call then an answer', () => {
  it('calls the tool, feeds the result back, and answers from it', async () => {
    const calls = [];
    const events = [];
    const fetchImpl = scriptedFetch([
      { chunks: [sseData(callPart('get_weather', { place: 'Hyderabad' }))] },
      { chunks: [sseData(textPart('Hyderabad is 31°C and partly cloudy.'))] },
    ]);
    const executor = async (name, args) => {
      calls.push({ name, args });
      return { ok: true, summary: 'Hyderabad: Partly cloudy, 31°C.', data: { place: 'Hyderabad', temperatureC: 31 } };
    };
    const out = await runAgent({
      model: 'gemini-2.5-flash',
      apiKey: 'KEY',
      history: [],
      userText: "What's the weather in Hyderabad?",
      executor,
      fetchImpl,
      onEvent: (ev) => events.push(ev.type),
    });
    assert.equal(out.text, 'Hyderabad is 31°C and partly cloudy.');
    assert.equal(out.trace.length, 1);
    assert.equal(out.trace[0].name, 'get_weather');
    assert.deepEqual(calls, [{ name: 'get_weather', args: { place: 'Hyderabad' } }]);
    assert.ok(events.includes('toolcall') && events.includes('toolresult'));
  });

  it('answers directly when no tool is needed', async () => {
    const fetchImpl = scriptedFetch([
      { chunks: [sseData(textPart('Paris is the capital of France.'))] },
    ]);
    let toolCalls = 0;
    const out = await runAgent({
      model: 'gemini-2.5-flash',
      apiKey: 'KEY',
      history: [],
      userText: 'What is the capital of France?',
      executor: async () => { toolCalls += 1; return { ok: true, summary: '', data: {} }; },
      fetchImpl,
    });
    assert.equal(out.text, 'Paris is the capital of France.');
    assert.equal(out.trace.length, 0);
    assert.equal(toolCalls, 0);
  });

  it('emits the plan text when a turn mixes text and tool calls', async () => {
    const plans = [];
    const fetchImpl = scriptedFetch([
      { chunks: [sseData({ candidates: [{ content: { parts: [{ text: 'I will look that up.' }, { functionCall: { name: 'web_search', args: { query: 'x' } } }] } }] })] },
      { chunks: [sseData(textPart('Here it is.'))] },
    ]);
    await runAgent({
      model: 'gemini-2.5-flash',
      apiKey: 'KEY',
      history: [],
      userText: 'Look it up',
      executor: async () => ({ ok: true, summary: 'found', data: { results: [] } }),
      fetchImpl,
      onEvent: (ev) => { if (ev.type === 'plan') plans.push(ev.text); },
    });
    assert.deepEqual(plans, ['I will look that up.']);
  });

  it('carries a tool failure back to the model instead of crashing', async () => {
    const fetchImpl = scriptedFetch([
      { chunks: [sseData(callPart('fetch_page', { url: 'https://blocked.example' }))] },
      { chunks: [sseData(textPart('That page blocked the read, so I cannot describe it.'))] },
    ]);
    const out = await runAgent({
      model: 'gemini-2.5-flash',
      apiKey: 'KEY',
      history: [],
      userText: 'Read this page',
      executor: async () => ({ ok: false, summary: 'Could not fetch — blocked.', data: { error: 'blocked' } }),
      fetchImpl,
    });
    assert.match(out.text, /blocked/);
    assert.equal(out.trace[0].result.ok, false);
  });

  it('stops after the turn limit instead of looping forever', async () => {
    const fetchImpl = scriptedFetch(
      Array.from({ length: 10 }, () => ({ chunks: [sseData(callPart('calculate', { expression: '1+1' }))] })),
    );
    const out = await runAgent({
      model: 'gemini-2.5-flash',
      apiKey: 'KEY',
      history: [],
      userText: 'Keep calculating',
      executor: async () => ({ ok: true, summary: '1+1 = 2', data: { result: 2 } }),
      fetchImpl,
      maxTurns: 2,
    });
    assert.equal(out.trace.length, 2);
    assert.match(out.text, /stopped after/);
    assert.ok(out.text.length > 0);
  });

  it('refuses to run without a key', async () => {
    await assert.rejects(
      () => runAgent({ model: 'gemini-2.5-flash', apiKey: '', history: [], userText: 'Hi', fetchImpl: scriptedFetch([]) }),
      (err) => err instanceof GeminiError && err.code === 'NO_KEY',
    );
  });

  it('surfaces an API error as a GeminiError', async () => {
    const fetchImpl = scriptedFetch([
      { status: 400, body: { error: { message: 'API key not valid.', status: 'INVALID_ARGUMENT' } } },
    ]);
    await assert.rejects(
      () => runAgent({ model: 'gemini-2.5-flash', apiKey: 'BAD', history: [], userText: 'Hi', fetchImpl }),
      (err) => err instanceof GeminiError && err.code === 'API_KEY_INVALID',
    );
  });
});

describe('buildAgentContents', () => {
  it('rebuilds tool history with functionCall and functionResponse parts', () => {
    const history = [
      { role: 'user', text: 'Weather?' },
      {
        role: 'assistant',
        text: 'Hyderabad is 31°C.',
        trace: [{ name: 'get_weather', args: { place: 'Hyderabad' }, result: { ok: true, summary: '31°C', data: { temperatureC: 31 } } }],
      },
    ];
    const contents = buildAgentContents(history, 'And tomorrow?');
    assert.equal(contents.length, 4);
    assert.equal(contents[0].role, 'user');
    assert.equal(contents[1].role, 'model');
    assert.ok(contents[1].parts.some((p) => p.functionCall?.name === 'get_weather'));
    assert.equal(contents[2].role, 'user');
    assert.ok(contents[2].parts.some((p) => p.functionResponse?.name === 'get_weather'));
    assert.equal(contents[3].parts[0].text, 'And tomorrow?');
  });

  it('handles plain history with no traces', () => {
    const contents = buildAgentContents([{ role: 'user', text: 'Hi' }], 'Hello');
    assert.deepEqual(contents, [
      { role: 'user', parts: [{ text: 'Hi' }] },
      { role: 'user', parts: [{ text: 'Hello' }] },
    ]);
  });
});

describe('MAX_AGENT_TURNS', () => {
  it('is six', () => {
    assert.equal(MAX_AGENT_TURNS, 6);
  });
});
