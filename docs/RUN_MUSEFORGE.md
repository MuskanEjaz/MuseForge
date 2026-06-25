# Run MuseForge

## First-time setup

Open **`EASY_GOOGLE_EMAIL_SETUP.md`**. It explains Google Login, Gmail App Password, frontend `.env`, backend `.env`, and testing in simple Roman Urdu.

## 1. Install dependencies

Open PowerShell in the main project folder:

```powershell
npm install
```

## 2. Start frontend and backend together

```powershell
npm run dev
```

Open:

- Frontend: `http://localhost:3000`
- Backend health check: `http://localhost:5000/health`

Keep PowerShell open while using the app.

## Correct account flow

1. Open **Log in** from the welcome page.
2. Choose **Sign up**.
3. Create an account with a real email.
4. Open the verification email and click **Verify my email**.
5. MuseForge activates the account and opens the creator-selection page.
6. A welcome email is sent after verification.
7. Use **Forgot password?** to receive a 60-minute reset link.
8. **Continue with Google** works after adding the Google Client ID to both `.env` files.

Google accounts are already email-verified by Google. Password accounts must use the verification link.

## Account storage

Local accounts are password-hashed and stored outside the project folder at:

```text
C:\Users\YOUR_WINDOWS_USERNAME\.museforge\users.json
```

Replacing or re-extracting the project folder therefore does not remove the accounts. Never manually share this file.

## Project enhancement rule

- Artist, musician, photographer, writer, and manually entered project descriptions request AI enhancement.
- Enhancement may improve wording but cannot invent tools, results, achievements, clients, or facts.
- Student/job-seeker projects extracted from an uploaded CV remain unchanged.

## Portfolio-picture rule

- Uploaded picture: shown in preview and exported HTML.
- No uploaded picture: no fake/default avatar; the name still appears.

## Full verification

```powershell
npm run verify
```

Expected result:

- Production build passes
- 12 frontend tests pass
- Backend authentication integration test passes

Never upload either `.env` file to GitHub.
