const fs = require("fs");
const path = require("path");

const appPath = path.join("src", "App.js");

if (!fs.existsSync(appPath)) {
  throw new Error("src/App.js not found");
}

let app = fs.readFileSync(appPath, "utf8");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

function mustReplace(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    throw new Error("Patch target not found: " + label);
  }
  return source.replace(pattern, replacement);
}

fs.copyFileSync(appPath, appPath + ".bak-public-link-footer-" + stamp);

/* =========================================================
   1) Local fallback cache for public portfolio links
   ========================================================= */

if (!app.includes("PUBLIC_PORTFOLIO_LOCAL_CACHE_KEY")) {
  app = mustReplace(
    app,
    /const getPublicPortfolioIdFromPath = \(\) => \{[\s\S]*?\n\};/,
    `const getPublicPortfolioIdFromPath = () => {
  if (typeof window === 'undefined') return '';
  const match = window.location.pathname.match(/^\\/portfolio\\/([a-zA-Z0-9_-]+)$/);
  return match ? match[1] : '';
};

const PUBLIC_PORTFOLIO_LOCAL_CACHE_KEY = 'museforge_public_portfolios_cache';

const readCachedPublicPortfolios = () => {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PUBLIC_PORTFOLIO_LOCAL_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
};

const readCachedPublicPortfolio = (id = '') => {
  const cleanId = String(id || '').trim();
  if (!cleanId) return null;
  return readCachedPublicPortfolios()[cleanId] || null;
};

const cachePublicPortfolio = (portfolio = {}) => {
  if (typeof window === 'undefined' || !portfolio || !portfolio.id) return;
  try {
    const cache = readCachedPublicPortfolios();
    cache[String(portfolio.id)] = {
      ...portfolio,
      cachedAt: new Date().toISOString(),
      storage: portfolio.storage || 'browser-local-cache',
    };
    const entries = Object.entries(cache).slice(-25);
    window.localStorage.setItem(PUBLIC_PORTFOLIO_LOCAL_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch (_) {}
};`,
    "public portfolio cache helpers"
  );
}

/* Use cache when backend says portfolio not found */
app = mustReplace(
  app,
  /setPublicPortfolioError\(error\?\.message \|\| 'Portfolio could not be opened\.'\);\s*setPublicPortfolioStatus\('error'\);/,
  `const cached = readCachedPublicPortfolio(publicPortfolioId);
        if (cached) {
          setPublicPortfolio(cached);
          setPublicPortfolioError('');
          setPublicPortfolioStatus('ready');
          return;
        }
        setPublicPortfolioError(error?.message || 'Portfolio could not be opened.');
        setPublicPortfolioStatus('error');`,
  "public portfolio backend fallback"
);

/* Cache portfolio immediately after share link is created */
app = mustReplace(
  app,
  /setShareUrl\(finalUrl\);/,
  `if (data.id) {
        cachePublicPortfolio({
          id: data.id,
          name: displayName || fixName(name),
          medium: displayMedium || medium,
          language: portfolioLanguage,
          portfolio,
          projects: displayProjects,
          customSections: displayCustomSections,
          imagePreview: imagePreview || '',
          imagePosition: imagePosition || { x: 50, y: 50 },
          contact,
          skills: displaySkills,
          factLockReviews,
          localizedOutput,
          trustReport: buildFactLockTrustReport({
            factLockReviews,
            portfolioLanguage,
            inputLanguage: detectInputLanguage(name, medium, description, projects.map(p => p.desc), customSections.map(s => s.items?.map(i => i.desc))),
            shareLinkCreated: true,
            projects: displayProjects,
            customSections: displayCustomSections,
          }),
          createdBy: 'MuseForge',
          createdAt: new Date().toISOString(),
          storage: data.storage || 'browser-local-cache',
        });
      }
      setShareUrl(finalUrl);`,
  "cache public portfolio after share"
);

/* =========================================================
   2) Restore exported HTML footer
   ========================================================= */

const cleanFooterCss = `    .footer {
      margin: 56px auto 0;
      padding: 18px 16px 22px;
      text-align: center;
      border-top: 1px solid var(--mf-border);
      background: var(--mf-footer);
      font-family: "Times New Roman", Times, serif;
    }
    .footer p {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding: 10px 24px;
      border-radius: 999px;
      border: 1px solid rgba(168, 85, 247, 0.22);
      background: rgba(255, 255, 255, 0.06);
      color: var(--mf-body);
      font-family: "Times New Roman", Times, serif;
      font-size: 1rem;
      line-height: 1;
      font-weight: 700;
      letter-spacing: 0.01em;
      box-shadow: none;
    }`;

app = mustReplace(
  app,
  /    \.footer \{[\s\S]*?    \.footer p \{[\s\S]*?    \}/,
  cleanFooterCss,
  "exported HTML footer CSS"
);

fs.writeFileSync(appPath, app, "utf8");

console.log("✅ Public portfolio fallback cache added.");
console.log("✅ Share links are cached in browser as backup.");
console.log("✅ Exported HTML footer restored to clean subtle style.");
console.log("Backup created: " + appPath + ".bak-public-link-footer-" + stamp);
