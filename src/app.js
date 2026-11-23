// Atlas — UI wiring. Plain DOM, no framework.
// The centre is an agent chat: every send runs the Gemini tool loop
// (src/agent.js). Tools run for real in this browser and the answer is
// written from their results. Without a key the app says so plainly and
// never invents a reply.
import { renderMarkdown, getCodeBlockById, extractCodeBlocks } from './markdown.js';
import {
  DEFAULT_MODEL,
  createConversation, getConversation,
  getActive, setActive, addMessage, renameConversation,
  deleteConversation, sortConversations,
  loadState, saveState, clearState,
} from './store.js';
import { isValidModel, modelLabel, formatUsage, GeminiError } from './gemini.js';
import { runAgent } from './agent.js';
import { executeTool } from './tools.js';
import { createTaskStore, createNoteStore, TASKS_KEY, NOTES_KEY } from './work.js';
import { createReminderStore, parseReminder, formatReminderTime, REMINDERS_KEY } from './reminders.js';
import { createPlanStore, planStepLabel, planProgress, PLANS_KEY } from './plans.js';
import { searchAll } from './search.js';
import { parseSlash, matchSlashCommands } from './slash.js';
import { buildPaletteItems, flattenPalette, moveSelection } from './palette.js';
import { createVoiceInput } from './voice.js';
import { buildBackup, parseBackup } from './backup.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  sidebar: $('#sidebar'),
  scrim: $('#scrim'),
  menuBtn: $('#menuBtn'),
  closeSidebarBtn: $('#closeSidebarBtn'),
  wordmark: $('#wordmark'),
  homeBtn: $('#homeBtn'),
  crumbHome: $('#crumbHome'),
  crumbCurrent: $('#crumbCurrent'),
  paletteBtn: $('#paletteBtn'),
  paletteModal: $('#paletteModal'),
  paletteInput: $('#paletteInput'),
  paletteList: $('#paletteList'),
  newChatBtn: $('#newChatBtn'),
  searchInput: $('#searchInput'),
  chatList: $('#chatList'),
  settingsBtn: $('#settingsBtn'),
  themeBtn: $('#themeBtn'),
  themeBtnLabel: $('#themeBtnLabel'),
  keyState: $('#keyState'),
  modelSelect: $('#modelSelect'),
  copyLinkBtn: $('#copyLinkBtn'),
  traceToggleBtn: $('#traceToggleBtn'),
  closeTraceBtn: $('#closeTraceBtn'),
  traceRail: $('#traceRail'),
  traceStatus: $('#traceStatus'),
  traceBody: $('#traceBody'),
  taskInput: $('#taskInput'),
  addTaskBtn: $('#addTaskBtn'),
  taskList: $('#taskList'),
  taskCount: $('#taskCount'),
  planList: $('#planList'),
  planCount: $('#planCount'),
  plansEmpty: $('#plansEmpty'),
  reminderList: $('#reminderList'),
  reminderCount: $('#reminderCount'),
  remindersEmpty: $('#remindersEmpty'),
  noteList: $('#noteList'),
  noteCount: $('#noteCount'),
  notesEmpty: $('#notesEmpty'),
  homeScroll: $('#homeScroll'),
  homeRoot: $('#homeRoot'),
  chatScroll: $('#chatScroll'),
  chatRoot: $('#chatRoot'),
  composerWrap: $('#composerWrap'),
  composerInput: $('#composerInput'),
  sendBtn: $('#sendBtn'),
  stopBtn: $('#stopBtn'),
  attachBtn: $('#attachBtn'),
  micBtn: $('#micBtn'),
  fileInput: $('#fileInput'),
  fileChip: $('#fileChip'),
  fileChipName: $('#fileChipName'),
  fileChipRemove: $('#fileChipRemove'),
  slashMenu: $('#slashMenu'),
  settingsModal: $('#settingsModal'),
  apiKeyInput: $('#apiKeyInput'),
  toggleKeyVisibility: $('#toggleKeyVisibility'),
  settingsModelSelect: $('#settingsModelSelect'),
  saveSettingsBtn: $('#saveSettingsBtn'),
  clearDataBtn: $('#clearDataBtn'),
  exportBtn: $('#exportBtn'),
  importBtn: $('#importBtn'),
  importInput: $('#importInput'),
  noteModal: $('#noteModal'),
  noteTitle: $('#noteTitle'),
  noteMeta: $('#noteMeta'),
  noteText: $('#noteText'),
  deleteNoteBtn: $('#deleteNoteBtn'),
  closeNoteBtn: $('#closeNoteBtn'),
  toast: $('#toast'),
};

// In-memory fallback if localStorage is unavailable (private mode, etc.)
const memoryStorage = (() => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
})();

let storage = memoryStorage;
try {
  localStorage.setItem('__atlas_probe__', '1');
  localStorage.removeItem('__atlas_probe__');
  storage = localStorage;
} catch (err) { /* stay on the in-memory fallback */ }

let state = loadState(storage);
let taskStore = createTaskStore(storage);
let noteStore = createNoteStore(storage);
let reminderStore = createReminderStore(storage);
let planStore = createPlanStore(storage);
let generating = false;
let abortController = null;
let toastTimer = null;
let attachedFile = null; // { name, text, truncated }
let liveTrace = null; // { plan, steps: [{ name, args, status, result }] }
let openNoteId = null;
let view = 'home'; // 'home' | 'chat'
let currentPlanId = null;
let paletteSelected = -1;
let paletteItems = [];
let slashSelected = -1;
let voiceInput = null;
let dictationBase = '';
let reminderTimer = null;

const MAX_FILE_CHARS = 20000;

const QUICK_ACTIONS = [
  { label: 'Search the web', prompt: 'Search the web for ', action: 'fill' },
  { label: 'Draft a mail', prompt: 'Draft a mail to ', action: 'fill' },
  { label: "What's the weather", prompt: "What's the weather in ", action: 'fill' },
  { label: 'Plan my day', prompt: 'Plan my day: look at my open tasks and turn the day into a short plan', action: 'send' },
  { label: 'Summarise a file', prompt: '', action: 'file' },
  { label: 'Manage tasks', prompt: '', action: 'tasks' },
];

function persist() { saveState(storage, state); }

function showToast(text) {
  els.toast.textContent = text;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

// Small DOM helper: el('div', 'cls', 'text').
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  return 'Good evening.';
}

function applyTheme() {
  const theme = state.settings.theme || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a0e14' : '#ffffff');
  els.themeBtnLabel.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
}

function renderKeyState() {
  const key = (state.settings.apiKey || '').trim();
  if (key) {
    els.keyState.textContent = `Key saved · ${modelLabel(state.settings.model)}`;
    els.keyState.classList.add('ok');
  } else {
    els.keyState.textContent = 'No API key set';
    els.keyState.classList.remove('ok');
  }
}

// ---------- views: Home (default) and chat ----------

function showView(next) {
  view = next;
  els.homeScroll.hidden = next !== 'home';
  els.chatScroll.hidden = next !== 'chat';
  els.homeBtn.classList.toggle('active', next === 'home');
  if (next === 'home') {
    els.crumbCurrent.textContent = 'Home';
    renderHome();
  } else {
    const conv = getActive(state);
    els.crumbCurrent.textContent = conv?.title || 'Chat';
    renderChat();
  }
  closeMobileSidebar();
}

function homeSection(title, count) {
  const section = el('section', 'home-section');
  const head = el('div', 'home-section-head');
  head.appendChild(el('h2', null, title));
  if (count != null) head.appendChild(el('span', 'home-section-count', String(count)));
  section.appendChild(head);
  return section;
}

function renderHome() {
  const tasks = taskStore.list();
  const open = tasks.filter((t) => !t.done);
  const doneCount = tasks.length - open.length;
  const notes = noteStore.list();
  const chats = sortConversations(state);
  const reminders = reminderStore.list();
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dueToday = reminders.filter((r) => r.at >= startOfToday.getTime() && r.at < startOfToday.getTime() + 86400000).length;

  const root = els.homeRoot;
  root.innerHTML = '';

  const head = el('div', 'home-head');
  head.appendChild(el('h1', null, greeting()));
  head.appendChild(el('p', 'home-date', new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })));
  root.appendChild(head);

  const stats = el('div', 'stat-row');
  const stat = (n, label) => {
    const s = el('span', 'stat');
    s.appendChild(el('b', null, String(n)));
    s.appendChild(document.createTextNode(` ${label}`));
    return s;
  };
  stats.appendChild(stat(open.length, open.length === 1 ? 'open mission' : 'open missions'));
  stats.appendChild(stat(dueToday, dueToday === 1 ? 'reminder today' : 'reminders today'));
  stats.appendChild(stat(notes.length, notes.length === 1 ? 'note' : 'notes'));
  stats.appendChild(stat(chats.length, chats.length === 1 ? 'chat' : 'chats'));
  root.appendChild(stats);

  // Today: open missions with progress.
  const today = homeSection('Today', tasks.length ? `${doneCount} of ${tasks.length} done` : null);
  if (tasks.length) {
    const bar = el('div', 'progress-bar');
    const fill = el('div', 'progress-fill');
    fill.style.width = `${Math.round((doneCount / tasks.length) * 100)}%`;
    bar.appendChild(fill);
    today.appendChild(bar);
  }
  if (!open.length) {
    today.appendChild(el('p', 'home-empty', tasks.length ? 'All missions done.' : 'Nothing open. Add a task in the sidebar.'));
  }
  for (const task of open.slice(0, 8)) {
    const row = el('button', 'home-row');
    row.type = 'button';
    const check = el('span', 'home-check');
    check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
    row.appendChild(check);
    row.appendChild(el('span', 'home-row-title', task.title));
    row.addEventListener('click', () => {
      taskStore.complete(task.id);
      renderMissions();
      renderHome();
    });
    today.appendChild(row);
  }
  root.appendChild(today);

  // Reminders due or upcoming.
  if (reminders.length) {
    const section = homeSection('Reminders', reminders.length);
    for (const r of reminders.slice(0, 5)) {
      const row = el('div', 'home-row static' + (r.status === 'fired' ? ' due' : ''));
      row.appendChild(el('span', 'home-row-time', formatReminderTime(r.at, now)));
      row.appendChild(el('span', 'home-row-title', r.what));
      const dismiss = el('button', 'home-row-dismiss', '×');
      dismiss.type = 'button';
      dismiss.setAttribute('aria-label', `Dismiss reminder "${r.what}"`);
      dismiss.addEventListener('click', () => {
        reminderStore.remove(r.id);
        renderReminders();
        renderHome();
      });
      row.appendChild(dismiss);
      section.appendChild(row);
    }
    root.appendChild(section);
  }

  // Recent chats.
  const recentChats = homeSection('Recent chats', chats.length || null);
  if (!chats.length) {
    recentChats.appendChild(el('p', 'home-empty', 'No chats yet. Ask Atlas something below.'));
  }
  for (const conv of chats.slice(0, 4)) {
    const row = el('button', 'home-row');
    row.type = 'button';
    row.appendChild(el('span', 'home-row-title', conv.title || 'New chat'));
    row.appendChild(el('span', 'home-row-meta', timeAgo(conv.updatedAt)));
    row.addEventListener('click', () => {
      setActive(state, conv.id);
      persist();
      renderSidebar();
      showView('chat');
    });
    recentChats.appendChild(row);
  }
  root.appendChild(recentChats);

  // Recent notes.
  const recentNotes = homeSection('Recent notes', notes.length || null);
  if (!notes.length) {
    recentNotes.appendChild(el('p', 'home-empty', 'No notes yet. Ask Atlas to save one.'));
  }
  for (const note of notes.slice(0, 3)) {
    const row = el('button', 'home-row');
    row.type = 'button';
    row.appendChild(el('span', 'home-row-title', note.title));
    row.appendChild(el('span', 'home-row-meta', note.text.split('\n')[0].slice(0, 60)));
    row.addEventListener('click', () => openNote(note.id));
    recentNotes.appendChild(row);
  }
  root.appendChild(recentNotes);

  // Quick actions as plain rows.
  const actions = homeSection('Do something');
  for (const action of QUICK_ACTIONS) {
    const row = el('button', 'home-row');
    row.type = 'button';
    row.appendChild(el('span', 'home-row-title', action.label));
    row.appendChild(el('span', 'home-row-meta', action.action === 'send' ? 'Runs now' : action.action === 'file' ? 'Attach a file' : action.action === 'tasks' ? 'Open the task list' : 'Fills the box below'));
    row.addEventListener('click', () => runQuickAction(action));
    actions.appendChild(row);
  }
  root.appendChild(actions);
}

// ---------- missions (tasks) ----------

function renderMissions() {
  const tasks = taskStore.list();
  const open = tasks.filter((t) => !t.done).length;
  els.taskCount.textContent = open ? String(open) : '';
  els.taskList.innerHTML = '';
  if (!tasks.length) {
    const empty = document.createElement('li');
    empty.className = 'tasks-empty';
    empty.textContent = 'No tasks yet. Add one above.';
    els.taskList.appendChild(empty);
    return;
  }
  for (const task of tasks) {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.done ? ' done' : '');
    li.dataset.taskId = task.id;
    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'task-check';
    check.setAttribute('aria-label', task.done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`);
    check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
    check.addEventListener('click', () => {
      if (task.done) {
        task.done = false;
        taskStore.save();
      } else {
        taskStore.complete(task.id);
      }
      renderMissions();
    });
    li.appendChild(check);
    const title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = task.title;
    li.appendChild(title);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'task-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove "${task.title}"`);
    remove.addEventListener('click', () => {
      taskStore.remove(task.id);
      renderMissions();
    });
    li.appendChild(remove);
    els.taskList.appendChild(li);
  }
}

function addTaskFromInput() {
  const title = els.taskInput.value.trim();
  if (!title) return;
  const { task, duplicate } = taskStore.add(title);
  els.taskInput.value = '';
  renderMissions();
  if (view === 'home') renderHome();
  showToast(duplicate ? 'That task is already on the list' : `Added: ${task.title}`);
}

// Highlight one task in the rail (used by search and the palette).
function flashTask(id) {
  if (window.innerWidth <= 768) openMobileSidebar();
  const item = els.taskList.querySelector(`[data-task-id="${id}"]`);
  if (!item) return;
  item.scrollIntoView({ block: 'nearest' });
  item.classList.add('flash');
  setTimeout(() => item.classList.remove('flash'), 1600);
}

// ---------- plans ----------

function renderPlans() {
  const plans = planStore.list().slice(0, 5);
  els.planCount.textContent = plans.length ? String(plans.length) : '';
  els.plansEmpty.hidden = plans.length > 0;
  els.planList.innerHTML = '';
  for (const plan of plans) {
    const { done, total } = planProgress(plan);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'plan-item';
    const title = document.createElement('span');
    title.className = 'plan-item-title';
    title.textContent = plan.title;
    btn.appendChild(title);
    const meta = document.createElement('span');
    meta.className = 'plan-item-meta';
    meta.textContent = total ? `${done} of ${total} done` : 'No steps yet';
    btn.appendChild(meta);
    if (total) {
      const bar = document.createElement('span');
      bar.className = 'plan-bar';
      const fill = document.createElement('span');
      fill.className = 'plan-fill';
      fill.style.width = `${Math.round((done / total) * 100)}%`;
      bar.appendChild(fill);
      btn.appendChild(bar);
    }
    btn.addEventListener('click', () => {
      if (plan.chatId && getConversation(state, plan.chatId)) {
        setActive(state, plan.chatId);
        persist();
        renderSidebar();
        showView('chat');
      }
    });
    li.appendChild(btn);
    els.planList.appendChild(li);
  }
}

// ---------- reminders ----------

function renderReminders() {
  const items = reminderStore.list();
  const pending = items.filter((r) => r.status === 'pending').length;
  els.reminderCount.textContent = pending ? String(pending) : '';
  els.remindersEmpty.hidden = items.length > 0;
  els.reminderList.innerHTML = '';
  for (const r of items) {
    const li = document.createElement('li');
    li.className = 'reminder-item' + (r.status === 'fired' ? ' due' : '');
    const time = document.createElement('span');
    time.className = 'reminder-time';
    time.textContent = formatReminderTime(r.at);
    li.appendChild(time);
    const what = document.createElement('span');
    what.className = 'reminder-what';
    what.textContent = r.what;
    li.appendChild(what);
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'reminder-dismiss';
    dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', `Dismiss reminder "${r.what}"`);
    dismiss.addEventListener('click', () => {
      reminderStore.remove(r.id);
      renderReminders();
      if (view === 'home') renderHome();
    });
    li.appendChild(dismiss);
    els.reminderList.appendChild(li);
  }
}

function maybeAskNotificationPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  } catch (err) { /* notifications unavailable in this browser */ }
}

// Fire due reminders. Only runs while Atlas is open — a static page
// cannot wake itself, and the UI says so.
function checkDueReminders() {
  const due = reminderStore.due();
  if (!due.length) return;
  for (const r of due) {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Atlas reminder', { body: r.what });
      }
    } catch (err) { /* fall through to the toast */ }
    showToast(`Reminder: ${r.what}`);
  }
  renderReminders();
  if (view === 'home') renderHome();
}

// ---------- notes ----------

function renderNotes() {
  const notes = noteStore.list();
  els.noteCount.textContent = notes.length ? String(notes.length) : '';
  els.notesEmpty.hidden = notes.length > 0;
  els.noteList.innerHTML = '';
  for (const note of notes) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'note-item';
    const title = document.createElement('span');
    title.className = 'note-item-title';
    title.textContent = note.title;
    btn.appendChild(title);
    const snippet = document.createElement('span');
    snippet.className = 'note-item-snippet';
    snippet.textContent = note.text.split('\n')[0];
    btn.appendChild(snippet);
    btn.addEventListener('click', () => openNote(note.id));
    li.appendChild(btn);
    els.noteList.appendChild(li);
  }
}

function openNote(id) {
  const note = noteStore.get(id);
  if (!note) return;
  openNoteId = id;
  els.noteTitle.textContent = note.title;
  els.noteMeta.textContent = `Saved ${new Date(note.createdAt).toLocaleString()}`;
  els.noteText.textContent = note.text;
  els.noteModal.classList.add('open');
}

function closeNote() {
  els.noteModal.classList.remove('open');
  openNoteId = null;
}

// ---------- trace rail ----------

function traceStepNode(step) {
  const div = document.createElement('div');
  div.className = 'trace-step';
  const head = document.createElement('div');
  head.className = 'trace-step-head';
  const name = document.createElement('span');
  name.className = 'trace-step-name';
  name.textContent = step.name;
  head.appendChild(name);
  const status = document.createElement('span');
  status.className = `trace-step-status ${step.status || 'done'}`;
  status.textContent = step.status === 'running' ? 'Running' : step.result?.ok === false ? 'Failed' : 'Done';
  if (step.status === 'running') status.className = 'trace-step-status running';
  else if (step.result?.ok === false) status.className = 'trace-step-status failed';
  else status.className = 'trace-step-status done';
  head.appendChild(status);
  div.appendChild(head);
  const args = document.createElement('div');
  args.className = 'trace-step-args';
  args.textContent = JSON.stringify(step.args || {});
  div.appendChild(args);
  if (step.result) {
    const result = document.createElement('div');
    result.className = 'trace-step-result' + (step.result.ok === false ? ' failed' : '');
    result.textContent = step.result.summary || '';
    div.appendChild(result);
    if (step.name === 'draft_email' && step.result.data?.composeUrl) {
      const link = document.createElement('a');
      link.className = 'trace-step-link';
      link.href = step.result.data.composeUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Open in Gmail';
      div.appendChild(link);
    }
  }
  return div;
}

function renderTraceRail(trace, live = false) {
  els.traceBody.innerHTML = '';
  const steps = trace?.steps || [];
  if (trace?.plan) {
    const plan = document.createElement('div');
    plan.className = 'trace-plan';
    plan.textContent = trace.plan;
    els.traceBody.appendChild(plan);
  }
  if (!steps.length && !trace?.plan) {
    const empty = document.createElement('p');
    empty.className = 'trace-empty';
    empty.textContent = live ? 'Working…' : 'Nothing traced yet.';
    els.traceBody.appendChild(empty);
  }
  for (const step of steps) els.traceBody.appendChild(traceStepNode(step));
  els.traceStatus.textContent = live ? 'Working' : steps.length ? 'Done' : 'Idle';
  els.traceStatus.classList.toggle('running', live);
}

function traceFromMessage(msg) {
  if (!msg || !Array.isArray(msg.trace) || !msg.trace.length) return null;
  return { plan: msg.plan || null, steps: msg.trace.map((s) => ({ name: s.name, args: s.args, status: 'done', result: s.result })) };
}

// ---------- sidebar (chats) ----------

function renderSidebar() {
  const query = els.searchInput.value || '';
  if (query.trim()) {
    renderSearchResults(query);
    return;
  }
  const list = sortConversations(state);
  els.chatList.innerHTML = '';

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = 'No chats yet. Start one below.';
    els.chatList.appendChild(empty);
    return;
  }

  const section = document.createElement('div');
  section.className = 'sidebar-section';
  section.textContent = 'Recent';
  els.chatList.appendChild(section);

  for (const conv of list) {
    const item = document.createElement('div');
    item.className = 'sidebar-item' + (conv.id === state.activeId ? ' active' : '');
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.dataset.convId = conv.id;

    const title = document.createElement('span');
    title.className = 'sidebar-item-title';
    title.textContent = conv.title || 'New chat';
    title.title = conv.title || 'New chat';
    item.appendChild(title);

    const actions = document.createElement('span');
    actions.className = 'sidebar-item-actions';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.title = 'Rename';
    renameBtn.setAttribute('aria-label', `Rename ${conv.title}`);
    renameBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
    renameBtn.addEventListener('click', (ev) => { ev.stopPropagation(); startRename(item, conv); });
    actions.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.title = 'Delete';
    deleteBtn.setAttribute('aria-label', `Delete ${conv.title}`);
    deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';
    deleteBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (deleteBtn.dataset.armed) {
        deleteConversation(state, conv.id);
        persist();
        renderSidebar();
        renderChat();
      } else {
        deleteBtn.dataset.armed = '1';
        deleteBtn.textContent = 'Delete?';
        deleteBtn.classList.add('confirm-delete');
        setTimeout(() => {
          deleteBtn.dataset.armed = '';
          deleteBtn.classList.remove('confirm-delete');
          deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';
        }, 3000);
      }
    });
    actions.appendChild(deleteBtn);

    item.appendChild(actions);

    const open = () => {
      setActive(state, conv.id);
      persist();
      renderSidebar();
      showView('chat');
      closeMobileSidebar();
      els.composerInput.focus();
    };
    item.addEventListener('click', open);
    item.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
    });
    els.chatList.appendChild(item);
  }
}

// Global search: chats (titles + message text), tasks and notes,
// grouped with counts. Clicking a result jumps to the real thing.
function renderSearchResults(query) {
  const results = searchAll(
    { conversations: state.conversations, tasks: taskStore.list(), notes: noteStore.list() },
    query,
  );
  els.chatList.innerHTML = '';
  if (!results.total) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = `No matches for "${query.trim()}".`;
    els.chatList.appendChild(empty);
    return;
  }
  const groups = [
    ['Chats', results.chats, 'chat'],
    ['Tasks', results.tasks, 'task'],
    ['Notes', results.notes, 'note'],
  ];
  for (const [label, items, kind] of groups) {
    if (!items.length) continue;
    const section = document.createElement('div');
    section.className = 'sidebar-section';
    section.textContent = `${label} (${items.length})`;
    els.chatList.appendChild(section);
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'sidebar-item search-result-item';
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const title = document.createElement('span');
      title.className = 'sidebar-item-title';
      title.textContent = item.title;
      row.appendChild(title);
      const snippet = document.createElement('span');
      snippet.className = 'search-result-snippet';
      snippet.textContent = item.snippet;
      row.appendChild(snippet);
      const open = () => {
        if (kind === 'chat') {
          setActive(state, item.id);
          persist();
          renderSidebar();
          showView('chat');
        } else if (kind === 'note') {
          openNote(item.id);
        } else {
          flashTask(item.id);
        }
      };
      row.addEventListener('click', open);
      row.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
      });
      els.chatList.appendChild(row);
    }
  }
}

function startRename(item, conv) {
  const titleEl = item.querySelector('.sidebar-item-title');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = conv.title;
  input.maxLength = 120;
  input.setAttribute('aria-label', 'Chat name');
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = (save) => {
    if (save) {
      if (renameConversation(state, conv.id, input.value)) persist();
    }
    renderSidebar();
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') commit(true);
    if (ev.key === 'Escape') commit(false);
    ev.stopPropagation();
  });
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('click', (ev) => ev.stopPropagation());
}

// ---------- chat rendering ----------

function planCardNode(plan) {
  const { done, total } = planProgress(plan);
  const card = document.createElement('div');
  card.className = 'plan-card';
  card.dataset.planId = plan.id;
  const head = document.createElement('div');
  head.className = 'plan-card-head';
  head.appendChild(el('span', 'plan-card-title', 'Plan'));
  head.appendChild(el('span', 'plan-card-count', total ? `${done} of ${total}` : ''));
  card.appendChild(head);
  const list = document.createElement('ol');
  list.className = 'plan-steps';
  for (const step of plan.steps) {
    const li = document.createElement('li');
    li.className = `plan-step ${step.status}`;
    const mark = document.createElement('span');
    mark.className = 'plan-step-mark';
    if (step.status === 'done') {
      mark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
    } else if (step.status === 'failed') {
      mark.textContent = '×';
    } else if (step.status === 'running') {
      mark.innerHTML = '<span class="plan-step-dot"></span>';
    }
    li.appendChild(mark);
    li.appendChild(el('span', 'plan-step-label', step.label));
    list.appendChild(li);
  }
  card.appendChild(list);
  return card;
}

// Replace a plan card in place after a step changes state.
function updatePlanCard(planId) {
  const plan = planStore.get(planId);
  if (!plan) return;
  const old = els.chatRoot.querySelector(`[data-plan-id="${planId}"]`);
  if (!old) return;
  old.replaceWith(planCardNode(plan));
}

function traceDetailsNode(msg) {
  const trace = Array.isArray(msg.trace) ? msg.trace : [];
  if (!trace.length && !msg.plan) return null;
  const details = document.createElement('details');
  details.className = 'msg-trace';
  const summary = document.createElement('summary');
  const dot = document.createElement('span');
  dot.className = 'trace-dot';
  summary.appendChild(dot);
  const label = document.createElement('span');
  label.textContent = trace.length ? `Tools used — ${trace.length} step${trace.length === 1 ? '' : 's'}` : 'Plan';
  summary.appendChild(label);
  const count = document.createElement('span');
  count.className = 'trace-count';
  count.textContent = trace.map((s) => s.name).join(', ');
  summary.appendChild(count);
  details.appendChild(summary);
  const body = document.createElement('div');
  body.className = 'msg-trace-body';
  if (msg.plan) {
    const plan = document.createElement('div');
    plan.className = 'trace-plan';
    plan.textContent = msg.plan;
    body.appendChild(plan);
  }
  for (const step of trace) {
    body.appendChild(traceStepNode({ ...step, status: 'done' }));
  }
  details.appendChild(body);
  return details;
}

function messageNode(conv, msg, index, isLast) {
  const wrap = document.createElement('div');
  if (msg.role === 'user') {
    wrap.className = 'msg msg-user';
    const bubble = document.createElement('div');
    bubble.className = 'msg-user-bubble';
    bubble.textContent = msg.text;
    wrap.appendChild(bubble);
    return wrap;
  }

  wrap.className = 'msg msg-assistant';
  wrap.dataset.msgIndex = String(index);

  const head = document.createElement('div');
  head.className = 'msg-head';
  head.innerHTML = '<span class="msg-mark" aria-hidden="true">A</span><span class="msg-name">Atlas</span>';
  wrap.appendChild(head);

  if (msg.planId) {
    const plan = planStore.get(msg.planId);
    if (plan && plan.steps.length) wrap.appendChild(planCardNode(plan));
  }

  const traceNode = traceDetailsNode(msg);
  if (traceNode) wrap.appendChild(traceNode);

  const body = document.createElement('div');
  body.className = 'msg-body';
  if (msg.text) body.innerHTML = renderMarkdown(msg.text);
  wrap.appendChild(body);

  if (msg.error) {
    const err = document.createElement('div');
    err.className = 'msg-error';
    const strong = document.createElement('strong');
    strong.textContent = 'This reply did not go through.';
    err.appendChild(strong);
    const span = document.createElement('span');
    span.textContent = msg.error;
    err.appendChild(span);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Try another model';
    retry.addEventListener('click', () => openSettings());
    err.appendChild(retry);
    wrap.appendChild(err);
  }

  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy';
  copyBtn.addEventListener('click', async () => {
    await copyText(msg.text);
    showToast('Reply copied');
  });
  actions.appendChild(copyBtn);

  if (isLast) {
    const regenBtn = document.createElement('button');
    regenBtn.type = 'button';
    regenBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>Regenerate';
    regenBtn.addEventListener('click', () => regenerate(conv));
    actions.appendChild(regenBtn);
  }

  if (msg.usage) {
    const usage = document.createElement('span');
    usage.className = 'msg-usage';
    usage.textContent = formatUsage(msg.usage);
    actions.appendChild(usage);
  }

  wrap.appendChild(actions);
  return wrap;
}

function emptyStateNode() {
  const empty = document.createElement('div');
  empty.className = 'empty';
  const hasKey = Boolean((state.settings.apiKey || '').trim());
  empty.innerHTML =
    '<div class="empty-mark" aria-hidden="true">A</div>' +
    '<h1>What should I do?</h1>' +
    (hasKey
      ? '<p>Type a request below, or pick one.</p>'
      : '<p>Add your free Gemini key in <a href="#" id="emptySettingsLink">Settings</a> first — it takes a minute, then ask away.</p>');
  const chips = document.createElement('div');
  chips.className = 'chips';
  for (const action of QUICK_ACTIONS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = action.label;
    chip.addEventListener('click', () => runQuickAction(action));
    chips.appendChild(chip);
  }
  empty.appendChild(chips);
  const link = empty.querySelector('#emptySettingsLink');
  if (link) link.addEventListener('click', (ev) => { ev.preventDefault(); openSettings(); });
  return empty;
}

function runQuickAction(action) {
  if (action.action === 'file') {
    els.fileInput.click();
    return;
  }
  if (action.action === 'tasks') {
    openMobileSidebar();
    setTimeout(() => els.taskInput.focus(), 250);
    return;
  }
  els.composerInput.value = action.prompt;
  autoGrow();
  els.composerInput.focus();
  if (action.action === 'send') sendCurrent();
}

function keyNeededNode() {
  const box = document.createElement('div');
  box.className = 'key-needed';
  box.innerHTML =
    '<strong>An API key is needed to chat.</strong>' +
    '<p>This app has no key of its own and never fakes a reply. Paste your free Gemini key in Settings — it stays in this browser.</p>';
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'btn primary';
  openBtn.textContent = 'Open Settings';
  openBtn.addEventListener('click', openSettings);
  box.appendChild(openBtn);
  const link = document.createElement('a');
  link.href = 'https://aistudio.google.com/apikey';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Get a free key';
  link.className = 'btn';
  box.appendChild(link);
  return box;
}

function renderChat() {
  const conv = getActive(state);
  els.chatRoot.innerHTML = '';
  // Trace rail follows the last assistant message of the active chat.
  let lastTrace = null;
  if (conv) {
    for (let i = conv.messages.length - 1; i >= 0; i -= 1) {
      if (conv.messages[i].role === 'assistant') {
        lastTrace = traceFromMessage(conv.messages[i]);
        break;
      }
    }
  }
  if (!generating) renderTraceRail(lastTrace, false);
  if (!conv || conv.messages.length === 0) {
    els.chatRoot.appendChild(emptyStateNode());
    updateSendState();
    return;
  }
  const lastIndex = conv.messages.length - 1;
  conv.messages.forEach((msg, i) => {
    els.chatRoot.appendChild(messageNode(conv, msg, i, i === lastIndex && msg.role === 'assistant'));
  });
  updateSendState();
}

function scrollToBottom(force = false) {
  const el = els.chatScroll;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  if (force || nearBottom) el.scrollTop = el.scrollHeight;
}

// ---------- sending (agent loop) ----------

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function updateSendState() {
  const hasText = els.composerInput.value.trim().length > 0;
  els.sendBtn.disabled = generating || !hasText;
  els.stopBtn.hidden = !generating;
}

function autoGrow() {
  const ta = els.composerInput;
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  updateSendState();
}

function toolCtx(signal) {
  return {
    fetchImpl: fetch,
    signal,
    taskStore,
    noteStore,
    attachedFile,
    openUrl: (url) => { try { window.open(url, '_blank', 'noopener'); } catch (err) { /* the trace carries the link */ } },
  };
}

async function sendCurrent() {
  const text = els.composerInput.value.trim();
  if (!text || generating) return;
  await sendMessage(text);
}

async function runAgentTurn({ conv, text, assistantMsg }) {
  const key = (state.settings.apiKey || '').trim();
  const history = conv.messages.slice(0, -1);
  let lastUsage = null;
  let rendered = false;
  liveTrace = { plan: null, steps: [] };
  renderTraceRail(liveTrace, true);

  generating = true;
  abortController = new AbortController();
  updateSendState();

  const bodyEl = els.chatRoot.querySelector(`[data-msg-index="${conv.messages.length - 1}"] .msg-body`);
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  if (bodyEl) bodyEl.appendChild(typing);

  try {
    const result = await runAgent({
      model: state.settings.model,
      apiKey: key,
      history,
      userText: text,
      toolCtx: toolCtx(abortController.signal),
      signal: abortController.signal,
      onEvent: (ev) => {
        if (ev.type === 'text') {
          rendered = true;
          assistantMsg.text = ev.text;
          if (bodyEl) {
            bodyEl.innerHTML = renderMarkdown(ev.text);
            scrollToBottom();
          }
        } else if (ev.type === 'plan') {
          liveTrace.plan = ev.text;
          assistantMsg.plan = ev.text;
          renderTraceRail(liveTrace, true);
        } else if (ev.type === 'toolcall') {
          liveTrace.steps.push({ name: ev.name, args: ev.args, status: 'running', result: null });
          if (!currentPlanId) {
            const plan = planStore.create({ title: text, chatId: conv.id, msgIndex: conv.messages.length - 1 });
            currentPlanId = plan.id;
            assistantMsg.planId = plan.id;
            const msgEl = els.chatRoot.querySelector(`[data-msg-index="${conv.messages.length - 1}"]`);
            const headEl = msgEl?.querySelector('.msg-head');
            if (headEl) headEl.after(planCardNode(plan));
          }
          const planStep = planStore.addStep(currentPlanId, planStepLabel(ev.name, ev.args), ev.name);
          if (planStep) planStore.setStepStatus(currentPlanId, planStep.id, 'running');
          updatePlanCard(currentPlanId);
          renderPlans();
          renderTraceRail(liveTrace, true);
          scrollToBottom();
        } else if (ev.type === 'toolresult') {
          const step = liveTrace.steps.find((s) => s.name === ev.step.name && s.status === 'running');
          if (step) {
            step.status = 'done';
            step.result = ev.step.result;
          }
          if (currentPlanId) {
            const plan = planStore.get(currentPlanId);
            if (plan) {
              for (let i = plan.steps.length - 1; i >= 0; i -= 1) {
                if (plan.steps[i].tool === ev.step.name && plan.steps[i].status === 'running') {
                  planStore.setStepStatus(currentPlanId, plan.steps[i].id, ev.step.result?.ok === false ? 'failed' : 'done');
                  break;
                }
              }
            }
            updatePlanCard(currentPlanId);
            renderPlans();
          }
          renderTraceRail(liveTrace, true);
          renderMissions();
          renderNotes();
        }
      },
    });
    assistantMsg.text = result.text;
    assistantMsg.usage = result.usage ?? lastUsage;
    assistantMsg.trace = result.trace.length ? result.trace : null;
    assistantMsg.error = null;
    liveTrace = null;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      if (!assistantMsg.text) assistantMsg.text = '';
      assistantMsg.error = null;
      if (!rendered && bodyEl) bodyEl.innerHTML = '';
      if (liveTrace) assistantMsg.trace = liveTrace.steps.length ? liveTrace.steps.map((s) => ({ name: s.name, args: s.args, result: s.result })) : null;
      liveTrace = null;
    } else {
      const message = err instanceof GeminiError
        ? err.message
        : (err?.message || 'Something went wrong while talking to Google.');
      assistantMsg.error = message;
      if (bodyEl && !assistantMsg.text) bodyEl.innerHTML = '';
      if (liveTrace) assistantMsg.trace = liveTrace.steps.length ? liveTrace.steps.map((s) => ({ name: s.name, args: s.args, result: s.result })) : null;
      liveTrace = null;
    }
  } finally {
    generating = false;
    abortController = null;
    if (currentPlanId) {
      const plan = planStore.get(currentPlanId);
      if (plan) {
        for (const s of plan.steps) {
          if (s.status === 'running') planStore.setStepStatus(currentPlanId, s.id, 'failed');
        }
      }
      updatePlanCard(currentPlanId);
      renderPlans();
      currentPlanId = null;
    }
    persist();
    renderChat();
    renderSidebar();
    renderMissions();
    renderNotes();
    scrollToBottom(true);
    els.composerInput.focus();
  }
}

async function sendMessage(text) {
  // "remind me ..." never goes to the model — it is handled here.
  if (/^remind me/i.test(text)) {
    const parsed = parseReminder(text);
    if (parsed.ok) {
      const reminder = reminderStore.add(parsed.what, parsed.at);
      maybeAskNotificationPermission();
      renderReminders();
      if (view === 'home') renderHome();
      els.composerInput.value = '';
      autoGrow();
      showToast(reminder ? `Reminder set — ${formatReminderTime(reminder.at)}` : 'That reminder could not be saved.');
      return;
    }
    showToast(parsed.error);
    return;
  }

  const key = (state.settings.apiKey || '').trim();
  let conv = getActive(state);
  if (!conv) {
    conv = createConversation(state, text);
    renderSidebar();
  }
  addMessage(state, conv.id, 'user', text);
  persist();
  els.composerInput.value = '';
  autoGrow();
  showView('chat');
  scrollToBottom(true);

  if (!key) {
    els.chatRoot.appendChild(keyNeededNode());
    scrollToBottom(true);
    return;
  }

  const assistantMsg = addMessage(state, conv.id, 'assistant', '');
  persist();
  renderChat();
  await runAgentTurn({ conv, text, assistantMsg });
}

async function regenerate(conv) {
  if (generating || !conv) return;
  const lastUserIdx = [...conv.messages].map((m, i) => ({ m, i }))
    .filter(({ m }) => m.role === 'user').pop()?.i;
  if (lastUserIdx == null) return;
  conv.messages.splice(lastUserIdx + 1);
  const text = conv.messages[lastUserIdx].text;
  persist();
  renderChat();
  scrollToBottom(true);

  const key = (state.settings.apiKey || '').trim();
  if (!key) {
    els.chatRoot.appendChild(keyNeededNode());
    return;
  }
  const assistantMsg = addMessage(state, conv.id, 'assistant', '');
  persist();
  renderChat();
  await runAgentTurn({ conv, text, assistantMsg });
}

function stopGenerating() {
  if (abortController) abortController.abort();
}

function newChat() {
  if (generating) stopGenerating();
  const conv = createConversation(state, '');
  persist();
  renderSidebar();
  showView('chat');
  closeMobileSidebar();
  els.composerInput.focus();
}

// ---------- sidebar on mobile / trace rail ----------

function openMobileSidebar() {
  els.sidebar.classList.add('open');
  els.scrim.classList.add('show');
}
function closeMobileSidebar() {
  els.sidebar.classList.remove('open');
  els.scrim.classList.remove('show');
}
function closeTraceRail() {
  els.traceRail.classList.remove('open');
  els.traceToggleBtn.classList.remove('active');
  if (!els.sidebar.classList.contains('open')) els.scrim.classList.remove('show');
}
function toggleTraceRail() {
  const open = els.traceRail.classList.toggle('open');
  els.traceToggleBtn.classList.toggle('active', open);
  if (open) els.scrim.classList.add('show');
  else if (!els.sidebar.classList.contains('open')) els.scrim.classList.remove('show');
}

// ---------- file attach ----------

function setAttachedFile(file) {
  attachedFile = file;
  if (file) {
    els.fileChipName.textContent = `${file.name} (${file.text.length.toLocaleString()} chars)`;
    els.fileChip.hidden = false;
  } else {
    els.fileChip.hidden = true;
  }
}

async function handleFilePicked(file) {
  if (!file) return;
  const allowed = /\.(txt|md|csv|json|log|html)$/i.test(file.name);
  if (!allowed) {
    showToast('That file type cannot be read — attach a .txt, .md, .csv, .json or .log file');
    els.fileInput.value = '';
    return;
  }
  if (file.size > 2_000_000) {
    showToast('That file is too large — 2 MB is the limit');
    els.fileInput.value = '';
    return;
  }
  try {
    const text = await file.text();
    setAttachedFile({
      name: file.name,
      text: text.slice(0, MAX_FILE_CHARS),
      truncated: text.length > MAX_FILE_CHARS,
    });
    showToast(text.length > MAX_FILE_CHARS ? `Attached ${file.name} — first ${MAX_FILE_CHARS.toLocaleString()} characters will be read` : `Attached ${file.name}`);
    els.composerInput.value = attachedFile.truncated
      ? `Summarise the attached file ${file.name}`
      : `Summarise the attached file ${file.name}`;
    autoGrow();
    els.composerInput.focus();
  } catch (err) {
    showToast('Could not read that file');
  }
  els.fileInput.value = '';
}

// ---------- command palette ----------

function paletteData() {
  return {
    conversations: state.conversations,
    tasks: taskStore.list(),
    notes: noteStore.list(),
  };
}

function openPalette() {
  els.paletteModal.classList.add('open');
  els.paletteInput.value = '';
  renderPalette('');
  setTimeout(() => els.paletteInput.focus(), 30);
}

function closePalette() {
  els.paletteModal.classList.remove('open');
  paletteSelected = -1;
  paletteItems = [];
}

function renderPalette(query) {
  const groups = buildPaletteItems(paletteData(), query);
  paletteItems = flattenPalette(groups);
  paletteSelected = paletteItems.length ? 0 : -1;
  els.paletteList.innerHTML = '';
  if (!paletteItems.length) {
    els.paletteList.appendChild(el('div', 'palette-empty', query.trim() ? `No matches for "${query.trim()}".` : 'Nothing here yet.'));
    return;
  }
  let idx = 0;
  for (const group of groups) {
    if (!group.items.length) continue;
    els.paletteList.appendChild(el('div', 'palette-group', group.group));
    for (const item of group.items) {
      const itemIdx = idx;
      idx += 1;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'palette-item' + (itemIdx === paletteSelected ? ' selected' : '');
      btn.setAttribute('role', 'option');
      btn.dataset.paletteIndex = String(itemIdx);
      btn.appendChild(el('span', 'palette-item-label', item.label));
      if (item.hint) btn.appendChild(el('span', 'palette-item-hint', item.hint));
      btn.addEventListener('click', () => runPaletteItem(paletteItems[itemIdx]));
      btn.addEventListener('mouseenter', () => selectPaletteItem(itemIdx));
      els.paletteList.appendChild(btn);
    }
  }
}

function selectPaletteItem(idx) {
  paletteSelected = idx;
  els.paletteList.querySelectorAll('.palette-item').forEach((node) => {
    node.classList.toggle('selected', Number(node.dataset.paletteIndex) === idx);
  });
  els.paletteList.querySelector(`[data-palette-index="${idx}"]`)?.scrollIntoView({ block: 'nearest' });
}

function runPaletteItem(item) {
  if (!item) return;
  closePalette();
  if (item.kind === 'chat') {
    setActive(state, item.id);
    persist();
    renderSidebar();
    showView('chat');
  } else if (item.kind === 'task') {
    flashTask(item.id);
  } else if (item.kind === 'note') {
    openNote(item.id);
  } else {
    runPaletteAction(item.id);
  }
}

function runPaletteAction(id) {
  if (id === 'new-chat') { newChat(); return; }
  if (id === 'home') { showView('home'); return; }
  if (id === 'settings') { openSettings(); return; }
  if (id === 'theme') { toggleTheme(); return; }
  if (id === 'export') { exportBackup(); return; }
  const prompts = {
    'search-web': 'Search the web for ',
    'draft-mail': 'Draft a mail to ',
    weather: "What's the weather in ",
    'plan-day': 'Plan my day: look at my open tasks and turn the day into a short plan',
  };
  const prompt = prompts[id];
  if (prompt == null) return;
  showView('chat');
  els.composerInput.value = prompt;
  autoGrow();
  els.composerInput.focus();
  if (id === 'plan-day') sendCurrent();
}

// ---------- slash commands ----------

function hideSlashMenu() {
  els.slashMenu.hidden = true;
  els.slashMenu.innerHTML = '';
  slashSelected = -1;
}

function updateSlashMenu() {
  const value = els.composerInput.value;
  const parsed = parseSlash(value);
  if (!parsed || value.includes('\n') || parsed.arg) { hideSlashMenu(); return; }
  const matches = matchSlashCommands(parsed.name);
  if (!matches.length) { hideSlashMenu(); return; }
  slashSelected = 0;
  els.slashMenu.innerHTML = '';
  matches.forEach((command, i) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'slash-item' + (i === slashSelected ? ' selected' : '');
    item.setAttribute('role', 'option');
    const name = el('span', 'slash-name', `/${command.name}`);
    if (command.hint) name.appendChild(el('span', 'slash-hint', ` ${command.hint}`));
    item.appendChild(name);
    item.appendChild(el('span', 'slash-desc', command.description));
    item.addEventListener('click', () => chooseSlashCommand(command));
    els.slashMenu.appendChild(item);
  });
  els.slashMenu.hidden = false;
}

function selectSlashItem(delta) {
  const items = [...els.slashMenu.querySelectorAll('.slash-item')];
  if (!items.length) return;
  slashSelected = (slashSelected + delta + items.length) % items.length;
  items.forEach((node, i) => node.classList.toggle('selected', i === slashSelected));
}

function chooseSlashCommand(command) {
  if (!command) return;
  hideSlashMenu();
  if (command.action === 'file') {
    els.composerInput.value = '';
    autoGrow();
    els.fileInput.click();
    return;
  }
  els.composerInput.value = command.build('');
  autoGrow();
  els.composerInput.focus();
}

// ---------- voice input ----------

function initVoice() {
  voiceInput = createVoiceInput({});
}

function toggleVoice() {
  if (!voiceInput || !voiceInput.supported) {
    showToast('Dictation is not supported in this browser — type instead.');
    return;
  }
  if (voiceInput.listening) {
    voiceInput.stop();
    els.micBtn.classList.remove('recording');
    return;
  }
  dictationBase = els.composerInput.value;
  const ok = voiceInput.start({
    onResult: (text, isFinal) => {
      els.composerInput.value = (dictationBase ? `${dictationBase} ` : '') + text;
      autoGrow();
      if (isFinal) dictationBase = els.composerInput.value;
    },
    onError: (code) => {
      els.micBtn.classList.remove('recording');
      showToast(code === 'not-allowed'
        ? 'Microphone access was blocked — allow it in the browser, or type instead.'
        : 'Dictation stopped — try again, or type instead.');
    },
    onEnd: () => els.micBtn.classList.remove('recording'),
  });
  if (ok) {
    els.micBtn.classList.add('recording');
    showToast('Listening — speak now.');
  }
}

// ---------- drag and drop files onto the composer ----------

function initDragDrop() {
  const wrap = els.composerWrap;
  wrap.addEventListener('dragenter', (ev) => {
    ev.preventDefault();
    wrap.classList.add('drag-over');
  });
  wrap.addEventListener('dragover', (ev) => { ev.preventDefault(); });
  wrap.addEventListener('dragleave', (ev) => {
    if (ev.relatedTarget && wrap.contains(ev.relatedTarget)) return;
    wrap.classList.remove('drag-over');
  });
  wrap.addEventListener('drop', (ev) => {
    ev.preventDefault();
    wrap.classList.remove('drag-over');
    const files = ev.dataTransfer?.files;
    if (files && files.length) handleFilePicked(files[0]);
  });
}

// ---------- back up and restore ----------

function downloadFile(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup() {
  const backup = buildBackup({
    state,
    tasks: taskStore.list(),
    notes: noteStore.list(),
    reminders: reminderStore.list(),
    plans: planStore.list(),
  });
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(`atlas-backup-${date}.json`, JSON.stringify(backup, null, 2));
  showToast('Backup downloaded — it does not include your API key');
}

function restoreBackup(data) {
  const incoming = data.state || {};
  const model = incoming.settings?.model;
  state = {
    version: 1,
    settings: {
      apiKey: state.settings.apiKey,
      model: isValidModel(model) ? model : DEFAULT_MODEL,
      theme: incoming.settings?.theme === 'light' ? 'light' : 'dark',
    },
    conversations: Array.isArray(incoming.conversations) ? incoming.conversations : [],
    activeId: incoming.activeId || null,
  };
  if (state.activeId && !getConversation(state, state.activeId)) {
    state.activeId = state.conversations[0]?.id || null;
  }
  persist();
  storage.setItem(TASKS_KEY, JSON.stringify(data.tasks || []));
  storage.setItem(NOTES_KEY, JSON.stringify(data.notes || []));
  storage.setItem(REMINDERS_KEY, JSON.stringify(data.reminders || []));
  storage.setItem(PLANS_KEY, JSON.stringify(data.plans || []));
  taskStore = createTaskStore(storage);
  noteStore = createNoteStore(storage);
  reminderStore = createReminderStore(storage);
  planStore = createPlanStore(storage);
  els.modelSelect.value = state.settings.model;
  applyTheme();
  renderKeyState();
  renderMissions();
  renderNotes();
  renderPlans();
  renderReminders();
  renderSidebar();
  closeSettings();
  showView('home');
  showToast('Backup restored');
}

function toggleTheme() {
  state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
  persist();
  applyTheme();
}

// ---------- settings ----------

function openSettings() {
  els.apiKeyInput.value = state.settings.apiKey || '';
  els.apiKeyInput.type = 'password';
  els.toggleKeyVisibility.textContent = 'Show';
  els.settingsModelSelect.value = isValidModel(state.settings.model) ? state.settings.model : DEFAULT_MODEL;
  els.settingsModal.classList.add('open');
  setTimeout(() => els.apiKeyInput.focus(), 50);
}
function closeSettings() {
  els.settingsModal.classList.remove('open');
}

function saveSettings() {
  const key = els.apiKeyInput.value.trim();
  const model = els.settingsModelSelect.value;
  state.settings.apiKey = key;
  if (isValidModel(model)) state.settings.model = model;
  els.modelSelect.value = state.settings.model;
  persist();
  renderKeyState();
  closeSettings();
  showToast(key ? 'Key saved in this browser' : 'Key removed');
  renderChat();
}

// ---------- share (copy transcript as Markdown) ----------

function conversationToMarkdown(conv) {
  const lines = [`# ${conv.title || 'Chat'}`];
  for (const m of conv.messages) {
    lines.push('', m.role === 'user' ? '## You' : '## Atlas', '', m.text);
    if (m.role === 'assistant' && Array.isArray(m.trace) && m.trace.length) {
      lines.push('', `Tools used: ${m.trace.map((s) => s.name).join(', ')}`);
    }
  }
  return lines.join('\n');
}

// ---------- wiring ----------

els.newChatBtn.addEventListener('click', newChat);
els.wordmark.addEventListener('click', (ev) => { ev.preventDefault(); showView('home'); });
els.homeBtn.addEventListener('click', () => showView('home'));
els.crumbHome.addEventListener('click', () => showView('home'));
els.menuBtn.addEventListener('click', openMobileSidebar);
els.closeSidebarBtn.addEventListener('click', closeMobileSidebar);
els.scrim.addEventListener('click', () => { closeMobileSidebar(); closeTraceRail(); });
els.searchInput.addEventListener('input', renderSidebar);
els.paletteBtn.addEventListener('click', openPalette);
els.paletteModal.addEventListener('click', (ev) => {
  if (ev.target === els.paletteModal) closePalette();
});
els.paletteInput.addEventListener('input', () => renderPalette(els.paletteInput.value));
els.paletteInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'ArrowDown') { ev.preventDefault(); selectPaletteItem(moveSelection(paletteSelected, 1, paletteItems.length)); }
  else if (ev.key === 'ArrowUp') { ev.preventDefault(); selectPaletteItem(moveSelection(paletteSelected, -1, paletteItems.length)); }
  else if (ev.key === 'Enter') { ev.preventDefault(); runPaletteItem(paletteItems[paletteSelected]); }
});
els.sendBtn.addEventListener('click', sendCurrent);
els.stopBtn.addEventListener('click', stopGenerating);
els.micBtn.addEventListener('click', toggleVoice);
els.traceToggleBtn.addEventListener('click', toggleTraceRail);
els.closeTraceBtn.addEventListener('click', closeTraceRail);
els.settingsBtn.addEventListener('click', openSettings);
els.saveSettingsBtn.addEventListener('click', saveSettings);
els.toggleKeyVisibility.addEventListener('click', () => {
  const show = els.apiKeyInput.type === 'password';
  els.apiKeyInput.type = show ? 'text' : 'password';
  els.toggleKeyVisibility.textContent = show ? 'Hide' : 'Show';
});
els.clearDataBtn.addEventListener('click', () => {
  if (els.clearDataBtn.dataset.armed) {
    state = clearState(storage);
    els.clearDataBtn.dataset.armed = '';
    els.clearDataBtn.textContent = 'Erase all chats';
    persist();
    applyTheme();
    renderKeyState();
    renderSidebar();
    renderChat();
    closeSettings();
    showToast('All chats erased');
  } else {
    els.clearDataBtn.dataset.armed = '1';
    els.clearDataBtn.textContent = 'Tap again to erase';
    setTimeout(() => {
      els.clearDataBtn.dataset.armed = '';
      els.clearDataBtn.textContent = 'Erase all chats';
    }, 3000);
  }
});
els.settingsModal.addEventListener('click', (ev) => {
  if (ev.target === els.settingsModal) closeSettings();
});
els.themeBtn.addEventListener('click', toggleTheme);
els.modelSelect.addEventListener('change', () => {
  const model = els.modelSelect.value;
  if (isValidModel(model)) {
    state.settings.model = model;
    persist();
    renderKeyState();
    showToast(`Model: ${modelLabel(model)}`);
  }
});
els.settingsModelSelect.addEventListener('change', () => {
  els.modelSelect.value = els.settingsModelSelect.value;
});
els.copyLinkBtn.addEventListener('click', async () => {
  const conv = getActive(state);
  if (!conv || conv.messages.length === 0) {
    showToast('Nothing to copy yet');
    return;
  }
  await copyText(conversationToMarkdown(conv));
  showToast('Chat copied as Markdown');
});
els.exportBtn.addEventListener('click', exportBackup);
els.importBtn.addEventListener('click', () => {
  if (els.importBtn.dataset.armed) {
    els.importBtn.dataset.armed = '';
    els.importBtn.textContent = 'Restore from backup';
    els.importInput.click();
  } else {
    els.importBtn.dataset.armed = '1';
    els.importBtn.textContent = 'Tap again to restore';
    setTimeout(() => {
      els.importBtn.dataset.armed = '';
      els.importBtn.textContent = 'Restore from backup';
    }, 3000);
  }
});
els.importInput.addEventListener('change', async () => {
  const file = els.importInput.files?.[0];
  els.importInput.value = '';
  if (!file) return;
  let text = '';
  try {
    text = await file.text();
  } catch (err) {
    showToast('Could not read that file.');
    return;
  }
  const parsed = parseBackup(text);
  if (!parsed.ok) {
    showToast(parsed.error);
    return;
  }
  restoreBackup(parsed.data);
});
els.composerInput.addEventListener('input', () => { autoGrow(); updateSlashMenu(); });
els.composerInput.addEventListener('keydown', (ev) => {
  if (!els.slashMenu.hidden) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); selectSlashItem(1); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); selectSlashItem(-1); return; }
    if (ev.key === 'Enter' || ev.key === 'Tab') {
      const parsed = parseSlash(els.composerInput.value);
      const command = parsed ? matchSlashCommands(parsed.name)[slashSelected] : null;
      if (command) { ev.preventDefault(); chooseSlashCommand(command); return; }
    }
    if (ev.key === 'Escape') { ev.preventDefault(); hideSlashMenu(); return; }
  }
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    sendCurrent();
  }
});
els.attachBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', () => handleFilePicked(els.fileInput.files?.[0]));
els.fileChipRemove.addEventListener('click', () => {
  setAttachedFile(null);
  showToast('File removed');
});
els.addTaskBtn.addEventListener('click', addTaskFromInput);
els.taskInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') { ev.preventDefault(); addTaskFromInput(); }
});
els.deleteNoteBtn.addEventListener('click', () => {
  if (openNoteId) {
    noteStore.remove(openNoteId);
    renderNotes();
    closeNote();
    showToast('Note deleted');
  }
});
els.closeNoteBtn.addEventListener('click', closeNote);
els.noteModal.addEventListener('click', (ev) => {
  if (ev.target === els.noteModal) closeNote();
});

// copy buttons inside code blocks (event delegation — code is re-rendered)
els.chatRoot.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-copy-code]');
  if (!btn) return;
  const conv = getActive(state);
  if (!conv) return;
  const msgIndex = Number(btn.closest('.msg-assistant')?.dataset.msgIndex ?? -1);
  const msg = conv.messages[msgIndex];
  if (!msg) return;
  const { blocks } = extractCodeBlocks(msg.text);
  const block = getCodeBlockById(blocks, btn.dataset.copyCode);
  if (!block) return;
  await copyText(block.code);
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
});

document.addEventListener('keydown', (ev) => {
  const mod = ev.metaKey || ev.ctrlKey;
  if (mod && ev.key.toLowerCase() === 'k' && !ev.shiftKey) {
    ev.preventDefault();
    if (els.paletteModal.classList.contains('open')) closePalette();
    else openPalette();
    return;
  }
  if (mod && ev.shiftKey && ev.key.toLowerCase() === 'k') {
    ev.preventDefault();
    newChat();
    return;
  }
  if (ev.key === 'Escape') {
    if (els.paletteModal.classList.contains('open')) closePalette();
    else if (!els.slashMenu.hidden) hideSlashMenu();
    else if (els.settingsModal.classList.contains('open')) closeSettings();
    else if (els.noteModal.classList.contains('open')) closeNote();
    else if (generating) stopGenerating();
    else { closeMobileSidebar(); closeTraceRail(); }
  }
});

// ---------- init ----------

function init() {
  // open a chat from ?chat=<id> when it exists (local link)
  const params = new URLSearchParams(location.search);
  const chatId = params.get('chat');
  if (chatId && getConversation(state, chatId)) setActive(state, chatId);
  else if (!getActive(state) && state.conversations.length > 0) {
    state.activeId = sortConversations(state)[0].id;
  }
  els.modelSelect.value = isValidModel(state.settings.model) ? state.settings.model : DEFAULT_MODEL;
  applyTheme();
  renderKeyState();
  renderMissions();
  renderNotes();
  renderPlans();
  renderReminders();
  renderSidebar();
  checkDueReminders();
  reminderTimer = setInterval(checkDueReminders, 20000);
  initVoice();
  initDragDrop();
  const viewParam = params.get('view');
  if (viewParam === 'chat' && getActive(state)) showView('chat');
  else showView('home');
  autoGrow();
}

init();
