#!/usr/bin/env node
'use strict';
/**
 * MuseForge — dump what Docling actually extracts from a CV.
 *
 *   node dump-cv.js "C:\path\to\your-cv.pdf"
 *
 * Answers ONE question with evidence: is the extracted text one giant line
 * (so no section headings can be detected) or properly multi-line?
 * It changes nothing. Run from inside backend/ with docling-serve running.
 */
const fs = require('fs');
const path = require('path');

const DOCLING_URL = String(process.env.DOCLING_URL || 'http://localhost:5001').replace(/\/+$/, '');
const file = process.argv[2];
if (!file) { console.error('Usage: node dump-cv.js <path-to-cv.pdf>'); process.exit(1); }
if (!fs.existsSync(file)) { console.error('File not found: ' + file); process.exit(1); }
const buffer = fs.readFileSync(file);

(async () => {
  const form = new FormData();
  form.append('files', new Blob([buffer], { type: 'application/pdf' }), path.basename(file));
  form.append('from_formats', 'pdf');
  form.append('to_formats', 'md');
  form.append('do_ocr', 'false');
  form.append('image_export_mode', 'placeholder');
  form.append('table_mode', 'accurate');

  let res;
  try {
    res = await fetch(DOCLING_URL + '/v1/convert/file', { method: 'POST', body: form, headers: { Accept: 'application/json' } });
  } catch (e) {
    console.error('Could not reach docling at ' + DOCLING_URL + ' — is docling-serve running? ' + e.message);
    process.exit(1);
  }
  if (!res.ok) { console.error('Docling HTTP ' + res.status + ': ' + (await res.text()).slice(0, 300)); process.exit(1); }

  const data = await res.json();
  const md = String((data.document && data.document.md_content) || '');

  const newlineCount = (md.match(/\n/g) || []).length;
  const lines = md.split('\n').map(l => l.trim()).filter(Boolean);

  console.log('=================================================');
  console.log('markdown length : ' + md.length + ' chars');
  console.log('newline count   : ' + newlineCount);
  console.log('non-empty lines : ' + lines.length);
  console.log('VERDICT         : ' + (lines.length <= 2
    ? 'ONE-LINE / COLLAPSED  ->  Docling is NOT producing structure for this PDF. This is why sections=0.'
    : 'MULTI-LINE (' + lines.length + ' lines)  ->  structure exists; the bug is in section matching, not extraction.'));
  console.log('=================================================');
  console.log('\n----- RAW DOCLING MARKDOWN (first 2500 chars, exactly as Docling returns it) -----\n');
  console.log(md.slice(0, 2500));
  console.log('\n----- END -----');
  console.log('\nPaste this WHOLE output back. The VERDICT + the raw markdown tell me exactly how to fix parsing.');
})();
