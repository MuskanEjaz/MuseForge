# 🚀 Quick Deployment Checklist

## Before You Deploy

- [ ] **Push all changes to GitHub**
  ```bash
  git add .
  git commit -m "Prepare for deployment"
  git push origin main
  ```

- [ ] **Have your Groq API key ready**
  - Get it from: https://console.groq.com/keys

---

## Backend Deployment (Railway.app)

### 1. Create New Project
- Go to: https://railway.app/dashboard
- Click **"New Project"**
- Select **"Deploy from GitHub repo"**
- Connect and select: `MuskanEjaz/museforge`
- Click **"Deploy Now"**

### 2. Configure Root Directory
- Click on the deployed service
- Go to **"Settings"** tab
- Set **"Root Directory"** to: `backend`
- Click **"Update"**

### 3. Add Environment Variables
- Go to **"Variables"** tab
- Add these variables:

```
GROQ_API_KEY=your_actual_groq_api_key_here
NODE_ENV=production
PORT=5000
FRONTEND_URL=(leave empty for now)
```

### 4. Generate Domain & Copy URL
- Go to **"Settings"** tab
- Scroll to **"Networking"** section
- Click **"Generate Domain"**
- Copy your backend URL: `https://museforge-backend-production.up.railway.app`

---

## Frontend Deployment (Vercel)

### 1. Create .env.production file
Create a file named `.env.production` in your project root:
```
REACT_APP_API_URL=https://museforge-backend-production.up.railway.app
```

### 2. Commit and Push
```bash
git add .env.production
git commit -m "Add production environment variables"
git push origin main
```

### 3. Deploy to Vercel
- Go to: https://vercel.com/dashboard
- Click **"Add New..."** → **"Project"**
- Import: `MuskanEjaz/museforge`
- Framework: `Create React App` (auto-detected)
- Click **"Deploy"**

### 4. Add Environment Variable in Vercel
- In Vercel project settings → **"Environment Variables"**
- Add:
  - Key: `REACT_APP_API_URL`
  - Value: `https://museforge-backend-production.up.railway.app` (your Railway URL)
  - Environment: `Production`
- Click **"Save"**
- Redeploy if needed

### 5. Copy Frontend URL
- Copy your Vercel URL: `https://museforge.vercel.app`

---

## Connect Frontend & Backend

### Update Backend CORS
1. Go back to Railway dashboard
2. Click on your **museforge** project
3. Click on the **backend service**
4. Go to **"Variables"** tab
5. Update `FRONTEND_URL` to: `https://museforge.vercel.app`
6. Go to **"Deployments"** tab and click **"Deploy"** to redeploy

---

## Test Your Deployment

1. **Visit your frontend:** `https://museforge.vercel.app`
2. **Test features:**
   - ✅ Generate portfolio
   - ✅ Upload CV
   - ✅ Export HTML

3. **Check backend health:**
   - Visit: `https://museforge-backend-production.up.railway.app/health`
   - Should see: `{"status":"healthy",...}`

---

## Troubleshooting

### CORS Errors?
- Verify `FRONTEND_URL` in Railway matches your Vercel URL exactly
- No trailing slash!
- Redeploy after changing environment variables

### Backend Not Responding?
- Railway free tier has $5 monthly credit
- No cold starts (stays active)
- Check logs in Railway dashboard (Deployments → View Logs)

### Build Failed?
- Check build logs in Vercel/Railway
- Verify all dependencies are in package.json
- Ensure Root Directory is set to `backend` in Railway

---

## 🎉 You're Live!

**Frontend:** https://museforge.vercel.app
**Backend:** https://museforge-backend-production.up.railway.app
**Health Check:** https://museforge-backend-production.up.railway.app/health

---

## Auto-Deploy Setup

Both Vercel and Render auto-deploy when you push to GitHub:

```bash
# Make changes
git add .
git commit -m "Your changes"
git push origin main
# Both services will auto-deploy!
```

---

## Need Help?

See full guide: `DEPLOYMENT_GUIDE.md`