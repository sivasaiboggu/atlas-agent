// Atlas — tests for the tool registry and executors.
// Run: npm test (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TOOL_DECLARATIONS, TOOL_NAMES,
  validateToolCall, executeTool,
  buildGmailComposeUrl, wikipediaSearchUrl, duckduckgoUrl,
  geocodeUrl, forecastUrl, stripHtmlToText, calculate,
  weatherDescription, MAX_PAGE_CHARS, MAX_FILE_CHARS,
} from '../src/tools.js';
import { createTaskStore, createNoteStore } from '../src/work.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

function jsonFetch(data, ok = true, status = 200) {
  return async () => ({ ok, status, json: async () => data, text: async () => JSON.stringify(data) });
}

function textFetch(text, ok = true, status = 200) {
  return async () => ({ ok, status, json: async () => { throw new Error('not json'); }, text: async () => text });
}

describe('tool registry', () => {
  it('declares exactly the eight tools', () => {
    assert.deepEqual(TOOL_NAMES, [
      'web_search', 'fetch_page', 'get_weather', 'tasks',
      'notes', 'draft_email', 'calculate', 'read_file',
    ]);
    for (const decl of TOOL_DECLARATIONS) {
      assert.ok(decl.name && decl.description, `declaration missing name/description: ${decl.name}`);
      assert.equal(decl.parameters.type, 'OBJECT');
      assert.ok(Array.isArray(decl.parameters.required));
    }
  });

  it('never claims a draft was sent', () => {
    const draft = TOOL_DECLARATIONS.find((t) => t.name === 'draft_email');
    assert.match(draft.description, /cannot send mail by itself/);
    assert.ok(!/sent mail/i.test(draft.description) || /not a sent mail/i.test(draft.description));
  });
});

describe('validateToolCall', () => {
  it('accepts a well-formed call', () => {
    assert.equal(validateToolCall('get_weather', { place: 'Hyderabad' }).ok, true);
    assert.equal(validateToolCall('calculate', { expression: '2+2' }).ok, true);
  });

  it('rejects unknown tools', () => {
    const out = validateToolCall('send_sms', {});
    assert.equal(out.ok, false);
    assert.match(out.error, /Unknown tool/);
  });

  it('rejects missing required arguments', () => {
    assert.equal(validateToolCall('web_search', {}).ok, false);
    assert.equal(validateToolCall('web_search', { query: '  ' }).ok, false);
    assert.equal(validateToolCall('draft_email', { to: 'a@b.com', subject: 'Hi' }).ok, false);
  });

  it('rejects a bad URL and a bad email', () => {
    assert.equal(validateToolCall('fetch_page', { url: 'example.com' }).ok, false);
    assert.equal(validateToolCall('draft_email', { to: 'not-an-email', subject: 's', body: 'b' }).ok, false);
  });

  it('rejects unknown tasks/notes actions', () => {
    assert.equal(validateToolCall('tasks', { action: 'explode' }).ok, false);
    assert.equal(validateToolCall('notes', { action: 'explode' }).ok, false);
  });
});

describe('URL builders', () => {
  it('builds a Wikipedia search URL with origin=* for CORS', () => {
    const url = wikipediaSearchUrl('Hyderabad');
    assert.ok(url.startsWith('https://en.wikipedia.org/w/api.php?'));
    assert.ok(url.includes('origin=*') || url.includes('origin=%2A'));
    assert.ok(url.includes('srsearch=Hyderabad'));
  });

  it('builds a DuckDuckGo instant-answer URL', () => {
    const url = duckduckgoUrl('test query');
    assert.ok(url.startsWith('https://api.duckduckgo.com/?'));
    assert.ok(url.includes('format=json'));
  });

  it('builds Open-Meteo geocode and forecast URLs', () => {
    assert.ok(geocodeUrl('Gooty').startsWith('https://geocoding-api.open-meteo.com/v1/search?'));
    const f = forecastUrl(15.3, 77.6);
    assert.ok(f.startsWith('https://api.open-meteo.com/v1/forecast?'));
    assert.ok(f.includes('latitude=15.3') && f.includes('longitude=77.6'));
    assert.ok(f.includes('current=temperature_2m'));
  });

  it('builds a Gmail compose URL with the draft prefilled', () => {
    const url = buildGmailComposeUrl({ to: 'boss@example.com', subject: 'Hello', body: 'Line one\nLine two' });
    assert.ok(url.startsWith('https://mail.google.com/mail/?'));
    const params = new URLSearchParams(url.split('?')[1]);
    assert.equal(params.get('view'), 'cm');
    assert.equal(params.get('to'), 'boss@example.com');
    assert.equal(params.get('su'), 'Hello');
    assert.equal(params.get('body'), 'Line one\nLine two');
  });
});

describe('stripHtmlToText', () => {
  it('removes scripts, styles and tags', () => {
    const out = stripHtmlToText('<html><head><style>.a{}</style></head><body><script>evil()</script><h1>Title</h1><p>Hello <b>world</b></p></body></html>');
    assert.ok(!out.includes('evil'), 'script leaked');
    assert.ok(!out.includes('<'), 'tag leaked');
    assert.ok(out.includes('Title') && out.includes('Hello world'));
  });

  it('caps the output length', () => {
    const out = stripHtmlToText(`<p>${'x'.repeat(MAX_PAGE_CHARS + 5000)}</p>`);
    assert.ok(out.length <= MAX_PAGE_CHARS);
  });
});

describe('calculate', () => {
  it('does arithmetic with precedence', () => {
    assert.deepEqual(calculate('2+3*4'), { ok: true, value: 14 });
    assert.deepEqual(calculate('(2+3)*4'), { ok: true, value: 20 });
    assert.deepEqual(calculate('10 % 3'), { ok: true, value: 1 });
    assert.deepEqual(calculate('2^10'), { ok: true, value: 1024 });
    assert.deepEqual(calculate('-5 + 3'), { ok: true, value: -2 });
    assert.deepEqual(calculate('1.5 * 2'), { ok: true, value: 3 });
  });

  it('refuses division by zero and bad input', () => {
    assert.equal(calculate('1/0').ok, false);
    assert.match(calculate('1/0').error, /divide by zero/);
    assert.equal(calculate('2+').ok, false);
    assert.equal(calculate('(2+3').ok, false);
    assert.equal(calculate('2 + foo').ok, false);
    assert.equal(calculate('').ok, false);
    assert.equal(calculate('process.exit()').ok, false);
  });
});

describe('weatherDescription', () => {
  it('names common codes and falls back honestly', () => {
    assert.equal(weatherDescription(0), 'Clear sky');
    assert.equal(weatherDescription(63), 'Rain');
    assert.equal(weatherDescription(95), 'Thunderstorm');
    assert.equal(weatherDescription(12345), 'Weather code 12345');
  });
});

describe('executeTool — web_search', () => {
  it('returns Wikipedia results when they exist', async () => {
    const fetchImpl = jsonFetch({
      query: { search: [
        { title: 'Hyderabad', snippet: 'Hyderabad is a city in <b>India</b>.' },
        { title: 'Hyderabad (state)', snippet: 'A former state.' },
      ] },
    });
    const out = await executeTool('web_search', { query: 'Hyderabad' }, { fetchImpl });
    assert.equal(out.ok, true);
    assert.equal(out.data.source, 'wikipedia');
    assert.equal(out.data.results.length, 2);
    assert.equal(out.data.results[0].snippet, 'Hyderabad is a city in India.');
    assert.ok(out.data.results[0].url.includes('wikipedia.org'));
  });

  it('falls back to DuckDuckGo when Wikipedia has nothing', async () => {
    let calls = 0;
    const fetchImpl = async (url) => {
      calls += 1;
      if (url.includes('wikipedia')) return { ok: true, status: 200, json: async () => ({ query: { search: [] } }) };
      return { ok: true, status: 200, json: async () => ({ AbstractText: 'An abstract.', Heading: 'Thing', AbstractURL: 'https://example.com/thing' }) };
    };
    const out = await executeTool('web_search', { query: 'obscure thing' }, { fetchImpl });
    assert.equal(out.ok, true);
    assert.equal(out.data.source, 'duckduckgo');
    assert.equal(calls, 2);
  });

  it('says plainly when both sources fail', async () => {
    const fetchImpl = async () => { throw new Error('network down'); };
    const out = await executeTool('web_search', { query: 'x' }, { fetchImpl });
    assert.equal(out.ok, false);
    assert.match(out.summary, /Search failed/);
  });
});

describe('executeTool — fetch_page', () => {
  it('returns stripped text from a readable page', async () => {
    const out = await executeTool('fetch_page', { url: 'https://example.com' }, { fetchImpl: textFetch('<h1>Hi</h1><p>Some words here.</p>') });
    assert.equal(out.ok, true);
    assert.ok(out.data.text.includes('Hi'));
    assert.ok(out.data.text.includes('Some words here.'));
  });

  it('says plainly when the read is blocked, and never invents content', async () => {
    const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
    const out = await executeTool('fetch_page', { url: 'https://blocked.example' }, { fetchImpl });
    assert.equal(out.ok, false);
    assert.match(out.summary, /blocked/);
    assert.equal(out.data.url, 'https://blocked.example');
  });

  it('reports an HTTP error instead of content', async () => {
    const out = await executeTool('fetch_page', { url: 'https://example.com/404' }, { fetchImpl: textFetch('', false, 404) });
    assert.equal(out.ok, false);
    assert.match(out.summary, /404/);
  });
});

describe('executeTool — get_weather', () => {
  it('geocodes then reports the forecast', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('geocoding')) {
        return { ok: true, status: 200, json: async () => ({ results: [{ name: 'Hyderabad', admin1: 'Telangana', country: 'India', latitude: 17.38, longitude: 78.48 }] }) };
      }
      return { ok: true, status: 200, json: async () => ({ current: { temperature_2m: 31, apparent_temperature: 33, relative_humidity_2m: 55, weather_code: 2, wind_speed_10m: 12, time: '2026-11-23T08:00' } }) };
    };
    const out = await executeTool('get_weather', { place: 'Hyderabad' }, { fetchImpl });
    assert.equal(out.ok, true);
    assert.match(out.summary, /Hyderabad/);
    assert.match(out.summary, /Partly cloudy/);
    assert.match(out.summary, /31°C/);
    assert.equal(out.data.temperatureC, 31);
  });

  it('says so when the place is not found', async () => {
    const fetchImpl = jsonFetch({ results: [] });
    const out = await executeTool('get_weather', { place: 'Nowhereville' }, { fetchImpl });
    assert.equal(out.ok, false);
    assert.match(out.summary, /could not find a place/);
  });
});

describe('executeTool — tasks and notes', () => {
  it('adds, lists and completes tasks through the store', async () => {
    const storage = memoryStorage();
    const taskStore = createTaskStore(storage);
    const ctx = { taskStore };
    const added = await executeTool('tasks', { action: 'add', title: 'Call the bank' }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.data.task.title, 'Call the bank');
    const dup = await executeTool('tasks', { action: 'add', title: 'call the bank' }, ctx);
    assert.equal(dup.data.duplicate, true);
    const listed = await executeTool('tasks', { action: 'list' }, ctx);
    assert.equal(listed.data.tasks.length, 1);
    const done = await executeTool('tasks', { action: 'complete', id: added.data.task.id }, ctx);
    assert.equal(done.ok, true);
    assert.match(done.summary, /Done/);
    const missing = await executeTool('tasks', { action: 'complete', id: 'nope' }, ctx);
    assert.equal(missing.ok, false);
  });

  it('saves, searches and lists notes', async () => {
    const storage = memoryStorage();
    const noteStore = createNoteStore(storage);
    const ctx = { noteStore };
    const saved = await executeTool('notes', { action: 'save', title: 'Bank', text: 'Call on Monday about the loan.' }, ctx);
    assert.equal(saved.ok, true);
    const found = await executeTool('notes', { action: 'search', query: 'loan' }, ctx);
    assert.equal(found.data.notes.length, 1);
    const none = await executeTool('notes', { action: 'search', query: 'pizza' }, ctx);
    assert.equal(none.data.notes.length, 0);
    const listed = await executeTool('notes', { action: 'list' }, ctx);
    assert.equal(listed.data.notes.length, 1);
  });
});

describe('executeTool — draft_email', () => {
  it('builds the compose URL and never claims the mail was sent', async () => {
    let opened = null;
    const out = await executeTool('draft_email', { to: 'a@b.com', subject: 'Hi', body: 'Hello there' }, { openUrl: (u) => { opened = u; } });
    assert.equal(out.ok, true);
    assert.equal(out.data.sent, false);
    assert.ok(out.data.composeUrl.startsWith('https://mail.google.com/mail/?'));
    assert.equal(opened, out.data.composeUrl);
    assert.match(out.summary, /draft, not a sent mail/);
  });
});

describe('executeTool — calculate and read_file', () => {
  it('evaluates arithmetic through the executor', async () => {
    const out = await executeTool('calculate', { expression: '(240 + 35) * 1.18' }, {});
    assert.equal(out.ok, true);
    assert.equal(out.data.result, 324.5);
  });

  it('refuses read_file with no attached file', async () => {
    const out = await executeTool('read_file', { question: 'Summarise this' }, { attachedFile: null });
    assert.equal(out.ok, false);
    assert.match(out.summary, /No file is attached/);
  });

  it('returns the attached file text, capped', async () => {
    const big = 'x'.repeat(MAX_FILE_CHARS + 100);
    const out = await executeTool('read_file', { question: 'Summarise this' }, { attachedFile: { name: 'notes.txt', text: big } });
    assert.equal(out.ok, true);
    assert.equal(out.data.text.length, MAX_FILE_CHARS);
    assert.equal(out.data.name, 'notes.txt');
  });

  it('reads the full 20,000 characters the app attaches (not a smaller cap)', async () => {
    // The attach step in app.js keeps the first 20,000 characters and tells
    // the user that many will be read — read_file must honour the same cap.
    assert.equal(MAX_FILE_CHARS, 20000);
    const text = 'y'.repeat(20000);
    const out = await executeTool('read_file', { question: 'Summarise this' }, { attachedFile: { name: 'notes.txt', text } });
    assert.equal(out.ok, true);
    assert.equal(out.data.text.length, 20000);
  });
});
