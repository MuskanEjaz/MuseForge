# IBM Bob Evidence — Screenshot Inventory

Complete inventory of the IBM Bob evidence screenshots collected for the MuseForge submission to the **IBM AI Builders Challenge — July Challenge: Reimagine Creative Industries with AI**.

IBM Bob was the **primary development tool** for MuseForge. These screenshots capture Bob sessions across ten areas of the build, from initial project setup through security hardening, feature implementation, multilingual QA and final acceptance testing.

- **Full write-up:** [`IBM_BOB_EVIDENCE.md`](IBM_BOB_EVIDENCE.md)
- **Screenshot folder:** [`ibm-bob-evidence/`](ibm-bob-evidence/)
- **Session log:** [`IBM_BOB_USAGE_LOG.md`](IBM_BOB_USAGE_LOG.md)

---

## Screenshot inventory

| # | File | Category | What it shows |
|---|---|---|---|
| 01 | `01-bob-html-syntax-review.png` | Code analysis and debugging | Bob analysing HTML structure and identifying semantic and markup issues |
| 02 | `02-bob-html-fixes-applied.png` | Code analysis and debugging | The resulting fixes applied to the markup |
| 03 | `03-bob-env-setup.png` | Security hardening | Environment configuration: `.env` structure, API key handling, credential practice |
| 04 | `04-bob-security-hardening.png` | Security hardening | Backend security implementation — Helmet, rate limiting, input validation, file-upload validation, CORS |
| 05 | `05-bob-deployment-checklist.png` | Deployment readiness | Production deployment checklist created and validated |
| 06 | `06-bob-reviews-feature.png` | Reviews and ratings feature | Reviews API endpoints, data validation and frontend integration |
| 07 | `07-bob-supabase-public-links.png` | Reviews and ratings feature | Persistent storage configuration for public portfolio links |
| 08 | `08-bob-final-testing.png` | Final testing and acceptance | End-to-end testing across features, flows and edge cases |
| 09 | `09-bob-language-qa.png` | Multilingual QA and language fixes | Quality-assurance pass across the supported output languages |
| 10 | `10-bob-react-responsive-fixes.png` | React UI and responsive fixes | React rendering and responsive layout corrections |
| 11 | `11-bob-cv-parsing-fix.png` | CV parsing and portfolio generation | CV parsing debugging — PDF text extraction, field mapping, error handling |
| 12 | `12-bob-multilingual-fix.png` | Multilingual QA and language fixes | Multilingual rendering fixes — text overflow, script rendering, character encoding, translation accuracy |
| 13 | `13-bob-acceptance-criteria.png` | Final testing and acceptance | Verification against the competition's acceptance criteria |
| 14 | `14-bob-reviews-planning.png` | Reviews and ratings feature | Requirements, data model and interaction flow planning |
| 15 | `15-bob-readme-documentation.png` | Documentation | README and technical documentation work |
| 16 | `16-bob-export-customizer.png` | Additional features | Portfolio export customiser implementation |
| 17 | `17-bob-ui-welcome.png` | Additional features | First Bob session on MuseForge — project scope and working approach |

**Total: 17 screenshots**

---

## Category summary

| # | Category | Screenshots | Files |
|---|---|---|---|
| 1 | Code analysis and debugging | 2 | 01, 02 |
| 2 | Security hardening | 2 | 03, 04 |
| 3 | Deployment readiness | 1 | 05 |
| 4 | Reviews and ratings feature | 3 | 06, 07, 14 |
| 5 | Multilingual QA and language fixes | 2 | 09, 12 |
| 6 | CV parsing and portfolio generation | 1 | 11 |
| 7 | React UI and responsive fixes | 1 | 10 |
| 8 | Final testing and acceptance | 2 | 08, 13 |
| 9 | Documentation | 1 | 15 |
| 10 | Additional features | 2 | 16, 17 |
| | **Total** | **17** | |

---

## Where each area shows up in the codebase

| Evidence category | Corresponding work in the repo |
|---|---|
| Security hardening | `helmet`, `express-rate-limit` with a stricter AI-endpoint limiter, PDF-only upload validation with a 10 MB cap, CORS allowlist, scrypt hashing, HMAC-signed session tokens — all in `backend/server.js` |
| CV parsing | `parseBestCv`, `normalizeCvHeading`, `CV_SECTION_ALIASES`, `CV_SECTION_ALIASES_MULTILINGUAL`, `parseCvContact` in `backend/server.js`; `backend/cv-readability.js`; suites `cv-test-harness.js`, `docling-cv-test.js`, `test-cv-readability.js`, `probe-cv.js`, `probe-sections.js` |
| Multilingual QA | `hasUnexpectedScriptForLanguage`, `looksLikeWrongEnglishForTarget`, `languageStrictInstruction`, the per-language label dictionaries; suites `lang-test.js`, `lang-headings-test.js`, `language-e2e-test.js`, `multilang-cv-test.js`, `first-person-test.js` |
| Reviews and public links | `POST /portfolio/share`, `GET /portfolio/:id`, the reviews store and Supabase integration in `backend/server.js`; `docs/PERSISTENT_PORTFOLIO_LINKS_SETUP.md`, `docs/SUPABASE_SETUP.md` |
| Export customiser | `performExportPortfolio` and the export HTML builder in `src/App.js` |
| React UI and responsive fixes | `src/App.js`, `src/App.css` |
| Deployment readiness | `docs/DEPLOYMENT_CHECKLIST.md`, `docs/DEPLOYMENT_GUIDE.md` |
| Final testing and acceptance | `docs/TEST_EXECUTION_SUMMARY.md`, `docs/TEST_RESULTS.md`, `docs/COMPETITION_SUBMISSION_CHECKLIST.md` |

---

## Notes on scope

- **Output languages: 15.** MuseForge generates portfolios in English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Turkish, Russian, Chinese, Japanese, Korean, Indonesian and Vietnamese. **Input is unrestricted** — a CV or free-text entry written in any language is detected and converted. The multilingual QA evidence (09, 12) covers the supported output set.
- **Screenshots are deduplicated.** Eight near-identical captures from the same Bob sessions were removed during organisation so that each file in this inventory represents a distinct piece of work rather than a repeated view of the same one.
- **Naming convention:** `##-bob-descriptive-name.png`, numbered 01–17 in the order the work was carried out.
