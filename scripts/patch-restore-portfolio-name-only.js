const fs = require("fs");
const path = require("path");

const appPath = path.join("src", "App.js");
const cssPath = path.join("src", "App.css");

if (!fs.existsSync(appPath)) throw new Error("src/App.js not found");
if (!fs.existsSync(cssPath)) throw new Error("src/App.css not found");

let app = fs.readFileSync(appPath, "utf8");
let css = fs.readFileSync(cssPath, "utf8");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.copyFileSync(appPath, appPath + ".bak-restore-name-only-" + stamp);
fs.copyFileSync(cssPath, cssPath + ".bak-restore-name-only-" + stamp);

/* Remove ONLY exported HTML colorful name override. Keep footer untouched. */
app = app.replace(
/\s*\/\* Final MuseForge export polish: colorful name \+ premium footer \*\/\s*\.hero h1 \{[\s\S]*?\n\s*\}\s*(?=\n\s*\.footer \{)/,
"\n    /* Final MuseForge export polish: premium footer */\n"
);

/* Remove ONLY public/shareable portfolio name gradient override. Keep footer untouched. */
css = css.replace(
/\/\* ===== FINAL PUBLIC PORTFOLIO NAME \+ FOOTER POLISH ===== \*\/\s*\.public-portfolio-page \.public-portfolio-hero h1,[\s\S]*?\n\}\s*(?=\n\.public-portfolio-page \.public-portfolio-footer,)/,
"/* ===== FINAL PUBLIC PORTFOLIO FOOTER POLISH ===== */\n"
);

css = css.replace(
/\/\* ===== END FINAL PUBLIC PORTFOLIO NAME \+ FOOTER POLISH ===== \*\//g,
"/* ===== END FINAL PUBLIC PORTFOLIO FOOTER POLISH ===== */"
);

fs.writeFileSync(appPath, app, "utf8");
fs.writeFileSync(cssPath, css, "utf8");

console.log("✅ Portfolio name/header restored to previous styling.");
console.log("✅ Footer was not changed.");
console.log("✅ Only name gradient override removed.");
