# 🐛 MuseForge Deployment Issues - Diagnosis & Fixes

## 🔴 Issues Identified

### Issue 1: CV Upload Fails - "CV parsing failed"
### Issue 2: Portfolio Generation Fails - "Error generating portfolio"

---

## 🔍 Root Causes Found

### 1. **CORS Configuration Issue**
**Problem:** Your CORS is configured to only accept requests from `process.env.FRONTEND_URL`, but:
- If `FRONTEND_URL` is not set or is wrong, requests will be blocked
- Vercel URL might not match exactly (trailing slash, www, etc.)

**Location:** `backend/server.js` line 17

### 2. **Missing Error Details in Frontend**
**Problem:** Frontend doesn't show detailed error messages from backend
- Only shows generic "CV parsing failed" or "Error generating portfolio"
- Actual error details are lost

**Location:** `src/App.js` lines 64-65, 162-168

### 3. **Potential Groq API Key Issue**
**Problem:** If the API key is invalid or not set in Railway:
- Both endpoints will fail silently
- Error messages don't indicate API key problems

---

## 🛠️ Fixes

### Fix 1: Update CORS Configuration (Backend)

**Current Code (Line 16-21):**
```javascript
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
```

**Fixed Code:**
```javascript
// CORS configuration for production
const allowedOrigins = [
  'http://localhost:3000',
  'https://muse-forge.vercel.app',
  'https://museforge.vercel.app',
  process.env.FRONTEND_URL
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
```

### Fix 2: Improve Error Handling (Frontend)

**Current Code (Lines 56-104):**
```javascript
const handleCV = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setCvLoading(true);
  setPortfolio(""); setProjects([]); setCustomSections([]);
  try {
    const formData = new FormData();
    formData.append('cv', file);
    const res = await fetch(`${API_URL}/parse-cv`, { method: 'POST', body: formData });
    const data = await res.json();
    // ... rest of code
  } catch (err) {
    alert("CV parsing failed. Please fill manually.");
  }
  setCvLoading(false);
};
```

**Fixed Code:**
```javascript
const handleCV = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setCvLoading(true);
  setPortfolio(""); setProjects([]); setCustomSections([]);
  try {
    const formData = new FormData();
    formData.append('cv', file);
    const res = await fetch(`${API_URL}/parse-cv`, { method: 'POST', body: formData });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`);
    }
    
    const data = await res.json();
    console.log('CV parsed:', data);
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    // ... rest of successful parsing code
    
  } catch (err) {
    console.error('CV parsing error:', err);
    alert(`CV parsing failed: ${err.message}\n\nPlease try again or fill manually.`);
  }
  setCvLoading(false);
};
```

**Current Code (Lines 157-170):**
```javascript
const generate = async () => {
  if (!name || !medium || !description) { alert("Please fill all fields"); return; }
  setLoading(true); setPortfolio("");
  try {
    const projectList = projects.filter(p => p.title.trim()).map(p => `- ${p.title}${p.desc ? ': ' + p.desc : ''}`).join('\n');
    const res = await fetch(`${API_URL}/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, medium, description, projectList }),
    });
    const data = await res.json();
    setPortfolio(data.portfolio);
  } catch { setPortfolio("Error generating portfolio. Try again."); }
  setLoading(false);
};
```

**Fixed Code:**
```javascript
const generate = async () => {
  if (!name || !medium || !description) { 
    alert("Please fill all fields"); 
    return; 
  }
  setLoading(true); 
  setPortfolio("");
  try {
    const projectList = projects.filter(p => p.title.trim())
      .map(p => `- ${p.title}${p.desc ? ': ' + p.desc : ''}`)
      .join('\n');
    
    const res = await fetch(`${API_URL}/generate`, {
      method: "POST", 
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, medium, description, projectList }),
    });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`);
    }
    
    const data = await res.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    if (data.portfolio) {
      setPortfolio(data.portfolio);
    } else {
      throw new Error('No portfolio content received');
    }
  } catch (err) {
    console.error('Portfolio generation error:', err);
    setPortfolio(`Error generating portfolio: ${err.message}\n\nPlease try again.`);
  }
  setLoading(false);
};
```

### Fix 3: Add Logging to Backend

**Add after line 66:**
```javascript
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Log configuration on startup
console.log('=== MuseForge Backend Configuration ===');
console.log('PORT:', process.env.PORT || 5000);
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('FRONTEND_URL:', process.env.FRONTEND_URL || 'not set');
console.log('GROQ_API_KEY:', process.env.GROQ_API_KEY ? 'SET (length: ' + process.env.GROQ_API_KEY.length + ')' : 'NOT SET');
console.log('=======================================');
```

---

## 🚀 Deployment Steps

### Step 1: Check Railway Environment Variables

1. Go to: https://railway.app/dashboard
2. Click on your **museforge** project
3. Click on **backend service**
4. Go to **Variables** tab
5. Verify these variables exist:

```
GROQ_API_KEY=gsk_... (your actual key)
NODE_ENV=production
PORT=5000
FRONTEND_URL=https://muse-forge.vercel.app
```

**Important:** Make sure `FRONTEND_URL` matches your Vercel URL EXACTLY (no trailing slash)

### Step 2: Check Vercel Environment Variables

1. Go to: https://vercel.com/dashboard
2. Click on your **muse-forge** project
3. Go to **Settings** → **Environment Variables**
4. Verify this variable exists:

```
REACT_APP_API_URL=https://museforge-production.up.railway.app
```

**Important:** No trailing slash!

### Step 3: Update Backend Code

Apply the CORS fix to `backend/server.js`:

```bash
# In your local project
# Update lines 16-21 with the fixed CORS code above
git add backend/server.js
git commit -m "Fix CORS for production deployment"
git push origin main
```

Railway will auto-deploy.

### Step 4: Update Frontend Code

Apply the error handling fixes to `src/App.js`:

```bash
# Update handleCV and generate functions with fixed code above
git add src/App.js
git commit -m "Improve error handling and logging"
git push origin main
```

Vercel will auto-deploy.

### Step 5: Test the Deployment

1. **Test Health Endpoint:**
   ```bash
   curl https://museforge-production.up.railway.app/health
   ```
   Should return: `{"status":"healthy",...}`

2. **Test CORS:**
   ```bash
   curl -H "Origin: https://muse-forge.vercel.app" \
        -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: Content-Type" \
        -X OPTIONS \
        https://museforge-production.up.railway.app/generate
   ```
   Should return CORS headers.

3. **Test Frontend:**
   - Visit: https://muse-forge.vercel.app
   - Open browser console (F12)
   - Try uploading a CV
   - Check console for detailed error messages

---

## 🔍 Debugging Checklist

If issues persist, check these in order:

### Backend Issues

- [ ] **Railway Logs:** Check for errors in Railway dashboard → Deployments → View Logs
- [ ] **Environment Variables:** Verify all variables are set correctly
- [ ] **API Key:** Test Groq API key works: https://console.groq.com/playground
- [ ] **CORS:** Check if origin is being blocked (look for "CORS blocked origin" in logs)
- [ ] **Rate Limiting:** Check if you're hitting rate limits (20 requests/15min for AI)

### Frontend Issues

- [ ] **Browser Console:** Check for CORS errors or network errors
- [ ] **Network Tab:** Check request/response in browser DevTools
- [ ] **Environment Variable:** Verify `REACT_APP_API_URL` is set in Vercel
- [ ] **API URL:** Make sure it points to Railway backend (no trailing slash)

### Common Error Messages

| Error | Cause | Fix |
|-------|-------|-----|
| "CORS policy" | CORS misconfiguration | Update CORS allowedOrigins |
| "Failed to fetch" | Wrong API URL or backend down | Check REACT_APP_API_URL |
| "AI generation failed" | Invalid Groq API key | Update GROQ_API_KEY in Railway |
| "CV parsing failed" | PDF parsing error or AI error | Check Railway logs for details |
| "Too many requests" | Rate limit hit | Wait 15 minutes or increase limit |

---

## 🧪 Local Testing

Test locally before deploying:

### Terminal 1 (Backend):
```bash
cd backend
# Create .env with your actual Groq API key
echo "GROQ_API_KEY=your_key_here" > .env
echo "FRONTEND_URL=http://localhost:3000" >> .env
npm start
```

### Terminal 2 (Frontend):
```bash
cd frontend
# Create .env
echo "REACT_APP_API_URL=http://localhost:5000" > .env
npm start
```

Test both CV upload and portfolio generation locally first.

---

## 📊 Monitoring

### Check Backend Health

```bash
# Should return healthy status
curl https://museforge-production.up.railway.app/health
```

### Check Backend Logs (Railway)

1. Go to Railway dashboard
2. Click on backend service
3. Click "Deployments" tab
4. Click on latest deployment
5. Click "View Logs"

Look for:
- "Server running on port 5000"
- Configuration log output
- Any error messages

### Check Frontend Logs (Vercel)

1. Go to Vercel dashboard
2. Click on muse-forge project
3. Click "Deployments"
4. Click on latest deployment
5. Click "View Function Logs"

---

## 🆘 Emergency Rollback

If fixes break something:

```bash
# Rollback to previous commit
git log --oneline -5
git revert HEAD
git push origin main
```

Or use Railway/Vercel dashboard to redeploy previous version.

---

## ✅ Success Criteria

Your deployment is working when:

1. ✅ Health endpoint returns `{"status":"healthy"}`
2. ✅ CV upload successfully parses and fills form
3. ✅ Portfolio generation creates bio and statement
4. ✅ No CORS errors in browser console
5. ✅ Detailed error messages appear if something fails

---

## 📞 Need Help?

If issues persist after applying all fixes:

1. **Check Railway Logs** for backend errors
2. **Check Browser Console** for frontend errors
3. **Test API Key** at https://console.groq.com/playground
4. **Verify URLs** match exactly (no typos, trailing slashes)
5. **Create GitHub Issue** with error logs

---

**Last Updated:** 2026-06-15