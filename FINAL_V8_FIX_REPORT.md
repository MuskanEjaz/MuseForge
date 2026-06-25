# MuseForge v8 Final Fix Report

## Fixed in v8

1. **CV parsing failure fixed**
   - The backend was treating `generateAiText()` as an old OpenAI completion object.
   - It now parses the returned AI text directly with `parseJsonObject()`.
   - If the PDF has no readable embedded text, the backend returns a safe response with a warning instead of crashing.

2. **Language-specific portfolio output strengthened**
   - Added strict native-script checks for Urdu, Arabic, Hindi, Chinese, Japanese, Korean, etc.
   - Added safeguards so Arabic/Urdu/Hindi pages do not silently fall back to Roman Urdu or English text.
   - Added strict fallback language text when AI is unavailable or returns the wrong script.

3. **Roman Urdu / Urdu / Arabic handling improved**
   - Removed the early Roman Urdu shortcut that prevented AI translation from running.
   - `translateTextStrict()` now tries the configured AI provider for Roman Urdu too.

4. **FactLock regeneration improved**
   - Regenerate now requests strict JSON.
   - It uses the selected tone and target language.
   - If the model returns the same text or wrong language, the backend forces a strict translation fallback.

5. **Auto-login disabled on fresh app open**
   - The app now opens to the welcome/login flow again after refresh/reopen instead of directly entering the logged-in app.

6. **Hover effects added**
   - FactLock / Multi-language / Shareable URL cards.
   - Review cards.
   - Template cards and trust report cards.

7. **Install reliability**
   - `.env` files are not included.
   - `package-lock.json` files are not included to avoid internal/broken registry references.

## Verified locally in container

- `node --check backend/server.js` passed.
- `node --check src/App.js` passed.
- Confirmed `.env` is excluded from the final package.
- Confirmed package lock files are excluded from the final package.

## Required runtime setup

Use a fresh `.env` inside `backend`:

```env
AI_PROVIDER=auto
GEMINI_API_KEY=your_new_gemini_key
GEMINI_MODEL=gemini-1.5-flash
OPENAI_API_KEY=your_new_openai_key
OPENAI_MODEL=gpt-4o-mini
```

Important: rotate API keys if they were shown in screenshots.
