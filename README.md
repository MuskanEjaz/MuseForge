# MuseForge — Fact-Locked AI Portfolio Builder

<p align="center">
  <img src="docs/readme-assets/museforge-landing-preview.png" alt="MuseForge landing page preview" width="900" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/DEMO-Link%20Coming%20Soon-6d28d9?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Demo coming soon" />
  <img src="https://img.shields.io/badge/LIVE-Link%20Coming%20Soon-16a34a?style=for-the-badge&logo=vercel&logoColor=white" alt="Live link coming soon" />
</p>

**MuseForge** is an AI-powered portfolio builder for creators who need to turn raw ideas, project notes, creative work, CV details, and media into polished, shareable portfolios without inventing unsupported achievements.

**Competition:** IBM AI Builders Challenge — July Challenge: Reimagine Creative Industries with AI
**Core Innovation:** FactLock AI review workflow that shows what AI changed before users accept it, preventing fabricated claims while enhancing professional presentation.

---

## 🎯 Problem Statement

Creators often have real work but struggle to present it professionally. Their notes may be short, informal, multilingual, or scattered across CVs, project descriptions, images, videos, and audio. Generic AI tools can make writing sound better, but they may also invent skills, achievements, tools, metrics, clients, or awards that the user never claimed.

**The Risk:** AI-generated portfolios that look impressive but contain fabricated information can damage professional credibility and career opportunities.

**The Solution:** MuseForge adds a **FactLock review layer** that shows what the AI changed before the user accepts it, making AI assistance visible, reviewable, and safer for career or creative identity use.

---

## 💡 Solution Overview

MuseForge provides a structured workflow for authentic portfolio generation:

1. **Create Account** — Email/password or Google sign-in with verification
2. **Choose Creator Path** — Artist, Musician, Student/Job Seeker, Photographer, or Writer
3. **Input Content** — Fill details manually or upload CV (Student/Job Seeker path)
4. **Add Projects** — Include descriptions, custom sections, skills, images, video, and audio
5. **Select Language** — Choose the final portfolio output language from the supported language dropdown
6. **Generate Portfolio** — AI-assisted enhancement with fact preservation
7. **Review FactLock** — Compare original vs enhanced descriptions with unsupported fact detection
8. **Export & Share** — Download HTML or create public shareable portfolio URL

---

## 🌟 Key Features

### 1. FactLock AI Portfolio Enhancement

MuseForge does not simply overwrite user descriptions. It shows a review panel with:

- **Original project description** — User's authentic input
- **AI-enhanced description** — Professional refinement
- **Preserved user-provided facts** — What stayed the same
- **Unsupported new facts detected** — What AI tried to add
- **Accept / Keep Original / Manual Edit** — User control

This makes AI assistance transparent and prevents fabricated claims.

**FactLock Rules:** AI must not add unsupported tools, metrics, awards, clients, dates, job roles, outcomes, achievements, or project features.

### 2. Multilingual Portfolio Generation

Users can write input naturally in any language, then select the final portfolio language from:

- **European:** English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Turkish, Greek
- **Asian:** Chinese, Japanese, Korean, Bengali, Punjabi, Tamil, Telugu, Thai, Vietnamese, Indonesian, Malay, Filipino
- **Middle Eastern / Regional:** Persian, Pashto, Sindhi
- **Other:** Russian, Swahili

### 3. Public Portfolio Links

After generation, users can create public portfolio URLs:

```
/portfolio/fact-lock-artist-a1b2c3d4
```

- **Local Development:** Links saved in JSON storage with local fallback
- **Production:** Supabase-ready storage configuration for persistent links
- **Setup Guide:** [`docs/PERSISTENT_PORTFOLIO_LINKS_SETUP.md`](docs/PERSISTENT_PORTFOLIO_LINKS_SETUP.md)

### 4. Creator-Specific Workflows

Each creator type has customized fields, prompts, visuals, and portfolio structures:

- **Artists** — Visual project galleries with image uploads
- **Musicians** — Audio/video integration for performances and compositions
- **Photographers** — Image-focused portfolios with project descriptions
- **Writers** — Text-heavy portfolios with publication details
- **Students/Job Seekers** — CV upload and parsing with career-focused templates

### 5. CV Upload and Parsing

Student/Job Seeker path supports:

- PDF CV upload
- Automatic text extraction
- Field mapping to portfolio structure
- Manual editing and refinement

### 6. Media Support

- **Images** — Project galleries and profile pictures with repositioning
- **Video** — Embedded video content for creative work
- **Audio** — Audio file integration for musicians and podcasters

### 7. Export Customizer

Users can customize portfolio exports:

- Select which sections to include
- Choose styling preferences
- Download as standalone HTML
- Copy generated text for external use

### 8. Reviews and Ratings Feature

Portfolio review system with:

- Star ratings (1-5)
- Written feedback
- Review moderation
- Public display on portfolio pages

### 9. Authentication and Security

- Email/password authentication with verification
- Google Sign-In integration
- Password reset flow
- Welcome emails
- Secure session management
- Environment-based configuration
- Input validation and sanitization
- Rate limiting
- Helmet.js security headers
- File upload validation

---

## 🏗️ Technology Stack

### Frontend
- **React** — Component-based UI
- **CSS** — Custom styling and responsive design
- **Google Identity Services** — OAuth integration
- **Client-side routing** — Portfolio preview and public links

### Backend
- **Node.js** — Runtime environment
- **Express** — Web framework
- **Multer** — File upload handling
- **pdfreader** — CV parsing
- **Nodemailer** — Email notifications
- **Google Auth Library** — Token verification
- **Groq SDK** — AI generation layer
- **JSON Storage** — Local development data
- **Supabase** — Production persistent storage

### Security
- **Helmet.js** — Security headers
- **Rate limiting** — API protection
- **Input validation** — XSS prevention
- **File validation** — Upload security
- **Environment variables** — Credential management

---

## 📁 Project Structure

```
MUSEFORGE_COMPETITION_FINAL_TESTED/
├── backend/
│   ├── server.js              # Express server with security hardening
│   ├── data/
│   │   └── reviews.json       # Reviews storage
│   ├── .env.example           # Backend environment template
│   └── package.json           # Backend dependencies
├── docs/
│   ├── IBM_BOB_EVIDENCE.md    # Comprehensive Bob evidence documentation
│   ├── IBM_BOB_EVIDENCE_INDEX.md  # Screenshot inventory
│   ├── ibm-bob-evidence/      # 17 organized evidence screenshots
│   ├── SUPABASE_SETUP.md      # Database configuration
│   ├── DEPLOYMENT_CHECKLIST.md  # Production readiness
│   ├── 25_LANGUAGE_QA_REPORT.md  # Multilingual testing results
│   └── [other documentation]
├── src/
│   ├── App.js                 # Main React application
│   ├── App.css                # Application styling
│   └── [other components]
├── public/                    # Static assets and demo video
├── .env.example               # Frontend environment template
├── package.json               # Frontend dependencies
└── README.md                  # This file
```

---

## 🚀 Installation and Setup

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- Groq API key (or compatible AI provider)
- Google OAuth credentials (optional)
- Gmail app password for email (optional)

### 1. Install Dependencies

Frontend:
```powershell
npm install --ignore-scripts
```

Backend:
```powershell
npm --prefix backend install
```

### 2. Configure Environment Variables

Copy example files:
```powershell
Copy-Item .env.example .env
Copy-Item backend\.env.example backend\.env
```

**Root `.env`:**
```env
REACT_APP_API_URL=http://localhost:5000
REACT_APP_GOOGLE_CLIENT_ID=your_google_client_id
```

**Backend `.env`:**
```env
# AI Configuration
GROQ_API_KEY=your_groq_or_ai_key

# Authentication
AUTH_SECRET=your_long_random_secret_min_32_chars
GOOGLE_CLIENT_ID=your_google_client_id

# Email Configuration (Optional)
SMTP_SERVICE=gmail
SMTP_USER=your_sender_gmail@gmail.com
SMTP_PASS=your_16_character_gmail_app_password
MAIL_FROM="MuseForge <your_sender_gmail@gmail.com>"

# Server Configuration
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Supabase (Production Only)
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SUPABASE_PORTFOLIOS_TABLE=public_portfolios
```

**⚠️ Never commit real `.env` files to version control**

### 3. Run Locally

**Recommended (concurrent):**
```powershell
npm run dev
```

**Alternative (separate terminals):**

Terminal 1 (Backend):
```powershell
cd backend
node server.js
```

Terminal 2 (Frontend):
```powershell
npm start
```

**Access:**
- Frontend: `http://localhost:3000`
- Backend Health: `http://localhost:5000/health`

---

## 🧪 Testing

### Frontend Tests
```powershell
npm run test:ci -- --runInBand
```

### Backend Smoke Tests
```powershell
npm --prefix backend test
```

### Production Build
```powershell
npm run build
```

### Test Coverage

Current tested functionality:
- Welcome and login UI
- Signup and verification state
- Email verification links
- Password reset flow
- Google login error handling
- CV upload exception handling
- Project enhancement workflow
- FactLock generation metadata
- Target language payload
- Shareable portfolio URL creation
- Portfolio retrieval and display

---

## 🤖 IBM Bob Usage

IBM Bob was instrumental throughout the MuseForge development process, serving as the primary AI development assistant for:

### Code Analysis and Debugging
- HTML syntax review and structural improvements
- React component optimization
- JSX rendering issue resolution
- Responsive design fixes

### Security Hardening
- Environment configuration setup
- Backend security implementation (Helmet.js, rate limiting)
- Input validation and sanitization
- File upload security
- CORS configuration

### Feature Implementation
- Reviews and ratings system architecture
- Supabase integration for persistent links
- Export customizer functionality
- CV parsing improvements
- Multilingual support enhancements

### Quality Assurance
- Comprehensive language QA across 25 languages
- End-to-end testing validation
- Acceptance criteria verification
- Deployment readiness checklist

### Documentation
- README creation and refinement
- Technical documentation
- Setup guides
- Testing reports

### Development Workflow
IBM Bob provided:
- Feature specifications and planning
- Architecture design guidance
- Debugging assistance
- Code review and improvements
- Best practices recommendations
- Competition submission preparation

**Comprehensive IBM Bob evidence is available in [`docs/IBM_BOB_EVIDENCE.md`](docs/IBM_BOB_EVIDENCE.md)**

The evidence includes 17 organized screenshots demonstrating Bob's contributions across:
- Code analysis (2 screenshots)
- Security hardening (2 screenshots)
- Deployment readiness (1 screenshot)
- Reviews feature (3 screenshots)
- Multilingual QA (2 screenshots)
- CV parsing fixes (1 screenshot)
- React UI improvements (1 screenshot)
- Final testing (2 screenshots)
- Documentation (1 screenshot)
- Additional features (2 screenshots)

---

## 📊 Competition Readiness

### ✅ Completed Requirements

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Working prototype using IBM Bob | ✅ Complete | 17 evidence screenshots in `docs/ibm-bob-evidence/` |
| AI as core component | ✅ Complete | FactLock review, portfolio generation, multilingual output |
| Public GitHub repository | ✅ Ready | Clean codebase with proper `.gitignore` |
| Clear README | ✅ Complete | Competition-focused documentation |
| Demo video | 📝 Pending | Script available in `docs/DEMO_VIDEO_SCRIPT_FACTLOCK_FIRST.md` |
| Security implementation | ✅ Complete | Helmet, rate limiting, input validation, file security |
| Testing coverage | ✅ Complete | Frontend and backend tests with documented results |

### 🎯 Competitive Advantages

1. **FactLock Innovation** — Unique AI transparency and fact-checking layer
2. **Multilingual Support** — Comprehensive language options with QA testing
3. **Creator-Specific Workflows** — Tailored experiences for different creative professions
4. **Public Portfolio Links** — Local JSON fallback with Supabase-ready production storage
5. **Security-Conscious Design** — Helmet, rate limiting, environment configuration, upload validation, and CORS controls
6. **IBM Bob Integration** — Extensive documented AI-assisted development

---

## 🎬 Demo Strategy

For the competition video, lead with the problem and FactLock innovation:

1. **Problem Introduction** (30 seconds) — AI portfolio tools that fabricate claims
2. **FactLock Solution** (60 seconds) — Show review panel with fact detection
3. **Creator Workflow** (45 seconds) — Quick demonstration of portfolio creation
4. **Multilingual Output** (20 seconds) — Language selection and generation
5. **Public Sharing** (15 seconds) — Shareable portfolio URL
6. **IBM Bob Evidence** (10 seconds) — Development process highlights

**Full script:** [`docs/DEMO_VIDEO_SCRIPT_FACTLOCK_FIRST.md`](docs/DEMO_VIDEO_SCRIPT_FACTLOCK_FIRST.md)

---

## 📝 Documentation

Comprehensive documentation is available in the `docs/` directory:

- **[IBM_BOB_EVIDENCE.md](docs/IBM_BOB_EVIDENCE.md)** — Complete Bob usage documentation
- **[IBM_BOB_EVIDENCE_INDEX.md](docs/IBM_BOB_EVIDENCE_INDEX.md)** — Screenshot inventory
- **[SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)** — Database configuration
- **[DEPLOYMENT_CHECKLIST.md](docs/DEPLOYMENT_CHECKLIST.md)** — Production readiness
- **[25_LANGUAGE_QA_REPORT.md](docs/25_LANGUAGE_QA_REPORT.md)** — Multilingual testing
- **[REVIEWS_FEATURE_IMPLEMENTATION.md](REVIEWS_FEATURE_IMPLEMENTATION.md)** — Reviews system
- **[USER_TESTING_PLAN.md](docs/USER_TESTING_PLAN.md)** — Testing methodology

---

## ⚠️ Known Limitations

- **Storage:** Current prototype uses JSON storage for local development; production deployment requires database migration
- **Portfolio Persistence:** Shareable links depend on backend data store; deployment must persist backend data
- **AI Quality:** Output quality depends on configured AI model and API key
- **Email:** Email features require SMTP configuration; optional for core functionality
- **User Testing:** Evidence collection in progress; no fabricated metrics included

---

## 🚀 Future Improvements

### Technical Enhancements
- Production database migration (PostgreSQL/MongoDB)
- IBM Granite / watsonx.ai integration for IBM-native AI
- Custom username slugs for portfolio URLs
- Portfolio analytics dashboard
- Team collaboration mode

### Feature Additions
- More portfolio template styles
- Built-in user testing dashboard
- Advanced export formats (PDF, DOCX)
- Portfolio version history
- Social media integration

### UX Improvements
- Better multilingual typography
- Enhanced right-to-left layout support
- Mobile app version
- Offline portfolio editing
- Real-time collaboration

---

## 📄 License

This project was developed for the IBM AI Builders Challenge — July Challenge: Reimagine Creative Industries with AI.

---

## 🙏 Acknowledgments

- **IBM AI Builders Challenge** — For the opportunity to reimagine creative industries with AI
- **IBM Bob** — For comprehensive development assistance throughout the project
- **Groq** — For fast AI inference capabilities
- **Supabase** — For persistent storage infrastructure

---

## 📞 Contact

For questions about MuseForge or the competition submission, please refer to the documentation in the `docs/` directory.

---

**IBM Bob evidence is available in [`docs/IBM_BOB_EVIDENCE.md`](docs/IBM_BOB_EVIDENCE.md).**
