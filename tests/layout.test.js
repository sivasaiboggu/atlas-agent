// Atlas — static layout checks: the page must not overflow at
// 390px or 1280px, and the two-rail shell plus trace drawer must be
// complete. These catch the classes of bug that screenshots alone can miss.
// Run: npm test (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('layout guards', () => {
  const html = read('index.html');
  const css = read('styles.css');

  it('has a viewport meta tag for mobile', () => {
    assert.ok(html.includes('name="viewport"'));
    assert.ok(html.includes('width=device-width'));
  });

  it('uses border-box everywhere', () => {
    assert.ok(css.includes('* { box-sizing: border-box; }'));
  });

  it('has no 100vw widths (the classic horizontal-overflow bug)', () => {
    assert.ok(!/width:\s*100vw/.test(css), '100vw found in CSS');
  });

  it('has no fixed pixel width on the chat column or composer', () => {
    assert.ok(!/\.chat\s*{[^}]*width:\s*\d+px/.test(css));
    assert.ok(!/\.composer\s*{[^}]*width:\s*\d+px/.test(css));
  });

  it('constrains the chat column with a max-width', () => {
    assert.ok(css.includes('--column-w: 720px'));
    assert.ok(css.includes('max-width: var(--column-w)'));
  });

  it('renders messages inside the constrained column, not the full main area', () => {
    assert.ok(html.includes('<div class="chat" id="chatRoot"></div>'), 'chatRoot is not wrapped in .chat — messages would run full-width');
  });

  it('lays out two rails on wide screens — sidebar plus one wide chat column', () => {
    assert.ok(css.includes('grid-template-columns: var(--sidebar-w) minmax(0, 1fr)'));
    assert.ok(!css.includes('var(--trace-w)'), 'permanent third rail still in the grid');
  });

  it('makes the trace an overlay drawer, not a grid column', () => {
    assert.ok(css.includes('.trace-rail {'));
    assert.ok(css.includes('position: fixed;'));
    assert.ok(css.includes('transform: translateX(102%)'));
    assert.ok(css.includes('.trace-rail.open { transform: translateX(0); }'));
    assert.ok(css.includes('--drawer-w: 360px'));
    assert.ok(!css.includes('trace-hidden'), 'old grid-toggle class still present');
  });

  it('has no marketing footer under the composer and no permanent tool list', () => {
    assert.ok(!html.includes('composer-foot'), 'composer footer still in the page');
    assert.ok(!html.includes('trace-tools'), 'permanent tool list still in the page');
    assert.ok(!html.includes('trace-intro'), 'trace intro still in the page');
  });

  it('keeps the token count on one line', () => {
    assert.ok(css.includes('.msg-usage {'));
    assert.ok(css.includes('white-space: nowrap;'));
  });

  it('keeps code blocks inside the column (no mobile clip)', () => {
    assert.ok(css.includes('.code-block { margin: 0 0 14px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; max-width: 100%; }'));
    assert.ok(css.includes('max-width: 100%;\n  background: var(--code-bg);'));
  });

  it('has a mobile breakpoint that hides the sidebar off-canvas', () => {
    assert.ok(css.includes('@media (max-width: 768px)'));
    assert.ok(css.includes('transform: translateX(-102%)'));
  });

  it('keeps the composer usable on small screens', () => {
    assert.ok(css.includes('.composer-hint { display: none; }'), 'hint not hidden on mobile');
  });

  it('respects prefers-reduced-motion', () => {
    assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
  });

  it('has a Home view container that starts hidden', () => {
    assert.ok(html.includes('id="homeScroll"'), 'home view missing');
    assert.ok(html.includes('id="homeRoot"'), 'home content root missing');
    assert.ok(html.includes('id="homeBtn"'), 'home nav missing');
  });

  it('renders the command palette as a fixed overlay, not a page section', () => {
    assert.ok(html.includes('id="paletteModal"'), 'palette modal missing');
    assert.ok(css.includes('.palette-backdrop {'));
    assert.ok(css.includes('.palette-backdrop.open { display: flex; }'));
  });

  it('has the slash menu and mic button in the composer', () => {
    assert.ok(html.includes('id="slashMenu"'), 'slash menu missing');
    assert.ok(html.includes('id="micBtn"'), 'mic button missing');
    assert.ok(html.includes('id="composerWrap"'), 'composer drop target missing');
  });

  it('wires every id the app JS expects', () => {
    const ids = [
      'sidebar', 'scrim', 'menuBtn', 'closeSidebarBtn', 'wordmark',
      'homeBtn', 'newChatBtn', 'searchInput', 'chatList', 'settingsBtn', 'themeBtn',
      'themeBtnLabel', 'keyState', 'modelSelect', 'copyLinkBtn',
      'crumbHome', 'crumbCurrent', 'paletteBtn',
      'traceToggleBtn', 'closeTraceBtn', 'traceRail', 'traceStatus', 'traceBody',
      'taskInput', 'addTaskBtn', 'taskList', 'taskCount',
      'noteList', 'noteCount', 'notesEmpty',
      'planList', 'planCount', 'plansEmpty',
      'reminderList', 'reminderCount', 'remindersEmpty',
      'homeScroll', 'homeRoot', 'composerWrap',
      'chatScroll', 'chatRoot', 'composerInput', 'sendBtn', 'stopBtn', 'micBtn',
      'slashMenu', 'attachBtn', 'fileInput', 'fileChip', 'fileChipName', 'fileChipRemove',
      'paletteModal', 'paletteInput', 'paletteList',
      'settingsModal', 'apiKeyInput', 'toggleKeyVisibility',
      'settingsModelSelect', 'saveSettingsBtn', 'clearDataBtn',
      'exportBtn', 'importBtn', 'importInput',
      'noteModal', 'noteTitle', 'noteMeta', 'noteText',
      'deleteNoteBtn', 'closeNoteBtn', 'toast',
    ];
    for (const id of ids) {
      assert.ok(html.includes(`id="${id}"`), `missing element #${id}`);
    }
  });

  it('loads the app as a module and links the stylesheet', () => {
    assert.ok(html.includes('<script type="module" src="src/app.js">'));
    assert.ok(html.includes('<link rel="stylesheet" href="styles.css">'));
  });

  it('has no external script dependency besides fonts', () => {
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(scripts, ['src/app.js']);
  });

  it('has the amber accent token and the ink-blue canvas', () => {
    assert.ok(css.includes('--bg: #0a0e14;'));
    assert.ok(css.includes('--accent: #f5a524;'));
  });
});
