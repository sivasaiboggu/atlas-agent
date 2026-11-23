// Atlas — reminders.
// Plain-words parsing ("remind me to call Mum at 3pm", "remind me in
// 20 minutes to stretch"), a small localStorage store, and due checks.
//
// Honest limit, stated in the UI too: a reminder only fires while
// Atlas is open in a tab. A static page cannot wake itself, so there
// is no background alarm — when the page is open, due reminders fire
// through the Notification API (when permitted) and the in-app due list.

import { newId } from './store.js';

export const REMINDERS_KEY = 'atlas-agent:reminders:v1';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

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

// Parse "3pm", "3:30pm", "15:30", "9 am". Returns { hours, minutes } or null.
export function parseTimeOfDay(str) {
  const m = String(str || '').trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3] || null;
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'am') hours = hours === 12 ? 0 : hours;
    else hours = hours === 12 ? 12 : hours + 12;
  } else if (hours > 23) {
    return null;
  }
  return { hours, minutes };
}

function atTime(date, hours, minutes) {
  const d = new Date(date);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

// Parse a reminder request. Returns { ok: true, what, at } (at = epoch ms)
// or { ok: false, error } with a plain-words reason.
export function parseReminder(text, now = new Date()) {
  const input = String(text || '').trim();
  const lower = input.toLowerCase();
  if (!lower.startsWith('remind me')) {
    return { ok: false, error: 'That is not a reminder request.' };
  }

  // "remind me in 20 minutes to stretch" / "remind me in 2 hours to call"
  let m = lower.match(/^remind me in (\d+)\s*(minutes?|mins?|hours?|hrs?)\s+to\s+(.+)$/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2].startsWith('h') ? HOUR_MS : MINUTE_MS;
    const what = m[3].trim();
    if (!what) return { ok: false, error: 'Say what to be reminded about, e.g. "remind me in 20 minutes to stretch".' };
    if (n < 1 || n > 24 * 60) return { ok: false, error: 'Pick a delay between 1 minute and a day.' };
    return { ok: true, what, at: now.getTime() + n * unit };
  }

  // "remind me to call Mum at 3pm" / "... tomorrow at 9am" / "... at 15:30"
  m = input.match(/^remind me to (.+?)(?:\s+(tomorrow))?\s+at\s+(.+)$/i);
  if (m) {
    const what = m[1].trim();
    const tomorrow = Boolean(m[2]);
    const time = parseTimeOfDay(m[3]);
    if (!what) return { ok: false, error: 'Say what to be reminded about.' };
    if (!time) return { ok: false, error: 'I could not work out the time — try "at 3pm" or "in 20 minutes".' };
    let at = atTime(now, time.hours, time.minutes);
    if (tomorrow) at.setDate(at.getDate() + 1);
    else if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1); // next occurrence
    return { ok: true, what, at: at.getTime() };
  }

  // "remind me to call Mum tomorrow" — tomorrow at 9:00.
  m = input.match(/^remind me to (.+?)\s+tomorrow$/i);
  if (m) {
    const what = m[1].trim();
    if (!what) return { ok: false, error: 'Say what to be reminded about.' };
    const at = atTime(now, 9, 0);
    at.setDate(at.getDate() + 1);
    return { ok: true, what, at: at.getTime() };
  }

  return { ok: false, error: 'I could not work out when — try "remind me to call Mum at 3pm" or "remind me in 20 minutes to stretch".' };
}

// "Today 15:30", "Tomorrow 09:00", "Fri 12 Jan 09:00", or "Due now".
export function formatReminderTime(atMs, nowMs = Date.now()) {
  const at = new Date(atMs);
  const now = new Date(nowMs);
  if (atMs <= nowMs) return 'Due now';
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (sameDay(at, now)) return `Today ${time}`;
  if (sameDay(at, tomorrow)) return `Tomorrow ${time}`;
  return `${at.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

export function createReminderStore(storage) {
  const store = {
    items: loadList(storage, REMINDERS_KEY),

    save() {
      return saveList(storage, REMINDERS_KEY, store.items);
    },

    // Soonest first.
    list() {
      return [...store.items].sort((a, b) => a.at - b.at);
    },

    add(what, at) {
      const clean = String(what || '').trim().slice(0, 200);
      if (!clean) return null;
      const reminder = { id: newId(), what: clean, at: Number(at), status: 'pending', createdAt: Date.now() };
      store.items.push(reminder);
      store.save();
      return reminder;
    },

    get(id) {
      return store.items.find((r) => r.id === id) || null;
    },

    // Pending reminders whose time has come. Marks them fired and returns them.
    due(nowMs = Date.now()) {
      const due = store.items.filter((r) => r.status === 'pending' && r.at <= nowMs);
      for (const r of due) r.status = 'fired';
      if (due.length) store.save();
      return due;
    },

    upcoming(nowMs = Date.now()) {
      return store.list().filter((r) => r.status === 'pending' && r.at > nowMs);
    },

    remove(id) {
      const idx = store.items.findIndex((r) => r.id === id);
      if (idx === -1) return false;
      store.items.splice(idx, 1);
      store.save();
      return true;
    },
  };
  return store;
}
