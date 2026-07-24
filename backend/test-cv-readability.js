'use strict';
/**
 * Tests for cv-readability.js.
 * The two MUST-CATCH cases are the real shattered signatures we observed.
 * The three MUST-NOT-FLAG cases are clean CVs that have to keep working.
 *
 *   node test-cv-readability.js
 */
const assert = require('assert');
const { assessCvReadability } = require('./cv-readability');

let passed = 0;
const ok = (label) => { console.log('  PASS  ' + label); passed += 1; };

// ---- MUST CATCH 1: the ~90% single-glyph shattered Urdu (probe-sections signature) ----
(() => {
  const glyphs = 'ک ن ی ب ہ ت ص خ ڈ پ ح ج ش'.split(' ');
  const lines = [];
  for (let i = 0; i < 700; i += 1) lines.push(glyphs[i % glyphs.length]); // 700 single-glyph lines
  lines.push('ص خ لاصہ');           // a couple of scrambled multi-glyph lines
  lines.push('ب ل ق ا ی ی م ق عل');
  const parsed = { customSections: [], skills: [], projects: [] };
  const r = assessCvReadability(lines.join('\n'), parsed);
  assert.strictEqual(r.unreadable, true, 'shattered Urdu must be unreadable');
  assert.strictEqual(r.reason, 'shattered-glyphs', 'reason = shattered-glyphs');
  ok('MUST-CATCH shattered Urdu (~90% single-glyph) -> unreadable (' + r.singleGlyphRatio + ')');
})();

// ---- MUST CATCH 2a: heavy shatter, Arabic-dominant (real 782-line signature) — caught by signal 1 ----
(() => {
  const glyphs = 'ک ن ی ب ہ ت ص خ'.split(' ');
  const lines = [];
  for (let i = 0; i < 200; i += 1) lines.push(glyphs[i % glyphs.length]); // Arabic dominates char count
  // a few clean Latin contact lines — these must NOT rescue a destroyed Urdu doc
  lines.push('ayesha.siddiqui.mkt@gmail.com +92 321 9876543');
  lines.push('https://linkedin.com/in/ayeshasiddiqui');
  const parsed = { customSections: [], skills: [], projects: [] };
  const r = assessCvReadability(lines.join('\n'), parsed);
  assert.strictEqual(r.unreadable, true, 'heavy shatter must be unreadable');
  assert.strictEqual(r.dominantScript, 'arabic', 'Arabic dominates despite Latin URLs');
  ok('MUST-CATCH heavy Arabic shatter (Latin URLs present) -> unreadable (reason=' + r.reason + ', arabic-dominant)');
})();

// ---- MUST CATCH 2b: MODERATE shatter (low single-glyph ratio) but 0 Urdu words + 0 structure — signal 3 ----
(() => {
  const lines = [];
  // scrambled Arabic: each line is 2-3 space-separated single glyphs => NOT single-glyph lines,
  // and NO run of 3+ connected Arabic letters => zero real words.
  const frags = ['ص خ', 'ی ک ن', 'ت ہ', 'ب ص ی', 'خ ن', 'ک ی ت'];
  for (let i = 0; i < 30; i += 1) lines.push(frags[i % frags.length]);
  lines.push('ayeshasiddiqui.com'); // short latin, kept below arabic char count
  const parsed = { customSections: [], skills: [], projects: [] };
  const r = assessCvReadability(lines.join('\n'), parsed);
  assert.ok(r.singleGlyphRatio < 0.35, 'this case must NOT trip signal 1 (ratio=' + r.singleGlyphRatio + ')');
  assert.strictEqual(r.unreadable, true, 'Arabic-dominant, 0 words, 0 structure must be unreadable');
  assert.strictEqual(r.reason, 'no-words-no-structure', 'caught by the no-words signal');
  ok('MUST-CATCH moderate shatter via signal 3 (0 words, 0 structure) -> unreadable');
})();

// ---- MUST NOT FLAG 1: a clean English CV with real content ----
(() => {
  const text = [
    'Ayesha Siddiqui', 'Marketing Manager',
    'Summary', 'Experienced marketing manager with eight years leading digital campaigns.',
    'Skills', 'SEO, content strategy, analytics, paid social, brand positioning',
    'Experience', 'Led a team of ten across three product lines and grew revenue.',
    'Education', 'BBA in Marketing, 2016',
  ].join('\n');
  const parsed = { customSections: [{ name: 'Experience', items: ['x'] }], skills: ['SEO', 'analytics'], projects: [] };
  const r = assessCvReadability(text, parsed);
  assert.strictEqual(r.unreadable, false, 'clean English CV must NOT be flagged');
  ok('MUST-NOT-FLAG clean English CV -> readable');
})();

// ---- MUST NOT FLAG 2: clean English text with UNUSUAL headings (parser found 0 sections) ----
// The safety net must not punish a readable CV just because headings were not recognised.
(() => {
  const text = [
    'Ayesha Siddiqui', 'Marketing Manager based in Karachi',
    'My professional journey spans nearly a decade of building brands and leading campaigns.',
    'I have managed cross functional teams and delivered measurable growth across markets.',
    'Tooling I rely on includes analytics platforms, content systems and social schedulers.',
    'Recent highlights include a relaunch that lifted engagement substantially.',
  ].join('\n');
  const parsed = { customSections: [], skills: [], projects: [] }; // parser found no sections
  const r = assessCvReadability(text, parsed);
  assert.strictEqual(r.unreadable, false, 'readable English prose with 0 sections must NOT be flagged');
  ok('MUST-NOT-FLAG readable English, 0 detected sections -> readable (words=' + r.dominantWords + ')');
})();

// ---- MUST NOT FLAG 3: a clean Urdu CV (good PDF: connected Urdu words) ----
(() => {
  const text = [
    'عائشہ صدیقی', 'مارکیٹنگ مینیجر',
    'خلاصہ', 'تجربہ کار مارکیٹنگ مینیجر جو ڈیجیٹل مہمات کی قیادت کرتی ہیں',
    'مہارتیں', 'ڈیجیٹل مارکیٹنگ، مواد کی حکمت عملی، تجزیات',
    'تعلیم', 'مارکیٹنگ میں بی بی اے',
  ].join('\n');
  const parsed = { customSections: [{ name: 'skills', items: ['x'] }], skills: [], projects: [] };
  const r = assessCvReadability(text, parsed);
  assert.strictEqual(r.unreadable, false, 'clean Urdu CV must NOT be flagged');
  assert.strictEqual(r.dominantScript, 'arabic', 'dominant arabic');
  ok('MUST-NOT-FLAG clean Urdu CV -> readable (arabic words=' + r.dominantWords + ')');
})();

// ---- edge: empty text ----
(() => {
  const r = assessCvReadability('', { customSections: [], skills: [], projects: [] });
  assert.strictEqual(r.unreadable, true, 'empty -> unreadable');
  assert.strictEqual(r.reason, 'empty', 'reason=empty');
  ok('edge empty text -> unreadable');
})();

console.log('\n  ALL ' + passed + ' CHECKS PASSED');
