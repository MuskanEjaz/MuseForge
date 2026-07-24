'use strict';
/**
 * Tests for project-suggestions.js.  node test-project-suggestions.js
 */
const assert = require('assert');
const { buildSuggestionMessages, parseSuggestionsFromAiText, normalizeSuggestions } = require('./project-suggestions');

let passed = 0;
const ok = (l) => { console.log('  PASS  ' + l); passed += 1; };

// ---- buildSuggestionMessages ----
(() => {
  const msgs = buildSuggestionMessages({
    name: 'Ayesha', medium: 'Marketing Manager', description: 'Eight years in digital campaigns.',
    projects: [{ title: 'Zenith Relaunch' }], targetLanguage: 'Urdu', aiTone: 'Confident',
  });
  assert.strictEqual(msgs.length, 2, 'two messages');
  assert.strictEqual(msgs[0].role, 'system', 'first is system');
  assert.strictEqual(msgs[1].role, 'user', 'second is user');
  assert.ok(/Urdu/.test(msgs[0].content), 'target language in prompt');
  assert.ok(/Confident/.test(msgs[0].content), 'tone in prompt');
  assert.ok(/no-fabrication|invent nothing|Do NOT invent/i.test(msgs[0].content), 'FactLock instruction present');
  assert.ok(/Zenith Relaunch/.test(msgs[0].content), 'existing projects passed to avoid duplicates');
  assert.ok(/Ayesha/.test(msgs[1].content) && /Marketing Manager/.test(msgs[1].content), 'creator context in user msg');
  ok('buildSuggestionMessages: language, tone, FactLock, avoid-list, context');
})();

// ---- parseSuggestionsFromAiText ----
(() => {
  const pure = '[{"title":"A","desc":"da"},{"title":"B","desc":"db"}]';
  assert.deepStrictEqual(parseSuggestionsFromAiText(pure), [{ title: 'A', desc: 'da' }, { title: 'B', desc: 'db' }], 'pure JSON');
  ok('parse pure JSON array');

  const fenced = '```json\n[{"title":"A","desc":"da"}]\n```';
  assert.deepStrictEqual(parseSuggestionsFromAiText(fenced), [{ title: 'A', desc: 'da' }], 'fenced JSON');
  ok('parse fenced ```json block');

  const preamble = 'Here are three ideas:\n[{"title":"A","desc":"da"}]\nHope that helps!';
  assert.deepStrictEqual(parseSuggestionsFromAiText(preamble), [{ title: 'A', desc: 'da' }], 'preamble/suffix stripped');
  ok('parse JSON with surrounding prose');

  const variantKeys = '[{"name":"A","description":"da"}]';
  assert.deepStrictEqual(parseSuggestionsFromAiText(variantKeys), [{ title: 'A', desc: 'da' }], 'name/description keys accepted');
  ok('parse tolerant of name/description key variants');

  assert.deepStrictEqual(parseSuggestionsFromAiText('sorry, no JSON here'), [], 'garbage -> []');
  assert.deepStrictEqual(parseSuggestionsFromAiText('[not valid json'), [], 'broken -> []');
  assert.deepStrictEqual(parseSuggestionsFromAiText(''), [], 'empty -> []');
  ok('parse returns [] on unparseable input (so route falls back)');
})();

// ---- normalizeSuggestions ----
(() => {
  const n = normalizeSuggestions([{ title: 'A', desc: 'da' }, { title: 'B', desc: 'db' }, { title: 'C', desc: 'dc' }, { title: 'D', desc: 'dd' }]);
  assert.strictEqual(n.length, 3, 'capped at 3');
  assert.ok(n.every(s => typeof s.id === 'string' && s.id.length > 0), 'every item has an id');
  assert.ok(n.every(s => s.title && typeof s.desc === 'string'), 'title + desc present');
  const ids = new Set(n.map(s => s.id));
  assert.strictEqual(ids.size, 3, 'ids are unique');
  ok('normalize caps to 3, adds unique ids, keeps title/desc');

  const dropped = normalizeSuggestions([{ title: '', desc: '' }, { title: 'Real', desc: '' }]);
  assert.strictEqual(dropped.length, 1, 'empty items dropped');
  assert.strictEqual(dropped[0].title, 'Real', 'kept the real one');
  ok('normalize drops empty items');

  // works directly on the fallbackProjectSuggestions shape ([{title, desc}])
  const fb = normalizeSuggestions([{ title: 'Flagship Build', desc: 'Show one strong project.' }]);
  assert.strictEqual(fb.length, 1, 'fallback shape normalizes');
  assert.ok(fb[0].id && fb[0].title === 'Flagship Build', 'fallback item gets an id');
  ok('normalize works on fallbackProjectSuggestions output');
})();

console.log('\n  ALL ' + passed + ' CHECKS PASSED');
