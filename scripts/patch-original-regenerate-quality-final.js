const fs = require("fs");
const path = require("path");

const serverPath = path.join("backend", "server.js");

if (!fs.existsSync(serverPath)) {
  throw new Error("backend/server.js not found");
}

let server = fs.readFileSync(serverPath, "utf8");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

function mustReplace(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    throw new Error("Patch target not found: " + label);
  }
  return source.replace(pattern, replacement);
}

function replaceFunctionBlock(source, functionName, nextFunctionName, replacement) {
  const start = source.indexOf("function " + functionName);
  if (start < 0) throw new Error(functionName + " not found");

  const end = source.indexOf("\n" + nextFunctionName, start);
  if (end < 0) throw new Error("End marker not found after " + functionName);

  return source.slice(0, start) + replacement + "\n" + source.slice(end);
}

if (!server.includes("function buildLocalStrongProjectRegeneration")) {
  throw new Error("buildLocalStrongProjectRegeneration not found. Run previous regenerate patch first.");
}
if (!server.includes("function regenerationIsStrongEnough")) {
  throw new Error("regenerationIsStrongEnough not found. Run previous regenerate patch first.");
}
if (!server.includes("async function translateOrLocalRegeneration")) {
  throw new Error("translateOrLocalRegeneration not found. Run previous regenerate patch first.");
}

const strongProjectFunction = [
"function cleanFactLockItemTitleForFirstPerson(title = '') {",
"  const raw = cleanText(title || '');",
"  if (!raw) return 'this portfolio entry';",
"",
"  const parts = raw.split(/\\s+[—–-]\\s+/).map(part => cleanText(part)).filter(Boolean);",
"  if (parts.length > 1 && parts[0].length <= 35) {",
"    return parts.slice(1).join(' — ') || raw;",
"  }",
"",
"  return raw",
"    .replace(/^(achievements?|certifications?|projects?|experience|portfolio)\\s*[:\\-—–]\\s*/i, '')",
"    .trim() || raw;",
"}",
"",
"function buildLocalStrongProjectRegeneration(options = {}) {",
"  const cleanTitle = cleanText(options.title || '') || 'This portfolio entry';",
"  const displayTitle = cleanFactLockItemTitleForFirstPerson(cleanTitle);",
"  const original = cleanText(options.originalDesc || '');",
"  const field = cleanText(options.medium || '') || cleanText(options.creatorType || '') || 'creative work';",
"  const lower = (cleanTitle + ' ' + displayTitle + ' ' + original + ' ' + field).toLowerCase();",
"",
"  if (/competition|compitition|award|certificate|certification|jeet|won|winner|achievement|school|university/.test(lower)) {",
"    return 'I added this achievement' + (displayTitle ? ' for ' + displayTitle : '') + ' to show a real milestone from my own experience. Based on my original note, I want this entry to explain what I did in a clearer and more professional way while keeping the focus on the facts I provided. I use this section to show my effort, confidence, and growth without adding unsupported awards, dates, numbers, or extra claims.';",
"  }",
"",
"  if (/song|songs|track|tracks|demo|music|perform|performance|release|released|social media/.test(lower)) {",
"    return 'I included ' + displayTitle + ' because it represents part of my real music journey and the work I have shared. Based on my original note, I want this entry to show what I created, released, or performed in a clearer and more polished way. I use this description to make my contribution feel stronger while still keeping every detail grounded in the information I provided.';",
"  }",
"",
"  if (/flower|flowers|blue|bells|painting|drawing|draw|garden|art|visual/.test(lower)) {",
"    return 'I created ' + displayTitle + ' as a visual piece shaped by my interest in observation, color, and personal expression. Based on my original note, this work is connected to a subject I genuinely liked and chose to draw or paint with care. I want this project description to show the real idea, subject, and personal connection behind the piece while giving it a stronger portfolio voice.';",
"  }",
"",
"  return 'I created ' + displayTitle + ' to present one part of my work in a clearer and more polished portfolio voice. Based on my original note, I want this entry to keep the real idea intact while making my purpose, effort, and creative direction easier for viewers to understand. I use this description to strengthen the presentation without adding unsupported achievements, tools, dates, metrics, or extra claims.';",
"}"
].join("\n");

server = replaceFunctionBlock(
  server,
  "buildLocalStrongProjectRegeneration",
  "async function translateOrLocalRegeneration",
  strongProjectFunction
);

/* Original project enhancement: reject weak AI output and use strong first-person fallback */
const projectBlockPattern = /const match = returned\.find\(item => String\(item\.id\) === project\.id\);[\s\S]*?return buildFactLockReview\(project, desc\);/;

const projectBlockReplacement = [
"const match = returned.find(item => String(item.id) === project.id);",
"          const candidate = project.desc ? stripRegenerateNoiseServer(cleanText(match && match.desc ? match.desc : '')) : '';",
"          const original = cleanText(project.desc);",
"          let desc = '';",
"          if (original) {",
"            const strongFallback = await translateOrLocalRegeneration(",
"              buildLocalStrongProjectRegeneration({ title: project.title, originalDesc: original, medium, creatorType }),",
"              safeTargetLanguage",
"            );",
"",
"            if (candidate && !sameCleanText(candidate, original) && regenerationIsStrongEnough(candidate, { isProject: true, targetLanguage: safeTargetLanguage })) {",
"              desc = candidate;",
"            } else {",
"              desc = strongFallback;",
"            }",
"",
"            if (!regenerationIsStrongEnough(desc, { isProject: true, targetLanguage: safeTargetLanguage })) {",
"              desc = strongFallback;",
"            }",
"          }",
"          return buildFactLockReview(project, desc);"
].join("\n");

server = mustReplace(server, projectBlockPattern, projectBlockReplacement, "original project enhancement quality gate");

/* Original project fallback: use strong first-person fallback */
server = mustReplace(
  server,
  /project\.desc \? await translateTextStrict\(polishDescriptionLocally\(project\.desc, project\.title\), safeTargetLanguage\) : ''/g,
  "project.desc ? await translateOrLocalRegeneration(buildLocalStrongProjectRegeneration({ title: project.title, originalDesc: project.desc, medium, creatorType }), safeTargetLanguage) : ''",
  "original project fallback"
);

/* Original custom section enhancement: reject weak AI output and use strong first-person fallback */
const customBlockPattern = /const match = returned\.find\(entry => String\(entry\.reviewId\) === reviewId\);[\s\S]*?const review = buildFactLockReview\(\{ id: reviewId, title: item\.heading \|\| section\.name, desc: original \}, desc\);/;

const customBlockReplacement = [
"const match = returned.find(entry => String(entry.reviewId) === reviewId);",
"            const original = cleanText(item.desc);",
"            const itemTitle = cleanText(item.heading || section.name);",
"            const candidate = original ? stripRegenerateNoiseServer(cleanText(match && match.desc ? match.desc : '')) : '';",
"            let desc = '';",
"            if (original) {",
"              const strongFallback = await translateOrLocalRegeneration(",
"                buildLocalStrongProjectRegeneration({ title: itemTitle, originalDesc: original, medium, creatorType }),",
"                safeTargetLanguage",
"              );",
"",
"              if (candidate && !sameCleanText(candidate, original) && regenerationIsStrongEnough(candidate, { isProject: true, targetLanguage: safeTargetLanguage })) {",
"                desc = candidate;",
"              } else {",
"                desc = strongFallback;",
"              }",
"",
"              if (!regenerationIsStrongEnough(desc, { isProject: true, targetLanguage: safeTargetLanguage })) {",
"                desc = strongFallback;",
"              }",
"            }",
"            const review = buildFactLockReview({ id: reviewId, title: item.heading || section.name, desc: original }, desc);"
].join("\n");

server = mustReplace(server, customBlockPattern, customBlockReplacement, "original custom section enhancement quality gate");

/* Original custom section fallback: use strong first-person fallback */
server = mustReplace(
  server,
  /const desc = original \? await translateTextStrict\(polishDescriptionLocally\(original, item\.heading \|\| section\.name\), safeTargetLanguage\) : '';/g,
  "const desc = original ? await translateOrLocalRegeneration(buildLocalStrongProjectRegeneration({ title: item.heading || section.name, originalDesc: original, medium, creatorType }), safeTargetLanguage) : '';",
  "original custom section fallback"
);

/* Make AI prompts first-person from the first generation too */
server = server.replace(
  "Return exactly this shape: {\"projects\":[{\"id\":\"original id\",\"desc\":\"one polished sentence\"}]}.",
  "Return exactly this shape: {\"projects\":[{\"id\":\"original id\",\"desc\":\"2-3 polished first-person portfolio sentences\"}]}."
);

server = server.replace(
  "Return exactly this shape: {\"items\":[{\"reviewId\":\"original reviewId\",\"desc\":\"one polished sentence\"}]}.",
  "Return exactly this shape: {\"items\":[{\"reviewId\":\"original reviewId\",\"desc\":\"2-3 polished first-person portfolio sentences\"}]}."
);

server = server.replace(
  "Rewrite project descriptions in a clearer, more polished tone while preserving every original fact.",
  "Rewrite project descriptions in a clearer, stronger, first-person portfolio voice while preserving every original fact."
);

server = server.replace(
  "Rewrite custom portfolio-section item descriptions in a clearer, more polished tone while preserving every original fact.",
  "Rewrite custom portfolio-section item descriptions in a clearer, stronger, first-person portfolio voice while preserving every original fact."
);

server = server.replace(
  "Do not repeat only the item heading as the description.",
  "Do not repeat only the item heading as the description. Do not start with the full section label such as Achievements — Demo Tracks. Write naturally in first person."
);

fs.copyFileSync(serverPath, serverPath + ".bak-original-regenerate-quality-final-" + stamp);
fs.writeFileSync(serverPath, server, "utf8");

console.log("✅ Original + regenerate quality patch applied.");
console.log("✅ Initial generation now uses strong first-person fallback.");
console.log("✅ Regenerate title cleanup fixed: no ugly 'Achievements — Demo Tracks' opening.");
console.log("✅ Weak AI output is rejected before it reaches FactLock.");
