# IBM Bob Evidence — MuseForge

**IBM AI Builders Challenge — July Challenge: Reimagine Creative Industries with AI**

IBM Bob was the **primary development tool** for MuseForge. This document records what Bob was used for across the build and, for each session, **what shipped as a result** — named files, functions and routes that can be checked in this repository.

Every entry below follows the same shape:

- **Session** — what was asked of Bob and what it did
- **What shipped** — the concrete artifact in the codebase, so the claim is checkable rather than asserted
- **Screenshot** — the captured session

- **Inventory:** [`IBM_BOB_EVIDENCE_INDEX.md`](IBM_BOB_EVIDENCE_INDEX.md) · **Session log:** [`IBM_BOB_USAGE_LOG.md`](IBM_BOB_USAGE_LOG.md)

---

## At a glance

| # | Area | Screenshots | Shipped into |
|---|---|---|---|
| 1 | Code analysis and debugging | 01, 02 | `src/App.js` markup structure |
| 2 | Security hardening | 03, 04 | `backend/.env.example`, `helmet`, `express-rate-limit`, upload validation, CORS allowlist in `backend/server.js` |
| 3 | Deployment readiness | 05 | `docs/DEPLOYMENT_CHECKLIST.md`, `docs/DEPLOYMENT_GUIDE.md` |
| 4 | Reviews and ratings | 06, 07, 14 | Reviews store and routes, `POST /portfolio/share`, `GET /portfolio/:id` |
| 5 | Multilingual QA and fixes | 09, 12 | Script validation and label dictionaries in `backend/server.js`; `docs/LANGUAGE_QA_STATUS.md` |
| 6 | CV parsing | 11 | `parseBestCv`, `normalizeCvHeading`, `CV_SECTION_ALIASES`, `parseCvContact` |
| 7 | React UI and responsive | 10 | `src/App.js`, `src/App.css` |
| 8 | Final testing and acceptance | 08, 13 | `docs/TEST_RESULTS.md`, `docs/COMPETITION_SUBMISSION_CHECKLIST.md` |
| 9 | Documentation | 15 | `README.md` and the `docs/` set |
| 10 | Additional features | 16, 17 | Export customiser in `src/App.js`; project kickoff |

---

## 1. Code Analysis and Debugging

### 01 — HTML Syntax Review

**Session.** Bob analysed the application's generated markup for structural and semantic problems — unclosed and mismatched tags, non-semantic containers, and accessibility gaps in the portfolio output.

**What shipped.** Structural corrections to the portfolio markup produced by `src/App.js`, which matters more here than in a typical app: MuseForge emits a **standalone HTML portfolio** that a creator downloads and sends to clients or galleries, so malformed markup would follow the user out of the product.

![HTML Syntax Review](ibm-bob-evidence/01-bob-html-syntax-review.png)

### 02 — HTML Fixes Applied

**Session.** Bob applied the corrections identified in the review pass rather than only reporting them.

**What shipped.** Cleaner exported-portfolio markup and improved cross-browser rendering of the downloadable HTML.

![HTML Fixes Applied](ibm-bob-evidence/02-bob-html-fixes-applied.png)

---

## 2. Security Hardening

### 03 — Environment Configuration

**Session.** Bob set up secure environment handling: creating `backend/.env.example` as a committed template, separating real credentials from the repository, and establishing which values belong in the frontend versus the backend environment.

**What shipped.** `backend/.env.example` and the root `.env.example`, plus `.gitignore` coverage so real keys are never committed. This is the foundation the later IBM Cloud work sits on — the watsonx, Docling and Cloud Object Storage credentials all follow the same pattern.

![Environment Setup](ibm-bob-evidence/03-bob-env-setup.png)

### 04 — Backend Security Hardening

**Session.** Bob was given a single instruction to harden the backend and produced a seven-item task list, then worked through it:

1. Create `.env.example` in `backend/`
2. Install `express-rate-limit` and `helmet`
3. Add file upload validation (size and type limits)
4. Add rate limiting with `express-rate-limit`
5. Add `helmet` for security headers
6. Add a health check endpoint
7. Fix CORS for production

**What shipped.** All of this is live in `backend/server.js` and can be checked line by line:

- `helmet` security headers
- `express-rate-limit`, with a **separate stricter limiter on the AI endpoints** so a single user cannot exhaust the watsonx quota
- `multer` upload validation: **PDF-only** file filter, **10 MB** size cap, one file per request
- A production CORS allowlist rather than an open origin

This is the single most checkable piece of evidence in this set: the task list Bob generated maps one-to-one onto code that is in the repository today.

![Backend Security Hardening](ibm-bob-evidence/04-bob-security-hardening.png)

---

## 3. Deployment Readiness

### 05 — Deployment Checklist

**Session.** Bob produced and validated a production readiness checklist covering environment variables, build optimisation, security headers, storage configuration and pre-launch verification.

**What shipped.** `docs/DEPLOYMENT_CHECKLIST.md` and `docs/DEPLOYMENT_GUIDE.md`, which is how MuseForge reached a live deployment at **muse-forge.vercel.app** rather than staying a local prototype.

![Deployment Checklist](ibm-bob-evidence/05-bob-deployment-checklist.png)

---

## 4. Reviews and Ratings Feature

### 14 — Reviews Planning

**Session.** Before any code, Bob worked through the feature definition: what a review record contains, how ratings are stored and moderated, and how the interaction flows on a public portfolio page.

**What shipped.** The data model and flow that the implementation below follows — planning first, then code.

![Reviews Planning](ibm-bob-evidence/14-bob-reviews-planning.png)

### 06 — Reviews Feature Implementation

**Session.** Bob implemented the reviews and ratings feature: endpoint design, validation of incoming review payloads, storage, and the frontend integration on the portfolio page.

**What shipped.** The reviews store in `backend/server.js` with a Supabase-backed table and a local JSON fallback (`backend/data/reviews.json`), plus the reviews UI in `src/App.js`. Documented in `docs/REVIEWS_FEATURE_IMPLEMENTATION.md`.

![Reviews Feature](ibm-bob-evidence/06-bob-reviews-feature.png)

### 07 — Persistent Public Portfolio Links

**Session.** Bob configured persistent storage for published portfolios so that a share link survives a server restart or redeploy — the difference between a demo and something a creator can put on a business card.

**What shipped.** `POST /portfolio/share` and `GET /portfolio/:id` in `backend/server.js`, backed by a persistent store with a local JSON fallback. Documented in `docs/PERSISTENT_PORTFOLIO_LINKS_SETUP.md` and `docs/SUPABASE_SETUP.md`, with the schema in `docs/supabase-production-schema.sql`.

![Persistent Public Links](ibm-bob-evidence/07-bob-supabase-public-links.png)

---

## 5. Multilingual QA and Language Fixes

### 09 — Language QA

**Session.** Bob ran quality-assurance passes across MuseForge's supported output languages, checking that generated portfolios were genuinely in the selected language, that headings and section names were localised rather than left in English, and that no fragments leaked through untranslated.

**What shipped.** The findings drove the language validation layer in `backend/server.js` — `languageStrictInstruction()` per-language prompt rules, `hasUnexpectedScriptForLanguage()` script validation, and `looksLikeWrongEnglishForTarget()` — and are recorded in `docs/LANGUAGE_QA_STATUS.md`. This is the work that made the output language a **guarantee** rather than a request: a wrong-language answer is retried, then rejected.

![Language QA](ibm-bob-evidence/09-bob-language-qa.png)

### 12 — Multilingual Fix Implementation

**Session.** Bob implemented fixes for the problems the QA pass surfaced: text overflow in languages with longer words, non-Latin script rendering, character encoding, and translation accuracy in the generated portfolio.

**What shipped.** Per-language label dictionaries (`OUTPUT_LABELS` and the frontend label maps) so section names, field labels and the creative field are localised deterministically — correct even when the model is unavailable — plus the layout corrections in `src/App.css` that keep longer translated strings from breaking the portfolio layout.

![Multilingual Fix](ibm-bob-evidence/12-bob-multilingual-fix.png)

---

## 6. CV Parsing and Portfolio Generation

### 11 — CV Parsing Fix

**Session.** Bob debugged the CV parsing pipeline: PDF text extraction, mapping extracted content onto portfolio fields, and error handling across CV formats that do not follow a single layout convention.

**What shipped.** The CV pipeline in `backend/server.js`:

- `parseBestCv()` — scores the IBM Docling extraction against the local parser and keeps the stronger result
- `normalizeCvHeading()` with `CV_SECTION_ALIASES` and `CV_SECTION_ALIASES_MULTILINGUAL` — recognises heading variants such as `SKILLS & TOOLS`, `KEY PROJECTS` and `WORK HISTORY`, headings split across two PDF lines, and headings written in languages other than English
- `parseCvContact()` — pulls contact details and embedded links out of the document

This is the layer every downstream FactLock decision depends on: if the sections are parsed wrongly, the grounding is grounded in the wrong text.

![CV Parsing Fix](ibm-bob-evidence/11-bob-cv-parsing-fix.png)

---

## 7. React UI and Responsive Design

### 10 — React Rendering and Responsive Fixes

**Session.** Bob identified and resolved React rendering issues, responsive layout problems and component bugs affecting the multi-step creator flow.

**What shipped.** Corrections across `src/App.js` and `src/App.css` covering the creator-type selection, the two-column form layout, and the portfolio preview, so the flow behaves consistently from mobile through desktop.

![React Responsive Fixes](ibm-bob-evidence/10-bob-react-responsive-fixes.png)

---

## 8. Final Testing and Acceptance

### 08 — End-to-End Testing

**Session.** Bob ran end-to-end validation across the full product: authentication, CV upload, generation, the FactLock review step, export, and public sharing — including edge cases and failure paths.

**What shipped.** Test records in `docs/TEST_EXECUTION_SUMMARY.md` and `docs/TEST_RESULTS.md`, and the fixes that came out of them.

![Final Testing](ibm-bob-evidence/08-bob-final-testing.png)

### 13 — Acceptance Criteria Validation

**Session.** Bob checked the build against the competition's stated requirements — working prototype, AI as a core component, public repository, README contents, demo video — and identified what was still outstanding.

**What shipped.** `docs/COMPETITION_SUBMISSION_CHECKLIST.md`, used to track submission completeness.

![Acceptance Criteria](ibm-bob-evidence/13-bob-acceptance-criteria.png)

---

## 9. Documentation

### 15 — Documentation Workflow

**Session.** Bob assisted in producing the project documentation set: setup instructions, environment configuration, feature descriptions and operational guides.

**What shipped.** The `docs/` directory, including deployment, storage setup, language QA and testing documentation, alongside the project README.

![README Documentation](ibm-bob-evidence/15-bob-readme-documentation.png)

---

## 10. Additional Features

### 16 — Export Customizer

**Session.** Bob implemented the portfolio export customiser, letting a creator choose which sections appear and how the exported portfolio is styled before downloading it.

**What shipped.** The export flow in `src/App.js` (`performExportPortfolio` and the export HTML builder), which produces a **standalone HTML file** — no dependency on MuseForge staying online, and no lock-in for the creator. Documented in `docs/EXPORT_CUSTOMIZER_SUMMARY.md`.

![Export Customizer](ibm-bob-evidence/16-bob-export-customizer.png)

### 17 — Project Kickoff

**Session.** The first Bob session on MuseForge, where the project scope, the workspace and the working method were established.

**What shipped.** The working pattern used for the rest of the build: describe the goal, let Bob produce a task list, work through it, verify the result in the codebase.

![Bob Kickoff](ibm-bob-evidence/17-bob-ui-welcome.png)

---

## How to verify this evidence

Each claim above points at something in the repository. The fastest checks:

| Claim | Check |
|---|---|
| Security hardening shipped | `grep -n "helmet\|rateLimit\|fileFilter" backend/server.js` |
| Upload validation is real | `multer` config in `backend/server.js` — PDF-only filter, 10 MB limit |
| Language validation is real | `grep -n "hasUnexpectedScriptForLanguage\|languageStrictInstruction" backend/server.js` |
| CV parsing is real | `grep -n "parseBestCv\|CV_SECTION_ALIASES" backend/server.js` |
| Public share links are real | `grep -n "portfolio/share\|portfolio/:id" backend/server.js` |
| The IBM stack is live | `curl http://localhost:5000/ibm-status` |

---

## Summary

IBM Bob contributed to MuseForge across ten areas of the build:

- **Security** — environment configuration, Helmet, tiered rate limiting, PDF-only upload validation with a size cap, production CORS
- **Code quality** — markup structure in the exported portfolio, React rendering and responsive layout
- **Document processing** — CV parsing, heading detection across formats and languages, contact and link extraction
- **Multilingual output** — QA across the supported languages, script validation, and deterministic label localisation
- **Features** — reviews and ratings from planning to implementation, persistent public portfolio links, export customiser
- **Testing** — end-to-end validation and acceptance-criteria verification
- **Documentation and deployment** — the `docs/` set and the checklist that took MuseForge to a live deployment

The pattern throughout was the same: state the goal, let Bob produce a plan, work through it, and verify the outcome against the codebase. The security session (04) is the clearest example — a seven-item task list that maps one-to-one onto code that is in the repository today.

---

### Scope note

MuseForge generates portfolios in **15 output languages**: English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Turkish, Russian, Chinese, Japanese, Korean, Indonesian and Vietnamese. **Input is unrestricted** — a CV or free-text entry written in any language is detected and converted, so a CV typed in one language can produce a portfolio in another. The multilingual QA sessions recorded above (09, 12) cover the supported output set.
