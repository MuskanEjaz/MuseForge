# MuseForge — Testing & Functionality Guide

## Project summary
MuseForge is an AI-assisted portfolio generator for multiple creator types. It supports manual portfolio creation, CV-assisted auto-fill for the student/job-seeker flow, AI-enhanced project descriptions with FactLock review, multilingual output, review submission, and public share links.

## Main creator types
- Artist
- Musician
- Student / Job Seeker
- Photographer
- Writer

## Main user flows
### 1) Landing page
- Hero section with CTA buttons
- Creator type cards
- Features section
- Template showcase
- Reviews section
- Demo video trigger

### 2) Authentication
- Email/password signup and login
- Google login button
- Session persistence after login
- Logout support

### 3) Portfolio creation
#### Manual form mode
Users can enter:
- Name
- Field / medium
- Contact details
- Skills
- Project titles and descriptions
- Custom sections
- Images / audio / videos where supported

#### CV upload mode
Available in Student / Job Seeker flow:
- PDF upload
- Backend parsing of CV content
- Auto-fill of form fields from parsed resume data

### 4) FactLock review flow
For AI-enhanced content:
- Original project text is shown
- AI-enhanced version is shown beside it
- Preserved facts are displayed
- Unsupported facts are displayed
- User can choose:
  - Accept enhanced
  - Keep edited changes
  - Keep original
- Portfolio generation is locked until every FactLock item is resolved

### 5) Final portfolio generation
- Generates a preview section inside the app
- Shows trust report cards including:
  - Projects reviewed
  - Enhanced in use
  - Original kept
  - Unsupported facts detected
  - Input language
  - Output language
  - Share link created
- Allows copy, export, and share actions

### 6) Multilingual output
Supported output languages include:
- English
- Urdu
- Roman Urdu
- Arabic
- Hindi
- Spanish
- French
- German
- Turkish
- Chinese
- Japanese
- Korean
- and additional configured languages

### 7) Reviews system
- Users can submit ratings and text reviews
- Reviews are stored server-side
- Reviews are loaded back after refresh/re-login
- Average rating and review cards appear on landing page
- Modal exists for submitting and viewing all reviews

### 8) Shareable portfolio
- User can create a public share link
- Public portfolio route is generated and viewable separately
- Public page respects selected output language and direction

### 9) HTML export
- Export final portfolio as HTML
- Export keeps theme, content blocks, and attached media where supported

## Current packaged fixes in this version
- Creator type cards moved above reviews on landing page
- Landing page hero adjusted closer to the approved reference style
- Creator card images enlarged
- Hero image border treatment softened / visually merged
- Client-side language fallback improved to replace mixed-language phrases inside longer headings/descriptions
- Added extra localization fallback for:
  - Karachi, Pakistan
  - Live performance Siyara ma
  - Siyara dance description sentence
- Contact location now passes through language fallback in preview/public/export contexts
- Backend fallback dictionary strengthened for multilingual cases

## Suggested test cases for expert reviewer
### Authentication
1. Signup with email/password
2. Login with same account
3. Logout and login again
4. Test Google login if credentials/origins are configured

### Reviews
1. Submit a review with 5-star rating
2. Refresh page
3. Confirm review still appears
4. Open “View all reviews” modal

### CV upload
1. Open Student / Job Seeker flow
2. Upload a PDF CV
3. Confirm fields auto-fill
4. Generate portfolio

### FactLock
1. Add 2–3 projects
2. Generate enhancement step
3. Resolve all review items using different buttons
4. Confirm “Generate Portfolio” unlocks only after all items are resolved

### Multilingual consistency
Use Roman Urdu input and test output in:
- Arabic
- Spanish
- Chinese
- Turkish
- English

Check:
- Name
- Medium
- Contact labels
- Location
- Project titles
- Project descriptions
- Custom section headings
- Custom item headings and descriptions

### Public share link
1. Generate a portfolio
2. Create share link
3. Open link in new tab
4. Confirm public page loads correctly

### Export HTML
1. Generate final portfolio
2. Export HTML
3. Open exported HTML locally in browser
4. Verify layout and text

## Run commands (Windows PowerShell)
### Root install
```powershell
cd "C:\path	o\MUSEFORGE_COMPETITION_FINAL_TESTED"
npm install
```

### Backend install + run
```powershell
cd "C:\path	o\MUSEFORGE_COMPETITION_FINAL_TESTEDackend"
npm install
node server.js
```

### Frontend run
Open another PowerShell window:
```powershell
cd "C:\path	o\MUSEFORGE_COMPETITION_FINAL_TESTED"
npm start
```

### Production build test
```powershell
cd "C:\path	o\MUSEFORGE_COMPETITION_FINAL_TESTED"
npm run build
```

## Notes for reviewer
- If Google login fails with `origin_mismatch`, the Google Cloud OAuth JavaScript origins must be updated for the active frontend URL.
- If CV upload fails, verify backend dependencies are installed in the `backend` folder.
- If reviews do not persist, ensure backend has write access to its storage path / database.


## New 10/10 feature additions

### AI Tone Selector
Users can select one of four AI writing styles before generation:
- Professional
- Creative
- Minimal
- Bold

The selected tone is passed to portfolio generation, FactLock enhancement, single-item regeneration, and AI project suggestions.

### FactLock Trust Score
MuseForge now calculates a FactLock score from preserved facts and unsupported new facts. The score appears inside the FactLock review panel and in the final trust report.

### Per-item FactLock Regenerate
Every FactLock item has a Regenerate button. It calls the backend only for that item and does not rewrite the full portfolio.

### AI Project Suggestions
The Projects section includes an AI Suggestions button. Suggestions are based on the user's bio, field, current projects, selected language, and selected tone. Suggestions are treated as ideas, not completed achievements.

### Version History
MuseForge keeps the latest 3 generated portfolio versions during the session. Users can restore a previous generated version.

### One-click LinkedIn Export
After portfolio generation, users can copy a LinkedIn-ready portfolio summary.

## Supabase production note
Supabase production setup must be completed before final judge testing. Without Supabase, local JSON fallback works for development but public share links may not survive a hosted backend redeploy/restart.
