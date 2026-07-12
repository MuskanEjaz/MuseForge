# SETUP — do this in order, two steps at a time

Nothing here is optional if you want the IBM prize. Tick each box before moving on.

---

## PART 1 — Get it running (30 minutes)

### Step 1. Put the files in place
Copy from this zip into your project:

| File | Where it goes |
|---|---|
| `server.js` | your backend folder (replaces the old one) |
| `App.js`, `App.css` | your React `src/` folder |
| `package.json` | your backend folder |
| `.env.example` | your backend folder |
| `verify-ibm.js`, `verify-languages.js` | your backend folder |
| `tests/*` | your backend folder (same level as `server.js`) |

### Step 2. Install and check it boots
```bash
cd your-backend-folder
npm install
cp .env.example .env
node -e "require('./server.js'); console.log('OK')"
```
You must see `OK`. If not, stop and send me the error.

**Checkpoint:** ✅ server.js loads.

---

## PART 2 — Prove the code works, before you touch any cloud (10 minutes)

### Step 3. Run the offline test suite
```bash
node tests/language-e2e-test.js
node tests/regenerate-e2e-test.js
node tests/cv-test-harness.js 300
```
No API key needed. You should see 100% on all three.

### Step 4. Start the app
```bash
npm start                 # backend
npm start                 # frontend, in the other folder
```
Upload a CV. It will work with **no AI key at all** — the output will be a safe local draft.
That is by design: the demo can never hard-fail.

**Checkpoint:** ✅ App runs, CV parses, portfolio appears.

---

## PART 3 — IBM Cloud + watsonx (Granite). This is the big one. (45 minutes)

### Step 5. Create your IBM Cloud account and a watsonx project
1. Sign up: https://cloud.ibm.com/registration?utm_content=academicsb
2. Go to **watsonx.ai** → **Create a project** (a sandbox project is fine).
3. Open the project → **Manage** tab → copy the **Project ID**. Save it.

### Step 6. Create an API key and associate the service
1. IBM Cloud → **Manage** → **Access (IAM)** → **API keys** → **Create**. Copy the key **now** (it is shown once).
2. Back in your watsonx project → **Manage** → **Services & integrations** → **Associate service** → pick your **watsonx.ai Runtime** instance. *(Skip this and every call returns a permissions error.)*

Now fill in `.env`:
```
AI_PROVIDER=watsonx
WATSONX_API_KEY=<the key from step 6>
WATSONX_PROJECT_ID=<the id from step 5>
WATSONX_URL=https://us-south.ml.cloud.ibm.com     # must match your project's region
```

**Checkpoint:** ✅ `.env` has a key, a project id, and the right region.

---

## PART 4 — Confirm Granite is really answering (15 minutes)

### Step 7. Run the verifier
```bash
node verify-ibm.js
```
It mints an IAM token, **lists the Granite models that actually exist in your region**, calls Granite
live, and checks Docling. `WATSONX_MODEL` in `.env` is a guess until this runs — if the verifier says
your model id is not in the list, copy one from its output into `.env` and run it again.

### Step 8. Measure which languages Granite is actually good at
```bash
node verify-languages.js
```
This asks Granite for a portfolio bio in each of the 17 languages and scores it.
**Any language it marks WEAK, do not demo.** Pay particular attention to Urdu: Granite's official
language list does not include it, so the prose may be plainer than the others. The *system* is
proven correct for Urdu (script, headings, facts, no Arabic bleed-through) — what the probe tells
you is how good Granite's Urdu *writing* is. Decide with the evidence, not a feeling. If several are weak, remove them:
- `App.js` → `LANGUAGE_OPTIONS`
- `server.js` → `ACTIVE_OUTPUT_LANGUAGES`
(Those two lists must always match.)

**Checkpoint:** ✅ Granite replies. ✅ You know which languages are safe to demo.

---

## PART 5 — Docling (document processing) (20 minutes)

### Step 9. Run docling-serve
```bash
docker run -p 5001:5001 quay.io/docling-project/docling-serve
```
Then in `.env`:
```
DOCLING_URL=http://localhost:5001
```

### Step 10. Test it against a real CV
```bash
node verify-ibm.js ./your-real-cv.pdf
```
Docling must return markdown. If it fails, the app still works (it falls back to the local PDF
parsers) — **but then you cannot claim Docling in your submission.** Don't claim what doesn't run.

**Checkpoint:** ✅ Docling returns markdown for a real PDF.

---

## PART 6 — LangFlow (20 minutes, high visual payoff)

### Step 11. Install and open LangFlow
```bash
pip install langflow
langflow run
```
Opens at http://localhost:7860.

### Step 12. Build the MuseForge flow and export it
Build these nodes, left to right:

```
File Input (CV)
     │
     ▼
Docling / Document Loader        ← structure-aware extraction
     │
     ▼
Prompt Template                  ← "stay in {language}, keep every fact, add nothing"
     │
     ▼
IBM watsonx.ai (Granite)         ← LangFlow ships a watsonx component; paste the same
     │                              API key / project id / model id from your .env
     ▼
Conditional / Router             ← this is FactLock: invented number or wrong language → reject
     │                              and take the grounded local draft instead
     ▼
Output (portfolio)
```

Then: **Export** → save the JSON as `langflow/museforge-flow.json` in your repo, and screenshot the
canvas into `docs/langflow.png`. Link both from the README.

This is the cheapest visible IBM tick you can get. Judges look at pictures.

**Checkpoint:** ✅ Flow JSON + screenshot committed.

---

## PART 7 — IBM Bob (REQUIRED — you cannot win without this) (ongoing)

### Step 13. Actually build in Bob
https://bit.ly/IBMBob-freetrial — this is the **required primary development tool**. Do real work in
it: ask it to add a feature, fix a bug, refactor a module. **Take screenshots as you go.**

### Step 14. Write the "How IBM Bob was used" section
Open `README.md` — I left that section empty with a comment. Fill it with **specifics**, not vibes:

> ❌ "We used IBM Bob to help develop the project."
> ✅ "IBM Bob scaffolded the Express + React structure, implemented the watsonx provider in
> `server.js` (IAM token caching + chat endpoint), and helped debug the PDF link reading-order
> bug where links were being read bottom-up. Session screenshots in `/docs/bob/`."

**Checkpoint:** ✅ Bob screenshots in the repo. ✅ README section written with specifics.

---

## PART 8 — Submission (do not lose marks here)

### Step 15. SkillsBuild — every single team member
Each person completes one IBM Bob course/webinar and **uploads their certificate**.
One missing certificate can invalidate the whole team. Do this first, not last.

### Step 16. Repo, video, page
- Public GitHub repo with the README (problem, solution, AI approach + architecture, theme,
  how IBM Bob was used).
- Demo video, **maximum 3 minutes**, publicly accessible.
- Project page published by **31 July, 11:59 PM ET**.

---

## Before you record the demo — the honesty check

Set this in `.env`:
```
WATSONX_STRICT=true
```
This stops the server from silently falling back to a non-IBM model if watsonx hiccups. Leave it
`false` and your "powered by IBM Granite" claim can quietly become false **in the middle of a demo
about not lying.** Do not let that happen.

Then run once more:
```bash
node verify-ibm.js && node verify-languages.js
```
Everything PASS → record.

---

## Optional: Context Forge (only if you have time)

Context Forge (`https://ibm.github.io/mcp-context-forge/`) is an MCP gateway/registry. It is a
genuine extra tick, but it adds a moving part. Only do it once Parts 1–8 are green. If you do:
run the gateway, register your model calls through it, and mention it in the architecture section.

**Do not start this before IBM Bob and SkillsBuild are done. Those are required. This is not.**
