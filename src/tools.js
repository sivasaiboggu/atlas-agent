// Atlas — tool registry and executors.
// Every tool runs in the browser with real data. Nothing is faked:
// a tool that cannot reach its source says so in its result.
// Pure functions (URL builders, validators, the calculator) are
// dependency-free so they can be unit-tested without a browser.

export const MAX_SEARCH_RESULTS = 5;
export const MAX_PAGE_CHARS = 8000;
export const MAX_FILE_CHARS = 12000;

// ---------- URL builders (pure) ----------

export function wikipediaSearchUrl(query) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: String(MAX_SEARCH_RESULTS),
    format: 'json',
    origin: '*',
  });
  return `https://en.wikipedia.org/w/api.php?${params.toString()}`;
}

export function duckduckgoUrl(query) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
  });
  return `https://api.duckduckgo.com/?${params.toString()}`;
}

export function geocodeUrl(place) {
  const params = new URLSearchParams({ name: place, count: '1', language: 'en', format: 'json' });
  return `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`;
}

export function forecastUrl(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
    timezone: 'auto',
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export function buildGmailComposeUrl({ to = '', subject = '', body = '' }) {
  const params = new URLSearchParams({ view: 'cm', fs: '1' });
  if (to) params.set('to', to);
  if (subject) params.set('su', subject);
  if (body) params.set('body', body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

// ---------- small pure helpers ----------

export const WEATHER_CODES = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Icy fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Slight rain showers',
  81: 'Rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

export function weatherDescription(code) {
  return WEATHER_CODES[code] ?? `Weather code ${code}`;
}

// Strip a fetched HTML page down to readable text. Crude on purpose:
// the goal is a usable extract, not a perfect reader.
export function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(h1|h2|h3|h4|p|li|tr|div|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_PAGE_CHARS);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Safe arithmetic: recursive-descent parser, no eval().
// Supports + - * / % ^ parentheses and unary minus, decimal numbers.
export function calculate(expression) {
  const src = String(expression || '').trim();
  if (!src) return { ok: false, error: 'No expression given.' };
  if (/[^0-9+\-*/%^().\s]/.test(src)) {
    return { ok: false, error: 'Only numbers and + - * / % ^ ( ) are allowed.' };
  }
  let i = 0;
  const peek = () => src[i];
  const eat = (ch) => { if (src[i] === ch) { i += 1; return true; } return false; };
  const skip = () => { while (/\s/.test(src[i] || '')) i += 1; };

  function parseNumber() {
    skip();
    const start = i;
    while (/[0-9.]/.test(src[i] || '')) i += 1;
    if (i === start) throw new Error(`Expected a number at position ${start + 1}.`);
    const value = Number(src.slice(start, i));
    if (!Number.isFinite(value)) throw new Error('That number is too large to work with.');
    return value;
  }
  function parsePrimary() {
    skip();
    if (eat('(')) {
      const value = parseExpr();
      skip();
      if (!eat(')')) throw new Error('Missing a closing bracket.');
      return value;
    }
    if (eat('-')) return -parsePrimary();
    if (eat('+')) return parsePrimary();
    return parseNumber();
  }
  function parsePower() {
    let base = parsePrimary();
    skip();
    if (eat('^')) {
      const exp = parsePower();
      base = Math.pow(base, exp);
      if (!Number.isFinite(base)) throw new Error('That power is too large to work with.');
    }
    return base;
  }
  function parseTerm() {
    let value = parsePower();
    for (;;) {
      skip();
      if (eat('*')) value *= parsePower();
      else if (eat('/')) {
        const d = parsePower();
        if (d === 0) throw new Error('Cannot divide by zero.');
        value /= d;
      } else if (eat('%')) {
        const d = parsePower();
        if (d === 0) throw new Error('Cannot divide by zero.');
        value %= d;
      } else break;
    }
    return value;
  }
  function parseExpr() {
    let value = parseTerm();
    for (;;) {
      skip();
      if (eat('+')) value += parseTerm();
      else if (eat('-')) value -= parseTerm();
      else break;
    }
    return value;
  }
  try {
    const value = parseExpr();
    skip();
    if (i < src.length) throw new Error(`Unexpected character "${src[i]}" at position ${i + 1}.`);
    if (!Number.isFinite(value)) throw new Error('That result is too large to work with.');
    return { ok: true, value: Math.round(value * 1e12) / 1e12 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------- tool declarations (Gemini functionDeclarations) ----------

export const TOOL_DECLARATIONS = [
  {
    name: 'web_search',
    description: 'Search the web for current facts, people, companies or news. Returns real titles, short extracts and links from Wikipedia, or DuckDuckGo when Wikipedia has nothing. Use it instead of guessing.',
    parameters: {
      type: 'OBJECT',
      properties: { query: { type: 'STRING', description: 'The search query, in plain words.' } },
      required: ['query'],
    },
  },
  {
    name: 'fetch_page',
    description: 'Fetch a web page and read its text. Returns the readable text of the page (up to 8000 characters). Some sites block cross-origin reads; when that happens the tool says so and returns the URL instead of inventing content.',
    parameters: {
      type: 'OBJECT',
      properties: { url: { type: 'STRING', description: 'The full URL to fetch, starting with http:// or https://.' } },
      required: ['url'],
    },
  },
  {
    name: 'get_weather',
    description: 'Current weather for a place the user names, from Open-Meteo. Give the place name; the tool looks up its coordinates first.',
    parameters: {
      type: 'OBJECT',
      properties: { place: { type: 'STRING', description: 'City or place name, e.g. Hyderabad, Gooty, Bengaluru.' } },
      required: ['place'],
    },
  },
  {
    name: 'tasks',
    description: 'Manage the user\'s task list, saved in this browser. Add a task, list open and done tasks, or mark one complete.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', enum: ['add', 'list', 'complete'], description: 'What to do with the task list.' },
        title: { type: 'STRING', description: 'Task title, needed for add.' },
        id: { type: 'STRING', description: 'Task id, needed for complete. List tasks first to see ids.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'notes',
    description: 'Save, list or search the user\'s notes, saved in this browser. Notes keep plain text the user asked to remember.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', enum: ['save', 'list', 'search'], description: 'What to do with the notes.' },
        title: { type: 'STRING', description: 'Short title for the note, needed for save.' },
        text: { type: 'STRING', description: 'Note text, needed for save.' },
        query: { type: 'STRING', description: 'Search words, needed for search.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'draft_email',
    description: 'Build a mail draft and open it in Gmail compose with the recipient, subject and body filled in. The app cannot send mail by itself — the user reviews and sends from Gmail. Never claim a mail was sent; it was only drafted.',
    parameters: {
      type: 'OBJECT',
      properties: {
        to: { type: 'STRING', description: 'Recipient email address.' },
        subject: { type: 'STRING', description: 'Mail subject.' },
        body: { type: 'STRING', description: 'Mail body, plain text.' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'calculate',
    description: 'Do arithmetic the user asks for. Numbers and + - * / % ^ and brackets only.',
    parameters: {
      type: 'OBJECT',
      properties: { expression: { type: 'STRING', description: 'The arithmetic expression, e.g. (240 + 35) * 1.18.' } },
      required: ['expression'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the file the user attached to this chat and answer a question about it, or summarise it. Only works when the user has attached a text file with the paperclip button. Text files up to 20000 characters are read in full.',
    parameters: {
      type: 'OBJECT',
      properties: { question: { type: 'STRING', description: 'What to find out about the file, or "summarise this file".' } },
      required: ['question'],
    },
  },
];

export const TOOL_NAMES = TOOL_DECLARATIONS.map((t) => t.name);

// ---------- validation ----------

export function validateToolCall(name, args) {
  const decl = TOOL_DECLARATIONS.find((t) => t.name === name);
  if (!decl) return { ok: false, error: `Unknown tool "${name}".` };
  const a = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
  for (const req of decl.parameters.required || []) {
    const value = a[req];
    if (value === undefined || value === null || String(value).trim() === '') {
      return { ok: false, error: `Tool "${name}" needs "${req}".` };
    }
  }
  if (name === 'fetch_page' && !/^https?:\/\//i.test(String(a.url || ''))) {
    return { ok: false, error: 'fetch_page needs a full URL starting with http:// or https://.' };
  }
  if (name === 'draft_email' && !EMAIL_RE.test(String(a.to || ''))) {
    return { ok: false, error: `"${a.to}" does not look like an email address.` };
  }
  if (name === 'tasks' && !['add', 'list', 'complete'].includes(String(a.action || ''))) {
    return { ok: false, error: 'tasks needs action add, list or complete.' };
  }
  if (name === 'notes' && !['save', 'list', 'search'].includes(String(a.action || ''))) {
    return { ok: false, error: 'notes needs action save, list or search.' };
  }
  return { ok: true, args: a };
}

// ---------- executors ----------
// ctx: { fetchImpl, taskStore, noteStore, attachedFile, openUrl }
// Each executor returns { ok, summary, data } — data is JSON-safe and small,
// and is what gets sent back to the model as the function result.

async function execWebSearch(args, ctx) {
  const fetchImpl = ctx.fetchImpl || fetch;
  const fetchOpts = ctx.signal ? { signal: ctx.signal } : undefined;
  const query = String(args.query).trim();
  // Wikipedia first.
  try {
    const res = await fetchImpl(wikipediaSearchUrl(query), fetchOpts);
    if (res.ok) {
      const data = await res.json();
      const hits = (data?.query?.search || []).map((h) => ({
        title: h.title,
        snippet: String(h.snippet || '').replace(/<[^>]+>/g, ''),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(h.title).replace(/ /g, '_'))}`,
      }));
      if (hits.length) {
        return { ok: true, summary: `Found ${hits.length} result${hits.length === 1 ? '' : 's'} on Wikipedia for "${query}".`, data: { source: 'wikipedia', query, results: hits } };
      }
    }
  } catch (err) { /* fall through to DuckDuckGo */ }
  try {
    const res = await fetchImpl(duckduckgoUrl(query), fetchOpts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const results = [];
    if (data?.AbstractText) {
      results.push({ title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL || '' });
    }
    for (const topic of data?.RelatedTopics || []) {
      if (results.length >= MAX_SEARCH_RESULTS) break;
      if (topic?.Text && topic?.FirstURL) results.push({ title: topic.Text.split(' - ')[0], snippet: topic.Text, url: topic.FirstURL });
    }
    if (results.length) {
      return { ok: true, summary: `Found ${results.length} result${results.length === 1 ? '' : 's'} for "${query}" (DuckDuckGo).`, data: { source: 'duckduckgo', query, results } };
    }
    return { ok: true, summary: `No results for "${query}" on Wikipedia or DuckDuckGo.`, data: { source: 'none', query, results: [] } };
  } catch (err) {
    return { ok: false, summary: `Search failed — neither Wikipedia nor DuckDuckGo answered (${err.message}). Check the connection and try again.`, data: { source: 'error', query, error: err.message } };
  }
}

async function execFetchPage(args, ctx) {
  const fetchImpl = ctx.fetchImpl || fetch;
  const fetchOpts = ctx.signal ? { signal: ctx.signal } : undefined;
  const url = String(args.url).trim();
  let res;
  try {
    res = await fetchImpl(url, fetchOpts);
  } catch (err) {
    return { ok: false, summary: `Could not fetch ${url} — the site or the network blocked the read (${err.message}). The page was not read, so I will not describe its content.`, data: { url, error: 'fetch blocked', detail: err.message } };
  }
  if (!res.ok) {
    return { ok: false, summary: `Fetching ${url} returned HTTP ${res.status}. The page was not read.`, data: { url, error: `HTTP ${res.status}` } };
  }
  const html = await res.text();
  const text = stripHtmlToText(html);
  if (!text) {
    return { ok: false, summary: `Fetched ${url} but found no readable text on it.`, data: { url, error: 'no readable text' } };
  }
  return { ok: true, summary: `Read ${text.length} characters from ${url}.`, data: { url, text } };
}

async function execGetWeather(args, ctx) {
  const fetchImpl = ctx.fetchImpl || fetch;
  const fetchOpts = ctx.signal ? { signal: ctx.signal } : undefined;
  const place = String(args.place).trim();
  let geo;
  try {
    const res = await fetchImpl(geocodeUrl(place), fetchOpts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    geo = await res.json();
  } catch (err) {
    return { ok: false, summary: `Could not look up "${place}" (${err.message}).`, data: { place, error: err.message } };
  }
  const hit = geo?.results?.[0];
  if (!hit) {
    return { ok: false, summary: `I could not find a place called "${place}". Check the spelling and try again.`, data: { place, error: 'place not found' } };
  }
  try {
    const res = await fetchImpl(forecastUrl(hit.latitude, hit.longitude), fetchOpts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const cur = data?.current || {};
    const condition = weatherDescription(cur.weather_code);
    const name = [hit.name, hit.admin1, hit.country].filter(Boolean).join(', ');
    const summary = `${name}: ${condition}, ${cur.temperature_2m ?? '?'}°C (feels like ${cur.apparent_temperature ?? '?'}°C), humidity ${cur.relative_humidity_2m ?? '?'}%, wind ${cur.wind_speed_10m ?? '?'} km/h.`;
    return { ok: true, summary, data: { place: name, condition, temperatureC: cur.temperature_2m ?? null, feelsLikeC: cur.apparent_temperature ?? null, humidityPct: cur.relative_humidity_2m ?? null, windKmh: cur.wind_speed_10m ?? null, time: cur.time ?? null } };
  } catch (err) {
    return { ok: false, summary: `Found ${hit.name}, but the weather service did not answer (${err.message}).`, data: { place: hit.name, error: err.message } };
  }
}

function execTasks(args, ctx) {
  const store = ctx.taskStore;
  if (!store) return { ok: false, summary: 'The task list is not available in this browser.', data: { error: 'no task store' } };
  if (args.action === 'add') {
    const { task, duplicate } = store.add(String(args.title || '').trim());
    if (!task) return { ok: false, summary: 'Give the task a title first.', data: { error: 'empty title' } };
    return { ok: true, summary: duplicate ? `That task is already on the list: "${task.title}".` : `Added task: "${task.title}".`, data: { task, duplicate } };
  }
  if (args.action === 'list') {
    const tasks = store.list();
    const open = tasks.filter((t) => !t.done);
    const done = tasks.filter((t) => t.done);
    return { ok: true, summary: open.length ? `${open.length} open task${open.length === 1 ? '' : 's'}${done.length ? `, ${done.length} done` : ''}.` : 'No open tasks. The list is clear.', data: { tasks } };
  }
  if (args.action === 'complete') {
    const done = store.complete(String(args.id || ''));
    if (!done) return { ok: false, summary: 'I could not find a task with that id. List the tasks first to see the ids.', data: { error: 'task not found' } };
    return { ok: true, summary: `Done: "${done.title}".`, data: { task: done } };
  }
  return { ok: false, summary: 'Unknown tasks action.', data: { error: 'bad action' } };
}

function execNotes(args, ctx) {
  const store = ctx.noteStore;
  if (!store) return { ok: false, summary: 'Notes are not available in this browser.', data: { error: 'no note store' } };
  if (args.action === 'save') {
    const note = store.add(String(args.title || '').trim(), String(args.text || '').trim());
    if (!note) return { ok: false, summary: 'A note needs a title and some text.', data: { error: 'empty note' } };
    return { ok: true, summary: `Saved note: "${note.title}".`, data: { note } };
  }
  if (args.action === 'list') {
    const notes = store.list();
    return { ok: true, summary: notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'} saved.` : 'No notes saved yet.', data: { notes } };
  }
  if (args.action === 'search') {
    const query = String(args.query || '').trim();
    const notes = store.search(query);
    return { ok: true, summary: notes.length ? `Found ${notes.length} note${notes.length === 1 ? '' : 's'} matching "${query}".` : `No notes match "${query}".`, data: { query, notes } };
  }
  return { ok: false, summary: 'Unknown notes action.', data: { error: 'bad action' } };
}

function execDraftEmail(args, ctx) {
  const url = buildGmailComposeUrl({ to: args.to, subject: args.subject, body: args.body });
  if (typeof ctx.openUrl === 'function') {
    try { ctx.openUrl(url); } catch (err) { /* the trace still carries the link */ }
  }
  return {
    ok: true,
    summary: `Draft ready for ${args.to} — it opened in Gmail compose. It is a draft, not a sent mail: review it and send it from Gmail.`,
    data: { to: args.to, subject: args.subject, body: args.body, composeUrl: url, sent: false },
  };
}

function execCalculate(args) {
  const out = calculate(String(args.expression || ''));
  if (!out.ok) return { ok: false, summary: `Could not work that out: ${out.error}`, data: { expression: args.expression, error: out.error } };
  return { ok: true, summary: `${args.expression} = ${out.value}`, data: { expression: args.expression, result: out.value } };
}

function execReadFile(args, ctx) {
  const file = ctx.attachedFile;
  if (!file || !file.text) {
    return { ok: false, summary: 'No file is attached to this chat. Attach a text file with the paperclip button, then ask again.', data: { error: 'no file attached' } };
  }
  const excerpt = file.text.slice(0, MAX_FILE_CHARS);
  return {
    ok: true,
    summary: `Read "${file.name}" (${file.text.length} characters${file.text.length > MAX_FILE_CHARS ? `, first ${MAX_FILE_CHARS} used` : ''}).`,
    data: { name: file.name, question: args.question, text: excerpt },
  };
}

const EXECUTORS = {
  web_search: execWebSearch,
  fetch_page: execFetchPage,
  get_weather: execGetWeather,
  tasks: execTasks,
  notes: execNotes,
  draft_email: execDraftEmail,
  calculate: execCalculate,
  read_file: execReadFile,
};

// Run one validated tool call. Returns the executor result, or a
// validation error result (never throws for bad input).
export async function executeTool(name, args, ctx = {}) {
  const check = validateToolCall(name, args);
  if (!check.ok) {
    return { ok: false, summary: check.error, data: { error: check.error } };
  }
  try {
    return await EXECUTORS[name](check.args, ctx);
  } catch (err) {
    return { ok: false, summary: `Tool "${name}" failed: ${err.message}`, data: { error: err.message } };
  }
}
