# MuseForge — Google Login + Real Email Setup (Bilkul Easy Steps)

Ye guide **Windows + PowerShell** ke liye hai. Aap ko do cheezen set karni hain:

1. **Continue with Google** ke liye Google Client ID
2. **Verification, welcome aur password-reset emails** ke liye Gmail App Password

> Important: normal Gmail password kabhi code mein mat dalna. Sirf **Google App Password** use karna hai.

---

## Part 1 — Project ko open karo

1. ZIP extract karo.
2. Extracted folder open karo.
3. Folder ke empty area mein **Shift + Right Click** karo.
4. **Open PowerShell window here** ya **Open in Terminal** select karo.

Project ke andar aap ko ye do jagah yaad rakhni hain:

- Frontend file: `MUSEFORGE.../.env`
- Backend file: `MUSEFORGE.../backend/.env`

Dono alag files hain.

---

## Part 2 — Google Login ke liye Client ID banao

### Step 1: Google Cloud kholo

Browser mein Google Cloud Console kholo aur apne Google account se sign in karo.

### Step 2: Naya project banao

1. Upar project selector par click karo.
2. **New Project** choose karo.
3. Project name likho: `MuseForge`
4. **Create** par click karo.
5. Project create hone ke baad usay select kar lo.

### Step 3: Google Auth Platform setup karo

1. Left menu/search mein **Google Auth Platform** likho.
2. **Get Started** par click karo.
3. App name: `MuseForge`
4. User support email: apni Gmail
5. Audience mein testing ke liye **External** choose karo.
6. Contact email mein apni Gmail do.
7. Setup complete/save karo.

Agar **Test users** ka option aaye, apni woh Gmail add kar do jis se Google Login test karna hai.

### Step 4: Web Client ID banao

1. Google Auth Platform mein **Clients** kholo.
2. **Create Client** par click karo.
3. Application type: **Web application**
4. Name: `MuseForge Web`
5. **Authorized JavaScript origins** mein ye add karo:

```text
http://localhost:3000
```

Agar React kisi aur port par chale, example `3001`, to ye bhi add karo:

```text
http://localhost:3001
```

6. **Create** par click karo.
7. Aap ko ek Client ID milegi jo aam tor par aise end hoti hai:

```text
.apps.googleusercontent.com
```

Us Client ID ko copy kar lo.

---

## Part 3 — Frontend `.env` banao

Main project folder mein `.env.example` ki copy banao aur naam sirf `.env` rakh do.

Us file mein ye likho:

```env
REACT_APP_API_URL=http://localhost:5000
REACT_APP_GOOGLE_CLIENT_ID=YAHAN_APNI_GOOGLE_CLIENT_ID_PASTE_KARO
```

Example:

```env
REACT_APP_API_URL=http://localhost:5000
REACT_APP_GOOGLE_CLIENT_ID=123456789-example.apps.googleusercontent.com
```

> File ka naam `.env.txt` nahi hona chahiye. Sirf `.env` hona chahiye.

---

## Part 4 — Gmail se real emails bhejne ka setup

MuseForge ye emails bhejega:

- Verify your email
- Welcome email
- Forgot-password reset link
- Password changed confirmation

### Step 1: Gmail par 2-Step Verification on karo

1. Google Account kholo.
2. **Security** section mein jao.
3. **2-Step Verification** open karo.
4. Instructions follow karke on kar do.

### Step 2: App Password banao

1. Google Account Security mein **App passwords** search/open karo.
2. Dobara login mangay to login karo.
3. App name likho: `MuseForge`
4. **Create** par click karo.
5. Google 16-character password dega.
6. Is password ko copy kar lo.

Example sirf samjhane ke liye:

```text
abcd efgh ijkl mnop
```

Backend `.env` mein spaces ke baghair paste karna better hai:

```text
abcdefghijklmnop
```

> Normal Gmail password yahan kaam nahi karega. App Password hi use karna hai.

---

## Part 5 — Backend `.env` banao

`backend` folder open karo. Wahan `.env.example` ki copy banao aur naam `.env` rakh do.

Is mein ye values add karo:

```env
GROQ_API_KEY=YAHAN_APNI_GROQ_KEY
AUTH_SECRET=YAHAN_LONG_RANDOM_SECRET
GOOGLE_CLIENT_ID=YAHAN_WAHI_GOOGLE_CLIENT_ID

SMTP_SERVICE=gmail
SMTP_USER=YOUR_GMAIL@gmail.com
SMTP_PASS=YAHAN_16_CHARACTER_APP_PASSWORD
MAIL_FROM="MuseForge <YOUR_GMAIL@gmail.com>"

PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

### AUTH_SECRET kaise banao

PowerShell mein ye command chalao:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})
```

Jo long output aaye, usay copy karke `AUTH_SECRET=` ke baad paste kar do.

### Complete example

```env
GROQ_API_KEY=gsk_your_real_key
AUTH_SECRET=K8zR2mQ9vN4pL7xA1sD6fG3hJ5kT0wY8uI2oP9cV4bM7nX1q
GOOGLE_CLIENT_ID=123456789-example.apps.googleusercontent.com

SMTP_SERVICE=gmail
SMTP_USER=youraccount@gmail.com
SMTP_PASS=abcdefghijklmnop
MAIL_FROM="MuseForge <youraccount@gmail.com>"

PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

Frontend aur backend mein **same Google Client ID** honi chahiye.

---

## Part 6 — App run karo

Main project folder ke PowerShell mein:

```powershell
npm install
npm run dev
```

Thora wait karo. Phir browser mein kholo:

```text
http://localhost:3000
```

Backend check karne ke liye:

```text
http://localhost:5000/health
```

Agar healthy JSON aaye to backend chal raha hai.

---

## Part 7 — Har feature ko test karo

### Test A: Email signup + verification

1. Landing page se **Log in** click karo.
2. **Sign up** click karo.
3. Name, real email aur password do.
4. **Create Account** click karo.
5. Inbox kholo.
6. `Verify your MuseForge email` email open karo.
7. **Verify my email** button click karo.
8. App khul jani chahiye.
9. Is ke baad welcome email bhi aani chahiye.

### Test B: Normal login

1. Log out karo.
2. Same email/password se login karo.
3. App open honi chahiye.

### Test C: Forgot password

1. Login page par **Forgot password?** click karo.
2. Apni email do.
3. Inbox mein reset email kholo.
4. **Choose a new password** click karo.
5. Naya password do.
6. New password se login test karo.

### Test D: Continue with Google

1. Login page kholo.
2. **Continue with Google** click karo.
3. Google account choose karo.
4. First time par account create hoga; baad mein direct login hoga.

---

## Agar email nahi aaye

1. Spam/Junk folder check karo.
2. `SMTP_USER` mein full Gmail address check karo.
3. `SMTP_PASS` mein normal password nahi, **App Password** hona chahiye.
4. `.env` save karne ke baad app band karke dobara `npm run dev` chalao.
5. Terminal mein email error dekho.

---

## Agar Google Login error de

### Error: origin not allowed

Google Cloud ke Web Client mein exact origin add karo:

```text
http://localhost:3000
```

Port `3001` ho to exact `http://localhost:3001` bhi add karo.

### Button par configuration message aaye

Check karo:

- Root `.env` mein `REACT_APP_GOOGLE_CLIENT_ID`
- Backend `.env` mein `GOOGLE_CLIENT_ID`
- Dono values bilkul same
- App restart ki hui ho

---

## Bohat important security rules

- `.env` GitHub par upload mat karna.
- Gmail App Password kisi ko mat dena.
- `AUTH_SECRET` kisi ko mat dena.
- GROQ key kisi ko mat dena.
- Agar key galti se GitHub par chali jaye to usay فوراً revoke/replace karo.

---

## Deployment ke waqt

Localhost ki jagah apna live frontend URL use karna hoga, example:

```env
FRONTEND_URL=https://your-museforge-site.vercel.app
```

Google Cloud ke **Authorized JavaScript origins** mein bhi live frontend origin add karna hoga:

```text
https://your-museforge-site.vercel.app
```

Backend deployment mein same environment variables hosting dashboard mein add karni hongi.
