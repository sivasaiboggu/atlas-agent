// Atlas — tests for the tasks and notes stores.
// Run: npm test (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTaskStore, createNoteStore, TASKS_KEY, NOTES_KEY } from '../src/work.js';

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

describe('task store', () => {
  it('adds a task and lists open tasks first', () => {
    const store = createTaskStore(memoryStorage());
    const a = store.add('Call the bank');
    const b = store.add('Buy milk');
    assert.equal(a.duplicate, false);
    assert.equal(store.list().length, 2);
    store.complete(b.task.id);
    const listed = store.list();
    assert.equal(listed[0].title, 'Call the bank');
    assert.equal(listed[1].done, true);
  });

  it('does not add the same open task twice', () => {
    const store = createTaskStore(memoryStorage());
    store.add('Call the bank');
    const dup = store.add('  CALL THE BANK ');
    assert.equal(dup.duplicate, true);
    assert.equal(store.list().length, 1);
    store.complete(dup.task.id);
    const again = store.add('Call the bank');
    assert.equal(again.duplicate, false, 'a completed task can be added again');
    assert.equal(store.list().length, 2);
  });

  it('rejects empty titles and unknown ids', () => {
    const store = createTaskStore(memoryStorage());
    assert.equal(store.add('   ').task, null);
    assert.equal(store.complete('nope'), null);
    assert.equal(store.remove('nope'), false);
  });

  it('removes a task', () => {
    const store = createTaskStore(memoryStorage());
    const { task } = store.add('Temp');
    assert.equal(store.remove(task.id), true);
    assert.equal(store.list().length, 0);
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const store = createTaskStore(storage);
    store.add('Persist me');
    const loaded = createTaskStore(storage);
    assert.equal(loaded.list().length, 1);
    assert.equal(loaded.list()[0].title, 'Persist me');
    assert.ok(storage.getItem(TASKS_KEY).includes('Persist me'));
  });
});

describe('note store', () => {
  it('adds and lists notes newest first', () => {
    const store = createNoteStore(memoryStorage());
    const a = store.add('First', 'text one');
    const b = store.add('Second', 'text two');
    assert.ok(a && b);
    const listed = store.list();
    assert.equal(listed.length, 2);
    assert.equal(listed[0].title, 'Second');
  });

  it('rejects empty notes', () => {
    const store = createNoteStore(memoryStorage());
    assert.equal(store.add('', 'text'), null);
    assert.equal(store.add('Title', '   '), null);
    assert.equal(store.list().length, 0);
  });

  it('searches titles and text, case-insensitive', () => {
    const store = createNoteStore(memoryStorage());
    store.add('Bank', 'Call on Monday about the loan.');
    store.add('Shopping', 'Buy milk and bread.');
    assert.equal(store.search('LOAN').length, 1);
    assert.equal(store.search('bank').length, 1);
    assert.equal(store.search('pizza').length, 0);
    assert.equal(store.search('').length, 2);
  });

  it('gets and removes a note by id', () => {
    const store = createNoteStore(memoryStorage());
    const note = store.add('Keep', 'keep me');
    assert.equal(store.get(note.id).title, 'Keep');
    assert.equal(store.get('nope'), null);
    assert.equal(store.remove(note.id), true);
    assert.equal(store.list().length, 0);
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const store = createNoteStore(storage);
    store.add('Persist', 'persisted text');
    const loaded = createNoteStore(storage);
    assert.equal(loaded.list().length, 1);
    assert.ok(storage.getItem(NOTES_KEY).includes('persisted text'));
  });
});
