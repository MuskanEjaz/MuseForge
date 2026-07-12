MuseForge CV Parser Real-Tested Fix

This package fixes the CV parser using the two real PDFs uploaded in the chat:
- MuskanEjaz_CV.pdf
- Sample_CV.pdf

What is fixed:
- Project bullets are grouped under the correct project title.
- Wrapped lines like "content" and "feed" are no longer treated as fake project titles.
- Embedded clickable PDF links are extracted with pdfjs-dist.
- GitHub repo links are assigned to project cards.
- Workshop/certification proof links are assigned to custom-section items.
- AI CV parsing is bypassed for /parse-cv to avoid Groq rate-limit failures and hallucinated grouping.
- App.js is patched only to preserve custom-section item links; it is not replaced.

Install:
1. Extract this ZIP into:
   C:\Users\FINE LAPTOP\Downloads\MUSEFORGE_COMPETITION_FINAL_TESTED

2. Run:
   powershell -ExecutionPolicy Bypass -File .\install-real-tested-cv-parser-fix.ps1

3. Run:
   npm run build

4. Restart backend:
   cd .\backend
   npm start

Expected backend log on CV upload:
   CV extraction: {"textChars":..., "embeddedLinks":...}
   === PARSED RESULT ===
