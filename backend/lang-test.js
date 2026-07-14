'use strict';
const assert = require('assert');
const { __test } = require('./server.js');
const { hasUnexpectedScriptForLanguage: badScript, requiresNonLatinScript: needsNonLatin,
        hasRequiredScript: hasReq, looksLikeWrongEnglishForTarget: wrongEnglish,
        normalizeServerOutputLanguage: normLang, languageFamily: fam } = __test;

let pass = 0, fail = 0;
function check(n, f){ try{ f(); pass++; console.log('  PASS  '+n);}catch(e){ fail++; console.log('  FAIL  '+n+'\n        '+e.message);} }

console.log('\n== Language-lock gate ==');

// The gate must FLAG wrong-language output and PASS correct-language output.
check('English target: English text passes', () => {
  assert.strictEqual(badScript('I build clean web apps and design tools.', 'English'), false);
});
check('Urdu target requires non-Latin script', () => {
  assert.strictEqual(needsNonLatin('Urdu'), true);
});
check('Urdu target: plain English body is flagged as wrong', () => {
  // English sentence under an Urdu target should NOT satisfy the required script
  assert.strictEqual(hasReq('I build web apps', 'Urdu'), false);
});
check('Urdu target: Urdu script satisfies required script', () => {
  assert.strictEqual(hasReq('میں ویب ایپس بناتا ہوں', 'Urdu'), true);
});
check('Arabic target: Arabic script is accepted, Latin is not required-satisfying', () => {
  assert.strictEqual(hasReq('أنا مصمم ومطور', 'Arabic'), true);
  assert.strictEqual(hasReq('I am a developer', 'Arabic'), false);
});
check('Chinese target: Chinese passes required-script, English does not', () => {
  assert.strictEqual(hasReq('我是一名开发者', 'Chinese'), true);
  assert.strictEqual(hasReq('I am a developer', 'Chinese'), false);
});
check('Russian target: Cyrillic vs Latin', () => {
  assert.strictEqual(hasReq('Я разработчик', 'Russian'), true);
  assert.strictEqual(hasReq('I am a developer', 'Russian'), false);
});
check('Wrong-script detection: Arabic text under English target is flagged', () => {
  assert.strictEqual(badScript('أنا مطور برمجيات', 'English'), true);
});
check('normalizeServerOutputLanguage returns a usable language string', () => {
  const v = normLang('Urdu');
  assert.ok(typeof v === 'string' && v.length > 0);
});
check('languageFamily maps script languages correctly', () => {
  assert.strictEqual(fam('Urdu'), 'urdu');
  assert.strictEqual(fam('Chinese'), 'chinese');
  assert.strictEqual(fam('English'), 'english');
});

console.log(`\n${pass} passed, ${fail} failed.\n`);
process.exitCode = fail ? 1 : 0;
