// Atlas — the agent loop.
// Turns a user message into: plan text (optional), tool calls, real tool
// results, and a final answer written from those results. The model is
// only ever given what the tools actually returned; it never sees
// invented facts. History is rebuilt with functionCall / functionResponse
// parts so the model can follow its own earlier tool use.

import { streamGenerate, GeminiError } from './gemini.js';
import { TOOL_DECLARATIONS, executeTool } from './tools.js';

export const MAX_AGENT_TURNS = 6;

export const SYSTEM_INSTRUCTION =
  'You are Atlas, a general-purpose everyday agent. You help with anything the user asks: ' +
  'job search, mail, web research, tasks, notes, files, planning, maths, and general questions. ' +
  'You have tools: web_search, fetch_page, get_weather, tasks, notes, draft_email, calculate, read_file. ' +
  'Use a tool whenever the user asks for something a tool can do — look up facts instead of guessing, ' +
  'check the weather instead of estimating, draft a mail instead of writing it as plain text. ' +
  'When a tool returns a result, answer from that result and say where it came from. ' +
  'If a tool fails, say so plainly and say what you could not do. ' +
  'Never invent a fact, a link, a number or a sent mail. A mail draft is not a sent mail — say so. ' +
  'Keep answers short and direct. Do not use emojis or marketing language.';

// Build the contents array for the API from chat history + the new
// user message. Assistant messages keep their tool trace so the model
// sees its own calls and their results.
export function buildAgentContents(history, userText) {
  const contents = [];
  for (const m of history || []) {
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.text }] });
    } else if (m.role === 'assistant') {
      const parts = [];
      if (m.text) parts.push({ text: m.text });
      const trace = Array.isArray(m.trace) ? m.trace : [];
      for (const step of trace) {
        if (step.name) parts.push({ functionCall: { name: step.name, args: step.args || {} } });
      }
      if (parts.length) contents.push({ role: 'model', parts });
      if (trace.length) {
        contents.push({
          role: 'user',
          parts: trace.map((step) => ({
            functionResponse: {
              name: step.name,
              response: { result: step.result?.data ?? step.result?.summary ?? null },
            },
          })),
        });
      }
    }
  }
  contents.push({ role: 'user', parts: [{ text: userText }] });
  return contents;
}

export function buildAgentBody(history, userText) {
  return {
    contents: buildAgentContents(history, userText),
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
  };
}

// Run one agent turn.
// onEvent receives:
//   { type: 'plan', text }              — model text that came with tool calls
//   { type: 'toolcall', name, args }    — before a tool runs
//   { type: 'toolresult', step }        — after a tool runs; step = { name, args, result }
//   { type: 'text', text }              — streaming text of the current turn
// Returns { text, usage, trace } — trace is [{ name, args, result }].
// executor defaults to the real executeTool; pass a stub in tests.
// Throws GeminiError on API failure (or AbortError when stopped).
export async function runAgent({
  model,
  apiKey,
  history = [],
  userText,
  executor = executeTool,
  toolCtx = {},
  signal,
  fetchImpl = fetch,
  onEvent = () => {},
  maxTurns = MAX_AGENT_TURNS,
}) {
  let contents = buildAgentContents(history, userText);
  const trace = [];
  let finalText = '';
  let usage = null;
  let turns = 0;

  for (;;) {
    const body = {
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
    };
    const turn = await streamGenerate({
      model,
      apiKey,
      body,
      signal,
      fetchImpl,
      onToken: (text) => onEvent({ type: 'text', text }),
      onUsage: (u) => { usage = u; },
    });
    if (turn.usage) usage = turn.usage;

    if (!turn.functionCalls.length) {
      finalText = turn.text;
      break;
    }
    if (turn.text) onEvent({ type: 'plan', text: turn.text });
    if (turns >= maxTurns) {
      finalText = turn.text || 'I stopped after six tool steps without a final answer. The results above are real — ask again and I will pick up from them.';
      break;
    }
    turns += 1;

    const modelParts = [];
    if (turn.text) modelParts.push({ text: turn.text });
    for (const call of turn.functionCalls) {
      modelParts.push({ functionCall: { name: call.name, args: call.args } });
    }
    contents.push({ role: 'model', parts: modelParts });

    const responseParts = [];
    for (const call of turn.functionCalls) {
      onEvent({ type: 'toolcall', name: call.name, args: call.args });
      const result = await executor(call.name, call.args, toolCtx);
      const step = { name: call.name, args: call.args, result };
      trace.push(step);
      onEvent({ type: 'toolresult', step });
      responseParts.push({
        functionResponse: {
          name: call.name,
          response: { result: result?.data ?? result?.summary ?? null },
        },
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return { text: finalText, usage, trace };
}

export { GeminiError };
