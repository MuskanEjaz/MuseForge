# 🚨 Emergency: Remove Exposed API Key from Git History

## ⚠️ CRITICAL: Do This FIRST

**Before running any commands, IMMEDIATELY revoke the exposed API key:**

1. Go to: https://console.groq.com/keys
2. Find and DELETE the key: `<EXPOSED_GROQ_KEY>`
3. Generate a NEW API key
4. Save the new key securely (you'll need it later)

---

## 📋 What Happened

- Commit `f3f988f` accidentally included a real API key in `backend/.env.example`
- This file was pushed to GitHub (public repository)
- The key is now in git history, even though we fixed the current file
- We need to rewrite history to remove it completely

---

## 🛠️ Solution: Remove Secret from Git History

### Method 1: Using git filter-repo (Recommended)

This is the safest and fastest method.

#### Step 1: Install git-filter-repo

**Windows (PowerShell):**
```powershell
pip install git-filter-repo
```

**Mac/Linux:**
```bash
pip3 install git-filter-repo
# or
brew install git-filter-repo
```

#### Step 2: Create a backup (IMPORTANT!)

```bash
# Create a backup of your repository
cd c:/Projects
cp -r museforge museforge-backup
cd museforge
```

#### Step 3: Remove the secret from history

```bash
# This will replace the API key in ALL commits
git filter-repo --replace-text <(echo '<EXPOSED_GROQ_KEY>==>***REMOVED***')
```

**Windows PowerShell alternative:**
```powershell
# Create a file with the replacement
echo "<EXPOSED_GROQ_KEY>==>***REMOVED***" > replacements.txt
git filter-repo --replace-text replacements.txt
del replacements.txt
```

#### Step 4: Re-add remote (filter-repo removes it)

```bash
git remote add origin https://github.com/MuskanEjaz/museforge.git
```

#### Step 5: Force push to GitHub

```bash
# Force push to overwrite history
git push origin --force --all
git push origin --force --tags
```

---

### Method 2: Using BFG Repo-Cleaner (Alternative)

If git-filter-repo doesn't work, use BFG.

#### Step 1: Download BFG

Download from: https://rtyley.github.io/bfg-repo-cleaner/

Or use this direct link:
```bash
# Download BFG jar file
curl -L https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar -o bfg.jar
```

#### Step 2: Create replacements file

```bash
# Create a file with the secret to remove
echo "<EXPOSED_GROQ_KEY>" > secrets.txt
```

#### Step 3: Run BFG

```bash
# Clone a fresh copy
cd c:/Projects
git clone --mirror https://github.com/MuskanEjaz/museforge.git museforge-mirror
cd museforge-mirror

# Run BFG to remove secrets
java -jar ../bfg.jar --replace-text ../secrets.txt

# Clean up
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Push changes
git push --force
```

#### Step 4: Clone fresh copy

```bash
cd c:/Projects
rm -rf museforge
git clone https://github.com/MuskanEjaz/museforge.git
cd museforge
```

---

### Method 3: Manual Interactive Rebase (If only 1-2 commits)

If the secret is only in recent commits, you can use interactive rebase.

#### Step 1: Find the commit

```bash
# View recent commits
git log --oneline -10

# Find commit f3f988f
```

#### Step 2: Start interactive rebase

```bash
# Rebase from the commit BEFORE the one with the secret
# If f3f988f is the bad commit, use the one before it
git rebase -i f3f988f^
```

#### Step 3: Edit the commit

In the editor that opens:
1. Change `pick` to `edit` for commit f3f988f
2. Save and close

#### Step 4: Fix the file

```bash
# Edit backend/.env.example
# Replace the real key with: your_groq_api_key_here

# Stage the change
git add backend/.env.example

# Amend the commit
git commit --amend --no-edit

# Continue rebase
git rebase --continue
```

#### Step 5: Force push

```bash
git push origin --force
```

---

## ✅ Verification Steps

After running any method above:

### 1. Check local history

```bash
# Search for the exposed key in history
git log -S "<EXPOSED_GROQ_KEY_PREFIX>" --all

# Should return NO results
```

### 2. Check GitHub

```bash
# Search on GitHub
# Go to: https://github.com/MuskanEjaz/museforge
# Use GitHub search: <EXPOSED_GROQ_KEY_PREFIX>
# Should return NO results
```

### 3. Verify .gitignore

```bash
# Make sure .env files are ignored
cat .gitignore | grep ".env"

# Should show:
# .env
# backend/.env
# frontend/.env
```

---

## 🔒 Post-Cleanup Security Checklist

- [ ] **Revoked old API key** on Groq console
- [ ] **Generated new API key**
- [ ] **Updated local `.env` file** with new key
- [ ] **Updated Railway environment variables** with new key
- [ ] **Verified key removed from git history** (no search results)
- [ ] **Verified key removed from GitHub** (no search results)
- [ ] **Confirmed `.env` files in `.gitignore`**
- [ ] **Tested application** with new key

---

## 🚀 Update Production

After cleaning history and getting a new key:

### Update Railway.app

1. Go to: https://railway.app/dashboard
2. Click on your **museforge** project
3. Click on **backend service**
4. Go to **Variables** tab
5. Update `GROQ_API_KEY` with your NEW key
6. Go to **Deployments** tab
7. Click **Deploy** to redeploy

### Test Backend

```bash
# Test health endpoint
curl https://museforge-backend-production.up.railway.app/health

# Should return: {"status":"healthy",...}
```

---

## 📝 Prevention: Never Commit Secrets Again

### 1. Use git-secrets (Recommended)

Install git-secrets to prevent committing secrets:

```bash
# Install git-secrets
# Windows (with Git Bash)
git clone https://github.com/awslabs/git-secrets.git
cd git-secrets
make install

# Mac
brew install git-secrets

# Configure for your repo
cd c:/Projects/museforge
git secrets --install
git secrets --register-aws
git secrets --add 'gsk_[A-Za-z0-9]{48}'
```

### 2. Pre-commit Hook

Create `.git/hooks/pre-commit`:

```bash
#!/bin/sh
# Check for potential secrets before committing

if git diff --cached --name-only | grep -E '\.(env|key|pem)$'; then
    echo "❌ ERROR: Attempting to commit sensitive files!"
    echo "Files with secrets detected. Commit rejected."
    exit 1
fi

if git diff --cached | grep -E 'gsk_[A-Za-z0-9]{48}'; then
    echo "❌ ERROR: Groq API key detected in commit!"
    echo "Remove the API key before committing."
    exit 1
fi

exit 0
```

Make it executable:
```bash
chmod +x .git/hooks/pre-commit
```

### 3. Always Use .env.example

**Rules:**
- ✅ `.env.example` → Commit to git (with placeholders only)
- ❌ `.env` → NEVER commit (add to .gitignore)
- ✅ Production → Use environment variables in hosting platform

---

## 🆘 If Something Goes Wrong

### Restore from backup

```bash
cd c:/Projects
rm -rf museforge
cp -r museforge-backup museforge
cd museforge
```

### Get help

- **Git filter-repo docs:** https://github.com/newren/git-filter-repo
- **BFG docs:** https://rtyley.github.io/bfg-repo-cleaner/
- **GitHub support:** https://support.github.com

---

## 📞 Emergency Contacts

- **Groq Support:** https://console.groq.com/support
- **GitHub Security:** security@github.com
- **Railway Support:** https://railway.app/help

---

## ⏱️ Timeline

**Immediate (Now):**
1. Revoke exposed API key (5 minutes)
2. Run git history cleanup (10 minutes)
3. Force push to GitHub (2 minutes)

**Within 1 hour:**
4. Generate new API key
5. Update local and production environments
6. Test application

**Within 24 hours:**
7. Set up git-secrets or pre-commit hooks
8. Review all environment files
9. Document incident for future reference

---

**🔴 REMEMBER: The exposed key is PUBLIC. Revoke it IMMEDIATELY, even if you think no one saw it!**