# STEP 5 (part 1) — add the /ibm-status endpoint. Every command, nothing skipped.

You'll add a small read-only endpoint that reports your IBM setup as simple true/false values.
It touches NONE of your existing features. Two files, one paste, then test.

Your backend runs on PORT 5000 (confirmed in your server.js).

---

## 1. Put the file in the right folder

Download `ibm-status.js` (from this message) and move it into your **backend** folder — the same
folder that has `server.js`, `cos-storage.js`, `cv-readability.js`.

To confirm it's in the right place, run this in the backend terminal:

```powershell
cd "C:\Users\FINE LAPTOP\Downloads\MUSEFORGE_COMPETITION_FINAL_TESTED\backend"
dir ibm-status.js
```

You should see the file listed. If it says "File Not Found", it's in the wrong folder — move it.

---

## 2. Wire it into server.js (one small paste)

1. Open `server.js` in VS Code.
2. Press `Ctrl + F` and search for exactly:
   ```
   app.post('/suggest-projects'
   ```
   (This is the route you added last time — easy to find.)
3. Click on the **blank line just ABOVE** that `app.post('/suggest-projects'` line.
4. Paste this whole block there:

```js
// Safe, read-only IBM status probe (booleans + public config only; never secrets).
require('./ibm-status').registerIbmStatus(app, {
  watsonxConfigured,
  watsonxModel: WATSONX_MODEL,
  watsonxStrict: WATSONX_STRICT,
  doclingUrl: DOCLING_URL,
  doclingProbeTimeoutMs: 2500,
});
```

5. Press `Ctrl + S` to save.

(This works because `watsonxConfigured`, `WATSONX_MODEL`, `WATSONX_STRICT`, and `DOCLING_URL`
already exist in your file — I checked.)

---

## 3. Check nothing broke (syntax)

In the backend terminal:

```powershell
node --check server.js
```

If it prints **nothing** and gives you a fresh line, that means NO syntax errors. Good.
If it prints a red error, tell me the exact message — don't continue.

---

## 4. Run the unit test

```powershell
node test-ibm-status.js
```

Expect the last line to say:

```
ALL 12 CHECKS PASSED
```

---

## 5. See it live in your browser

1. Start your app the same way you normally do (so the backend on port 5000 is running).
2. Open your web browser (Chrome/Edge).
3. In the address bar, type this and press Enter:

```
http://localhost:5000/ibm-status
```

You'll see something like:

```json
{
  "watsonxConfigured": true,
  "graniteModel": "ibm/granite-3-3-8b-instruct",
  "langchainInstalled": true,
  "doclingConfigured": true,
  "doclingReachable": true,
  "strictIbmMode": false
}
```

**Read it like a checklist:**
- `graniteModel` — tells you the exact model your app uses right now.
- `strictIbmMode` — for the demo this should later be `true` (we'll set that next).
- `doclingReachable` — `false` just means docling-serve isn't running at that moment; that's fine.

Nothing prints your API key or any secret — only these true/false values and the model name.

---

## 6. Send me back

1. The `node test-ibm-status.js` result (did it say ALL 12 CHECKS PASSED?).
2. The exact JSON you saw at `http://localhost:5000/ibm-status`.

That JSON tells me your real IBM state, and then I'll give you the NEXT small step:
turning on strict IBM mode + safe logging (the rest of Step 5). One step at a time.
