// Headless-Chrome smoke test for the SaaS pass: palette search, slash
// menu, reminder flow, export click, plan card render, sidebar search.
// Run: node scripts/smoke.mjs (from the atlas-agent directory)
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const CHROME = '/opt/meta-chromium/chrome';
const DEBUG_PORT = 9229;
const policy = 'hatch-webgl-allowed-domains-v1\nexample.com\n';
const file = path.join(os.tmpdir(), 'atlas-agent-webgl-policy.txt');
fs.writeFileSync(file, policy);
const sha = createHash('sha256').update(policy).digest('hex');
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--allow-file-access-from-files',
  `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-agent-chrome-'))}`,
  `--hatch-webgl-allowed-domains-file=${file}`,
  `--hatch-webgl-allowed-domains-sha256=${sha}`,
  `--remote-debugging-port=${DEBUG_PORT}`,
  '--window-size=1280,900',
  `file://${ROOT}/index.html?view=home`,
]);
let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
try {
  let wsUrl = null;
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch (err) {}
    await delay(200);
  }
  if (!wsUrl) throw new Error('DevTools did not come up');
  const ws = new WebSocket(wsUrl);
  let id = 1;
  const pending = new Map();
  const errors = [];
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); p(msg.result); }
    else if (msg.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'page error'));
  };
  await ready;
  const call = (method, params = {}) => new Promise((resolve) => {
    const i = id++;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expr) => {
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    if (r.result === undefined) throw new Error('evaluate returned no result for: ' + expr.slice(0, 120) + ' :: ' + JSON.stringify(r).slice(0, 300));
    return r.result?.value;
  };
  await call('Page.enable');
  await call('Runtime.enable');
  const events = [];
  const origOnMessage = ws.onmessage;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method) events.push(msg);
    origOnMessage(ev);
  };
  async function waitForLoad(timeoutMs = 30000) {
    const start = Date.now();
    for (;;) {
      const i = events.findIndex((e) => e.method === 'Page.loadEventFired');
      if (i >= 0) { events.splice(i, 1); return; }
      if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for load');
      await delay(100);
    }
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `file://${ROOT}/index.html?view=home` });
  await waitForLoad();
  await delay(600);
  // seed: one chat with a plan, one task, one note
  const state = {
    version: 1,
    settings: { apiKey: '', model: 'gemini-2.5-flash', theme: 'dark' },
    conversations: [{
      id: 'c1', title: 'Sample chat', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [
        { role: 'user', text: 'Check the weather', usage: null, error: null, trace: null, ts: Date.now() },
        { role: 'assistant', text: 'Done.', usage: null, error: null, planId: 'p1', trace: [{ name: 'get_weather', args: { place: 'Hyderabad' }, result: { ok: true, summary: 'Sunny' } }], ts: Date.now() },
      ],
    }],
    activeId: 'c1',
  };
  await ev(`localStorage.setItem('atlas-agent:v1', ${JSON.stringify(JSON.stringify(state))})`);
  await ev(`localStorage.setItem('atlas-agent:tasks:v1', ${JSON.stringify(JSON.stringify([{ id: 't1', title: 'Reply to the RustLabs mail', done: false, createdAt: Date.now() }]))})`);
  await ev(`localStorage.setItem('atlas-agent:notes:v1', ${JSON.stringify(JSON.stringify([{ id: 'n1', title: 'RustLabs', text: 'follow up', createdAt: Date.now() }]))})`);
  await ev(`localStorage.setItem('atlas-agent:reminders:v1', ${JSON.stringify(JSON.stringify([]))})`);
  await ev(`localStorage.setItem('atlas-agent:plans:v1', ${JSON.stringify(JSON.stringify([{ id: 'p1', title: 'Check the weather', chatId: 'c1', msgIndex: 1, createdAt: Date.now(), steps: [{ id: 's1', label: 'Check the weather in Hyderabad', tool: 'get_weather', status: 'done' }, { id: 's2', label: 'Summarise the result', tool: 'calculate', status: 'running' }] }]))})`);
  await call('Page.navigate', { url: `file://${ROOT}/index.html?view=home` });
  await waitForLoad();
  await delay(1500);

  // 1. Command palette finds a task
  await ev(`document.querySelector('#paletteBtn').click()`);
  await ev(`(() => { const i = document.querySelector('#paletteInput'); i.value = 'rust'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await delay(300);
  const palette = await ev(`JSON.stringify({ open: document.querySelector('#paletteModal').classList.contains('open'), items: [...document.querySelectorAll('.palette-item-label')].map((n) => n.textContent), groups: [...document.querySelectorAll('.palette-group')].map((n) => n.textContent) })`);
  const p = JSON.parse(palette);
  check('palette opens and finds the RustLabs task', p.open && p.items.includes('Reply to the RustLabs mail'), JSON.stringify(p.items));
  check('palette groups tasks and notes for "rust"', p.groups.join('|').includes('Tasks') && p.groups.join('|').includes('Notes'), p.groups.join(', '));
  await ev(`(() => { const i = document.querySelector('#paletteInput'); i.value = 'weather'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await delay(300);
  const palette2 = await ev(`JSON.stringify({ items: [...document.querySelectorAll('.palette-item-label')].map((n) => n.textContent), groups: [...document.querySelectorAll('.palette-group')].map((n) => n.textContent) })`);
  const p2 = JSON.parse(palette2);
  check('palette finds the chat for "weather"', p2.groups.join('|').includes('Chats') && p2.items.includes('Sample chat'), p2.items.join(', '));
  await ev(`document.querySelector('#paletteInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await ev(`document.querySelector('#paletteModal').classList.remove('open')`);

  // 2. Slash menu appears and a choice fills the composer
  await ev(`(() => { const c = document.querySelector('#composerInput'); c.focus(); c.value = '/'; c.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await delay(300);
  const slash = await ev(`JSON.stringify({ hidden: document.querySelector('#slashMenu').hidden, items: [...document.querySelectorAll('.slash-item .slash-name')].map((n) => n.textContent) })`);
  const s = JSON.parse(slash);
  check('slash menu opens with commands', !s.hidden && s.items.length >= 7, s.items.join(', '));
  await ev(`document.querySelector('.slash-item').click()`);
  await delay(200);
  const composerVal = await ev(`document.querySelector('#composerInput').value`);
  check('choosing /search fills the composer', composerVal.startsWith('Search the web for '), JSON.stringify(composerVal));

  // 3. Reminder flow: plain words -> stored + listed, no model call
  await ev(`(() => { const c = document.querySelector('#composerInput'); c.value = 'remind me to call the bank at 6pm'; c.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await ev(`document.querySelector('#sendBtn').click()`);
  await delay(500);
  const rem = await ev(`JSON.stringify({ listed: document.querySelector('#reminderList').textContent, stored: JSON.parse(localStorage.getItem('atlas-agent:reminders:v1') || '[]').map((r) => r.what), chatCount: JSON.parse(localStorage.getItem('atlas-agent:v1')).conversations.length, composer: document.querySelector('#composerInput').value })`);
  const r = JSON.parse(rem);
  check('reminder is stored and listed', r.listed.includes('call the bank') && r.stored.includes('call the bank'), JSON.stringify(r.stored));
  check('reminder did not create a chat or call the model', r.chatCount === 1 && r.composer === '', `chats=${r.chatCount}`);

  // 4. Export button clicks without a page error (download itself is a blob anchor)
  await ev(`document.querySelector('#exportBtn').click()`);
  await delay(300);
  check('export click runs without a page error', errors.length === 0, errors.join('; '));

  // 5. Plan card renders in chat with done + running steps
  await call('Page.navigate', { url: `file://${ROOT}/index.html?view=chat` });
  await waitForLoad();
  await delay(1500);
  const plan = await ev(`JSON.stringify({ card: !!document.querySelector('.plan-card'), steps: [...document.querySelectorAll('.plan-step')].map((n) => n.className), labels: [...document.querySelectorAll('.plan-step-label')].map((n) => n.textContent) })`);
  const pl = JSON.parse(plan);
  check('plan card renders with done and running steps', pl.card && pl.steps.some((c) => c.includes('done')) && pl.steps.some((c) => c.includes('running')), pl.labels.join(' | '));

  // 6. Global search box finds the task and shows a count
  await ev(`(() => { const i = document.querySelector('#searchInput'); i.value = 'rust'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await delay(300);
  const gsearch = await ev(`JSON.stringify({ results: document.querySelectorAll('.search-result-item').length, text: document.querySelector('#chatList').textContent })`);
  const g = JSON.parse(gsearch);
  check('sidebar search finds the task', g.results >= 1 && g.text.includes('Reply to the RustLabs mail'), `results=${g.results}`);

  check('no page errors during the whole smoke run', errors.length === 0, errors.join('; '));
  ws.close();
} finally {
  chrome.kill('SIGTERM');
}
console.log(failures === 0 ? 'SMOKE: all passed' : `SMOKE: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
