const fs = require("fs");
const path = require("path");

const appPath = path.join("src", "App.js");
const serverPath = path.join("backend", "server.js");

if (!fs.existsSync(appPath)) throw new Error("src/App.js not found");
if (!fs.existsSync(serverPath)) throw new Error("backend/server.js not found");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.copyFileSync(appPath, `${appPath}.bak-strong-factlock-${stamp}`);
fs.copyFileSync(serverPath, `${serverPath}.bak-strong-factlock-${stamp}`);

let app = fs.readFileSync(appPath, "utf8");
let server = fs.readFileSync(serverPath, "utf8");

function mustReplace(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Patch target not found: ${label}`);
  return source.replace(pattern, replacement);
}

function replaceOptional(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    console.warn(`⚠️ Optional target not found, skipped: ${label}`);
    return source;
  }
  return source.replace(pattern, replacement);
}

/* =========================================================
   FRONTEND FIXES
   ========================================================= */

/* 1) Add frontend markdown cleanup helper */
if (!app.includes("const stripPortfolioMarkdownHeadingClient =")) {
  app = mustReplace(
    app,
    /const normalizeLocalizedOutput = \(raw = \{\}, fallback = \{\}\) => localizeOutputClient\(raw \|\| \{\}, fallback \|\| \{\}\);/,
    `const normalizeLocalizedOutput = (raw = {}, fallback = {}) => localizeOutputClient(raw || {}, fallback || {});

const stripPortfolioMarkdownHeadingClient = (value = '') => stripAiReasoningClient(value)
  .replace(/^#{1,6}\\s+(Artist Bio|Bio|Artist Statement|Professional Statement|Statement)\\s*/i, '')
  .replace(/\\n#{1,6}\\s+(Artist Bio|Bio|Artist Statement|Professional Statement|Statement)\\s*/gi, '\\n')
  .replace(/^["']|["']$/g, '')
  .trim();

const extractPortfolioSectionClient = (markdown = '', heading = '') => {
  const source = String(markdown || '');
  const cleanHeading = String(heading || '').replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  if (!source.trim() || !cleanHeading) return '';
  const pattern = new RegExp('(^|\\\\n)##\\\\s+' + cleanHeading + '\\\\s*\\\\n([\\\\s\\\\S]*?)(?=\\\\n##\\\\s+|$)', 'i');
  const match = source.match(pattern);
  return stripPortfolioMarkdownHeadingClient(match?.[2] || '');
};`
  );
}

/* 2) Make localized bio/statement cleanup stronger */
app = replaceOptional(
  app,
  /const bioCandidate = safeClientLocalized\(\s*output\.bio \|\| output\.description,\s*fallback\.bio \|\| fallback\.description \|\| '',\s*language,\s*'description'\s*\);/,
  `const bioCandidate = stripPortfolioMarkdownHeadingClient(safeClientLocalized(
  output.bio || output.description,
  fallback.bio || fallback.description || '',
  language,
  'description'
));`,
  "clean bioCandidate"
);

app = replaceOptional(
  app,
  /let statementCandidate = safeClientLocalized\(\s*output\.artistStatement \|\| output\.statement,\s*fallback\.artistStatement \|\| fallback\.statement \|\| '',\s*language,\s*'description'\s*\);/,
  `let statementCandidate = stripPortfolioMarkdownHeadingClient(safeClientLocalized(
  output.artistStatement || output.statement,
  fallback.artistStatement || fallback.statement || '',
  language,
  'description'
));`,
  "clean statementCandidate"
);

/* 3) Force FactLock to include BOTH Bio and Statement */
app = mustReplace(
  app,
  /const metaReviews = \[\];[\s\S]*?const reviews = \[\.\.\.metaReviews, \.\.\.projectReviews, \.\.\.sectionReviews\];/,
  `const metaReviews = [];
        const reviewLabels = applyCreatorHeadingLabels(
          normalizedLocalized.labels || getPortfolioLabels(portfolioLanguage),
          portfolioLanguage,
          selectedCreatorType,
          CREATOR_TYPES[selectedCreatorType]?.label || ''
        );

        const bioCandidateForReview = stripPortfolioMarkdownHeadingClient(
          normalizedLocalized.bio ||
          extractPortfolioSectionClient(data.portfolio, getBioHeading(selectedCreatorType, CREATOR_TYPES[selectedCreatorType]?.label || '')) ||
          ''
        );

        const statementCandidateForReview = stripPortfolioMarkdownHeadingClient(
          normalizedLocalized.artistStatement ||
          extractPortfolioSectionClient(data.portfolio, getStatementHeading(selectedCreatorType, CREATOR_TYPES[selectedCreatorType]?.label || '')) ||
          ''
        );

        const addMetaReview = (id, title, enhancedDesc) => {
          const cleaned = stripPortfolioMarkdownHeadingClient(enhancedDesc);
          if (!cleaned) return;
          metaReviews.push({
            id,
            title,
            originalDesc: String(description || '').trim(),
            enhancedDesc: cleaned,
            factsPreserved: [name, medium].filter(Boolean),
            unsupportedNewFacts: [],
            status: 'pending',
          });
        };

        if (shouldEnhanceProjects) {
          addMetaReview('meta:bio', \`\${reviewLabels.artistBio || reviewLabels.about || 'Bio'} — portfolio profile\`, bioCandidateForReview);
          addMetaReview('meta:statement', \`\${reviewLabels.artistStatement || reviewLabels.statement || 'Statement'} — portfolio voice\`, statementCandidateForReview);
        }

        const reviews = [...metaReviews, ...projectReviews, ...sectionReviews];`,
  "replace metaReviews block"
);

/* 4) Tell backend whether regenerate is Bio, Statement, or Project */
app = mustReplace(
  app,
  /medium,\s*aiTone,\s*\}\),/,
  `medium,
          aiTone,
          name,
          itemKind: String(review.id).startsWith('meta:bio')
            ? 'bio'
            : String(review.id).startsWith('meta:statement')
              ? 'statement'
              : 'project',
        }),`,
  "add itemKind to regenerate payload"
);

/* 5) Regenerated Bio/Statement must be cleaned, not treated as project fallback */
app = replaceOptional(
  app,
  /const regeneratedDesc = safeClientLocalized\(data\.enhancedDesc \|\| data\.desc \|\| '', review\.originalDesc \|\| '', portfolioLanguage, 'project'\);/,
  `const itemKind = String(review.id).startsWith('meta:bio') || String(review.id).startsWith('meta:statement') ? 'description' : 'project';
      const regeneratedDesc = stripPortfolioMarkdownHeadingClient(safeClientLocalized(data.enhancedDesc || data.desc || '', review.originalDesc || '', portfolioLanguage, itemKind));`,
  "regeneratedDesc cleanup"
);

/* 6) Keep original / reviewed meta must apply in every language */
app = replaceOptional(
  app,
  /\.\.\.\(languageFamilyName\(portfolioLanguage\) === 'english' && reviewedMeta\.bio \? \{ bio: reviewedMeta\.bio \} : \{\}\),\s*\.\.\.\(languageFamilyName\(portfolioLanguage\) === 'english' && reviewedMeta\.statement \? \{ artistStatement: reviewedMeta\.statement \} : \{\}\),/,
  `...(reviewedMeta.bio ? { bio: stripPortfolioMarkdownHeadingClient(reviewedMeta.bio) } : {}),
        ...(reviewedMeta.statement ? { artistStatement: stripPortfolioMarkdownHeadingClient(reviewedMeta.statement) } : {}),`,
  "apply reviewedMeta for all languages"
);

/* 7) Final portfolio must not render nested ## heading inside Bio */
app = replaceOptional(
  app,
  /\$\{finalLocalized\.bio \|\| ''\}/,
  "${stripPortfolioMarkdownHeadingClient(finalLocalized.bio || '')}",
  "clean final bio render"
);

app = replaceOptional(
  app,
  /\$\{finalLocalized\.artistStatement \|\| ''\}/,
  "${stripPortfolioMarkdownHeadingClient(finalLocalized.artistStatement || '')}",
  "clean final statement render"
);

/* =========================================================
   BACKEND FIXES
   ========================================================= */

/* 8) Add backend strong Bio/Statement helpers */
if (!server.includes("function stripPortfolioMarkdownHeadingServer")) {
  server = mustReplace(
    server,
    /function replaceGeneratedPortfolioSection\(markdown = '', heading = '', newBody = ''\) \{/,
    `function stripPortfolioMarkdownHeadingServer(value = '') {
  return cleanText(value)
    .replace(/^#{1,6}\\s+(Artist Bio|Bio|Artist Statement|Professional Statement|Statement)\\s*/i, '')
    .replace(/\\n#{1,6}\\s+(Artist Bio|Bio|Artist Statement|Professional Statement|Statement)\\s*/gi, '\\n')
    .replace(/^["']|["']$/g, '')
    .trim();
}

function buildLocalDistinctBio({ name = '', medium = '', description = '', creatorType = '' } = {}) {
  const displayName = cleanText(name) || 'This creator';
  const field = cleanText(medium) || (/student|job|career|cv|developer|software|engineer|intern|professional/i.test(creatorType) ? 'their professional field' : 'visual art and creative expression');
  const original = cleanText(description);

  if (/student|job|career|cv|developer|software|engineer|intern|professional/i.test(creatorType)) {
    return \`\${displayName} is a developing professional focused on \${field}, practical learning, and building credible portfolio work. Their profile is grounded in the information they shared, with emphasis on real skills, project experience, and clear growth direction. \${original ? \`Their current interests include \${original}.\` : 'Their portfolio presents their current strengths without adding unsupported claims.'} This bio is designed to give recruiters, mentors, and collaborators a clear first impression. It presents the person honestly while making their work feel organized, focused, and opportunity-ready.\`;
  }

  return \`\${displayName} is an emerging creator working in \${field}, with a personal interest in developing expressive and visually meaningful work. Their portfolio is built around the details they shared, especially the themes, subjects, and creative choices that shape their current direction. \${original ? \`Their work is connected to this core idea: \${original}.\` : 'Their work is presented with honesty, care, and attention to creative growth.'} This bio introduces their practice in a polished and credible way. It gives viewers a clear sense of who they are as a creator without adding fake achievements or unsupported claims.\`;
}

function buildLocalDistinctStatementStrong({ medium = '', description = '', creatorType = '' } = {}) {
  const field = cleanText(medium) || (/student|job|career|cv|developer|software|engineer|intern|professional/i.test(creatorType) ? 'my professional field' : 'my creative field');
  const original = cleanText(description);

  if (/student|job|career|cv|developer|software|engineer|intern|professional/i.test(creatorType)) {
    return \`My direction is shaped by practical learning, honest growth, and a clear commitment to improving in \${field}. I want my portfolio to show how I think, what I can contribute, and how seriously I approach each opportunity.

I value clarity, consistency, and real progress over empty claims. \${original ? \`The details I shared guide this portfolio: \${original}.\` : 'Every section is based on the real information I provided.'} My goal is to present my abilities truthfully, confidently, and in a way that helps others understand my potential.\`;
  }

  return \`My creative direction is shaped by curiosity, observation, and a personal connection to \${field}. I want my work to communicate feeling, care, and intention while staying true to the details I have actually shared.

I see each piece as a chance to develop my visual voice and understand my creative process more deeply. \${original ? \`The idea behind my work begins here: \${original}.\` : 'I want my portfolio to feel honest, expressive, and grounded in my real creative interests.'} My goal is to keep improving with confidence while presenting my work in a clear and meaningful way.\`;
}

async function ensureDistinctBioDraft({ name = '', medium = '', description = '', targetLanguage = 'English', creatorType = '', aiTone = 'Professional', artistStatement = '' } = {}) {
  const localFallback = buildLocalDistinctBio({ name, medium, description, creatorType });

  if (aiAvailable()) {
    try {
      const aiText = await generateAiText({
        temperature: 0.18,
        maxTokens: 650,
        messages: [
          {
            role: 'system',
            content: \`You are MuseForge's strict portfolio BIO writer. \${languageStrictInstruction(targetLanguage)} \${toneInstruction(aiTone)} Write ONLY the bio body, no heading. Use only supplied facts. Never invent awards, clients, numbers, tools, metrics, dates, exhibitions, jobs, education, or achievements. Bio = profile/introduction. It must NOT sound like an artist statement. Make it strong, polished, human, credible, and 5-6 sentences.\`,
          },
          {
            role: 'user',
            content: \`Name: \${cleanText(name)}
Creator type: \${cleanText(creatorType)}
Medium/field: \${cleanText(medium)}
User-provided description: \${cleanText(description)}
Existing statement to avoid repeating: \${cleanText(artistStatement)}

Write a strong portfolio bio only.\`,
          },
        ],
      });

      const candidate = stripPortfolioMarkdownHeadingServer(aiText || '');
      if (candidate && !sectionsTooSimilar(candidate, artistStatement) && !hasUnexpectedScriptForLanguage(candidate, targetLanguage)) return candidate;
    } catch (error) {
      console.warn('Distinct bio generation failed; local fallback used:', error.message);
    }
  }

  return targetLanguage === 'English' ? localFallback : await translateTextStrict(localFallback, targetLanguage);
}

function replaceGeneratedPortfolioSection(markdown = '', heading = '', newBody = '') {`,
    "insert backend helper block"
  );
}

/* 9) Replace weak post-processing of generated Bio/Statement */
server = mustReplace(
  server,
  /const customSectionsForOutput = enhancedCustomSections\.length \? enhancedCustomSections : customSectionItems;[\s\S]*?portfolio = replaceGeneratedPortfolioSection\(portfolio, _genStatementHeading, generatedArtistStatement\);/,
  `const customSectionsForOutput = enhancedCustomSections.length ? enhancedCustomSections : customSectionItems;

  let generatedArtistBio = stripPortfolioMarkdownHeadingServer(extractGeneratedPortfolioSection(portfolio, _genBioHeading));
  let generatedArtistStatement = stripPortfolioMarkdownHeadingServer(extractGeneratedPortfolioSection(portfolio, _genStatementHeading));

  generatedArtistBio = await ensureDistinctBioDraft({
    name,
    medium,
    description,
    targetLanguage: safeTargetLanguage,
    creatorType,
    aiTone,
    artistStatement: generatedArtistStatement,
  });

  generatedArtistStatement = await ensureDistinctStatementDraft({
    name,
    medium,
    description,
    projects: projectItems,
    targetLanguage: safeTargetLanguage,
    creatorType,
    aiTone,
    artistBio: generatedArtistBio,
    artistStatement: generatedArtistStatement,
  });

  generatedArtistBio = stripPortfolioMarkdownHeadingServer(generatedArtistBio);
  generatedArtistStatement = stripPortfolioMarkdownHeadingServer(generatedArtistStatement);

  if (!generatedArtistStatement || sectionsTooSimilar(generatedArtistBio, generatedArtistStatement)) {
    generatedArtistStatement = safeTargetLanguage === 'English'
      ? buildLocalDistinctStatementStrong({ medium, description, creatorType })
      : await translateTextStrict(buildLocalDistinctStatementStrong({ medium, description, creatorType }), safeTargetLanguage);
  }

  portfolio = replaceGeneratedPortfolioSection(portfolio, _genBioHeading, generatedArtistBio);
  portfolio = replaceGeneratedPortfolioSection(portfolio, _genStatementHeading, generatedArtistStatement);`,
  "replace generated bio/statement post-process"
);

/* 10) Clean localizedOutput bio/statement */
server = replaceOptional(
  server,
  /const sourceBio = cleanText\(artistBio\) \|\| cleanText\(description\);\s*const sourceStatement = cleanText\(artistStatement\) \|\| cleanText\(description\);/,
  `const sourceBio = stripPortfolioMarkdownHeadingServer(cleanText(artistBio) || cleanText(description));
  const sourceStatement = stripPortfolioMarkdownHeadingServer(cleanText(artistStatement) || cleanText(description));`,
  "clean sourceBio/sourceStatement"
);

server = replaceOptional(
  server,
  /bio: safeLocalizedValue\(cleanText\(parsed\.bio\), fallback\.bio \|\| description, lang, 'description'\),\s*artistStatement: safeLocalizedValue\(cleanText\(parsed\.artistStatement\), fallback\.artistStatement \|\| description, lang, 'description'\),/,
  `bio: stripPortfolioMarkdownHeadingServer(safeLocalizedValue(cleanText(parsed.bio), fallback.bio || description, lang, 'description')),
      artistStatement: stripPortfolioMarkdownHeadingServer(safeLocalizedValue(cleanText(parsed.artistStatement), fallback.artistStatement || description, lang, 'description')),`,
  "clean parsed localized bio/statement"
);

/* 11) Replace /factlock/regenerate with strong Bio/Statement-aware endpoint */
server = mustReplace(
  server,
  /app\.post\('\/factlock\/regenerate', aiLimiter, async \(req, res\) => \{[\s\S]*?\n\}\);\s*\napp\.post\('\/generate'/,
  `app.post('/factlock/regenerate', aiLimiter, async (req, res) => {
  try {
    const {
      id,
      title,
      originalDesc,
      targetLanguage = 'English',
      creatorType = 'creator',
      medium = '',
      aiTone = 'Professional',
      name = '',
      itemKind = 'project',
    } = req.body || {};

    const cleanOriginal = cleanText(originalDesc);
    const cleanTitle = cleanText(title || 'Portfolio item');
    const kind = cleanText(itemKind).toLowerCase();
    const isBio = kind === 'bio' || /meta:bio|\\bbio\\b/i.test(String(id || '') + ' ' + cleanTitle);
    const isStatement = kind === 'statement' || /meta:statement|statement|voice/i.test(String(id || '') + ' ' + cleanTitle);

    if (!cleanOriginal) {
      return res.status(400).json({ error: 'Original description is required for regeneration.' });
    }

    const localFallback = isBio
      ? buildLocalDistinctBio({ name, medium, description: cleanOriginal, creatorType })
      : isStatement
        ? buildLocalDistinctStatementStrong({ medium, description: cleanOriginal, creatorType })
        : polishDescriptionLocally(cleanOriginal, cleanTitle);

    let enhancedDesc = '';

    if (aiAvailable()) {
      try {
        const systemInstruction = isBio
          ? \`You are MuseForge's strict portfolio BIO regenerator. \${languageStrictInstruction(targetLanguage)} \${toneInstruction(aiTone)} Output only valid JSON: {"enhanced":"..."}. Write a strong 5-6 sentence portfolio bio. Bio = profile/introduction: who the creator is, field, visible interests, style, credibility, and opportunity-ready presentation. Do not write a manifesto. Do not repeat statement language. Use only supplied facts. Never invent awards, clients, tools, years, metrics, exhibitions, degrees, jobs, or achievements.\`
          : isStatement
            ? \`You are MuseForge's strict ARTIST STATEMENT regenerator. \${languageStrictInstruction(targetLanguage)} \${toneInstruction(aiTone)} Output only valid JSON: {"enhanced":"..."}. Write 2 short first-person paragraphs, mature and memorable. Statement = purpose, values, process, creative direction, and what guides the work. Do not write a bio. Do not reintroduce the person. Use only supplied facts. Never invent awards, clients, tools, years, metrics, exhibitions, jobs, or achievements.\`
            : \`You are FactLock AI — a strict fact-checking creative assistant. \${languageStrictInstruction(targetLanguage)} \${toneInstruction(aiTone)} Output only valid JSON: {"enhanced":"..."}. Improve grammar, flow, emotional tone, and professionalism. Preserve original meaning 100%. Never add new achievements, awards, dates, numbers, tools, metrics, clients, or facts.\`;

        const aiText = await generateAiText({
          temperature: isBio || isStatement ? 0.22 : 0.08,
          maxTokens: isBio || isStatement ? 750 : 450,
          messages: [
            { role: 'system', content: systemInstruction },
            {
              role: 'user',
              content: \`Name: \${cleanText(name)}
Creator type: \${cleanText(creatorType)}
Medium/field: \${cleanText(medium)}
Item title: \${cleanTitle}
Original user text: \${cleanOriginal}

Regenerate this item only.\`,
            },
          ],
        });

        try {
          const parsed = parseJsonObject(aiText || '');
          enhancedDesc = stripPortfolioMarkdownHeadingServer(parsed.enhanced || '');
        } catch (_) {
          enhancedDesc = stripPortfolioMarkdownHeadingServer(aiText || '');
        }

        if (
          !enhancedDesc ||
          sameCleanText(enhancedDesc, cleanOriginal) ||
          hasUnexpectedScriptForLanguage(enhancedDesc, targetLanguage)
        ) {
          enhancedDesc = targetLanguage === 'English' ? localFallback : await translateTextStrict(localFallback, targetLanguage);
        }
      } catch (error) {
        enhancedDesc = targetLanguage === 'English' ? localFallback : await translateTextStrict(localFallback, targetLanguage);
      }
    } else {
      enhancedDesc = targetLanguage === 'English' ? localFallback : localizeBasicTextFallback(localFallback, targetLanguage);
    }

    enhancedDesc = stripPortfolioMarkdownHeadingServer(enhancedDesc);
    const review = buildFactLockReview({ id: cleanText(id) || 'regenerated', title: cleanTitle, desc: cleanOriginal }, enhancedDesc);
    return res.json({ ...review, desc: enhancedDesc, enhancedDesc, status: 'pending' });
  } catch (error) {
    console.error('FactLock regeneration failed:', error);
    return res.status(500).json({ error: 'Could not regenerate this FactLock item.' });
  }
});

app.post('/generate'`,
  "replace factlock regenerate endpoint"
);

fs.writeFileSync(appPath, app, "utf8");
fs.writeFileSync(serverPath, server, "utf8");

console.log("✅ Strong FactLock Bio/Statement patch applied.");
console.log("✅ Bio + Statement both forced into FactLock.");
console.log("✅ Regenerate now has separate strong prompts for Bio, Statement, and Projects.");
console.log("✅ Keep original / reviewed choices apply to all output languages.");
console.log("✅ Nested markdown headings inside Bio/Statement are stripped.");
console.log("Backups:");
console.log(`- ${appPath}.bak-strong-factlock-${stamp}`);
console.log(`- ${serverPath}.bak-strong-factlock-${stamp}`);

