#!/usr/bin/env node
'use strict';
/**
 * MuseForge — section-detection ground truth.
 *
 *   node probe-sections.js "C:\path\to\your-cv.pdf"
 *
 * The new symptom: Docling SUCCEEDS (2231 chars) but sections=0, skills=0.
 * So extraction is fine and the bug is in SECTION DETECTION. This tells us WHY,
 * with no guessing, by running your app's OWN logic on your app's OWN Docling output.
 *
 * It does NOT re-type your parser. It reads the real alias tables and the real
 * text-transform functions out of server.js, so what you see here is byte-identical
 * to what /parse-cv feeds the matcher. If the probe and the app ever disagree, the
 * probe is wrong — but this design makes that almost impossible.
 *
 * Run it from inside backend/.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DOCLING_URL = String(process.env.DOCLING_URL || 'http://localhost:5001').replace(/\/+$/, '');
const DOCLING_API_KEY = String(process.env.DOCLING_API_KEY || '').trim();
const SERVER_PATH = process.env.SERVER_PATH || path.join(process.cwd(), 'server.js');

const file = process.argv[2];
if (!file) { console.error('Usage: node probe-sections.js <path-to-cv.pdf>'); process.exit(1); }
if (!fs.existsSync(file)) { console.error('File not found: ' + file); process.exit(1); }
if (!fs.existsSync(SERVER_PATH)) {
  console.error('server.js not found at ' + SERVER_PATH + '  (run this from inside backend/, or set SERVER_PATH)');
  process.exit(1);
}
const buffer = fs.readFileSync(file);

// ---------------------------------------------------------------------------
// Pull the two alias object literals OUT of server.js so they are guaranteed
// identical to production. These are pure data (no function refs), so eval is safe.
// ---------------------------------------------------------------------------
const serverSrc = fs.readFileSync(SERVER_PATH, 'utf8');

function extractObjectLiteral(src, declaration) {
  const start = src.indexOf(declaration);
  if (start === -1) throw new Error('could not find `' + declaration + '` in server.js');
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart, inStr = null;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { i += 1; break; } }
  }
  const literal = src.slice(braceStart, i);
  return vm.runInNewContext('(' + literal + ')');
}

const CV_SECTION_ALIASES = extractObjectLiteral(serverSrc, 'const CV_SECTION_ALIASES = {');
const CV_SECTION_ALIASES_MULTILINGUAL = extractObjectLiteral(serverSrc, 'const CV_SECTION_ALIASES_MULTILINGUAL = {');

// ---------------------------------------------------------------------------
// Verbatim copies of the SHORT text-transform + normalization functions from
// server.js. Copied exactly (lines cited) so the transformed text matches the app.
// ---------------------------------------------------------------------------

// server.js cleanCvLine
function cleanCvLine(value = '') {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

// server.js CV_LETTER_FOLDS / CV_LETTER_FOLD_RE
const CV_LETTER_FOLDS = {
  'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'Ð': 'D', 'ð': 'd',
  'Ø': 'O', 'ø': 'o', 'Æ': 'AE', 'æ': 'ae', 'Œ': 'OE', 'œ': 'oe',
  'ß': 'ss', 'İ': 'I', 'ı': 'i', 'Þ': 'TH', 'þ': 'th', 'Ħ': 'H', 'ħ': 'h',
};
const CV_LETTER_FOLD_RE = new RegExp('[' + Object.keys(CV_LETTER_FOLDS).join('') + ']', 'g');

// server.js normalizeCvHeading
function normalizeCvHeading(value = '') {
  return String(value || '')
    .replace(CV_LETTER_FOLD_RE, ch => CV_LETTER_FOLDS[ch])
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}& ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// server.js isMarkdownTableSeparator
function isMarkdownTableSeparator(line = '') {
  const text = String(line || '').trim();
  return /-{2,}/.test(text) && /^\|?[\s:|-]+\|?$/.test(text);
}

// server.js doclingMarkdownToCvText
function doclingMarkdownToCvText(markdown = '') {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    line = line.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!line) { out.push(''); continue; }
    if (isMarkdownTableSeparator(line)) continue;
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (isMarkdownTableSeparator(lines[i + 1] || '')) continue;
      const cells = line.split('|').map(cell => cell.trim()).filter(Boolean);
      if (!cells.length) continue;
      out.push(cells.join(' · '));
      continue;
    }
    line = line.replace(/^#{1,6}\s*/, '');
    line = line.replace(/^\s*[-*+]\s+/, '• ');
    line = line.replace(/^\s*\d+[.)]\s+/, '• ');
    line = line.replace(/\*\*(.*?)\*\*/g, '$1');
    line = line.replace(/__(.*?)__/g, '$1');
    line = line.replace(/`([^`]*)`/g, '$1');
    line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2');
    line = line.replace(/^>\s*/, '');
    out.push(line.trim());
  }
  return out.join('\n');
}

// server.js normalizeCvTextForParsing
function normalizeCvTextForParsing(text = '') {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// server.js linesFromCvText
function linesFromCvText(cvText = '') {
  return String(cvText || '')
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(cleanCvLine)
    .filter(Boolean)
    .filter(line => !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line));
}

// Build the exact same lookup the app builds.
const CV_HEADING_TO_SECTION = {};
for (const [section, aliases] of Object.entries(CV_SECTION_ALIASES)) {
  for (const a of aliases) CV_HEADING_TO_SECTION[normalizeCvHeading(a)] = section;
}
for (const [section, aliases] of Object.entries(CV_SECTION_ALIASES_MULTILINGUAL)) {
  for (const a of aliases) { const k = normalizeCvHeading(a); if (k) CV_HEADING_TO_SECTION[k] = section; }
}

// Simplified matcher for the probe: exact normalized lookup + the "HEADING: content" split.
// (The app's fuzzy branch is deliberately narrow; if a line matches here it WILL match in the
// app, and if it matches only after reversal we've found an RTL bug.)
function headingSectionFor(text) {
  const norm = normalizeCvHeading(text);
  if (CV_HEADING_TO_SECTION[norm]) return CV_HEADING_TO_SECTION[norm];
  const split = String(text).match(/^([^:：–—-]{2,40})[:：\-–—]\s*(.+)$/);
  if (split) {
    const k = normalizeCvHeading(split[1]);
    if (CV_HEADING_TO_SECTION[k]) return CV_HEADING_TO_SECTION[k];
  }
  return null;
}

const reverseString = s => Array.from(String(s)).reverse().join('');

// ---------------------------------------------------------------------------
// Script analysis
// ---------------------------------------------------------------------------
const RE_ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const RE_LATIN = /[A-Za-z]/g;
const RE_PUA = /[\uE000-\uF8FF]/g;
const RE_REPL = /\uFFFD/g;
const c = (t, re) => (String(t).match(re) || []).length;

function scriptTag(t) {
  const ar = c(t, RE_ARABIC), la = c(t, RE_LATIN), pua = c(t, RE_PUA), rp = c(t, RE_REPL);
  const bits = [];
  if (ar) bits.push('ar' + ar);
  if (la) bits.push('la' + la);
  if (pua) bits.push('PUA' + pua);
  if (rp) bits.push('FFFD' + rp);
  return bits.join(' ') || '-';
}

// ---------------------------------------------------------------------------
// Docling call — exactly what your app sends today (do_ocr=false).
// ---------------------------------------------------------------------------
async function getDoclingMarkdown() {
  const form = new FormData();
  form.append('files', new Blob([buffer], { type: 'application/pdf' }), path.basename(file));
  form.append('from_formats', 'pdf');
  form.append('to_formats', 'md');
  form.append('do_ocr', 'false');
  form.append('image_export_mode', 'placeholder');
  form.append('table_mode', 'accurate');

  const headers = { Accept: 'application/json' };
  if (DOCLING_API_KEY) headers['X-Api-Key'] = DOCLING_API_KEY;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  const res = await fetch(DOCLING_URL + '/v1/convert/file', {
    method: 'POST', body: form, headers, signal: controller.signal,
  });
  clearTimeout(timer);
  if (!res.ok) throw new Error('Docling HTTP ' + res.status + ' :: ' + (await res.text()).slice(0, 300));
  const data = await res.json();
  return String((data.document && data.document.md_content) || '');
}

(async () => {
  console.log('FILE        : ' + file + '  (' + buffer.length + ' bytes)');
  console.log('DOCLING_URL : ' + DOCLING_URL);
  console.log('aliases loaded from server.js: ' + Object.keys(CV_HEADING_TO_SECTION).length + ' normalized heading keys');

  let md;
  try {
    md = await getDoclingMarkdown();
  } catch (e) {
    console.error('\nDocling call failed: ' + e.message);
    process.exit(1);
  }

  console.log('\n==================== RAW DOCLING MARKDOWN (' + md.length + ' chars) ====================');
  console.log(md);

  const isTableHeavy = (md.match(/^\s*\|.*\|\s*$/gm) || []).length;
  console.log('\n>> markdown rows that are table rows (| ... |): ' + isTableHeavy);

  const cvText = normalizeCvTextForParsing(doclingMarkdownToCvText(md));
  const lines = linesFromCvText(cvText);

  console.log('\n==================== PER-LINE DETECTION (' + lines.length + ' lines) ====================');
  console.log('  [#] HEADING?         SCRIPT        TABLE?  TEXT');
  console.log('  ------------------------------------------------------------');

  let headingsFwd = 0, headingsRev = 0, tableRows = 0;
  const detected = [];

  lines.forEach((line, idx) => {
    const fwd = headingSectionFor(line);
    const rev = fwd ? null : headingSectionFor(reverseString(line));
    const isTableRow = line.includes(' · ');
    if (isTableRow) tableRows += 1;

    let tag = 'body';
    if (fwd) { tag = 'HEAD->' + fwd; headingsFwd += 1; detected.push(`${idx}: ${line}  ->  ${fwd}`); }
    else if (rev) { tag = 'REV!->' + rev; headingsRev += 1; }

    const shortLetterLine =
      line.length <= 40 && (c(line, RE_ARABIC) + c(line, RE_LATIN)) >= 3 && !line.includes(' · ');
    const candidate = (!fwd && !rev && shortLetterLine) ? ' <-- looks heading-shaped but NOT matched' : '';

    console.log(
      '  [' + String(idx).padStart(3) + '] '
      + tag.padEnd(15) + ' '
      + scriptTag(line).padEnd(13) + ' '
      + (isTableRow ? 'TABLE ' : '      ') + ' '
      + JSON.stringify(line.slice(0, 90))
      + candidate
    );
  });

  console.log('\n==================== SUMMARY ====================');
  console.log('  total lines                 : ' + lines.length);
  console.log('  table-flattened lines (·)   : ' + tableRows + '  (of ' + lines.length + ')');
  console.log('  headings matched FORWARD     : ' + headingsFwd);
  console.log('  headings matched only REVERSED: ' + headingsRev);
  if (detected.length) {
    console.log('  matched headings:');
    detected.forEach(d => console.log('    ' + d));
  }

  console.log('\n==================== VERDICT ====================');
  if (headingsFwd > 0) {
    console.log('  Headings ARE matching here (' + headingsFwd + '). If the APP still reports sections:0,');
    console.log('  the bug is between cvSectionsFromLines and parseCvCustomSections, NOT the matcher.');
    console.log('  --> Next: dump `sections` right after cvSectionsFromLines in server.js.');
  } else if (headingsRev > 0) {
    console.log('  RTL REVERSAL. Headings match ONLY when reversed (' + headingsRev + ').');
    console.log('  Docling is emitting Urdu/Arabic in VISUAL order. Fix: reverse RTL runs before matching,');
    console.log('  or switch Docling pdf_backend / enable bidi handling. This is the real bug.');
  } else if (tableRows > lines.length * 0.5) {
    console.log('  TABLE FLATTENING. ' + tableRows + '/' + lines.length + ' lines are `·`-joined table rows.');
    console.log('  Docling parsed this CV as a TABLE, so headings never sit on their own line and the');
    console.log('  matcher never sees them. Fix: to_formats=json (walk the doc tree) OR split `·` cells');
    console.log('  back onto their own lines when a cell alone is a known heading. This is the real bug.');
  } else {
    console.log('  HEADINGS ABSENT. No line matches any alias, forward or reversed, and it is not a table.');
    console.log('  Either this CV uses headings not in the alias list (look at the "looks heading-shaped');
    console.log('  but NOT matched" lines above), or the text is decoded garbage (check the SCRIPT column');
    console.log('  for PUA/FFFD). The heading-shaped lines above tell you which aliases to add.');
  }

  console.log('\n  Paste the WHOLE output — especially RAW MARKDOWN + PER-LINE + VERDICT. Do not trim it.');
})();
