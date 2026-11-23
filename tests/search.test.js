// Atlas — tests for search everywhere and the command palette.
// Run: npm test (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fuzzyScore, searchAll } from '../src/search.js';
import { buildPaletteItems, flattenPalette, moveSelection, PALETTE_ACTIONS } from '../src/palette.js';

const DATA = {
  conversations: [
    { id: 'c1', title: 'RustLabs follow-up', updatedAt: 3, messages: [{ text: 'Draft a mail to RustLabs about the security role' }] },
    { id: 'c2', title: 'Weather check', updatedAt: 2, messages: [{ text: "What's the weather in Hyderabad today?" }] },
    { id: 'c3', title: 'Groceries', updatedAt: 1, messages: [{ text: 'Buy milk and bread' }] },
  ],
  tasks: [
    { id: 't1', title: 'Reply to the RustLabs mail', done: false },
    { id: 't2', title: 'Finish the insiderOne skill checks', done: false },
    { id: 't3', title: 'Send the morning job applications', done: true },
  ],
  notes: [
    { id: 'n1', title: 'RustLabs', text: 'Remote AI Security Engineer, $20/hr.' },
    { id: 'n2', title: 'Neon rotation', text: 'Reset the SecureFlow Neon database password.' },
  ],
};

describe('fuzzyScore', () => {
  it('scores exact phrases highest', () => {
    assert.ok(fuzzyScore('rust', 'RustLabs') > fuzzyScore('rsl', 'RustLabs'));
    assert.ok(fuzzyScore('rust', 'RustLabs') >= 0.9);
    assert.equal(fuzzyScore('rust', 'Groceries'), 0);
    assert.equal(fuzzyScore('', 'anything'), 0);
  });

  it('matches subsequences in order, not out of order', () => {
    assert.ok(fuzzyScore('rl', 'RustLabs') > 0);
    assert.equal(fuzzyScore('lr', 'RustLabs'), 0);
  });

  it('is case-insensitive', () => {
    assert.ok(fuzzyScore('RUSTLABS', 'rustlabs follow-up') >= 0.9);
  });
});

describe('searchAll', () => {
  it('finds chats by title and by message text', () => {
    const out = searchAll(DATA, 'rustlabs');
    assert.equal(out.chats.length, 1);
    assert.equal(out.chats[0].id, 'c1');
    assert.equal(out.tasks.length, 1);
    assert.equal(out.tasks[0].id, 't1');
    assert.equal(out.notes.length, 1);
    assert.equal(out.notes[0].id, 'n1');
    assert.equal(out.total, 3);
  });

  it('finds a chat by message text even when the title does not match', () => {
    const out = searchAll(DATA, 'hyderabad');
    assert.equal(out.chats.length, 1);
    assert.equal(out.chats[0].id, 'c2');
    assert.match(out.chats[0].snippet, /Hyderabad/);
  });

  it('finds notes by body text', () => {
    const out = searchAll(DATA, 'password');
    assert.equal(out.notes.length, 1);
    assert.equal(out.notes[0].id, 'n2');
  });

  it('returns nothing for a query with no matches, and nothing for empty queries', () => {
    assert.equal(searchAll(DATA, 'zanzibar').total, 0);
    assert.equal(searchAll(DATA, '').total, 0);
    assert.equal(searchAll(DATA, '   ').total, 0);
  });

  it('caps each group at 5 results', () => {
    const many = { conversations: [], tasks: [], notes: [] };
    for (let i = 0; i < 8; i += 1) many.tasks.push({ id: `t${i}`, title: `Call the bank ${i}`, done: false });
    assert.equal(searchAll(many, 'bank').tasks.length, 5);
  });
});

describe('buildPaletteItems', () => {
  it('shows actions, recent chats and open tasks with an empty query', () => {
    const groups = buildPaletteItems(DATA, '');
    const actions = groups.find((g) => g.group === 'Actions');
    assert.ok(actions.items.length >= PALETTE_ACTIONS.length);
    const chats = groups.find((g) => g.group === 'Recent chats');
    assert.equal(chats.items[0].id, 'c1', 'most recent chat first');
    const tasks = groups.find((g) => g.group === 'Open tasks');
    assert.equal(tasks.items.length, 2, 'done tasks are not shown');
  });

  it('filters everything by query, with counts in the group names', () => {
    const groups = buildPaletteItems(DATA, 'rustlabs');
    assert.ok(groups.some((g) => g.group === 'Chats (1)'));
    assert.ok(groups.some((g) => g.group === 'Tasks (1)'));
    assert.ok(groups.some((g) => g.group === 'Notes (1)'));
    const actions = groups.find((g) => g.group === 'Actions');
    assert.ok(!actions || actions.items.every((a) => /rust/i.test(a.label + a.hint)) || actions.items.length === 0);
  });

  it('returns no groups when nothing matches', () => {
    assert.deepEqual(buildPaletteItems(DATA, 'zanzibar'), []);
  });
});

describe('flattenPalette + moveSelection', () => {
  it('flattens groups in order', () => {
    const groups = buildPaletteItems(DATA, '');
    const flat = flattenPalette(groups);
    assert.ok(flat.length > 0);
    assert.equal(flat[0].group, 'Actions');
  });

  it('wraps arrow-key selection around the list', () => {
    assert.equal(moveSelection(-1, 1, 5), 0);
    assert.equal(moveSelection(-1, -1, 5), 4);
    assert.equal(moveSelection(4, 1, 5), 0);
    assert.equal(moveSelection(0, -1, 5), 4);
    assert.equal(moveSelection(2, 1, 5), 3);
    assert.equal(moveSelection(0, 1, 0), -1);
  });
});
