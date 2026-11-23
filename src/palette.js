// Atlas — command palette (Ctrl/Cmd+K).
// Fuzzy search across chats, tasks, notes and actions. Pure logic —
// the DOM wiring lives in app.js. Items are grouped; the list is
// flattened for arrow-key navigation (wrap-around).

import { fuzzyScore, searchAll } from './search.js';

export const PALETTE_ACTIONS = [
  { id: 'new-chat', label: 'New chat', hint: 'Start a fresh chat' },
  { id: 'home', label: 'Go to Home', hint: 'Overview of today' },
  { id: 'settings', label: 'Open Settings', hint: 'API key and model' },
  { id: 'theme', label: 'Switch theme', hint: 'Dark or light' },
  { id: 'export', label: 'Back up data', hint: 'Download a JSON backup' },
  { id: 'search-web', label: 'Search the web', hint: 'Ask Atlas to search' },
  { id: 'draft-mail', label: 'Draft a mail', hint: 'Ask Atlas to draft it' },
  { id: 'weather', label: "What's the weather", hint: 'Ask Atlas for the weather' },
  { id: 'plan-day', label: 'Plan my day', hint: 'Turn open tasks into a plan' },
];

// Build grouped palette items for a query.
// data: { conversations, tasks, notes }. Returns [{ group, items }].
// With an empty query: all actions, the 5 most recent chats, open tasks.
export function buildPaletteItems(data, query) {
  const q = String(query || '').trim();
  const groups = [];

  const actions = PALETTE_ACTIONS
    .map((a) => ({ ...a, kind: 'action', score: q ? Math.max(fuzzyScore(q, a.label), fuzzyScore(q, a.hint)) : 1 }))
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score);
  if (actions.length) groups.push({ group: 'Actions', items: actions });

  if (!q) {
    const recent = [...(data.conversations || [])]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5)
      .map((c) => ({ kind: 'chat', id: c.id, label: c.title || 'New chat', hint: `${c.messages?.length || 0} messages`, score: 1 }));
    if (recent.length) groups.push({ group: 'Recent chats', items: recent });
    const open = (data.tasks || []).filter((t) => !t.done).slice(0, 5)
      .map((t) => ({ kind: 'task', id: t.id, label: t.title, hint: 'Open task', score: 1 }));
    if (open.length) groups.push({ group: 'Open tasks', items: open });
    return groups;
  }

  const found = searchAll(data, q);
  if (found.chats.length) {
    groups.push({
      group: `Chats (${found.chats.length})`,
      items: found.chats.map((c) => ({ kind: 'chat', id: c.id, label: c.title, hint: c.snippet, score: c.score })),
    });
  }
  if (found.tasks.length) {
    groups.push({
      group: `Tasks (${found.tasks.length})`,
      items: found.tasks.map((t) => ({ kind: 'task', id: t.id, label: t.title, hint: t.snippet, score: t.score })),
    });
  }
  if (found.notes.length) {
    groups.push({
      group: `Notes (${found.notes.length})`,
      items: found.notes.map((n) => ({ kind: 'note', id: n.id, label: n.title, hint: n.snippet, score: n.score })),
    });
  }
  return groups;
}

export function flattenPalette(groups) {
  const flat = [];
  for (const g of groups || []) {
    for (const item of g.items || []) flat.push({ ...item, group: g.group });
  }
  return flat;
}

// Arrow-key selection: moves by delta, wraps around, clamps to the list.
export function moveSelection(current, delta, count) {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}
