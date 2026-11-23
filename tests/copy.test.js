// Copy guard — Atlas's user-facing words must stay plain, human and
// free of AI-marketing clichés and decorative symbols. Atlas is a
// general-purpose everyday agent, not a study tool: no "study" or
// "learn" framing anywhere. Scans the visible text of index.html and
// every string literal in src/*.js, then asserts:
//   - no emoji or pictographic symbols anywhere
//   - no banned marketing words or retired phrasing
//   - no trace of the old Grok Replica identity
//   - no study/learning framing
// Run: npm test (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&middot;/g, '·')
    .replace(/\s+/g, ' ');
}

function stringLiterals(js) {
  const out = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(js)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out.join(' ');
}

const BANNED_WORDS = [
  'seamless', 'supercharge', 'elevate', 'unlock', 'revolutionize',
  'AI-powered', 'AI powered', 'cutting-edge', 'cutting edge',
  'game-changer', 'game changer', 'next-gen', 'next generation',
  'delve', 'tapestry', 'in today\'s fast-paced',
];

const BANNED_PHRASES = [
  'Atlas works with real tools',
  'then answers from the real results',
  'Every step Atlas takes, in the open',
  'in the open',
  'Nothing traced yet. Ask Atlas something',
];

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2728}\u{1F680}\u{1F525}]/u;

describe('copy guard', () => {
  const htmlText = visibleText(read('index.html'));
  const jsText = ['app.js', 'gemini.js', 'markdown.js', 'store.js', 'tools.js', 'agent.js', 'work.js', 'reminders.js', 'plans.js', 'search.js', 'slash.js', 'palette.js', 'voice.js', 'backup.js']
    .map((f) => stringLiterals(read(`src/${f}`)))
    .join(' ');
  const all = `${htmlText} ${jsText}`;

  it('has no emoji or decorative symbols in user-facing text', () => {
    assert.ok(!EMOJI_RE.test(all), `emoji/symbol found in: ${all.match(EMOJI_RE)?.[0]}`);
    assert.ok(!all.includes('✨'), 'sparkle found');
    assert.ok(!all.includes('🚀'), 'rocket found');
  });

  it('has no banned marketing words', () => {
    for (const word of BANNED_WORDS) {
      assert.ok(!all.toLowerCase().includes(word.toLowerCase()), `banned word present: ${word}`);
    }
  });

  it('has no retired product-selling phrases', () => {
    for (const phrase of BANNED_PHRASES) {
      assert.ok(!all.toLowerCase().includes(phrase.toLowerCase()), `retired phrase present: ${phrase}`);
    }
  });

  it('does not describe the product on the empty state', () => {
    assert.ok(!/It searches the web, checks the weather/.test(all), 'empty state still sells the product');
  });

  it('has no trace of the old Grok identity', () => {
    assert.ok(!/grok/i.test(all), 'Grok name present');
    assert.ok(!/xai/i.test(all), 'xAI present');
    assert.ok(!/study clone/i.test(all), 'study clone present');
  });

  it('has no study or learning framing', () => {
    assert.ok(!/\bstudy\b/i.test(all), 'study framing present');
    assert.ok(!/\bstudied\b/i.test(all), 'studied framing present');
    assert.ok(!/\blearn\b/i.test(all), 'learn framing present');
    assert.ok(!/\blearning\b/i.test(all), 'learning framing present');
  });

  it('is named Atlas and says what it does', () => {
    assert.ok(htmlText.includes('Atlas'), 'Atlas name missing from the page');
    assert.ok(/general-purpose/i.test(all), 'general-purpose description missing');
  });

  it('never promises a reply without a key', () => {
    assert.ok(!/demo reply|sample answer|try asking/i.test(all), 'copy hints at a fake reply');
  });

  it('is honest about mail: drafts only, never sent', () => {
    assert.ok(/cannot send mail/i.test(all), 'mail honesty line missing');
  });
});
