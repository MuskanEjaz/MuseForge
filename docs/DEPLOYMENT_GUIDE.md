# MuseForge Deployment Guide

Complete step-by-step guide to deploy your MuseForge project to production.

---

## 📋 Prerequisites

Before starting, make sure you have:
- ✅ GitHub account with your repo: https://github.com/MuskanEjaz/museforge
- ✅ Vercel account (sign up at https://vercel.com)
- ✅ Railway.app account (sign up at https://railway.app)
- ✅ Your Groq API key ready

---

## 🚀 Part 1: Deploy Backend to Railway.app

### Step 1: Push Your Code to GitHub

```bash
# In your project root directory (c:/Projects/museforge)
git add .
git commit -m "Add deployment configurations and security improvements"
git push origin main
```

### Step 2: Create Backend Service on Railway

1. **Go to Railway Dashboard**
   - Visit: https://railway.app/dashboard
   - Click **"New Project"**
   - Select **"Deploy from GitHub repo"**

2. **Connect Your Repository**
   - If not connected, click **"Configure GitHub App"**
   - Authorize Railway to access your repositories
   - Select: **MuskanEjaz/museforge**
   - Click **"Deploy Now"**

3. **Configure the Service**
   After initial deployment:
   
   - Railway will auto-detect your Node.js app
   - Click on the deployed service
   - Go to **"Settings"** tab

4. **Set Root Directory**
   - In Settings, find **"Root Directory"**
   - Set to: `backend`
   - Click **"Update"**

5. **Add Environment Variables**
   - Click **"Variables"** tab
   - Click **"New Variable"**
   
   Add these variables one by one:
   
   | Variable | Value |
   |----------|-------|
   | `GROQ_API_KEY` | Your actual Groq API key |
   | `NODE_ENV` | `production` |
   | `PORT` | `5000` |
   | `FRONTEND_URL` | Leave empty for now (we'll update after frontend deployment) |

6. **Generate Domain**
   - Go to **"Settings"** tab
   - Scroll to **"Networking"** section
   - Click **"Generate Domain"**
   - Railway will create a public URL (looks like: `https://museforge-backend-production.up.railway.app`)
   - Copy this URL

7. **Redeploy (if needed)**
   - Go to **"Deployments"** tab
   - Click **"Deploy"** to trigger a new deployment with all settings
   - Wait 2-3 minutes for deployment to complete

8. **Test Your Backend**
   - Visit: `https://your-backend-url.up.railway.app/health`
   - You should see JSON response with status "healthy"

---

## 🎨 Part 2: Deploy Frontend to Vercel

### Step 1: Update Frontend API URL

Before deploying, we need to update your frontend to use the production backend URL.

1. **Find where you call the backend API** (likely in `src/App.js`)
2. **Replace** `http://localhost:5000` with your Render backend URL
3. **Example:**
   ```javascript
   // Change from:
   const response = await axios.post('http://localhost:5000/generate', data);
   
   // To:
   const response = await axios.post('https://museforge-backend-production.up.railway.app/generate', data);
   ```

4. **Commit and push:**
   ```bash
   git add .
   git commit -m "Update API URL for production"
   git push origin main
   ```

### Step 2: Deploy to Vercel

1. **Go to Vercel Dashboard**
   - Visit: https://vercel.com/dashboard
   - Click **"Add New..."** → **"Project"**

2. **Import Your Repository**
   - Click **"Import Git Repository"**
   - If not connected, click **"Connect GitHub Account"**
   - Find: **MuskanEjaz/museforge**
   - Click **"Import"**

3. **Configure Project**
   
   | Field | Value |
   |-------|-------|
   | **Project Name** | `museforge` |
   | **Framework Preset** | `Create React App` (auto-detected) |
   | **Root Directory** | `./` (leave as is) |
   | **Build Command** | `npm run build` (auto-filled) |
   | **Output Directory** | `build` (auto-filled) |

4. **Environment Variables** (if needed)
   - Click **"Environment Variables"**
   - Add any frontend-specific variables (if you have any)
   - For this project, you likely don't need any

5. **Deploy**
   - Click **"Deploy"**
   - Wait 2-3 minutes
   - Once done, you'll see: 🎉 **Congratulations!**
   - Copy your frontend URL (looks like: `https://museforge.vercel.app`)

---

## 🔗 Part 3: Connect Frontend and Backend

### Step 1: Update Backend CORS Settings

1. **Go back to Railway Dashboard**
   - Visit: https://railway.app/dashboard
   - Click on your **museforge** project
   - Click on the **backend service**

2. **Update Environment Variables**
   - Click **"Variables"** tab
   - Find `FRONTEND_URL` variable (or add it if missing)
   - Update value to: `https://museforge.vercel.app` (your Vercel URL)
   - Railway auto-saves changes

3. **Redeploy**
   - Go to **"Deployments"** tab
   - Click **"Deploy"** to trigger redeploy with new variable
   - Wait 1-2 minutes for deployment to complete

### Step 2: Test Your Application

1. **Visit your frontend:** `https://museforge.vercel.app`
2. **Test all features:**
   - ✅ Generate portfolio
   - ✅ Upload CV
   - ✅ Check if API calls work

---

## 🔧 Part 4: Custom Domain (Optional)

### For Vercel (Frontend):

1. Go to your project in Vercel
2. Click **"Settings"** → **"Domains"**
3. Add your custom domain (e.g., `museforge.com`)
4. Follow DNS configuration instructions

### For Railway (Backend):

1. Go to your service in Railway
2. Click **"Settings"** tab
3. Scroll to **"Networking"** section
4. Click **"Add Custom Domain"**
5. Enter your domain (e.g., `api.museforge.com`)
6. Follow DNS configuration instructions

---

## 📊 Monitoring & Logs

### Railway (Backend):

- **View Logs:** Dashboard → Your Service → **"Deployments"** tab → Click on deployment → **"View Logs"**
- **Monitor Health:** Visit `/health` endpoint regularly
- **Check Metrics:** Dashboard → Your Service → **"Metrics"** tab (if available on your plan)
- **Real-time Logs:** Click **"View Logs"** button in the deployment view

### Vercel (Frontend):

- **View Deployments:** Dashboard → Your Project → **"Deployments"**
- **Check Analytics:** Dashboard → Your Project → **"Analytics"**
- **View Logs:** Click on any deployment → **"Logs"**

---

## 🐛 Troubleshooting

### Backend Issues:

**Problem:** Backend not starting
- **Solution:** Check logs in Railway dashboard (Deployments → View Logs)
- Verify all environment variables are set correctly
- Ensure `GROQ_API_KEY` is valid
- Check that Root Directory is set to `backend`

**Problem:** CORS errors
- **Solution:** Verify `FRONTEND_URL` matches your Vercel URL exactly
- No trailing slash in URL
- Redeploy after changing environment variables

**Problem:** File upload fails
- **Solution:** Railway free tier has 512MB RAM limit
- Large files might fail - consider upgrading plan
- Check logs for specific error messages

### Frontend Issues:

**Problem:** API calls failing
- **Solution:** Check if backend URL is correct in your code
- Verify backend is running (visit `/health` endpoint)
- Check browser console for errors

**Problem:** Build fails on Vercel
- **Solution:** Check build logs
- Ensure all dependencies are in `package.json`
- Try building locally first: `npm run build`

---

## 🔄 Updating Your Application

### Update Backend:

```bash
# Make changes to backend code
git add backend/
git commit -m "Update backend"
git push origin main
# Railway auto-deploys from GitHub
```

### Update Frontend:

```bash
# Make changes to frontend code
git add src/
git commit -m "Update frontend"
git push origin main
# Vercel auto-deploys from GitHub
```

---

## 💰 Cost Breakdown

### Free Tier Limits:

**Railway.app (Backend):**
- ✅ $5 free credit per month (no credit card required initially)
- ✅ 512MB RAM, 1GB disk
- ✅ No sleep/cold starts (stays active)
- ✅ Faster than traditional free tiers
- ⚠️ Usage-based billing after free credit

**Vercel (Frontend):**
- ✅ Unlimited deployments
- ✅ 100GB bandwidth/month
- ✅ Always fast (no cold starts)
- ✅ Automatic HTTPS

---

## 🎯 Next Steps

1. ✅ Set up custom domain
2. ✅ Configure analytics
3. ✅ Set up error monitoring (e.g., Sentry)
4. ✅ Add CI/CD tests
5. ✅ Set up database (if needed)

---

## 📞 Support

- **Railway Docs:** https://docs.railway.app
- **Vercel Docs:** https://vercel.com/docs
- **GitHub Issues:** https://github.com/MuskanEjaz/museforge/issues

---

**🎉 Congratulations! Your MuseForge app is now live!**