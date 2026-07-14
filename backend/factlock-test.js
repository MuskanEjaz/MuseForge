'use strict';
const assert = require('assert');
const { __test } = require('./server.js');
const {
  candidateChangesOriginalFacts,
  regenerationIsStrongEnough,
  buildLocalStrongProjectRegeneration,
  importantOriginalAnchors,
} = __test;

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}
const EN = { targetLanguage: 'English' };

console.log('\n== FactLock: fake-fact detection (must BLOCK fabrication) ==');

check('BLOCKS a fabricated user count', () => {
  const original = 'I built a to-do app in React.';
  const fake = 'I built a to-do app in React that is used by over 5000 daily active users.';
  assert.strictEqual(candidateChangesOriginalFacts(original, fake, EN), true);
});

check('BLOCKS a fabricated award/win', () => {
  const original = 'I created a poster series for a college event.';
  const fake = 'I created an award-winning poster series that won first prize at a national competition.';
  assert.strictEqual(candidateChangesOriginalFacts(original, fake, EN), true);
});

check('BLOCKS a domain switch (music -> code)', () => {
  const original = 'I produced a short music track for a friend.';
  const fake = 'I developed a full-stack web application using React and Node.js.';
  assert.strictEqual(candidateChangesOriginalFacts(original, fake, EN), true);
});

check('BLOCKS dropping/altering an original number', () => {
  const original = 'I completed 3 freelance design projects.';
  const altered = 'I completed several freelance design projects with great care and consistency for clients.';
  assert.strictEqual(candidateChangesOriginalFacts(original, altered, EN), true);
});

console.log('\n== FactLock: faithful rewrites (must ALLOW) ==');

check('ALLOWS a faithful expansion with no new facts', () => {
  const original = 'I built a to-do app in React.';
  const faithful = 'I built a to-do app in React, focusing on a clean interface and making everyday task tracking simple and reliable.';
  assert.strictEqual(candidateChangesOriginalFacts(original, faithful, EN), false);
});

check('ALLOWS a faithful rewrite that keeps the number', () => {
  const original = 'I completed 3 freelance design projects.';
  // faithful: keeps the number, adds NO new domain noun (no "client", "award", etc.)
  const faithful = 'I completed 3 freelance design projects, and I put real effort into each one to keep the work polished, consistent, and presented clearly.';
  assert.strictEqual(candidateChangesOriginalFacts(original, faithful, EN), false);
});

console.log('\n== Strength gate: reject weak, accept strong ==');

check('REJECTS an empty candidate', () => {
  assert.strictEqual(regenerationIsStrongEnough('', { isProject: true, ...EN, originalDesc: 'x', title: 'T' }), false);
});

check('REJECTS a prompt echo', () => {
  const echo = 'Item title: Portfolio project. Original user text: I built an app.';
  assert.strictEqual(regenerationIsStrongEnough(echo, { isProject: true, ...EN, originalDesc: 'I built an app', title: 'App' }), false);
});

check('REJECTS a too-short project rewrite', () => {
  assert.strictEqual(regenerationIsStrongEnough('I built an app.', { isProject: true, ...EN, originalDesc: 'I built an app', title: 'App' }), false);
});

check('ACCEPTS a strong first-person project rewrite', () => {
  // 2 sentences, faithful to the original, >= 28 words — matches the enforced contract.
  const strong = 'I built a to-do app in React, focusing on a clean and responsive interface for everyday task tracking. I wanted adding, editing, and completing tasks to feel fast, simple, and reliable for the person using it.';
  assert.strictEqual(regenerationIsStrongEnough(strong, { isProject: true, ...EN, originalDesc: 'I built a to-do app in React', title: 'To-do app' }), true);
});

console.log('\n== Local fallback: strong AND grounded (never fabricates) ==');

check('local fallback passes the project strength gate', () => {
  const original = 'made a flower painting for class';
  const out = buildLocalStrongProjectRegeneration({ title: 'Flower Painting', originalDesc: original, medium: 'Visual Art', creatorType: 'artist' });
  assert.ok(regenerationIsStrongEnough(out, { isProject: true, ...EN, originalDesc: original, title: 'Flower Painting' }),
    'fallback not strong enough: ' + out);
});

check('local fallback introduces NO fabricated facts', () => {
  const original = 'made a flower painting for class';
  const out = buildLocalStrongProjectRegeneration({ title: 'Flower Painting', originalDesc: original, medium: 'Visual Art', creatorType: 'artist' });
  assert.strictEqual(candidateChangesOriginalFacts(original, out, EN), false, 'fallback fabricated facts: ' + out);
});

check('local fallback preserves an original number', () => {
  const original = 'completed 5 practice logos';
  const out = buildLocalStrongProjectRegeneration({ title: 'Logo Practice', originalDesc: original, medium: 'Design', creatorType: 'designer' });
  assert.ok(out.includes('5'), 'fallback dropped the number 5: ' + out);
});

check('anchors are pulled from the ORIGINAL text only', () => {
  const anchors = importantOriginalAnchors('I built a React dashboard with charts and filters');
  assert.ok(anchors.includes('react'), 'react anchor missing: ' + JSON.stringify(anchors));
  assert.ok(anchors.includes('dashboard'), 'dashboard anchor missing: ' + JSON.stringify(anchors));
});

console.log(`\n${pass} passed, ${fail} failed.\n`);
process.exitCode = fail ? 1 : 0;
