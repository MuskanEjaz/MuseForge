# IBM COS — Step 1: prove it works (nothing in the app is rewired yet)

## Why COS is real here (not decoration)

Your app saves users, public portfolios, reviews, and history to local JSON files in `data/`. Local
files are **wiped on every restart/redeploy** on IBM Cloud (ephemeral filesystem) — so those would
vanish the moment you deploy. COS gives durable storage that survives restarts, which is what makes
**deployment** possible. So the chain is genuine: COS → survives restarts → enables deployment →
scores on Feasibility, Real-World Impact, and "Best Use of Technology." This is effective use, not
padding.

**This step changes NONE of your app logic.** It only proves COS connects and round-trips. Step 2
wires the data layer to COS with a local fallback, after this passes.

## Files in this drop

- `cos-storage.js`        → COS wrapper (IAM or HMAC auth; JSON put/get/delete). Put in `backend/`.
- `verify-cos.js`        → live verification (list buckets → put → get → verify → delete). Put in `backend/`.
- `test-cos-storage.js`  → network-free tests (10 checks, passing here). Optional.

## STEP 1a — install + configure

```powershell
cd "C:\Users\FINE LAPTOP\Downloads\MUSEFORGE_COMPETITION_FINAL_TESTED\backend"
npm install ibm-cos-sdk
```

Add these to your `.env` (get the values from IBM Cloud → your COS instance). **IAM is preferred**
(matches your existing watsonx IAM setup):

```
COS_ENDPOINT=https://s3.<region>.cloud-object-storage.appdomain.cloud
COS_BUCKET=<your-bucket-name>
COS_API_KEY=<your COS service-credential apikey>
COS_RESOURCE_INSTANCE_ID=<your COS resource_instance_id>
```

Where to find them: IBM Cloud → your Cloud Object Storage instance →
- **Service credentials** (create one with the "Writer" or "Manager" role) → copy `apikey` and
  `resource_instance_id`.
- **Buckets** → your bucket → **Configuration** → **Endpoints** → copy the **Public** endpoint.
- If you don't have a bucket yet, create one first (any name/region).

(HMAC alternative, only if you prefer it: set `COS_HMAC_ACCESS_KEY_ID` + `COS_HMAC_SECRET_ACCESS_KEY`
instead of the two IAM vars. A service credential created with the "Include HMAC credential" option
provides these.)

**Keep `.env` in `.gitignore`.** Never commit these values.

## STEP 1b — verify

```powershell
node verify-cos.js
```

Expect, at the end:
```
=== VERDICT: IBM COS is WORKING (auth + bucket + read/write round-trip). ===
```

The script prints only booleans, the bucket/endpoint, and which vars are SET — never your key or
secret. If it fails, it names exactly what's wrong (wrong endpoint, missing bucket, credential lacks
write role, etc.).

Optional unit test (no network):
```powershell
node test-cos-storage.js
```
Expect: `ALL 10 CHECKS PASSED`.

## Paste back to me

- The full `verify-cos.js` output (it has no secrets in it).

## What Step 2 will do (after this passes)

Swap `readUsers`/`writeUsers`, public-portfolios, and history to read/write via COS, with the current
local-file path kept as a fallback (so nothing breaks if COS is briefly unreachable or unconfigured).
That's the change that makes your data survive a real deployment — and it's the honest way to add a
fifth IBM technology that actually earns its place.
