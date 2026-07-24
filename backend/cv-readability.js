'use strict';
/**
 * MuseForge — Option B: honest failure for unreadable CV PDFs.
 *
 * Some PDFs cannot be turned into usable text: scanned images with no text layer, or documents
 * whose font has a broken/absent ToUnicode map so extraction yields shattered, disjoined glyphs.
 * Urdu Nastaliq / InPage exports are the classic case — we proved a real one comes out as ~700
 * single-glyph lines with zero connected words and zero detectable sections.
 *
 * Feeding that into portfolio generation produces a hollow, or worse, a mis-transcribed portfolio —
 * which would undermine FactLock (it would present invented "facts"). So instead of pretending, we
 * DETECT the unreadable case and let the caller fail honestly ("fill the form or paste your text").
 *
 * This is LANGUAGE-AGNOSTIC. It never targets Urdu specifically; it catches any broken/scanned PDF
 * in any language, and it leaves clean CVs (English, Urdu, French, CJK, …) completely untouched.
 *
 * Pure function, no I/O, no server.js dependency — trivially testable.
 */

// Arabic-script block (covers Urdu + Arabic + presentation forms).
const RE_ARABIC_CHAR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
// A "word" in each script = a run of 3+ connected letters. 3+ is a real word, not a stray fragment.
const RE_ARABIC_WORD = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]{3,}/g;
const RE_LATIN_CHAR = /[A-Za-z]/g;
const RE_LATIN_WORD = /[A-Za-z]{3,}/g;
const countOf = (t, re) => (String(t).match(re) || []).length;

/**
 * @param {string} rawText   the extracted CV text (Docling or local), before/around parsing
 * @param {object} parsed    the parser result (uses .customSections/.skills/.projects lengths)
 * @returns {{unreadable:boolean, reason:string, singleGlyphRatio:number, dominantScript:string,
 *            dominantWords:number, structured:number, totalLines:number}}
 */
function assessCvReadability(rawText = '', parsed = {}) {
  const text = String(rawText || '');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const totalLines = lines.length;

  // Signal 1 — shattered glyph extraction: most lines are a single character.
  const singleGlyphLines = lines.filter(l => l.replace(/\s+/g, '').length === 1).length;
  const singleGlyphRatio = totalLines ? singleGlyphLines / totalLines : 1;

  // Signal 2 — does the DOMINANT script actually form words? (Latin email/URLs must not mask a
  // destroyed Urdu body: if the doc is Arabic-dominant but has ~0 Arabic words, it's shattered.)
  const arabicChars = countOf(text, RE_ARABIC_CHAR);
  const latinChars = countOf(text, RE_LATIN_CHAR);
  const dominantIsArabic = arabicChars > 0 && arabicChars >= latinChars;
  const dominantScript = dominantIsArabic ? 'arabic' : 'latin';
  const dominantWords = dominantIsArabic ? countOf(text, RE_ARABIC_WORD) : countOf(text, RE_LATIN_WORD);

  // Signal 3 — did the parser recover ANY structure? A real CV yields at least one section/skill/project.
  const structured =
    (Array.isArray(parsed && parsed.customSections) ? parsed.customSections.length : 0) +
    (Array.isArray(parsed && parsed.skills) ? parsed.skills.length : 0) +
    (Array.isArray(parsed && parsed.projects) ? parsed.projects.length : 0);

  let unreadable = false;
  let reason = 'ok';
  if (totalLines === 0) { unreadable = true; reason = 'empty'; }
  else if (singleGlyphRatio >= 0.35) { unreadable = true; reason = 'shattered-glyphs'; }
  else if (structured === 0 && dominantWords < 5) { unreadable = true; reason = 'no-words-no-structure'; }

  return { unreadable, reason, singleGlyphRatio: Number(singleGlyphRatio.toFixed(2)), dominantScript, dominantWords, structured, totalLines };
}

// The user-facing message. Honest, non-technical, actionable. Never blames the user.
const UNREADABLE_CV_MESSAGE =
  'We couldn’t reliably read this PDF — it looks like a scanned image, or it uses a font whose ' +
  'text can’t be extracted (common for Urdu Nastaliq / InPage PDFs). Please fill the form manually, ' +
  'or paste your text into the description box.';

module.exports = { assessCvReadability, UNREADABLE_CV_MESSAGE };
