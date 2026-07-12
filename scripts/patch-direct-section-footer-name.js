const fs = require("fs");
const path = require("path");

const serverPath = path.join("backend", "server.js");
const appPath = path.join("src", "App.js");
const cssPath = path.join("src", "App.css");

if (!fs.existsSync(serverPath)) throw new Error("backend/server.js not found");
if (!fs.existsSync(appPath)) throw new Error("src/App.js not found");
if (!fs.existsSync(cssPath)) throw new Error("src/App.css not found");

let server = fs.readFileSync(serverPath, "utf8");
let app = fs.readFileSync(appPath, "utf8");
let css = fs.readFileSync(cssPath, "utf8");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");

fs.copyFileSync(serverPath, serverPath + ".bak-direct-section-footer-name-" + stamp);
fs.copyFileSync(appPath, appPath + ".bak-direct-section-footer-name-" + stamp);
fs.copyFileSync(cssPath, cssPath + ".bak-direct-section-footer-name-" + stamp);

function replaceFunction(source, functionName, endMarker, replacement) {
  const start = source.indexOf("function " + functionName);
  if (start < 0) throw new Error(functionName + " not found");

  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error("End marker not found after " + functionName);

  return source.slice(0, start) + replacement + "\n\n" + source.slice(end);
}

/* =========================================================
   1) Backend: direct natural first-person section descriptions
   ========================================================= */

if (!server.includes("function buildLocalStrongProjectRegeneration")) {
  throw new Error("buildLocalStrongProjectRegeneration not found. Stop and send screenshot.");
}

const directProjectFunction = [
"function buildLocalStrongProjectRegeneration(options = {}) {",
"  const rawTitle = cleanText(options.title || '') || 'this portfolio entry';",
"  const original = cleanText(options.originalDesc || '');",
"  const field = cleanText(options.medium || '') || cleanText(options.creatorType || '') || 'creative work';",
"  let displayTitle = rawTitle;",
"",
"  displayTitle = displayTitle",
"    .replace(/^.*?\\s+[—–-]\\s+/, '')",
"    .replace(/^(achievements?|certifications?|projects?|experience|portfolio)\\s*[:\\-—–]\\s*/i, '')",
"    .trim() || rawTitle;",
"",
"  const lower = (rawTitle + ' ' + displayTitle + ' ' + original + ' ' + field).toLowerCase();",
"",
"  if (/demo|track|tracks|release|released|social media/.test(lower)) {",
"    return 'I released my demo tracks on social media to share my music with a wider audience and start building a real presence around my work. Through this, I practiced presenting my sound publicly, learning how my music could connect with listeners, and taking my first steps toward a stronger creative identity. I want this entry to show my effort, confidence, and consistency without adding unsupported numbers, platforms, or fake recognition.';",
"  }",
"",
"  if (/original\\s+songs?|15\\+|songwriting|lyrics|likhe|wrote/.test(lower)) {",
"    return 'I have written more than 15 original songs, which has helped me express my ideas, emotions, and creative voice through music. This work shows my consistency as a songwriter and my interest in developing meaningful lyrics and original compositions. I want this section to present my songwriting journey clearly while staying faithful to the facts I provided.';",
"  }",
"",
"  if (/university\\s+music\\s+night|music\\s+night|perform|performance/.test(lower)) {",
"    return 'I performed at university music night, which gave me a real opportunity to share my music in front of an audience. That experience helped me build confidence, understand stage presence, and connect more directly with people through performance. I want this entry to show my growth as a performer without adding unsupported awards, dates, or extra claims.';",
"  }",
"",
"  if (/competition|compitition|award|certificate|certification|jeet|won|winner|achievement|school|university/.test(lower)) {",
"    return 'I took part in this achievement as a real milestone from my own experience. It reflects effort, participation, and growth, and I want to present it in a clear, professional way without exaggerating the facts. This section helps my portfolio show confidence and progress while staying grounded in the information I provided.';",
"  }",
"",
"  if (/flower|flowers|blue|bells|painting|drawing|draw|garden|art|visual/.test(lower)) {",
"    return 'I created ' + displayTitle + ' as a visual piece shaped by my interest in observation, color, and personal expression. The work is connected to a subject I genuinely liked and chose to draw or paint with care. I want this description to show the real idea, subject, and personal connection behind the piece while giving it a stronger portfolio voice.';",
"  }",
"",
"  return 'I created ' + displayTitle + ' to present one part of my work in a clearer and more polished portfolio voice. I want this entry to keep the real idea intact while making my purpose, effort, and creative direction easier for viewers to understand. This description strengthens the presentation without adding unsupported achievements, tools, dates, metrics, or extra claims.';",
"}"
].join("\n");

server = replaceFunction(
  server,
  "buildLocalStrongProjectRegeneration",
  "\nasync function translateOrLocalRegeneration",
  directProjectFunction
);

/* Reject ugly AI openings so fallback is used */
server = server.replace(
  /function regenerationLooksPromptEcho\(value = ''\) \{[\s\S]*?\n\}/,
  [
    "function regenerationLooksPromptEcho(value = '') {",
    "  const text = String(value || '').trim();",
    "  return /item\\s*title\\s*:|original\\s+user\\s+text\\s*:|regenerate\\s+this\\s+item|output\\s+only\\s+valid\\s+json|creator\\s+type\\s*:|medium\\/field\\s*:|^\\s*I\\s+(included|added)\\b|^\\s*This\\s+(entry|project)\\b|^\\s*The\\s+creator\\b/i.test(text);",
    "}"
  ].join("\n")
);

/* Strengthen prompts so AI also avoids ugly starts */
server = server.replace(
  /Do not write in third person\. Do not say the creator, this entry, or this project presents\./g,
  "Do not write in third person. Do not say the creator, this entry, or this project presents. Do not start with I included or I added this achievement. Start directly with the real action, such as I released, I performed, I wrote, I created, or I took part."
);

server = server.replace(
  /Use I, my, or me clearly\./g,
  "Use I, my, or me clearly. Start naturally and directly; never start with I included or I added this achievement."
);

/* =========================================================
   2) Export HTML: colorful name + screenshot-like footer
   ========================================================= */

const exportStyleOverride = [
"",
"    /* Final MuseForge export polish: colorful name + premium footer */",
"    .hero h1 {",
"      display: inline-block;",
"      margin-bottom: 10px;",
"      background: linear-gradient(90deg, #8b5cf6 0%, #ec4899 58%, #f472b6 100%);",
"      -webkit-background-clip: text;",
"      background-clip: text;",
"      color: transparent !important;",
"      -webkit-text-fill-color: transparent;",
"      text-shadow: none;",
"    }",
"    .footer {",
"      margin: 64px 0 0;",
"      min-height: 178px;",
"      padding: 42px 16px 48px;",
"      display: flex;",
"      flex-direction: column;",
"      align-items: center;",
"      justify-content: center;",
"      gap: 16px;",
"      text-align: center;",
"      border-top: 1px solid rgba(255, 255, 255, 0.16);",
"      background: #0b0714;",
"      font-family: 'Times New Roman', Times, serif;",
"    }",
"    .footer p {",
"      margin: 0;",
"      padding: 0;",
"      border: 0;",
"      background: transparent;",
"      color: rgba(255, 255, 255, 0.78);",
"      box-shadow: none;",
"      font-family: 'Times New Roman', Times, serif;",
"      font-size: 1.08rem;",
"      font-weight: 500;",
"      line-height: 1.3;",
"    }",
"    .footer span {",
"      display: inline-flex;",
"      align-items: center;",
"      justify-content: center;",
"      padding: 13px 30px;",
"      border-radius: 999px;",
"      background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%);",
"      color: #ffffff;",
"      font-family: 'Times New Roman', Times, serif;",
"      font-size: 1.05rem;",
"      line-height: 1;",
"      font-weight: 800;",
"      box-shadow: 0 16px 35px rgba(236, 72, 153, 0.24);",
"    }",
""
].join("\n");

if (!app.includes("Final MuseForge export polish: colorful name + premium footer")) {
  app = app.replace("    .badge {", exportStyleOverride + "\n    .badge {");
}

app = app.replace(
  /<div class="footer">\s*<p>[\s\S]*?<\/p>\s*(?:<span>[\s\S]*?<\/span>\s*)?<\/div>/,
  '<div class="footer">\\n    <p>Created with MuseForge — Built with IBM Bob</p>\\n    <span>Powered by IBM Bob × Groq AI</span>\\n  </div>'
);

/* =========================================================
   3) Public portfolio CSS: colorful name + same footer style
   ========================================================= */

const publicCssOverride = [
"",
"/* ===== FINAL PUBLIC PORTFOLIO NAME + FOOTER POLISH ===== */",
".public-portfolio-page .public-portfolio-hero h1,",
".public-portfolio-page .public-portfolio-name,",
".public-portfolio-page .public-portfolio-title,",
".public-portfolio-page.portfolio-preview-shell h1.public-portfolio-name {",
"  display: inline-block !important;",
"  background: linear-gradient(90deg, #8b5cf6 0%, #ec4899 58%, #f472b6 100%) !important;",
"  -webkit-background-clip: text !important;",
"  background-clip: text !important;",
"  color: transparent !important;",
"  -webkit-text-fill-color: transparent !important;",
"  text-shadow: none !important;",
"}",
"",
".public-portfolio-page .public-portfolio-footer,",
".public-portfolio-page footer,",
".portfolio-preview-shell .public-portfolio-footer {",
"  margin: 64px 0 0 !important;",
"  min-height: 178px !important;",
"  padding: 42px 16px 48px !important;",
"  display: flex !important;",
"  flex-direction: column !important;",
"  align-items: center !important;",
"  justify-content: center !important;",
"  gap: 16px !important;",
"  text-align: center !important;",
"  border-top: 1px solid rgba(255, 255, 255, 0.16) !important;",
"  background: #0b0714 !important;",
"  font-family: 'Times New Roman', Times, serif !important;",
"}",
"",
".public-portfolio-page .public-portfolio-footer p,",
".public-portfolio-page footer p,",
".portfolio-preview-shell .public-portfolio-footer p {",
"  margin: 0 !important;",
"  padding: 0 !important;",
"  border: 0 !important;",
"  background: transparent !important;",
"  color: rgba(255, 255, 255, 0.78) !important;",
"  box-shadow: none !important;",
"  font-family: 'Times New Roman', Times, serif !important;",
"  font-size: 1.08rem !important;",
"  font-weight: 500 !important;",
"  line-height: 1.3 !important;",
"}",
"",
".public-portfolio-page .public-portfolio-footer span,",
".public-portfolio-page footer span,",
".portfolio-preview-shell .public-portfolio-footer span {",
"  display: inline-flex !important;",
"  align-items: center !important;",
"  justify-content: center !important;",
"  padding: 13px 30px !important;",
"  border-radius: 999px !important;",
"  background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%) !important;",
"  color: #ffffff !important;",
"  font-family: 'Times New Roman', Times, serif !important;",
"  font-size: 1.05rem !important;",
"  line-height: 1 !important;",
"  font-weight: 800 !important;",
"  box-shadow: 0 16px 35px rgba(236, 72, 153, 0.24) !important;",
"}",
"/* ===== END FINAL PUBLIC PORTFOLIO NAME + FOOTER POLISH ===== */",
""
].join("\n");

if (!css.includes("FINAL PUBLIC PORTFOLIO NAME + FOOTER POLISH")) {
  css += "\n" + publicCssOverride;
}

fs.writeFileSync(serverPath, server, "utf8");
fs.writeFileSync(appPath, app, "utf8");
fs.writeFileSync(cssPath, css, "utf8");

console.log("✅ Direct section opening patch applied.");
console.log("✅ Regenerate now avoids ugly starts like I included Achievements — Demo Tracks.");
console.log("✅ Export/public footer styled like requested.");
console.log("✅ Portfolio name gradient added.");
console.log("Backups created with stamp: " + stamp);
