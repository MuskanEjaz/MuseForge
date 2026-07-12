const fs = require("fs");
const path = require("path");

const serverPath = path.join("backend", "server.js");

if (!fs.existsSync(serverPath)) {
  throw new Error("backend/server.js not found");
}

let server = fs.readFileSync(serverPath, "utf8");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

function replaceBetween(source, startPattern, endPattern, replacement, label) {
  const start = source.search(startPattern);
  if (start < 0) throw new Error("Patch start not found: " + label);

  const rest = source.slice(start);
  const end = rest.search(endPattern);
  if (end < 0) throw new Error("Patch end not found: " + label);

  return source.slice(0, start) + replacement + "\n\n" + source.slice(start + end);
}

function replaceOptional(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    console.warn("Optional target skipped: " + label);
    return source;
  }
  return source.replace(pattern, replacement);
}

if (!server.includes("function buildLocalDistinctBio")) {
  throw new Error("buildLocalDistinctBio not found");
}
if (!server.includes("function buildLocalDistinctStatementStrong")) {
  throw new Error("buildLocalDistinctStatementStrong not found");
}
if (!server.includes("function buildLocalStrongProjectRegeneration")) {
  throw new Error("buildLocalStrongProjectRegeneration not found. Run strict regenerate patch first.");
}
if (!server.includes("function regenerationIsStrongEnough")) {
  throw new Error("regenerationIsStrongEnough not found. Run strict regenerate patch first.");
}

const firstPersonBio = [
"function buildLocalDistinctBio({ name = '', medium = '', description = '', creatorType = '' } = {}) {",
"  const displayName = cleanText(name);",
"  const field = cleanText(medium) || (/student|job|career|cv|developer|software|engineer|intern|professional/i.test(creatorType) ? 'my professional field' : 'my creative field');",
"  const original = cleanText(description);",
"  const nameIntro = displayName ? displayName + ', ' : '';",
"",
"  if (/student|job|career|cv|developer|software|engineer|intern|professional/i.test(creatorType)) {",
"    return 'I am ' + nameIntro + 'a developing professional focused on ' + field + ', practical learning, and building credible portfolio work. I use this portfolio to present my real skills, project experience, and growth direction in a clear and organized way. ' + (original ? 'My current work and interests are connected to this information: ' + original + '. ' : 'I keep the focus on the real information I have provided without adding unsupported claims. ') + 'I want viewers to understand how I think, what I can contribute, and how seriously I approach new opportunities. My goal is to present myself honestly while making my work feel polished, focused, and opportunity-ready.';",
"  }",
"",
"  return 'I am ' + nameIntro + 'an emerging creator working in ' + field + ', and I use my portfolio to present the ideas, subjects, and creative choices that shape my current direction. My work is built around the details I have shared, especially the themes and visual interests that matter to me. ' + (original ? 'My creative practice is connected to this core idea: ' + original + '. ' : 'I want my work to feel honest, expressive, and carefully presented. ') + 'I am still developing my voice, but I approach each piece with care, curiosity, and intention. My goal is to share my work in a way that feels personal, credible, and true to my actual creative journey.';",
"}"
].join("\n");

const firstPersonStatement = [
"function buildLocalDistinctStatementStrong({ medium = '', description = '', creatorType = '' } = {}) {",
"  const field = cleanText(medium) || (/student|job|career|cv|developer|software|engineer|intern|professional/i.test(creatorType) ? 'my professional field' : 'my creative field');",
"  const original = cleanText(description);",
"",
"  if (/student|job|career|cv|developer|software|engineer|intern|professional/i.test(creatorType)) {",
"    return 'My direction is shaped by practical learning, honest growth, and a clear commitment to improving in ' + field + '. I want my portfolio to show how I think, what I can contribute, and how seriously I approach each opportunity.\\n\\nI value clarity, consistency, and real progress over empty claims. ' + (original ? 'The details I shared guide this portfolio: ' + original + '. ' : 'Every section is based on the real information I provided. ') + 'My goal is to present my abilities truthfully, confidently, and in a way that helps others understand my potential.';",
"  }",
"",
"  return 'My creative direction is shaped by curiosity, observation, and a personal connection to ' + field + '. I want my work to communicate feeling, care, and intention while staying true to the details I have actually shared.\\n\\nI see each piece as a chance to develop my visual voice and understand my creative process more deeply. ' + (original ? 'The idea behind my work begins here: ' + original + '. ' : 'I want my portfolio to feel honest, expressive, and grounded in my real creative interests. ') + 'My goal is to keep improving with confidence while presenting my work in a clear and meaningful way.';",
"}"
].join("\n");

const firstPersonQuality = [
"function regenerationUsesFirstPerson(value = '', targetLanguage = 'English') {",
"  const text = String(value || '').trim();",
"  const lower = text.toLowerCase();",
"  const family = languageFamily(targetLanguage || 'English');",
"",
"  const patterns = {",
"    english: /\\b(i|my|me|mine|myself)\\b/i,",
"    spanish: /\\b(yo|mi|mis|me|mío|mía|conmigo)\\b/i,",
"    french: /\\b(je|j’|j'|mon|ma|mes|moi|me)\\b/i,",
"    german: /\\b(ich|mein|meine|meinen|mir|mich)\\b/i,",
"    italian: /\\b(io|mio|mia|miei|mie|mi|me)\\b/i,",
"    portuguese: /\\b(eu|meu|minha|meus|minhas|me|mim)\\b/i,",
"    dutch: /\\b(ik|mijn|me|mij)\\b/i,",
"    turkish: /\\b(ben|benim|bana|beni)\\b/i,",
"    russian: /\\b(я|мой|моя|мои|меня|мне)\\b/i,",
"    indonesian: /\\b(saya|aku|karya saya|milik saya)\\b/i,",
"    vietnamese: /\\b(tôi|của tôi|mình|của mình)\\b/i",
"  };",
"",
"  if (patterns[family]) return patterns[family].test(lower);",
"  if (family === 'arabic') return /أنا|عملي|أعمالي|لي|أرسم|أصنع|أقدّم|أعبر/.test(text);",
"  if (family === 'chinese') return /我|我的|本人/.test(text);",
"  if (family === 'japanese') return /私|僕|自分|わたし/.test(text);",
"  if (family === 'korean') return /나|저|내|제|제가|나는|저는/.test(text);",
"",
"  return true;",
"}",
"",
"function regenerationIsStrongEnough(value = '', options = {}) {",
"  const clean = cleanText(value);",
"  if (!clean) return false;",
"  if (regenerationLooksPromptEcho(clean)) return false;",
"  if (hasUnexpectedScriptForLanguage(clean, options.targetLanguage || 'English')) return false;",
"  if (!regenerationUsesFirstPerson(clean, options.targetLanguage || 'English')) return false;",
"",
"  const family = languageFamily(options.targetLanguage || 'English');",
"  const wordCount = regenerationWordCount(clean);",
"  const sentenceCount = regenerationSentenceCount(clean);",
"  const charCount = clean.length;",
"  const compactScript = ['chinese', 'japanese', 'korean', 'arabic'].includes(family);",
"",
"  if (options.isBio) {",
"    return compactScript ? charCount >= 180 : wordCount >= 55 && sentenceCount >= 4;",
"  }",
"",
"  if (options.isStatement) {",
"    return compactScript ? charCount >= 150 : wordCount >= 45 && sentenceCount >= 3;",
"  }",
"",
"  if (options.isProject) {",
"    return compactScript ? charCount >= 90 : wordCount >= 28 && sentenceCount >= 2;",
"  }",
"",
"  return compactScript ? charCount >= 80 : wordCount >= 18;",
"}"
].join("\n");

const firstPersonProject = [
"function buildLocalStrongProjectRegeneration(options = {}) {",
"  const cleanTitle = cleanText(options.title || '') || 'This portfolio entry';",
"  const original = cleanText(options.originalDesc || '');",
"  const field = cleanText(options.medium || '') || cleanText(options.creatorType || '') || 'creative work';",
"  const lower = (cleanTitle + ' ' + original + ' ' + field).toLowerCase();",
"",
"  if (/competition|compitition|award|certificate|certification|jeet|won|winner|achievement|school/.test(lower)) {",
"    return 'I included ' + cleanTitle + ' because it represents a real achievement from my own experience. Based on my original note, I want this entry to show the competition or recognition in a clearer and more professional way while keeping the focus on the facts I provided. I use this section to show my effort, confidence, and growth without adding unsupported awards, dates, or extra claims.';",
"  }",
"",
"  if (/flower|flowers|blue|bells|painting|drawing|draw|garden|art|visual/.test(lower)) {",
"    return 'I created ' + cleanTitle + ' as a visual piece shaped by my interest in observation, color, and personal expression. Based on my original note, this work is connected to a subject I genuinely liked and chose to draw or paint with care. I want this project description to show the real idea, subject, and personal connection behind the piece while giving it a stronger portfolio voice.';",
"  }",
"",
"  return 'I created ' + cleanTitle + ' to present one part of my work in a clearer and more polished portfolio voice. Based on my original note, I want this entry to keep the real idea intact while making my purpose, effort, and creative direction easier for viewers to understand. I use this description to strengthen the presentation without adding unsupported achievements, tools, dates, metrics, or extra claims.';",
"}"
].join("\n");

server = replaceBetween(
  server,
  /function buildLocalDistinctBio\(\{ name = '', medium = '', description = '', creatorType = '' \} = \{\}\) \{/,
  /\nfunction buildLocalDistinctStatementStrong/,
  firstPersonBio,
  "buildLocalDistinctBio"
);

server = replaceBetween(
  server,
  /\nfunction buildLocalDistinctStatementStrong\(\{ medium = '', description = '', creatorType = '' \} = \{\}\) \{/,
  /\nasync function ensureDistinctBioDraft|\nfunction replaceGeneratedPortfolioSection/,
  "\n" + firstPersonStatement,
  "buildLocalDistinctStatementStrong"
);

server = replaceBetween(
  server,
  /function regenerationIsStrongEnough\(value = '', options = \{\}\) \{/,
  /\nfunction buildLocalStrongProjectRegeneration/,
  firstPersonQuality,
  "regenerationIsStrongEnough"
);

server = replaceBetween(
  server,
  /\nfunction buildLocalStrongProjectRegeneration\(options = \{\}\) \{/,
  /\nasync function translateOrLocalRegeneration/,
  "\n" + firstPersonProject,
  "buildLocalStrongProjectRegeneration"
);

server = server.replace(
  "'Do not use first-person unless the original clearly uses it.',",
  "'Always write in first person using I, my, or me.',"
);

server = server.replace(
  "'Write exactly 2 short first-person paragraphs, around 80-120 words total.',",
  "'Write exactly 2 short first-person paragraphs, around 80-120 words total. Every paragraph must clearly use I, my, or me.',"
);

server = server.replace(
  "'Write 2-3 polished portfolio sentences, around 45-75 words total.',",
  "'Write 2-3 polished first-person portfolio sentences, around 45-75 words total. Use I, my, or me clearly.'"
);

server = server.replace(
  "'Do not output labels like Item title or Text.',",
  "'Do not output labels like Item title or Text. Do not write in third person. Do not say the creator, this entry, or this project presents.'"
);

fs.copyFileSync(serverPath, serverPath + ".bak-first-person-regenerate-" + stamp);
fs.writeFileSync(serverPath, server, "utf8");

console.log("✅ First-person regenerate patch applied.");
console.log("✅ Bio, Statement, Projects, Achievements now regenerate in first person.");
console.log("✅ Third-person regenerate output will be rejected by quality gate.");
console.log("✅ Strong first-person fallback added.");
