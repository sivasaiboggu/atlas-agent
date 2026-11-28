// Atlas — tests for slash commands, voice input, and backup/restore.
// Run: npm test (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SLASH_COMMANDS, parseSlash, matchSlashCommands } from '../src/slash.js';
import { createVoiceInput, isSpeechSupported } from '../src/voice.js';
import { buildBackup, validateBackup, parseBackup, BACKUP_APP, BACKUP_VERSION } from '../src/backup.js';

describe('slash commands', () => {
  it('lists all seven commands', () => {
    assert.deepEqual(SLASH_COMMANDS.map((c) => c.name), ['search', 'mail', 'task', 'note', 'weather', 'calc', 'file']);
  });

  it('parses "/search cats" into command + arg', () => {
    const out = parseSlash('/search cats and dogs');
    assert.equal(out.name, 'search');
    assert.equal(out.arg, 'cats and dogs');
    assert.equal(out.command.name, 'search');
    assert.equal(out.command.build('cats'), 'Search the web for cats');
  });

  it('builds plain requests for every command', () => {
    const built = Object.fromEntries(SLASH_COMMANDS.map((c) => [c.name, c.build('X')]));
    assert.equal(built.mail, 'Draft a mail to X');
    assert.equal(built.task, 'Add a task: X');
    assert.equal(built.note, 'Save a note titled "X"');
    assert.equal(built.weather, "What's the weather in X");
    assert.equal(built.calc, 'Calculate X');
    assert.equal(built.file, 'Summarise the attached file');
  });

  it('returns null for non-slash text and unknown commands', () => {
    assert.equal(parseSlash('hello'), null);
    assert.equal(parseSlash(''), null);
    const unknown = parseSlash('/dance now');
    assert.equal(unknown.name, 'dance');
    assert.equal(unknown.command, null);
  });

  it('matches commands by prefix for the menu', () => {
    assert.deepEqual(matchSlashCommands('s').map((c) => c.name), ['search']);
    assert.deepEqual(matchSlashCommands('').map((c) => c.name).length, 7);
    assert.deepEqual(matchSlashCommands('zzz'), []);
    assert.deepEqual(matchSlashCommands('MA').map((c) => c.name), ['mail']);
  });
});

describe('voice input', () => {
  it('reports unsupported when the browser has no SpeechRecognition', () => {
    const voice = createVoiceInput({ Recognition: undefined });
    assert.equal(voice.supported, false);
  });

  it('reports unsupported in Node (no window)', () => {
    assert.equal(isSpeechSupported(), false);
  });

  it('starts a fake recogniser and delivers interim then final text', () => {
    let instance = null;
    class FakeRecognition {
      constructor() { instance = this; this.started = false; }
      start() { this.started = true; }
      stop() { this.started = false; if (this.onend) this.onend(); }
    }
    const voice = createVoiceInput({ Recognition: FakeRecognition });
    assert.equal(voice.supported, true);
    const heard = [];
    let ended = false;
    const started = voice.start({
      onResult: (text, isFinal) => heard.push([text, isFinal]),
      onEnd: () => { ended = true; },
    });
    assert.equal(started, true);
    assert.equal(voice.listening, true);
    instance.onresult({ results: [{ 0: { transcript: 'hello' }, isFinal: false }] });
    instance.onresult({ results: [{ 0: { transcript: 'hello there' }, isFinal: true }] });
    assert.deepEqual(heard, [['hello', false], ['hello there', true]]);
    voice.stop();
    assert.equal(ended, true);
    assert.equal(voice.listening, false);
  });

  it('surfaces recogniser errors by code', () => {
    let instance = null;
    class FakeRecognition {
      constructor() { instance = this; }
      start() {}
      stop() {}
    }
    const voice = createVoiceInput({ Recognition: FakeRecognition });
    const errors = [];
    voice.start({ onError: (code) => errors.push(code) });
    instance.onerror({ error: 'not-allowed' });
    assert.deepEqual(errors, ['not-allowed']);
    assert.equal(voice.listening, false);
  });
});

describe('backup and restore', () => {
  const sample = () => ({
    state: {
      settings: { apiKey: 'SECRET-KEY', model: 'gemini-2.5-pro', theme: 'light' },
      conversations: [{ id: 'c1', title: 'Hi', messages: [] }],
      activeId: 'c1',
    },
    tasks: [{ id: 't1', title: 'Call Mum', done: false }],
    notes: [{ id: 'n1', title: 'Note', text: 'body' }],
    reminders: [{ id: 'r1', what: 'Call', at: 123, status: 'pending' }],
    plans: [{ id: 'p1', title: 'Plan', steps: [] }],
  });

  it('exports everything except the API key', () => {
    const backup = buildBackup(sample());
    assert.equal(backup.app, BACKUP_APP);
    assert.equal(backup.version, BACKUP_VERSION);
    assert.ok(backup.exportedAt);
    assert.equal(backup.state.settings.model, 'gemini-2.5-pro');
    assert.equal(backup.state.settings.theme, 'light');
    assert.equal(backup.state.settings.apiKey, undefined, 'the key must never be in a backup');
    assert.equal(JSON.stringify(backup).includes('SECRET-KEY'), false);
    assert.equal(backup.tasks.length, 1);
    assert.equal(backup.reminders.length, 1);
    assert.equal(backup.plans.length, 1);
  });

  it('falls back to the current default model when the state has none', () => {
    const backup = buildBackup({ state: { settings: {}, conversations: [], activeId: null }, tasks: [], notes: [], reminders: [], plans: [] });
    assert.equal(backup.state.settings.model, 'gemini-3.8-flash');
  });

  it('round-trips: export then parse validates', () => {
    const text = JSON.stringify(buildBackup(sample()));
    const parsed = parseBackup(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.state.conversations[0].id, 'c1');
    assert.equal(parsed.data.tasks[0].title, 'Call Mum');
  });

  it('rejects bad files without touching anything', () => {
    assert.equal(parseBackup('not json').ok, false);
    assert.equal(parseBackup('{"app":"other","version":1}').ok, false);
    assert.equal(parseBackup(JSON.stringify({ app: BACKUP_APP, version: 99, state: { conversations: [] } })).ok, false);
    assert.equal(parseBackup(JSON.stringify({ app: BACKUP_APP, version: 1, state: {} })).ok, false);
    assert.equal(parseBackup(JSON.stringify({ app: BACKUP_APP, version: 1, state: { conversations: [] }, tasks: 'nope' })).ok, false);
    assert.equal(validateBackup(null).ok, false);
    assert.equal(validateBackup([]).ok, false);
  });

  it('tolerates missing optional sections', () => {
    const parsed = parseBackup(JSON.stringify({ app: BACKUP_APP, version: 1, state: { conversations: [] } }));
    assert.equal(parsed.ok, true);
  });
});
