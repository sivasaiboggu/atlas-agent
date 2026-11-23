// Real Chrome renders for review: desktop 1280px + phone 390px,
// empty state and a seeded sample chat (light + dark).
// The sample chat is a screenshot fixture only: it is seeded through
// localStorage by this script, titled "Sample chat", and is not part of
// the app — the app itself never invents a reply. Tasks and notes in the
// left rail are seeded the same way, so the rails read as they will in
// real use.
// Run: node scripts/shots.mjs — writes screenshots/*.png
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const CHROME = process.env.CHROME_BIN
  || ['/opt/meta-chromium/chrome', '/usr/bin/chromium-browser', 'google-chrome']
    .find((c) => c.startsWith('/') ? fs.existsSync(c) : true);

// This VM's Hatch Chrome needs a WebGL domain policy (contract file +
// SHA-256) just to start.
function chromeArgs(debugPort, firstUrl) {
  const policy = 'hatch-webgl-allowed-domains-v1\nexample.com\n';
  const file = path.join(os.tmpdir(), 'atlas-agent-webgl-policy.txt');
  fs.writeFileSync(file, policy);
  const sha = createHash('sha256').update(policy).digest('hex');
  return [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--allow-file-access-from-files',
    `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-agent-chrome-'))}`,
    `--hatch-webgl-allowed-domains-file=${file}`,
    `--hatch-webgl-allowed-domains-sha256=${sha}`,
    `--remote-debugging-port=${debugPort}`,
    '--window-size=1280,900',
    firstUrl,
  ];
}

// Pages load over file://, not http://127.0.0.1: this Chrome build blocks
// navigations to local-network servers when initiated through DevTools,
// while file:// pages load fine with --allow-file-access-from-files
// (ES module imports included).
const pageUrl = (page) => `file://${ROOT}/${page}`;
const DEBUG_PORT = 9227;

const SAMPLE_STATE = {
  version: 1,
  settings: { apiKey: '', model: 'gemini-2.5-flash', theme: 'dark' },
  conversations: [
    {
      id: 'sample-chat',
      title: 'Sample chat — weather',
      createdAt: 1795392000000,
      updatedAt: 1795392000000,
      messages: [
        { role: 'user', text: "What's the weather in Hyderabad today?", usage: null, error: null, trace: null, ts: 1795392000000 },
        {
          role: 'assistant',
          text: 'Hyderabad is **31°C and partly cloudy** right now — it feels like 33°C, with 55% humidity and a 12 km/h wind.\n\nThat is from Open-Meteo, checked just now. No rain in the current conditions.',
          usage: { prompt: 42, candidates: 38, total: 80 },
          error: null,
          planId: 'plan-1',
          plan: 'I will check the current weather for Hyderabad.',
          trace: [
            {
              name: 'get_weather',
              args: { place: 'Hyderabad' },
              result: {
                ok: true,
                summary: 'Hyderabad, Telangana, India: Partly cloudy, 31°C (feels like 33°C), humidity 55%, wind 12 km/h.',
                data: { place: 'Hyderabad, Telangana, India', condition: 'Partly cloudy', temperatureC: 31, feelsLikeC: 33, humidityPct: 55, windKmh: 12 },
              },
            },
          ],
          ts: 1795392001000,
        },
      ],
    },
  ],
  activeId: 'sample-chat',
};

const SAMPLE_TASKS = [
  { id: 'task-1', title: 'Reply to the RustLabs mail', done: false, createdAt: 1763855900000 },
  { id: 'task-2', title: 'Finish the insiderOne skill checks', done: false, createdAt: 1763855950000 },
  { id: 'task-3', title: 'Send the morning job applications', done: true, createdAt: 1763855800000 },
];

const SAMPLE_NOTES = [
  { id: 'note-1', title: 'RustLabs', text: 'Remote AI Security Engineer, $20/hr. Follow-up form needs sign-in to rustlabs.ai.', createdAt: 1763855900000 },
  { id: 'note-2', title: 'Neon rotation', text: 'Reset the SecureFlow Neon database password and the JWT secret.', createdAt: 1763855850000 },
];

const SAMPLE_REMINDERS = [
  { id: 'rem-1', what: 'Reply to the RustLabs mail', at: Date.now() + 3 * 3600000, createdAt: 1763855900000, fired: false },
  { id: 'rem-2', what: 'Send the morning job applications', at: Date.now() - 60000, createdAt: 1763855800000, fired: false },
];

const SAMPLE_PLANS = [
  {
    id: 'plan-1', title: "What's the weather in Hyderabad today?", chatId: 'sample-chat', msgIndex: 1, createdAt: 1795392001000,
    steps: [
      { id: 's1', label: 'Check the weather in Hyderabad', tool: 'get_weather', status: 'done' },
    ],
  },
  {
    id: 'plan-2', title: 'Plan my day', chatId: 'sample-chat', msgIndex: 1, createdAt: 1795392002000,
    steps: [
      { id: 's1', label: 'Read my open tasks', tool: 'tasks', status: 'done' },
      { id: 's2', label: 'Search the web for job applications due today', tool: 'web_search', status: 'running' },
    ],
  },
];

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    };
  }

  async call(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const done = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return done;
  }

  async waitForEvent(method, timeoutMs = 30000) {
    const start = Date.now();
    for (;;) {
      const i = this.events.findIndex((e) => e.method === method);
      if (i >= 0) return this.events.splice(i, 1)[0];
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${method}`);
      await delay(100);
    }
  }

  async evaluate(expression) {
    const res = await this.call('Runtime.evaluate', { expression, returnByValue: true });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
    return res.result?.value;
  }

  close() { try { this.ws.close(); } catch (err) { /* already closed */ } }
}

const SHOTS = [
  { name: 'desktop-home.png', width: 1280, url: 'index.html?view=home', seed: true, theme: 'dark', waitMs: 2500 },
  { name: 'desktop-chat.png', width: 1280, url: 'index.html?view=chat', seed: true, theme: 'dark', waitMs: 2500 },
  { name: 'desktop-light-chat.png', width: 1280, url: 'index.html?view=chat', seed: true, theme: 'light', waitMs: 2500 },
  { name: 'mobile-home.png', width: 390, url: 'index.html?view=home', seed: true, theme: 'dark', waitMs: 2500 },
  { name: 'mobile-chat.png', width: 390, url: 'index.html?view=chat', seed: true, theme: 'dark', waitMs: 2500 },
  { name: 'mobile-light-chat.png', width: 390, url: 'index.html?view=chat', seed: true, theme: 'light', waitMs: 2500 },
  {
    name: 'command-palette-open.png', width: 1280, url: 'index.html?view=home', seed: true, theme: 'dark', waitMs: 2500,
    run: `(() => { document.querySelector('#paletteBtn').click(); const input = document.querySelector('#paletteInput'); input.value = 'rust'; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
  },
  {
    name: 'trace-drawer-open.png', width: 1280, url: 'index.html?view=chat', seed: true, theme: 'dark', waitMs: 2500,
    run: `document.querySelector('#traceToggleBtn').click()`,
  },
];

async function main() {
  fs.mkdirSync(path.join(ROOT, 'screenshots'), { recursive: true });
  const first = SHOTS[0];
  const chrome = spawn(CHROME, chromeArgs(DEBUG_PORT, pageUrl(first.url)));
  try {
    let wsUrl = null;
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
        const targets = await res.json();
        const page = targets.find((t) => t.type === 'page');
        if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
      } catch (err) { /* not up yet */ }
      await delay(200);
    }
    if (!wsUrl) throw new Error('Chrome DevTools did not come up');
    const cdp = new Cdp(wsUrl);
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    for (const shot of SHOTS) {
      await cdp.call('Emulation.setDeviceMetricsOverride', {
        width: shot.width, height: 844, deviceScaleFactor: 1, mobile: shot.width < 600,
      });
      await cdp.call('Page.navigate', { url: pageUrl(shot.url) });
      await cdp.waitForEvent('Page.loadEventFired');
      await delay(600);
      // seed or clear localStorage, then reload so the app reads it
      const seedState = shot.seed
        ? { ...SAMPLE_STATE, settings: { ...SAMPLE_STATE.settings, theme: shot.theme } }
        : { version: 1, settings: { apiKey: '', model: 'gemini-2.5-flash', theme: shot.theme }, conversations: [], activeId: null };
      await cdp.evaluate(`localStorage.setItem('atlas-agent:v1', ${JSON.stringify(JSON.stringify(seedState))})`);
      await cdp.evaluate(`localStorage.setItem('atlas-agent:tasks:v1', ${JSON.stringify(JSON.stringify(SAMPLE_TASKS))})`);
      await cdp.evaluate(`localStorage.setItem('atlas-agent:notes:v1', ${JSON.stringify(JSON.stringify(SAMPLE_NOTES))})`);
      await cdp.evaluate(`localStorage.setItem('atlas-agent:reminders:v1', ${JSON.stringify(JSON.stringify(shot.seed ? SAMPLE_REMINDERS : []))})`);
      await cdp.evaluate(`localStorage.setItem('atlas-agent:plans:v1', ${JSON.stringify(JSON.stringify(shot.seed ? SAMPLE_PLANS : []))})`);
      const stored = await cdp.evaluate(`localStorage.getItem('atlas-agent:v1') !== null`);
      if (!stored) throw new Error('localStorage seeding failed on file:// — cannot render this shot');
      await cdp.call('Page.navigate', { url: pageUrl(shot.url) });
      await cdp.waitForEvent('Page.loadEventFired');
      await delay(shot.waitMs);
      if (shot.run) {
        await cdp.evaluate(shot.run);
        await delay(500);
      }
      const overflow = await cdp.evaluate(
        `JSON.stringify({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth })`,
      );
      const { data } = await cdp.call('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true,
      });
      fs.writeFileSync(path.join(ROOT, 'screenshots', shot.name), Buffer.from(data, 'base64'));
      console.log('wrote', shot.name, overflow);
    }
    cdp.close();
  } finally {
    chrome.kill('SIGTERM');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
