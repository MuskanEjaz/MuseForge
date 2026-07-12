const fs = require("fs");
const path = require("path");

const appPath = path.join("src", "App.js");
const cssPath = path.join("src", "App.css");

if (!fs.existsSync(appPath)) throw new Error("src/App.js not found");
if (!fs.existsSync(cssPath)) throw new Error("src/App.css not found");

let app = fs.readFileSync(appPath, "utf8");
let css = fs.readFileSync(cssPath, "utf8");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.copyFileSync(appPath, appPath + ".bak-footer-compact-" + stamp);
fs.copyFileSync(cssPath, cssPath + ".bak-footer-compact-" + stamp);

function compactFooter(source) {
  return source
    .replace(/margin:\s*64px 0 0\s*!important;/g, "margin: 36px 0 0 !important;")
    .replace(/margin:\s*64px 0 0;/g, "margin: 36px 0 0;")
    .replace(/min-height:\s*178px\s*!important;/g, "min-height: 112px !important;")
    .replace(/min-height:\s*178px;/g, "min-height: 112px;")
    .replace(/padding:\s*42px 16px 48px\s*!important;/g, "padding: 24px 14px 28px !important;")
    .replace(/padding:\s*42px 16px 48px;/g, "padding: 24px 14px 28px;")
    .replace(/gap:\s*16px\s*!important;/g, "gap: 10px !important;")
    .replace(/gap:\s*16px;/g, "gap: 10px;")
    .replace(/padding:\s*13px 30px\s*!important;/g, "padding: 10px 24px !important;")
    .replace(/padding:\s*13px 30px;/g, "padding: 10px 24px;")
    .replace(/font-size:\s*1\.08rem\s*!important;/g, "font-size: 0.96rem !important;")
    .replace(/font-size:\s*1\.08rem;/g, "font-size: 0.96rem;")
    .replace(/font-size:\s*1\.05rem\s*!important;/g, "font-size: 0.96rem !important;")
    .replace(/font-size:\s*1\.05rem;/g, "font-size: 0.96rem;");
}

app = compactFooter(app);
css = compactFooter(css);

fs.writeFileSync(appPath, app, "utf8");
fs.writeFileSync(cssPath, css, "utf8");

console.log("✅ Footer height reduced.");
console.log("✅ Footer pill made slightly smaller.");
console.log("✅ Only src/App.js and src/App.css touched.");
