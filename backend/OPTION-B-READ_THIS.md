# OPTION B — fail honestly on unreadable CV PDFs

## What we decided (plain version)

- **Approach:** Option B. When a PDF can't be read into usable text (scanned image, or broken font
  like Urdu Nastaliq/InPage), we STOP producing a hollow portfolio and tell the user to fill the
  form or paste their text. Your OCR probe confirmed OCR can't rescue these PDFs, so this is the
  right call.
- **Urdu:** KEPT. Urdu portfolio generation is untouched. We only stop pretending we can parse
  broken Urdu PDFs.
- **Multi-language CV upload:** KEPT. Clean PDFs in every language still parse. The detector is
  language-agnostic — it also catches a broken/scanned English PDF.
- **Nothing is removed. No languages dropped. No features deleted.**

This is backend-only. Your frontend already shows `data.warning`, so no UI change is needed.

---

## Files in this drop

- `cv-readability.js`        → the detector. Put it in `backend/` next to `server.js`.
- `test-cv-readability.js`   → tests (7 checks, all passing here). Optional to keep.

---

## STEP 1 — add the detector (three small edits, no logic removed)

**Edit 1.** Put `cv-readability.js` in `backend/`.

**Edit 2.** Near the top of `server.js`, with your other `require(...)` lines, add:
```js
const { assessCvReadability, UNREADABLE_CV_MESSAGE } = require('./cv-readability');
```

**Edit 3.** In your `app.post('/parse-cv', ...)` handler, find these two lines (they already exist):
```js
    const best = parseBestCv(candidates, embeddedCvLinks);
    const cvText = best.source === 'docling' ? candidates.docling : candidates.local;
```
and immediately AFTER them, before the `await sendToParserAndRespond(...)` line, paste:
```js
    // Option B: if the PDF text is shattered/unreadable (broken font or scanned image, ANY language),
    // do not emit a hollow portfolio — fail honestly so FactLock is never fed garbage.
    const readability = assessCvReadability(cvText, best.parsed);
    if (readability.unreadable) {
      console.log('CV unreadable:', JSON.stringify(readability));
      return res.json({
        ...parseCvTextLocally('', embeddedCvLinks),
        unreadable: true,
        warning: UNREADABLE_CV_MESSAGE,
      });
    }
```

That's it. If `best.parsed` isn't the exact variable name in your current file, tell me what
`parseBestCv(...)` returns in your version and I'll adjust — don't guess.

---

## STEP 2 — test (two checks, then stop)

1. Unit test (no network):
```powershell
cd "C:\Users\FINE LAPTOP\Downloads\MUSEFORGE_COMPETITION_FINAL_TESTED\backend"
node test-cv-readability.js
```
Expect: `ALL 7 CHECKS PASSED`.

2. Real behaviour, with `npm run dev` running:
   - Upload the **Urdu** `CV_Marketing_Manager_Urdu.pdf`. It must now show the honest message
     ("We couldn't reliably read this PDF …") instead of an empty auto-fill. In the terminal you'll
     see one line: `CV unreadable: {"reason":"shattered-glyphs",...}`.
   - Upload a **clean English** PDF (any normal text-based CV). It must STILL parse and auto-fill as
     before. This is the regression check — it proves we didn't break the working path.

---

## Paste back to me

- `node test-cv-readability.js` output.
- What happened on BOTH uploads: the Urdu one (should show the honest message) and a clean English
  one (should still auto-fill).

Once this is confirmed, the Urdu/CV track is DONE. Then — and only then — we go back to the IBM
audit track (the `/ibm-status` patch), one step at a time. They are separate; we finish this first.
