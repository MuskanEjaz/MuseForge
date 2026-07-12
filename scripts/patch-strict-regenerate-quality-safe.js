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

if (!server.includes("function buildLocalDistinctBio")) {
  throw new Error("buildLocalDistinctBio helper not found. Stop and send screenshot.");
}

if (!server.includes("function buildLocalDistinctStatementStrong")) {
  throw new Error("buildLocalDistinctStatementStrong helper not found. Stop and send screenshot.");
}

const helperBlock = [
"function stripRegenerateNoiseServer(value = '') {",
"  let text = stripPortfolioMarkdownHeadingServer(value || '');",
"  text = text",
"    .replace(/^item\\s*title\\s*:\\s*[\\s\\S]{0,180}?\\b(?:text|description|original\\s+user\\s+text)\\s*:\\s*/i, '')",
"    .replace(/^(enhanced|description|text|answer|output)\\s*:\\s*/i, '')",
"    .replace(/^['\\\"]|['\\\"]$/g, '')",
"    .trim();",
"  text = text",
"    .replace(/^\\{\\s*\\\"enhanced\\\"\\s*:\\s*\\\"/i, '')",
"    .replace(/\\\"\\s*\\}\\s*$/i, '')",
"    .replace(/\\bRegenerate this item only\\.?$/i, '')",
"    .trim();",
"  return cleanText(text);",
"}",
"",
"function regenerationWordCount(value = '') {",
"  return String(value || '').trim().split(/\\s+/).filter(Boolean).length;",
"}",
"",
"function regenerationSentenceCount(value = '') {",
"  return (String(value || '').match(/[.!?۔؟]+/g) || []).length;",
"}",
"",
"function regenerationLooksPromptEcho(value = '') {",
"  return /item\\s*title\\s*:|original\\s+user\\s+text\\s*:|regenerate\\s+this\\s+item|output\\s+only\\s+valid\\s+json|creator\\s+type\\s*:|medium\\/field\\s*:/i.test(String(value || ''));",
"}",
"",
"function regenerationIsStrongEnough(value = '', options = {}) {",
"  const clean = cleanText(value);",
"  if (!clean) return false;",
"  if (regenerationLooksPromptEcho(clean)) return false;",
"  if (hasUnexpectedScriptForLanguage(clean, options.targetLanguage || 'English')) return false;",
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
"    return compactScript ? charCount >= 90 : wordCount >= 24 && sentenceCount >= 2;",
"  }",
"",
"  return compactScript ? charCount >= 80 : wordCount >= 18;",
"}",
"",
"function buildLocalStrongProjectRegeneration(options = {}) {",
"  const cleanTitle = cleanText(options.title || '') || 'This portfolio entry';",
"  const original = cleanText(options.originalDesc || '');",
"  const field = cleanText(options.medium || '') || cleanText(options.creatorType || '') || 'creative work';",
"  const lower = (cleanTitle + ' ' + original + ' ' + field).toLowerCase();",
"",
"  if (/competition|compitition|award|certificate|certification|jeet|won|winner|achievement|school/.test(lower)) {",
"    return cleanTitle + ' highlights a real achievement from the creator’s supplied experience. Based on the original note, this entry presents the competition or recognition in a clearer and more professional way while keeping the focus on the facts provided. It helps the portfolio show effort, confidence, and growth without adding unsupported awards, dates, or extra claims.';",
"  }",
"",
"  if (/flower|flowers|blue|bells|painting|drawing|draw|garden|art|visual/.test(lower)) {",
"    return cleanTitle + ' presents a creative piece shaped by the creator’s interest in visual expression and observation. Based on the original note, the work is connected to a subject the creator genuinely liked and chose to draw or paint with care. This description gives the project a stronger portfolio voice while preserving the real idea, subject, and personal connection behind the piece.';",
"  }",
"",
"  return cleanTitle + ' presents the creator’s supplied work in a clearer and more polished portfolio voice. Based on the original note, this entry keeps the real idea intact while making the purpose, effort, and creative direction easier for viewers to understand. It strengthens the presentation without adding unsupported achievements, tools, dates, metrics, or extra claims.';",
"}",
"",
"async function translateOrLocalRegeneration(text = '', targetLanguage = 'English') {",
"  const clean = cleanText(text);",
"  if (!clean) return '';",
"  if (languageFamily(targetLanguage) === 'english') return clean;",
"  return await translateTextStrict(clean, targetLanguage);",
"}"
].join("\n");

const endpoint = [
"app.post('/factlock/regenerate', aiLimiter, async (req, res) => {",
"  try {",
"    const body = req.body || {};",
"    const id = body.id;",
"    const title = body.title;",
"    const originalDesc = body.originalDesc;",
"    const targetLanguage = body.targetLanguage || 'English';",
"    const creatorType = body.creatorType || 'creator';",
"    const medium = body.medium || '';",
"    const aiTone = body.aiTone || 'Professional';",
"    const name = body.name || '';",
"    const itemKind = body.itemKind || 'project';",
"",
"    const cleanOriginal = cleanText(originalDesc);",
"    const cleanTitle = cleanText(title || 'Portfolio item');",
"    const kind = cleanText(itemKind).toLowerCase();",
"    const idTitle = String(id || '') + ' ' + cleanTitle;",
"",
"    const isBio = kind === 'bio' || /meta:bio|\\bbio\\b|portfolio profile/i.test(idTitle);",
"    const isStatement = kind === 'statement' || /meta:statement|statement|portfolio voice/i.test(idTitle);",
"    const isProject = !isBio && !isStatement;",
"",
"    if (!cleanOriginal) {",
"      return res.status(400).json({ error: 'Original description is required for regeneration.' });",
"    }",
"",
"    const localFallbackBase = isBio",
"      ? buildLocalDistinctBio({ name, medium, description: cleanOriginal, creatorType })",
"      : isStatement",
"        ? buildLocalDistinctStatementStrong({ medium, description: cleanOriginal, creatorType })",
"        : buildLocalStrongProjectRegeneration({ title: cleanTitle, originalDesc: cleanOriginal, medium, creatorType });",
"",
"    let enhancedDesc = '';",
"",
"    if (aiAvailable()) {",
"      try {",
"        const systemInstruction = isBio",
"          ? [",
"              'You are MuseForge strict portfolio BIO regenerator.',",
"              languageStrictInstruction(targetLanguage),",
"              toneInstruction(aiTone),",
"              'Return only valid JSON: {\"enhanced\":\"...\"}',",
"              'Write a strong 5-6 sentence bio, around 90-130 words.',",
"              'Bio means profile/introduction: who the creator is, field, visible interests, style, credibility, and opportunity-ready presentation.',",
"              'Do not write an artist statement. Do not use first-person unless the original clearly uses it.',",
"              'Use only supplied facts. Never invent awards, clients, tools, years, metrics, exhibitions, degrees, jobs, or achievements.'",
"            ].join('\\n')",
"          : isStatement",
"            ? [",
"                'You are MuseForge strict ARTIST STATEMENT regenerator.',",
"                languageStrictInstruction(targetLanguage),",
"                toneInstruction(aiTone),",
"                'Return only valid JSON: {\"enhanced\":\"...\"}',",
"                'Write exactly 2 short first-person paragraphs, around 80-120 words total.',",
"                'Statement means purpose, values, process, creative direction, and what guides the work.',",
"                'Do not write a bio. Do not reintroduce the person. Do not return a single weak sentence.',",
"                'Use only supplied facts. Never invent awards, clients, tools, years, metrics, exhibitions, jobs, or achievements.'",
"              ].join('\\n')",
"            : [",
"                'You are FactLock AI, a strict portfolio project-description regenerator.',",
"                languageStrictInstruction(targetLanguage),",
"                toneInstruction(aiTone),",
"                'Return only valid JSON: {\"enhanced\":\"...\"}',",
"                'Write 2-3 polished portfolio sentences, around 45-75 words total.',",
"                'Do not output labels like Item title or Text.',",
"                'If the original is messy Roman Urdu or mixed language, translate the meaning into the target output language.',",
"                'Make the description stronger than the original, but preserve meaning 100%.',",
"                'Never add unsupported achievements, awards, dates, numbers, tools, metrics, clients, or facts.'",
"              ].join('\\n');",
"",
"        const aiText = await generateAiText({",
"          temperature: isBio || isStatement ? 0.28 : 0.18,",
"          maxTokens: isBio || isStatement ? 850 : 600,",
"          messages: [",
"            { role: 'system', content: systemInstruction },",
"            {",
"              role: 'user',",
"              content: [",
"                'Name: ' + cleanText(name),",
"                'Creator type: ' + cleanText(creatorType),",
"                'Medium/field: ' + cleanText(medium),",
"                'Item title: ' + cleanTitle,",
"                'Original user text: ' + cleanOriginal,",
"                '',",
"                'Regenerate this item only.'",
"              ].join('\\n'),",
"            },",
"          ],",
"        });",
"",
"        try {",
"          const parsed = parseJsonObject(aiText || '');",
"          enhancedDesc = stripRegenerateNoiseServer(parsed.enhanced || '');",
"        } catch (_) {",
"          enhancedDesc = stripRegenerateNoiseServer(aiText || '');",
"        }",
"      } catch (error) {",
"        console.warn('FactLock AI regeneration failed; using strong local fallback:', error.message);",
"      }",
"    }",
"",
"    if (!regenerationIsStrongEnough(enhancedDesc, { isBio, isStatement, isProject, targetLanguage }) || sameCleanText(enhancedDesc, cleanOriginal)) {",
"      enhancedDesc = await translateOrLocalRegeneration(localFallbackBase, targetLanguage);",
"    }",
"",
"    enhancedDesc = stripRegenerateNoiseServer(enhancedDesc);",
"",
"    const review = buildFactLockReview(",
"      { id: cleanText(id) || 'regenerated', title: cleanTitle, desc: cleanOriginal },",
"      enhancedDesc",
"    );",
"",
"    return res.json({ ...review, desc: enhancedDesc, enhancedDesc, status: 'pending' });",
"  } catch (error) {",
"    console.error('FactLock regeneration failed:', error);",
"    return res.status(500).json({ error: 'Could not regenerate this FactLock item.' });",
"  }",
"});"
].join("\n");

if (!server.includes("function stripRegenerateNoiseServer")) {
  server = server.replace("app.post('/factlock/regenerate'", helperBlock + "\n\napp.post('/factlock/regenerate'");
}

server = mustReplace(
  server,
  /app\.post\('\/factlock\/regenerate', aiLimiter, async \(req, res\) => \{[\s\S]*?\n\}\);\s*\napp\.post\('\/generate'/,
  endpoint + "\n\napp.post('/generate'",
  "replace factlock regenerate endpoint"
);

fs.copyFileSync(serverPath, serverPath + ".bak-regenerate-quality-" + stamp);
fs.writeFileSync(serverPath, server, "utf8");

console.log("✅ Strict regenerate quality patch applied.");
console.log("✅ Weak one-line statements will be rejected.");
console.log("✅ Project regenerate will reject prompt-echo garbage.");
console.log("✅ Strong local fallback added.");
