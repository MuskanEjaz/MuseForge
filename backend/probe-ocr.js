#!/usr/bin/env node
'use strict';
/**
 * MuseForge — is Urdu OCR viable on THIS machine, right now?
 *
 *   node probe-ocr.js "C:\path\to\your-urdu-cv.pdf"
 *
 * We proved the Urdu text layer is shattered garbage (700+ single-glyph lines).
 * Text extraction can't fix that. OCR is the only path — IF an Urdu-capable engine
 * is installed in your docling-serve venv. This probe finds out, with no guessing.
 *
 * It:
 *   0. Reads /openapi.json to see which ocr_engine values your build accepts.
 *   1. Calls Docling with force_ocr + easyocr + ocr_lang=ur.
 *   2. If easyocr errors, retries with tesseract + urd.
 *   3. For whatever returns text, measures: single-glyph-line ratio (vs the ~700 we
 *      saw), real multi-letter Urdu words, and — using YOUR server.js aliases —
 *      whether any real section heading finally reassembles and matches.
 *
 * Run from inside backend/. Be patient: CPU OCR is slow (per-page seconds).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DOCLING_URL = String(process.env.DOCLING_URL || 'http://localhost:5001').replace(/\/+$/, '');
const DOCLING_API_KEY = String(process.env.DOCLING_API_KEY || '').trim();
const SERVER_PATH = process.env.SERVER_PATH || path.join(process.cwd(), 'server.js');
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 300000); // 5 min: OCR is slow

const file = process.argv[2];
if (!file) { console.error('Usage: node probe-ocr.js <path-to-cv.pdf>'); process.exit(1); }
if (!fs.existsSync(file)) { console.error('File not found: ' + file); process.exit(1); }
const buffer = fs.readFileSync(file);

// ---- verbatim helpers from server.js (defined BEFORE the alias load that uses them) ----
const CV_LETTER_FOLDS = { 'Ł':'L','ł':'l','Đ':'D','đ':'d','Ð':'D','ð':'d','Ø':'O','ø':'o','Æ':'AE','æ':'ae','Œ':'OE','œ':'oe','ß':'ss','İ':'I','ı':'i','Þ':'TH','þ':'th','Ħ':'H','ħ':'h' };
const CV_LETTER_FOLD_RE = new RegExp('[' + Object.keys(CV_LETTER_FOLDS).join('') + ']', 'g');
function normalizeCvHeading(value = '') {
  return String(value || '').replace(CV_LETTER_FOLD_RE, ch => CV_LETTER_FOLDS[ch])
    .normalize('NFD').replace(/[\u0300-\u036F]/g, '').toUpperCase()
    .replace(/[^\p{L}\p{N}& ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
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
  return String(cvText || '').replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '').replace(/\r/g, '\n').split('\n')
    .map(cleanCvLine).filter(Boolean).filter(l => !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(l));
}
function headingSectionFor(text) {
  const norm = normalizeCvHeading(text);
  if (CV_HEADING_TO_SECTION[norm]) return CV_HEADING_TO_SECTION[norm];
  const split = String(text).match(/^([^:：–—-]{2,40})[:：\-–—]\s*(.+)$/);
  if (split) { const k = normalizeCvHeading(split[1]); if (CV_HEADING_TO_SECTION[k]) return CV_HEADING_TO_SECTION[k]; }
  return null;
}

// ---- pull the real alias tables out of server.js (identical to production) ----
let CV_HEADING_TO_SECTION = {};
try {
  const serverSrc = fs.readFileSync(SERVER_PATH, 'utf8');
  const extractObjectLiteral = (src, declaration) => {
    const start = src.indexOf(declaration);
    if (start === -1) throw new Error('missing ' + declaration);
    const braceStart = src.indexOf('{', start);
    let depth = 0, i = braceStart, inStr = null;
    for (; i < src.length; i += 1) {
      const ch = src[i];
      if (inStr) { if (ch === '\\') { i += 1; continue; } if (ch === inStr) inStr = null; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
      if (ch === '{') depth += 1; else if (ch === '}') { depth -= 1; if (depth === 0) { i += 1; break; } }
    }
    return vm.runInNewContext('(' + src.slice(braceStart, i) + ')');
  };
  const a1 = extractObjectLiteral(serverSrc, 'const CV_SECTION_ALIASES = {');
  const a2 = extractObjectLiteral(serverSrc, 'const CV_SECTION_ALIASES_MULTILINGUAL = {');
  for (const [s, arr] of Object.entries(a1)) for (const a of arr) CV_HEADING_TO_SECTION[normalizeCvHeading(a)] = s;
  for (const [s, arr] of Object.entries(a2)) for (const a of arr) { const k = normalizeCvHeading(a); if (k) CV_HEADING_TO_SECTION[k] = s; }
  console.log('aliases loaded from server.js: ' + Object.keys(CV_HEADING_TO_SECTION).length + ' keys');
} catch (e) {
  console.log('WARNING: could not load aliases from server.js (' + e.message + '); heading match disabled.');
}

const RE_ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const c = (t, re) => (String(t).match(re) || []).length;

// A "word" = a run of >=3 connected Arabic-script letters with no space inside.
function urduWordCount(text) {
  const words = String(text).match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]{3,}/g) || [];
  return words.length;
}

async function callDocling(label, fields) {
  console.log('\n========== ' + label + ' ==========');
  const form = new FormData();
  form.append('files', new Blob([buffer], { type: 'application/pdf' }), path.basename(file));
  form.append('from_formats', 'pdf');
  form.append('to_formats', 'md');
  form.append('image_export_mode', 'placeholder');
  form.append('table_mode', 'accurate');
  for (const [k, v] of fields) form.append(k, v);
  console.log('  fields: ' + JSON.stringify(fields));

  const headers = { Accept: 'application/json' };
  if (DOCLING_API_KEY) headers['X-Api-Key'] = DOCLING_API_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(DOCLING_URL + '/v1/convert/file', { method: 'POST', body: form, headers, signal: controller.signal });
    clearTimeout(timer);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const raw = await res.text();
    if (!res.ok) {
      console.log('  HTTP ' + res.status + ' in ' + secs + 's — ENGINE/OPTION REJECTED:');
      console.log('  ' + raw.slice(0, 500));
      return null;
    }
    let data = {}; try { data = JSON.parse(raw); } catch (_) { console.log('  200 but non-JSON body'); return null; }
    const md = String((data.document && data.document.md_content) || '');
    console.log('  HTTP 200 in ' + secs + 's, md_content ' + md.length + ' chars');
    return md;
  } catch (e) {
    clearTimeout(timer);
    console.log('  ' + (e.name === 'AbortError' ? 'TIMEOUT after ' + TIMEOUT_MS + 'ms (OCR too slow here)' : 'ERROR: ' + e.message));
    return null;
  }
}

function analyse(label, md) {
  const cvText = normalizeCvTextForParsing(doclingMarkdownToCvText(md));
  const lines = linesFromCvText(cvText);
  const single = lines.filter(l => l.replace(/\s+/g, '').length === 1).length;
  const words = urduWordCount(cvText);
  const heads = [];
  for (const l of lines) { const s = headingSectionFor(l); if (s) heads.push(l + ' -> ' + s); }
  const singlePct = lines.length ? Math.round((single / lines.length) * 100) : 0;

  console.log('\n  --- analysis: ' + label + ' ---');
  console.log('  lines                         : ' + lines.length);
  console.log('  single-glyph lines            : ' + single + '  (' + singlePct + '%)   [shattered run was ~90%]');
  console.log('  connected Urdu words (3+ letters): ' + words);
  console.log('  section headings matched      : ' + heads.length);
  if (heads.length) heads.forEach(h => console.log('      ' + h));
  console.log('  --- first 600 chars of reassembled text ---');
  console.log('  ' + JSON.stringify(cvText.slice(0, 600)));
  return { lines: lines.length, single, singlePct, words, heads: heads.length };
}

async function schema() {
  console.log('\n========== 0. ocr engines your build accepts ==========');
  try {
    const res = await fetch(DOCLING_URL + '/openapi.json');
    if (!res.ok) { console.log('  /openapi.json -> ' + res.status + ' (open ' + DOCLING_URL + '/docs)'); return; }
    const spec = await res.json();
    const seen = new Set(); let found = false;
    (function walk(n){ if(!n||typeof n!=='object'||seen.has(n))return; seen.add(n);
      for(const [k,v] of Object.entries(n)){ if(k==='ocr_engine'&&v&&typeof v==='object'){ console.log('  ocr_engine schema: '+JSON.stringify(v).slice(0,300)); found=true; } if(v&&typeof v==='object')walk(v);} })(spec);
    const schemas = (spec.components && spec.components.schemas) || {};
    for (const [n,d] of Object.entries(schemas)) if(/ocr/i.test(n)&&Array.isArray(d.enum)){ console.log('  enum '+n+' = '+JSON.stringify(d.enum)); found=true; }
    if (!found) console.log('  (ocr_engine not found in schema — open ' + DOCLING_URL + '/docs and read /v1/convert/file)');
  } catch (e) { console.log('  schema probe failed: ' + e.message); }
}

(async () => {
  console.log('FILE        : ' + file + '  (' + buffer.length + ' bytes)');
  console.log('DOCLING_URL : ' + DOCLING_URL);
  await schema();

  let best = null, bestLabel = '';

  let md = await callDocling('1. force_ocr + easyocr + ur/en', [
    ['do_ocr','true'],['force_ocr','true'],['ocr_engine','easyocr'],['ocr_lang','ur'],['ocr_lang','en'],['pdf_backend','dlparse_v4'],
  ]);
  if (md) { const r = analyse('easyocr/ur', md); best = r; bestLabel = 'easyocr'; }

  if (!md) {
    md = await callDocling('2. force_ocr + tesseract + urd/eng (easyocr failed, trying tesseract)', [
      ['do_ocr','true'],['force_ocr','true'],['ocr_engine','tesseract'],['ocr_lang','urd'],['ocr_lang','eng'],['pdf_backend','dlparse_v4'],
    ]);
    if (md) { const r = analyse('tesseract/urd', md); best = r; bestLabel = 'tesseract'; }
  }

  console.log('\n==================== VERDICT ====================');
  if (!best) {
    console.log('  OCR ENGINE MISSING / FAILED. No Urdu-capable engine ran (see the rejection bodies above).');
    console.log('  Your docling-serve loaded RapidOCR (Chinese) at startup, which cannot read Urdu.');
    console.log('  To even attempt OCR: in the SAME venv that runs docling-serve,');
    console.log('      pip install easyocr    (or install tesseract + the "urd" traineddata)');
    console.log('  then restart docling-serve and rerun this probe.');
    console.log('  If you do NOT want to go down the OCR road: that is the correct call. Go to Option B');
    console.log('  (detect the shattered text and fail honestly). Tell me and I ship the detector.');
  } else if (best.heads > 0) {
    console.log('  OCR IS VIABLE with ' + bestLabel + '. Real headings reassembled and matched (' + best.heads + ').');
    console.log('  single-glyph lines dropped to ' + best.singlePct + '% and ' + best.words + ' connected Urdu words came back.');
    console.log('  --> Option A is on the table. Next step: wire force_ocr + ' + bestLabel + ' into extractCvTextWithDocling,');
    console.log('      raise the timeout, AND still add the shatter-detector as a safety net for PDFs OCR cannot save.');
    console.log('  Caveat: OCR Urdu is imperfect. Weigh this against FactLock before betting the demo on it.');
  } else if (best.words > 15 && best.singlePct < 40) {
    console.log('  OCR PARTIAL with ' + bestLabel + '. Text is far better (' + best.words + ' words, ' + best.singlePct + '% single-glyph)');
    console.log('  but NO heading matched — likely OCR spelled the headings imperfectly, or this CV uses');
    console.log('  headings not in the alias list. Paste the "first 600 chars" above and I will tell you which.');
  } else {
    console.log('  OCR DID NOT HELP. Still ' + best.singlePct + '% single-glyph lines, ' + best.words + ' words.');
    console.log('  This Nastaliq PDF is beyond what CPU OCR recovers. Option B (fail honestly) is the right call.');
  }

  console.log('\n  Paste the WHOLE output. The VERDICT + the "first 600 chars" are what I need.');
})();
