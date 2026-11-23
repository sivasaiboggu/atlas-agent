// Atlas — tasks and notes stores.
// Plain state + a tiny storage adapter, testable without a browser.
// Both persist in localStorage; nothing leaves the machine.

import { newId } from './store.js';

export const TASKS_KEY = 'atlas-agent:tasks:v1';
export const NOTES_KEY = 'atlas-agent:notes:v1';

function loadList(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function saveList(storage, key, items) {
  try {
    storage.setItem(key, JSON.stringify(items));
    return true;
  } catch (err) {
    return false;
  }
}

// ---------- tasks ----------

export function createTaskStore(storage) {
  const store = {
    items: loadList(storage, TASKS_KEY),

    save() {
      return saveList(storage, TASKS_KEY, store.items);
    },

    // Open tasks first (oldest first), then completed ones.
    list() {
      const open = store.items.filter((t) => !t.done).sort((a, b) => a.createdAt - b.createdAt);
      const done = store.items.filter((t) => t.done).sort((a, b) => b.createdAt - a.createdAt);
      return [...open, ...done];
    },

    // Adds a task; an identical open task is not added twice.
    add(title) {
      const clean = String(title || '').trim().slice(0, 200);
      if (!clean) return { task: null, duplicate: false };
      const existing = store.items.find((t) => !t.done && t.title.toLowerCase() === clean.toLowerCase());
      if (existing) return { task: existing, duplicate: true };
      const task = { id: newId(), title: clean, done: false, createdAt: Date.now() };
      store.items.push(task);
      store.save();
      return { task, duplicate: false };
    },

    complete(id) {
      const task = store.items.find((t) => t.id === id);
      if (!task) return null;
      task.done = true;
      store.save();
      return task;
    },

    remove(id) {
      const idx = store.items.findIndex((t) => t.id === id);
      if (idx === -1) return false;
      store.items.splice(idx, 1);
      store.save();
      return true;
    },
  };
  return store;
}

// ---------- notes ----------

export function createNoteStore(storage) {
  const store = {
    items: loadList(storage, NOTES_KEY),

    save() {
      return saveList(storage, NOTES_KEY, store.items);
    },

    list() {
      // Newest first; same-millisecond ties keep insertion order (later first).
      return [...store.items]
        .map((n, i) => ({ n, i }))
        .sort((a, b) => (b.n.createdAt - a.n.createdAt) || (b.i - a.i))
        .map(({ n }) => n);
    },

    add(title, text) {
      const cleanTitle = String(title || '').trim().slice(0, 120);
      const cleanText = String(text || '').trim().slice(0, 20000);
      if (!cleanTitle || !cleanText) return null;
      const note = { id: newId(), title: cleanTitle, text: cleanText, createdAt: Date.now() };
      store.items.push(note);
      store.save();
      return note;
    },

    get(id) {
      return store.items.find((n) => n.id === id) || null;
    },

    search(query) {
      const q = String(query || '').trim().toLowerCase();
      if (!q) return store.list();
      return store.list().filter((n) =>
        n.title.toLowerCase().includes(q) || n.text.toLowerCase().includes(q));
    },

    remove(id) {
      const idx = store.items.findIndex((n) => n.id === id);
      if (idx === -1) return false;
      store.items.splice(idx, 1);
      store.save();
      return true;
    },
  };
  return store;
}
