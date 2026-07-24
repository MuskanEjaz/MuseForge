# FIX — the broken "AI Suggestions" button (adds POST /suggest-projects)

## What was wrong

Your App.js "AI Suggestions" button sends a request to `/suggest-projects`, but your `server.js`
had no route for it. So the button did nothing (a 404 behind the scenes). This fix adds the route,
routes it through **LangChain → watsonx Granite** (your `generateAiText`), and falls back to your
existing `fallbackProjectSuggestions` if the AI is unavailable — so the button ALWAYS produces
something, even offline.

**Only additions. Nothing existing is changed or removed.**

## Files in this drop

- `project-suggestions.js`       → helper functions. Put it in `backend/` next to `server.js`.
- `test-project-suggestions.js`  → tests (9 checks, passing here). Optional to keep.

---

## STEP — three small edits (do them slowly, in order)

### Edit 1 — add the helper file
Copy `project-suggestions.js` into your `backend/` folder (same place as `server.js`).

### Edit 2 — add ONE require line at the top of server.js
Near your other `require(...)` lines at the very top of `server.js` (for example right under the
`cv-readability` require you already added), add this line:

```js
const { buildSuggestionMessages, parseSuggestionsFromAiText, normalizeSuggestions } = require('./project-suggestions');
```

### Edit 3 — add the route
Open `server.js` and find where your `/generate` route ENDS. It starts with:
```js
app.post('/generate', ...
```
Scroll down to where that handler closes (the line `});` that ends it, just before
`app.post('/parse-cv'`). Paste this WHOLE block on a new line there:

```js
// ---- AI Suggestions: POST /suggest-projects (routes through LangChain -> watsonx Granite) ----
app.post('/suggest-projects', async (req, res) => {
  const body = req.body || {};
  const name = body.name || '';
  const medium = body.medium || '';
  const description = body.description || '';
  const projects = Array.isArray(body.projects) ? body.projects : [];
  const targetLanguage = body.targetLanguage || 'English';
  const aiTone = body.aiTone || 'Professional';

  try {
    const messages = buildSuggestionMessages({ name, medium, description, projects, targetLanguage, aiTone });
    const aiText = await generateAiText({ messages, temperature: 0.4, maxTokens: 700 });
    let suggestions = normalizeSuggestions(parseSuggestionsFromAiText(aiText));
    if (suggestions.length === 0) {
      // AI returned nothing usable -> deterministic fallback so the button always works
      suggestions = normalizeSuggestions(fallbackProjectSuggestions({ medium, description, targetLanguage }));
    }
    return res.json({ suggestions: suggestions.slice(0, 3) });
  } catch (err) {
    console.error('suggest-projects error:', err.message);
    const suggestions = normalizeSuggestions(fallbackProjectSuggestions({ medium, description, targetLanguage }));
    return res.json({ suggestions: suggestions.slice(0, 3) });
  }
});
```

> This block uses two functions your `server.js` already has: `generateAiText(...)` and
> `fallbackProjectSuggestions(...)`. If for any reason they are named differently in your current
> file, tell me and I'll adjust — do not rename them yourself.

---

## TEST (two checks)

### 1. Unit test (no internet, fast)
```powershell
cd "C:\Users\FINE LAPTOP\Downloads\MUSEFORGE_COMPETITION_FINAL_TESTED\backend"
node test-project-suggestions.js
```
Expect: `ALL 9 CHECKS PASSED`.

### 2. Real button test
- Start the app (`npm run dev`) with watsonx running.
- In the form, type something in the **description** box (the button is disabled until you do).
- Click **AI Suggestions**.
- You should see **3 project ideas** appear, each with a title, a description, and an **Add** button.
- Try it once with **Portfolio language = Urdu** too — the suggestions should come back in Urdu.

If watsonx is briefly down, you'll still get 3 (deterministic) suggestions — that's the fallback
doing its job so the demo never shows a dead button.

---

## Paste back to me

- `node test-project-suggestions.js` output.
- What happened when you clicked **AI Suggestions** (did 3 ideas appear?).

Then this fix is done and we continue with the plan. Reminder of where we are:

```
1. Option B            DONE (wired + working)
2. COS connect         DONE (verify-cos = WORKING)
>> this fix: AI Suggestions button   <-- you are here
3. COS save data (Step 2)
4. Branding (remove "Groq")
5. IBM hardening (/ibm-status, strict mode, safe logging)
6. Languages test (17)
7. README + evidence
8. Deploy + demo video
```
