// Atlas — tests for mission plans: step labels, the store, progress.
// Run: npm test (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  planStepLabel, planProgress, createPlanStore, PLANS_KEY,
} from '../src/plans.js';

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

describe('planStepLabel', () => {
  it('labels each tool in plain words', () => {
    assert.equal(planStepLabel('web_search', { query: 'RustLabs' }), 'Search the web for "RustLabs"');
    assert.equal(planStepLabel('get_weather', { place: 'Hyderabad' }), 'Weather in Hyderabad');
    assert.equal(planStepLabel('draft_email', { to: 'a@b.com' }), 'Draft a mail to a@b.com');
    assert.equal(planStepLabel('calculate', { expression: '2 + 2' }), 'Work out 2 + 2');
    assert.equal(planStepLabel('read_file', {}), 'Read the attached file');
    assert.equal(planStepLabel('tasks', { action: 'add', title: 'Call Mum' }), 'Add task: Call Mum');
    assert.equal(planStepLabel('notes', { action: 'search', query: 'rent' }), 'Search notes for "rent"');
    assert.equal(planStepLabel('fetch_page', { url: 'https://example.com/a-very-long-path-that-keeps-going' }), 'Read https://example.com/a-very-long-path-that-keeps-going');
    assert.equal(planStepLabel('mystery_tool', {}), 'mystery_tool');
  });
});

describe('plan store', () => {
  it('creates a plan, adds steps, and reports progress', () => {
    const store = createPlanStore(memoryStorage());
    const plan = store.create({ title: 'Check the weather and draft a mail', chatId: 'c1', msgIndex: 1 });
    assert.ok(plan.id);
    assert.equal(plan.steps.length, 0);
    const s1 = store.addStep(plan.id, 'Weather in Hyderabad', 'get_weather');
    const s2 = store.addStep(plan.id, 'Draft a mail to a@b.com', 'draft_email');
    assert.deepEqual(planProgress(plan), { done: 0, total: 2 });
    store.setStepStatus(plan.id, s1.id, 'running');
    store.setStepStatus(plan.id, s1.id, 'done');
    store.setStepStatus(plan.id, s2.id, 'failed');
    assert.deepEqual(planProgress(store.get(plan.id)), { done: 2, total: 2 });
    assert.equal(store.get(plan.id).steps[1].status, 'failed');
  });

  it('lists newest first and removes plans', () => {
    const store = createPlanStore(memoryStorage());
    const a = store.create({ title: 'First' });
    const b = store.create({ title: 'Second' });
    assert.equal(store.list()[0].id, b.id);
    assert.equal(store.setStepStatus('nope', 'nope', 'done'), null);
    assert.equal(store.addStep('nope', 'x', 'calculate'), null);
    assert.equal(store.remove(a.id), true);
    assert.equal(store.list().length, 1);
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const store = createPlanStore(storage);
    const plan = store.create({ title: 'Persist me' });
    store.addStep(plan.id, 'Work out 2 + 2', 'calculate');
    const loaded = createPlanStore(storage);
    assert.equal(loaded.list().length, 1);
    assert.equal(loaded.list()[0].steps.length, 1);
    assert.ok(storage.getItem(PLANS_KEY).includes('Persist me'));
  });
});
