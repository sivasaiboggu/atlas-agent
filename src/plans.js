// Atlas — mission plans.
// A plan is the numbered list of steps for one agent turn: each tool
// call becomes a step, checked off as its tool finishes. Plans persist
// in localStorage so the left rail can show progress ("2 of 4") after
// the turn is over. A plan is only created once a turn actually calls
// a tool — plain answers have no plan.

import { newId } from './store.js';

export const PLANS_KEY = 'atlas-agent:plans:v1';

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

// Plain label for one tool step, from its name and arguments.
export function planStepLabel(name, args = {}) {
  const a = args || {};
  switch (name) {
    case 'web_search':
      return `Search the web for "${String(a.query || '').slice(0, 60)}"`;
    case 'fetch_page':
      return `Read ${String(a.url || '').slice(0, 80)}`;
    case 'get_weather':
      return `Weather in ${String(a.place || '').slice(0, 60)}`;
    case 'tasks':
      return a.action === 'add' ? `Add task: ${String(a.title || '').slice(0, 60)}`
        : a.action === 'complete' ? 'Mark a task done'
        : 'List tasks';
    case 'notes':
      return a.action === 'save' ? `Save note: ${String(a.title || '').slice(0, 60)}`
        : a.action === 'search' ? `Search notes for "${String(a.query || '').slice(0, 60)}"`
        : 'List notes';
    case 'draft_email':
      return `Draft a mail to ${String(a.to || '').slice(0, 80)}`;
    case 'calculate':
      return `Work out ${String(a.expression || '').slice(0, 60)}`;
    case 'read_file':
      return 'Read the attached file';
    default:
      return String(name);
  }
}

export function planProgress(plan) {
  const steps = plan?.steps || [];
  const done = steps.filter((s) => s.status === 'done' || s.status === 'failed').length;
  return { done, total: steps.length };
}

export function createPlanStore(storage) {
  const store = {
    items: loadList(storage, PLANS_KEY),

    save() {
      return saveList(storage, PLANS_KEY, store.items);
    },

    create({ title, chatId = null, msgIndex = null }) {
      const clean = String(title || '').trim().split('\n')[0].slice(0, 120) || 'Plan';
      const plan = {
        id: newId(),
        title: clean,
        chatId,
        msgIndex,
        steps: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      store.items.push(plan);
      store.save();
      return plan;
    },

    get(id) {
      return store.items.find((p) => p.id === id) || null;
    },

    // Newest first; same-millisecond ties keep insertion order (later first).
    list() {
      return [...store.items]
        .map((p, i) => ({ p, i }))
        .sort((a, b) => (b.p.createdAt - a.p.createdAt) || (b.i - a.i))
        .map(({ p }) => p);
    },

    addStep(planId, label, tool) {
      const plan = store.get(planId);
      if (!plan) return null;
      const step = { id: newId(), label: String(label || '').slice(0, 200), tool: tool || '', status: 'pending' };
      plan.steps.push(step);
      plan.updatedAt = Date.now();
      store.save();
      return step;
    },

    setStepStatus(planId, stepId, status) {
      const plan = store.get(planId);
      if (!plan) return null;
      const step = plan.steps.find((s) => s.id === stepId);
      if (!step) return null;
      step.status = status;
      plan.updatedAt = Date.now();
      store.save();
      return step;
    },

    remove(id) {
      const idx = store.items.findIndex((p) => p.id === id);
      if (idx === -1) return false;
      store.items.splice(idx, 1);
      store.save();
      return true;
    },
  };
  return store;
}
