#!/usr/bin/env node
'use strict';
/**
 * MuseForge — Docling + Urdu ground-truth probe.
 *
 *   node probe-cv.js "C:\path\to\your-urdu-cv.pdf"
 *
 * This changes NOTHING in your app. It only refuses to lie to you.
 *
 * It answers, with evidence, the four questions your current logs destroy:
 *
 *   0. What does YOUR docling-serve build actually accept? (ocr_engine enum, ocr_lang, force_ocr)
 *   A. What does /v1/convert/file ACTUALLY return with your app's current settings?
 *   B. Does force_ocr + ocr_lang=ur change anything?
 *   C. Is the PDF's own text layer usable, or is the 4497 chars pure garbage?
 *
 * Run it from your `backend/` folder (it needs backend/node_modules/pdf-parse).
 */

const fs = require('fs');
const path = require('path');

const DOCLING_URL = String(process.env.DOCLING_URL || 'http://localhost:5001').replace(/\/+$/, '');
const DOCLING_API_KEY = String(process.env.DOCLING_API_KEY || '').trim();
// OCR on CPU is SLOW. Your app's 20s default is not a timeout, it is a guaranteed abort.
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 240000);

const file = process.argv[2];
if (!file) {
  console.error('Usage: node probe-cv.js <path-to-cv.pdf>');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error('File not found: ' + file);
  process.exit(1);
}
const buffer = fs.readFileSync(file);

// ---------------------------------------------------------------------------
// Script analysis. This is the whole point: "4497 chars" tells you nothing.
// 4497 chars of WHAT is the only question that matters.
// ---------------------------------------------------------------------------
const RE_ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const RE_LATIN = /[A-Za-z]/g;
const RE_PUA = /[\uE000-\uF8FF]/g;   // private-use glyphs => the PDF's ToUnicode map is broken
const RE_REPL = /\uFFFD/g;           // replacement char   => decoding outright failed

const countOf = (text, re) => (String(text).match(re) || []).length;

function analyse(label, text) {
  const t = String(text || '');
  const arabic = countOf(t, RE_ARABIC);
  const latin = countOf(t, RE_LATIN);
  const pua = countOf(t, RE_PUA);
  const repl = countOf(t, RE_REPL);

  console.log('\n  --- ' + label + ' ---');
  console.log('  chars                 : ' + t.length);
  console.log('  arabic-script letters : ' + arabic);
  console.log('  latin letters         : ' + latin);
  console.log('  private-use glyphs    : ' + pua + '   <-- anything > 0 means broken font encoding');
  console.log('  U+FFFD replacements   : ' + repl);

  let verdict;
  if (!t.length) {
    verdict = 'EMPTY — nothing came back at all.';
  } else if (pua > 20 || repl > 20) {
    verdict = 'GARBAGE — broken ToUnicode map. force_ocr=true is MANDATORY.';
  } else if (arabic === 0 && t.length > 200) {
    verdict = 'NO URDU FOUND — text layer decodes to non-Urdu junk. force_ocr=true is MANDATORY.';
  } else if (arabic > 50) {
    verdict = 'USABLE URDU. Extraction is FINE — if sections are still 0, the bug is downstream (reading order / bidi), NOT extraction.';
  } else {
    verdict = 'THIN — almost no real text. Likely a scanned/image PDF. do_ocr=true is MANDATORY.';
  }
  console.log('  VERDICT: ' + verdict);
  console.log('  --- first 400 chars, look at them with your own eyes ---');
  console.log('  ' + JSON.stringify(t.slice(0, 400)));
}

// ---------------------------------------------------------------------------
// 0. Read YOUR server's OpenAPI schema. Stop guessing which options exist.
// ---------------------------------------------------------------------------
async function schemaCheck() {
  console.log('\n========== 0. WHAT DOES YOUR docling-serve ACTUALLY ACCEPT? ==========');
  try {
    const res = await fetch(DOCLING_URL + '/openapi.json');
    if (!res.ok) {
      console.log('GET /openapi.json -> HTTP ' + res.status + '  (open ' + DOCLING_URL + '/docs in a browser instead)');
      return;
    }
    const spec = await res.json();
    const schemas = (spec && spec.components && spec.components.schemas) || {};

    let printed = 0;
    for (const [name, def] of Object.entries(schemas)) {
      if (/ocr|backend|table|pipeline/i.test(name) && Array.isArray(def.enum)) {
        console.log('  enum ' + name + ' = ' + JSON.stringify(def.enum));
        printed += 1;
      }
    }

    const interesting = ['ocr_engine', 'ocr_lang', 'ocr_preset', 'force_ocr', 'do_ocr', 'pdf_backend'];
    const seen = new Set();
    (function walk(node) {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      for (const [k, v] of Object.entries(node)) {
        if (interesting.includes(k) && v && typeof v === 'object') {
          console.log('  field ' + k + ' = ' + JSON.stringify(v).slice(0, 260));
          printed += 1;
        }
        if (v && typeof v === 'object') walk(v);
      }
    })(spec);

    if (!printed) console.log('  (nothing matched — open ' + DOCLING_URL + '/docs and read the /v1/convert/file schema)');
    console.log('\n  >> If "easyocr" is NOT in the ocr_engine enum, your build cannot read Urdu at all.');
    console.log('  >> Fix: pip install easyocr   (in the same venv that runs docling-serve), then restart it.');
  } catch (e) {
    console.log('  openapi probe failed: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// Docling call. Every failure is PRINTED IN FULL, not overwritten.
// ---------------------------------------------------------------------------
async function docling(label, extraFields) {
  console.log('\n========== ' + label + ' ==========');
  console.log('  POST ' + DOCLING_URL + '/v1/convert/file');
  console.log('  extra fields: ' + JSON.stringify(extraFields));

  const form = new FormData();
  form.append('files', new Blob([buffer], { type: 'application/pdf' }), path.basename(file));
  form.append('from_formats', 'pdf');
  form.append('to_formats', 'md');
  form.append('image_export_mode', 'placeholder');
  form.append('table_mode', 'accurate');
  // NOTE: ocr_lang is a LIST. It is appended once PER LANGUAGE. Never "ur,en" in one string.
  for (const [k, v] of extraFields) form.append(k, v);

  const headers = { Accept: 'application/json' };
  if (DOCLING_API_KEY) headers['X-Api-Key'] = DOCLING_API_KEY;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();

  try {
    const res = await fetch(DOCLING_URL + '/v1/convert/file', {
      method: 'POST', body: form, headers, signal: controller.signal,
    });
    clearTimeout(timer);
    const raw = await res.text();
    console.log('  HTTP ' + res.status + ' in ' + ((Date.now() - started) / 1000).toFixed(1) + 's');

    if (!res.ok) {
      console.log('  BODY (THIS is the error your app was hiding):');
      console.log('  ' + raw.slice(0, 1200));
      return;
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      console.log('  200 OK but the body is NOT JSON:');
      console.log('  ' + raw.slice(0, 600));
      return;
    }

    console.log('  top-level keys : ' + Object.keys(data).join(', '));
    console.log('  status         : ' + data.status);
    console.log('  errors         : ' + JSON.stringify(data.errors || []));
    console.log('  document keys  : ' + Object.keys(data.document || {}).join(', '));

    analyse(label + ' :: md_content', (data.document && data.document.md_content) || '');
  } catch (e) {
    clearTimeout(timer);
    console.log('  REQUEST FAILED: ' + (e.name === 'AbortError'
      ? 'TIMEOUT after ' + TIMEOUT_MS + 'ms'
      : e.message));
  }
}

// ---------------------------------------------------------------------------
// C. The local fallback — the thing that produced your "4497 chars".
// ---------------------------------------------------------------------------
async function localExtract() {
  console.log('\n========== C. LOCAL pdf-parse (what your app is silently falling back to) ==========');
  try {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    if (typeof parser.destroy === 'function') await parser.destroy();
    analyse('local pdf-parse', (result && result.text) || '');
  } catch (e) {
    console.log('  pdf-parse failed: ' + e.message);
    console.log('  (are you running this from inside backend/ ?)');
  }
}

(async () => {
  console.log('FILE        : ' + file + '  (' + buffer.length + ' bytes)');
  console.log('DOCLING_URL : ' + DOCLING_URL);

  await schemaCheck();

  // A. exactly what your app sends TODAY (DOCLING_OCR defaults to 'false')
  await docling('A. DOCLING as your app calls it today (do_ocr=false)', [
    ['do_ocr', 'false'],
  ]);

  // B. the Urdu configuration
  await docling('B. DOCLING with force_ocr + Urdu', [
    ['do_ocr', 'true'],
    ['force_ocr', 'true'],
    ['ocr_engine', 'easyocr'],
    ['ocr_lang', 'ur'],
    ['ocr_lang', 'en'],
    ['pdf_backend', 'dlparse_v4'],
  ]);

  await localExtract();

  console.log('\n========== READ THE VERDICTS ==========');
  console.log('  A empty, B good     -> Docling was never broken. You had OCR off. Wire the flags.');
  console.log('  A returns 4xx/5xx   -> the BODY above names the exact field docling-serve rejected.');
  console.log('  B dies on the engine-> your build has no easyocr. See section 0.');
  console.log('  C shows PUA/garbage -> Urdu text layer is unusable. force_ocr is not optional.');
  console.log('  C shows clean Urdu  -> extraction was fine all along; the bug is reading order. Different fix.');
  console.log('\n  Paste the WHOLE output back. Do not summarise it.');
})();
