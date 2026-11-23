// Atlas — search everywhere.
// One search across chats (titles + message text), tasks and notes.
// Fuzzy: an exact phrase scores highest; a subsequence match (typed
// letters in order) still finds things. Returns grouped results with
// counts, best first, capped per group.

export const MAX_RESULTS_PER_GROUP = 5;

// Subsequence fuzzy score, 0..1. 0 means the query is not in the text
// at all. Exact phrases score 0.9–1.0; subsequence matches cap at 0.85.
export function fuzzyScore(query, text) {
  const q = String(query || '').trim().toLowerCase();
  const t = String(text || '').toLowerCase();
  if (!q) return 0;
  if (t.includes(q)) return 0.9 + 0.1 * (q.length / Math.max(t.length, 1));
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  let prevIdx = -2;
  for (let i = 0; i < t.length && qi < q.length; i += 1) {
    if (t[i] === q[qi]) {
      score += 1;
      if (i === prevIdx + 1) consecutive += 1;
      if (i === 0 || t[i - 1] === ' ') score += 0.5;
      prevIdx = i;
      qi += 1;
    }
  }
  if (qi < q.length) return 0;
  return Math.min(0.85, (score + consecutive * 0.5) / (q.length * 2));
}

function excerpt(text, query, radius = 40) {
  // Excerpts are plain text: strip markdown markers so a chat excerpt
  // never shows raw ** or backticks.
  const clean = String(text || '').replace(/\*\*/g, '').replace(/__/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
  const idx = clean.toLowerCase().indexOf(String(query || '').trim().toLowerCase());
  if (idx === -1) return clean.slice(0, 80);
  const start = Math.max(0, idx - radius);
  const end = Math.min(clean.length, idx + String(query).length + radius);
  return (start > 0 ? '…' : '') + clean.slice(start, end) + (end < clean.length ? '…' : '');
}

// data: { conversations, tasks, notes } — plain arrays from the stores.
// Returns { chats: [], tasks: [], notes: [], total }.
export function searchAll(data, query) {
  const q = String(query || '').trim();
  const out = { chats: [], tasks: [], notes: [], total: 0 };
  if (!q) return out;

  for (const conv of data.conversations || []) {
    let best = fuzzyScore(q, conv.title || '');
    let snippet = conv.title || 'New chat';
    for (const m of conv.messages || []) {
      const s = fuzzyScore(q, m.text || '');
      if (s > best) {
        best = s;
        snippet = excerpt(m.text, q);
      }
    }
    if (best > 0) out.chats.push({ id: conv.id, title: conv.title || 'New chat', snippet, score: best });
  }

  for (const task of data.tasks || []) {
    const score = fuzzyScore(q, task.title || '');
    if (score > 0) out.tasks.push({ id: task.id, title: task.title, snippet: task.done ? 'Done' : 'Open', score });
  }

  for (const note of data.notes || []) {
    const best = Math.max(fuzzyScore(q, note.title || ''), fuzzyScore(q, note.text || ''));
    if (best > 0) {
      out.notes.push({
        id: note.id,
        title: note.title,
        snippet: excerpt(note.text, q),
        score: best,
      });
    }
  }

  for (const group of ['chats', 'tasks', 'notes']) {
    out[group].sort((a, b) => b.score - a.score);
    out[group] = out[group].slice(0, MAX_RESULTS_PER_GROUP);
  }
  out.total = out.chats.length + out.tasks.length + out.notes.length;
  return out;
}
