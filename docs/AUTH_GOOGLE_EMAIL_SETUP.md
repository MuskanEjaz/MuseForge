# Google Login, Email Verification and Password Reset Setup

For the beginner-friendly Roman Urdu instructions, open:

**`EASY_GOOGLE_EMAIL_SETUP.md`**

The required environment files are:

- Root `.env`: frontend API URL and `REACT_APP_GOOGLE_CLIENT_ID`
- `backend/.env`: Groq key, auth secret, the same Google Client ID, SMTP/Gmail settings, backend port and frontend URL

New authentication flow:

1. Email/password signup creates an unverified account.
2. MuseForge emails a 24-hour verification link.
3. The verification link activates and signs in the user.
4. A welcome email is sent after successful verification.
5. Forgot Password emails a 60-minute reset link.
6. A successful reset sends a password-change confirmation.
7. Google accounts are treated as email-verified because the backend verifies Google's ID token.
