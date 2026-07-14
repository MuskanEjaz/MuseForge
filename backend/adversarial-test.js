'use strict';
const assert = require('assert');
const { __test } = require('./server.js');
const { parseCvTextLocally } = __test;

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

console.log('\n== Adversarial / false-positive tests ==');

// 1) A body sentence containing "skills" must NOT create/scramble a section.
check('body sentence with "skills" is not a heading', () => {
  const cv = [
    'Ali Khan', 'Software Engineer', 'ali@x.com',
    'SUMMARY',
    'I improved my skills in Python by building three independent side projects over the summer.',
    'SKILLS', 'Python, React, SQL',
  ].join('\n');
  const p = parseCvTextLocally(cv, []);
  // summary keeps its full sentence; skills has the real tokens
  assert.ok(/improved my skills/i.test(p.description), 'summary sentence lost: ' + p.description);
  assert.deepStrictEqual(p.skills, ['Python', 'React', 'SQL']);
});

// 2) "Experience the difference" style sentence must not become an Experience section.
check('sentence starting with a heading word is not a heading', () => {
  const cv = [
    'Sara Ahmed', 'Designer', 'sara@x.com',
    'PROFILE',
    'Experience working across brands has shaped my visual style and attention to detail.',
    'SKILLS', 'Figma, Photoshop',
  ].join('\n');
  const p = parseCvTextLocally(cv, []);
  const names = p.customSections.map(s => s.name.toLowerCase());
  assert.ok(!names.includes('experience'), 'false Experience section created');
  assert.ok(/Experience working across/i.test(p.description), 'summary text lost');
});

// 3) Skills sub-label "Languages:" (title case) inside a Skills block must stay in skills,
//    NOT become the spoken-languages section.
check('title-case "Languages:" sub-label stays inside skills', () => {
  const cv = [
    'Omar Ali', 'Backend Developer', 'omar@x.com',
    'TECHNICAL SKILLS',
    'Languages: Python, Java, C++',
    'Frameworks: React, Node.js',
    'PROJECTS', 'ApiGateway', '• Built a REST gateway',
  ].join('\n');
  const p = parseCvTextLocally(cv, []);
  ['Python', 'Java', 'C++', 'React', 'Node.js'].forEach(s =>
    assert.ok(p.skills.includes(s), 'missing skill ' + s + ' -> ' + JSON.stringify(p.skills)));
  const langSec = p.customSections.find(s => s.name.toLowerCase() === 'languages');
  // if a Languages section exists it must NOT contain programming languages
  if (langSec) {
    const headings = langSec.items.map(i => i.heading);
    assert.ok(!headings.includes('Python'), 'programming language leaked into Languages section');
  }
});

// 4) A real ALL-CAPS "LANGUAGES:" inline section IS captured.
check('all-caps "LANGUAGES: English, Urdu" is captured as a section', () => {
  const cv = [
    'Hina Raza', 'Writer', 'hina@x.com',
    'SUMMARY', 'Creative writer.',
    'LANGUAGES: English, Urdu, Punjabi',
  ].join('\n');
  const p = parseCvTextLocally(cv, []);
  const langSec = p.customSections.find(s => s.name.toLowerCase() === 'languages');
  assert.ok(langSec, 'Languages section not created');
  assert.ok(langSec.items.length >= 2, 'languages not split into items');
});

// 5) CV with NO recognized headings at all should not crash and should still return a name.
check('heading-less CV does not crash and still yields a name', () => {
  const cv = [
    'Bilal Nawaz',
    'Passionate creator who builds small web tools and writes about technology in simple words.',
    'Contact: bilal@x.com',
  ].join('\n');
  const p = parseCvTextLocally(cv, []);
  assert.strictEqual(p.name, 'Bilal Nawaz');
  assert.ok(typeof p.description === 'string');
});

// 6) Messy PDF artifacts (page markers) must be ignored.
check('page markers and stray footers do not break sections', () => {
  const cv = [
    'Zara Malik', 'Data Analyst', 'zara@x.com',
    '-- 1 of 2 --',
    'EDUCATION', 'NUST', 'BS Data Science', '2021 - 2025',
    '-- 2 of 2 --',
    'SKILLS', 'Python, SQL, Power BI',
  ].join('\n');
  const p = parseCvTextLocally(cv, []);
  assert.deepStrictEqual(p.skills, ['Python', 'SQL', 'Power BI']);
  assert.ok(p.customSections.some(s => s.name.toLowerCase() === 'education'), 'education lost');
});

// 7) Pipe/semicolon separated skills tokenize correctly (and keep "Node.js"/"C++").
check('pipe & semicolon separated skills tokenize correctly', () => {
  const cv = [
    'Kim Lee', 'Engineer', 'kim@x.com',
    'SKILLS', 'Python | Node.js | C++ ; PostgreSQL | UI/UX',
  ].join('\n');
  const p = parseCvTextLocally(cv, []);
  ['Python', 'Node.js', 'C++', 'PostgreSQL', 'UI/UX'].forEach(s =>
    assert.ok(p.skills.includes(s), 'missing ' + s + ' -> ' + JSON.stringify(p.skills)));
});

// 8) Two separate single-word sections on consecutive lines must NOT merge.
check('adjacent single-word headings (empty section) do not merge', () => {
  const cv = [
    'Noor Fatima', 'Engineer', 'noor@x.com',
    'SKILLS', 'Python, React',
    'EDUCATION',    // education heading immediately after skills content
    'FAST NUCES', 'BS CS', '2020 - 2024',
  ].join('\n');
  const p = parseCvTextLocally(cv, []);
  assert.deepStrictEqual(p.skills, ['Python', 'React']);
  assert.ok(p.customSections.some(s => s.name.toLowerCase() === 'education'), 'education merged away');
});

// 9) Empty input returns a safe object.
check('empty CV returns safe defaults', () => {
  const p = parseCvTextLocally('', []);
  assert.ok(p && typeof p === 'object');
  assert.ok('name' in p && 'skills' in p && 'projects' in p);
});

// 10) A project whose description contains a colon phrase must not spawn a fake section.
check('project bullet with colon does not create a section', () => {
  const cv = [
    'Ahmed Raza', 'Developer', 'ahmed@x.com',
    'PROJECTS',
    'InsightBoard',
    '• Goal: build an analytics dashboard with live charts and filters',
    'SKILLS', 'React, D3',
  ].join('\n');
  const p = parseCvTextLocally(cv, []);
  assert.ok(p.projects.length >= 1, 'project lost');
  assert.deepStrictEqual(p.skills, ['React', 'D3']);
});

console.log(`\n${pass} passed, ${fail} failed.\n`);
process.exitCode = fail ? 1 : 0;
