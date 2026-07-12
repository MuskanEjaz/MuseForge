const fs = require("fs");
const path = require("path");

const appPath = path.join("src", "App.js");
const serverPath = path.join("backend", "server.js");

if (!fs.existsSync(appPath)) throw new Error("src/App.js not found");
if (!fs.existsSync(serverPath)) throw new Error("backend/server.js not found");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");

function latestBackupWithPrefix(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(name => name.startsWith(prefix))
    .map(name => {
      const full = path.join(dir, name);
      return { full, time: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.time - a.time);
  return files.length ? files[0].full : null;
}

/* 1) Restore App.js from the backup made right before the public-link/footer patch */
const publicFooterBackup = latestBackupWithPrefix("src", "App.js.bak-public-link-footer-");

fs.copyFileSync(appPath, appPath + ".bak-before-public-link-footer-restore-" + stamp);

if (publicFooterBackup) {
  fs.copyFileSync(publicFooterBackup, appPath);
  console.log("✅ Restored src/App.js from: " + publicFooterBackup);
} else {
  console.warn("⚠️ No App.js.bak-public-link-footer-* backup found. Keeping current App.js and applying footer restore only.");
}

/* Reload files after optional restore */
let app = fs.readFileSync(appPath, "utf8");
let server = fs.readFileSync(serverPath, "utf8");

fs.copyFileSync(serverPath, serverPath + ".bak-before-public-read-fallback-" + stamp);

/* 2) Backend public portfolio read fallback fix */
const oldFindPattern = /async function findPublicPortfolio\(id\) \{[\s\S]*?\n\}\n\nfunction createPortfolioSlug/;

const newFindBlock = [
"async function findPublicPortfolio(id) {",
"  const cleanId = cleanText(id);",
"  if (!cleanId) return null;",
"",
"  const findLocalPortfolio = () => readPublicPortfolios().find(item => item.id === cleanId) || null;",
"",
"  if (publicPortfolioDatabaseEnabled) {",
"    try {",
"      const encodedId = encodeURIComponent(cleanId);",
"      const rows = await supabaseRequest(`${SUPABASE_PORTFOLIOS_TABLE}?id=eq.${encodedId}&select=portfolio_data`, {",
"        method: 'GET',",
"      });",
"      const remotePortfolio = Array.isArray(rows) && rows[0]?.portfolio_data ? rows[0].portfolio_data : null;",
"      if (remotePortfolio) return remotePortfolio;",
"    } catch (error) {",
"      console.warn('Supabase portfolio read failed; using local JSON fallback:', error.message);",
"    }",
"  }",
"",
"  return findLocalPortfolio();",
"}",
"",
"function createPortfolioSlug"
].join("\n");

if (!oldFindPattern.test(server)) {
  throw new Error("Could not find findPublicPortfolio block in backend/server.js");
}

server = server.replace(oldFindPattern, newFindBlock);

/* 3) Restore exported HTML footer to clean subtle style */
const footerStart = app.indexOf("    .footer {");
const badgeMarker = "    .badge {";
const footerEnd = footerStart >= 0 ? app.indexOf(badgeMarker, footerStart) : -1;

if (footerStart < 0 || footerEnd < 0) {
  throw new Error("Could not find exported HTML footer CSS block in src/App.js");
}

const cleanFooterCss = [
"    .footer {",
"      margin: 56px auto 0;",
"      padding: 18px 16px 24px;",
"      text-align: center;",
"      border-top: 1px solid var(--mf-border);",
"      background: var(--mf-footer);",
"      font-family: \"Times New Roman\", Times, serif;",
"    }",
"    .footer p {",
"      display: inline-flex;",
"      align-items: center;",
"      justify-content: center;",
"      margin: 0;",
"      padding: 10px 24px;",
"      border-radius: 999px;",
"      border: 1px solid rgba(168, 85, 247, 0.22);",
"      background: rgba(255, 255, 255, 0.06);",
"      color: var(--mf-body);",
"      font-family: \"Times New Roman\", Times, serif;",
"      font-size: 1rem;",
"      line-height: 1;",
"      font-weight: 700;",
"      letter-spacing: 0.01em;",
"      box-shadow: none;",
"    }",
""
].join("\n");

app = app.slice(0, footerStart) + cleanFooterCss + app.slice(footerEnd);

fs.writeFileSync(appPath, app, "utf8");
fs.writeFileSync(serverPath, server, "utf8");

console.log("✅ Backend public portfolio read fallback fixed.");
console.log("✅ Exported HTML footer restored to clean subtle style.");
console.log("✅ App.css was not touched.");
console.log("Backups created:");
console.log("- " + appPath + ".bak-before-public-link-footer-restore-" + stamp);
console.log("- " + serverPath + ".bak-before-public-read-fallback-" + stamp);
