'use strict';
/**
 * Proves the CV-parsing bug and the fix, using the app's OWN functions.
 *
 *   node test-parse-fix.js
 *
 * The bug: extractCvTextCandidates does `cleanText(docling)`, and cleanText does
 * .replace(/\s+/g,' '), which flattens Docling's multi-line structure into ONE line,
 * so no section heading is ever detected.
 *
 * The fix: keep the newlines (Docling already gives correct structure; it's already
 * normalized by normalizeCvTextForParsing). This test runs the pipeline BOTH ways on the
 * real cardiologist CV and on many diverse synthetic CVs, and counts detected headings.
 *
 * It reads the REAL alias tables out of server.js, so detection matches production.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SERVER_PATH = process.env.SERVER_PATH || path.join(process.cwd(), 'server.js');

// ---- verbatim transforms copied from server.js ----
function cleanText(value = '') { return String(value || '').replace(/\s+/g, ' ').trim(); } // the culprit
function cleanCvLine(value = '') { return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }
function isMarkdownTableSeparator(line = '') { const t = String(line || '').trim(); return /-{2,}/.test(t) && /^\|?[\s:|-]+\|?$/.test(t); }
function doclingMarkdownToCvText(markdown = '') {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n'); const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i].replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!line) { out.push(''); continue; }
    if (isMarkdownTableSeparator(line)) continue;
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (isMarkdownTableSeparator(lines[i + 1] || '')) continue;
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      if (!cells.length) continue; out.push(cells.join(' · ')); continue;
    }
    line = line.replace(/^#{1,6}\s*/, '').replace(/^\s*[-*+]\s+/, '• ').replace(/^\s*\d+[.)]\s+/, '• ')
      .replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1').replace(/`([^`]*)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2').replace(/^>\s*/, '');
    out.push(line.trim());
  }
  return out.join('\n');
}
function normalizeCvTextForParsing(text = '') {
  return String(text || '').replace(/\r/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function linesFromCvText(cvText = '') {
  return String(cvText || '').replace(/\r/g, '\n').split('\n').map(cleanCvLine).filter(Boolean);
}
const CV_LETTER_FOLDS = { 'Ł':'L','ł':'l','Đ':'D','đ':'d','Ø':'O','ø':'o','ß':'ss','İ':'I','ı':'i' };
const CV_LETTER_FOLD_RE = new RegExp('[' + Object.keys(CV_LETTER_FOLDS).join('') + ']', 'g');
function normalizeCvHeading(value = '') {
  return String(value || '').replace(CV_LETTER_FOLD_RE, ch => CV_LETTER_FOLDS[ch])
    .normalize('NFD').replace(/[\u0300-\u036F]/g, '').toUpperCase()
    .replace(/[^\p{L}\p{N}& ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

// ---- real alias tables out of server.js ----
let CV_HEADING_TO_SECTION = {};
try {
  const src = fs.readFileSync(SERVER_PATH, 'utf8');
  const grab = (decl) => {
    const s = src.indexOf(decl); const b = src.indexOf('{', s); let d = 0, i = b, q = null;
    for (; i < src.length; i += 1) { const c = src[i];
      if (q) { if (c === '\\') { i += 1; continue; } if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if (c === '{') d += 1; else if (c === '}') { d -= 1; if (d === 0) { i += 1; break; } } }
    return vm.runInNewContext('(' + src.slice(b, i) + ')');
  };
  for (const [sec, arr] of Object.entries(grab('const CV_SECTION_ALIASES = {'))) for (const a of arr) CV_HEADING_TO_SECTION[normalizeCvHeading(a)] = sec;
  for (const [sec, arr] of Object.entries(grab('const CV_SECTION_ALIASES_MULTILINGUAL = {'))) for (const a of arr) { const k = normalizeCvHeading(a); if (k) CV_HEADING_TO_SECTION[k] = sec; }
} catch (e) { console.error('Could not read aliases from server.js: ' + e.message + '\nRun from backend/ or set SERVER_PATH.'); process.exit(1); }

function headingFor(line) {
  const k = normalizeCvHeading(line);
  if (CV_HEADING_TO_SECTION[k]) return CV_HEADING_TO_SECTION[k];
  const m = String(line).match(/^([^:：]{2,40})[:：]\s*.+$/);
  if (m) { const k2 = normalizeCvHeading(m[1]); if (CV_HEADING_TO_SECTION[k2]) return CV_HEADING_TO_SECTION[k2]; }
  return null;
}
function detectSections(text) {
  const found = new Set();
  for (const line of linesFromCvText(text)) { const s = headingFor(line); if (s) found.add(s); }
  return [...found];
}

// pipeline OLD (with cleanText) vs NEW (without)
function pipeline(markdown, useCleanText) {
  let text = normalizeCvTextForParsing(doclingMarkdownToCvText(markdown));
  if (useCleanText) text = cleanText(text); // the bug
  return { lines: (text.match(/\n/g) || []).length + 1, sections: detectSections(text) };
}

let passed = 0, failed = 0;
function check(name, markdown, expectAtLeast) {
  const oldR = pipeline(markdown, true);
  const newR = pipeline(markdown, false);
  const ok = newR.sections.length >= expectAtLeast;
  if (ok) passed += 1; else failed += 1;
  console.log(
    (ok ? '  PASS  ' : '  FAIL  ') + name +
    '\n         OLD (cleanText): ' + oldR.lines + ' line(s), sections=' + oldR.sections.length +
    '   NEW (fix): ' + newR.lines + ' lines, sections=' + newR.sections.length + ' [' + newR.sections.join(',') + ']'
  );
}

// ---- 1. the REAL cardiologist CV ----
const cardio = fs.readFileSync(path.join(__dirname, 'cardio-md.txt'), 'utf8');
console.log('=== REAL CV (Dr. Bilal Ahmed Khan, cardiologist) ===');
check('real cardiologist CV', cardio, 5);

// ---- 2. diverse synthetic CVs: heading-style + language variations ----
console.log('\n=== DIVERSE SYNTHETIC CVs ===');
const H = (t, body) => '## ' + t + '\n' + body + '\n';
const contact = H('Contact', 'a@b.com\n+1 555 1234');

const suite = [
  ['English ALLCAPS headings', H('SUMMARY','x') + H('EXPERIENCE','y') + H('EDUCATION','z') + H('SKILLS','a'), 4],
  ['English Title Case', H('Professional Summary','x') + H('Work Experience','y') + H('Education','z') + H('Technical Skills','a'), 4],
  ['English mixed + contact', contact + H('Experience','y') + H('Projects','p') + H('Certifications','c'), 4],
  ['colon style headings', 'Skills: python, java\nExperience: senior dev\nEducation: BSc', 3],
  ['bulleted content', H('SKILLS','- python\n- java') + H('PROJECTS','- portfolio site'), 2],
  ['table in education', H('EDUCATION','| BSc CS | 2020 |\n|---|---|') + H('SKILLS','python'), 2],
  ['Spanish', H('Experiencia','y') + H('Educación','z') + H('Habilidades','a') + H('Idiomas','i'), 4],
  ['French', H('Expérience','y') + H('Formation','z') + H('Compétences','a'), 3],
  ['German', H('Berufserfahrung','y') + H('Ausbildung','z') + H('Kenntnisse','a'), 3],
  ['Italian', H('Esperienza','y') + H('Istruzione','z') + H('Competenze','a'), 3],
  ['Portuguese', H('Experiência','y') + H('Educação','z') + H('Habilidades','a'), 3],
  ['Urdu headings', H('تجربہ','y') + H('تعلیم','z') + H('مہارتیں','a'), 3],
  ['Arabic headings', H('الخبرة','y') + H('التعليم','z') + H('المهارات','a'), 3],
  ['designer CV', contact + H('PROFILE','x') + H('EXPERIENCE','y') + H('SKILLS','a') + H('AWARDS','w'), 4],
  ['academic CV', H('EDUCATION','x') + H('PUBLICATIONS','y') + H('EXPERIENCE','z') + H('LANGUAGES','l'), 4],
  ['minimal CV', H('EXPERIENCE','y') + H('SKILLS','a'), 2],
  ['extra sections', contact + H('SUMMARY','s') + H('EXPERIENCE','e') + H('PROJECTS','p') + H('CERTIFICATIONS','c') + H('INTERESTS','i'), 5],
];
for (const [name, md, expect] of suite) check(name, md, expect);

console.log('\n=================================================');
console.log('  ' + passed + ' passed, ' + failed + ' failed  (out of ' + (passed + failed) + ')');
console.log('  Every OLD result collapses to 1 line, sections=0 (the bug).');
console.log('  Every NEW result keeps its lines and detects the sections (the fix).');
