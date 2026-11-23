// Atlas — tests for reminders: plain-words parsing, the store, due checks.
// Run: npm test (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseReminder, parseTimeOfDay, formatReminderTime,
  createReminderStore, REMINDERS_KEY,
} from '../src/reminders.js';

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

const noon = new Date(2026, 10, 23, 12, 0, 0); // Mon 23 Nov 2026, 12:00

describe('parseTimeOfDay', () => {
  it('parses 12-hour and 24-hour times', () => {
    assert.deepEqual(parseTimeOfDay('3pm'), { hours: 15, minutes: 0 });
    assert.deepEqual(parseTimeOfDay('3:30pm'), { hours: 15, minutes: 30 });
    assert.deepEqual(parseTimeOfDay('9 am'), { hours: 9, minutes: 0 });
    assert.deepEqual(parseTimeOfDay('12am'), { hours: 0, minutes: 0 });
    assert.deepEqual(parseTimeOfDay('12pm'), { hours: 12, minutes: 0 });
    assert.deepEqual(parseTimeOfDay('15:30'), { hours: 15, minutes: 30 });
    assert.deepEqual(parseTimeOfDay('9'), { hours: 9, minutes: 0 });
  });

  it('rejects nonsense times', () => {
    assert.equal(parseTimeOfDay('25:00'), null);
    assert.equal(parseTimeOfDay('3:99pm'), null);
    assert.equal(parseTimeOfDay('13pm'), null);
    assert.equal(parseTimeOfDay('soon'), null);
    assert.equal(parseTimeOfDay(''), null);
  });
});

describe('parseReminder', () => {
  it('parses "remind me to X at 3pm" later today', () => {
    const out = parseReminder('remind me to call Mum at 3pm', noon);
    assert.equal(out.ok, true);
    assert.equal(out.what, 'call Mum');
    const d = new Date(out.at);
    assert.equal(d.getHours(), 15);
    assert.equal(d.getDate(), 23);
  });

  it('rolls a past time today over to tomorrow', () => {
    const out = parseReminder('remind me to call Mum at 9am', noon);
    assert.equal(out.ok, true);
    const d = new Date(out.at);
    assert.equal(d.getDate(), 24);
    assert.equal(d.getHours(), 9);
  });

  it('parses "remind me in 20 minutes to X"', () => {
    const out = parseReminder('remind me in 20 minutes to stretch', noon);
    assert.equal(out.ok, true);
    assert.equal(out.what, 'stretch');
    assert.equal(out.at, noon.getTime() + 20 * 60 * 1000);
  });

  it('parses "remind me in 2 hours to X"', () => {
    const out = parseReminder('Remind me in 2 hours to send the mail', noon);
    assert.equal(out.ok, true);
    assert.equal(out.at, noon.getTime() + 2 * 60 * 60 * 1000);
  });

  it('parses "tomorrow at 9am" and bare "tomorrow" (9:00)', () => {
    const a = parseReminder('remind me to water the plants tomorrow at 9am', noon);
    assert.equal(a.ok, true);
    assert.equal(new Date(a.at).getDate(), 24);
    assert.equal(new Date(a.at).getHours(), 9);
    const b = parseReminder('remind me to water the plants tomorrow', noon);
    assert.equal(b.ok, true);
    assert.equal(new Date(b.at).getDate(), 24);
    assert.equal(new Date(b.at).getHours(), 9);
  });

  it('parses 24-hour times', () => {
    const out = parseReminder('remind me to check the oven at 18:30', noon);
    assert.equal(out.ok, true);
    assert.equal(new Date(out.at).getHours(), 18);
    assert.equal(new Date(out.at).getMinutes(), 30);
  });

  it('rejects non-reminders and unparseable times with plain reasons', () => {
    assert.equal(parseReminder('what time is it', noon).ok, false);
    const bad = parseReminder('remind me to call Mum at tea time', noon);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /3pm|20 minutes/);
    const empty = parseReminder('remind me to  at 3pm', noon);
    assert.equal(empty.ok, false);
  });
});

describe('formatReminderTime', () => {
  it('labels today, tomorrow and later dates', () => {
    assert.equal(formatReminderTime(new Date(2026, 10, 23, 15, 30).getTime(), noon.getTime()), 'Today 15:30');
    assert.equal(formatReminderTime(new Date(2026, 10, 24, 9, 0).getTime(), noon.getTime()), 'Tomorrow 09:00');
    assert.match(formatReminderTime(new Date(2026, 10, 27, 9, 0).getTime(), noon.getTime()), /Fri, Nov 27 09:00/);
    assert.equal(formatReminderTime(new Date(2026, 10, 23, 11, 0).getTime(), noon.getTime()), 'Due now');
  });
});

describe('reminder store', () => {
  it('adds, lists soonest first, and reports due ones', () => {
    const store = createReminderStore(memoryStorage());
    const a = store.add('Later', noon.getTime() + 3600_000);
    const b = store.add('Sooner', noon.getTime() + 600_000);
    assert.ok(a && b);
    assert.equal(store.list()[0].what, 'Sooner');
    assert.equal(store.upcoming(noon.getTime()).length, 2);
    assert.equal(store.due(noon.getTime() + 601_000).length, 1);
    assert.equal(store.due(noon.getTime() + 601_000).length, 0, 'a fired reminder does not fire twice');
    assert.equal(store.list().length, 2, 'fired reminders stay listed until dismissed');
  });

  it('removes (dismisses) a reminder', () => {
    const store = createReminderStore(memoryStorage());
    const r = store.add('Temp', noon.getTime() + 1000);
    assert.equal(store.remove(r.id), true);
    assert.equal(store.list().length, 0);
    assert.equal(store.remove('nope'), false);
  });

  it('rejects empty reminders and round-trips through storage', () => {
    const storage = memoryStorage();
    const store = createReminderStore(storage);
    assert.equal(store.add('   ', noon.getTime()), null);
    store.add('Persist me', noon.getTime() + 1000);
    const loaded = createReminderStore(storage);
    assert.equal(loaded.list().length, 1);
    assert.ok(storage.getItem(REMINDERS_KEY).includes('Persist me'));
  });
});
