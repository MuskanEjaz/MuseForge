const fs = require("fs");
const path = require("path");

const appPath = path.join("src", "App.js");
const serverPath = path.join("backend", "server.js");

if (!fs.existsSync(appPath)) throw new Error("src/App.js not found");
if (!fs.existsSync(serverPath)) throw new Error("backend/server.js not found");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.copyFileSync(appPath, `${appPath}.bak-factlock-bio-${stamp}`);
fs.copyFileSync(serverPath, `${serverPath}.bak-factlock-bio-${stamp}`);

let app = fs.readFileSync(appPath, "utf8");
let server = fs.readFileSync(serverPath, "utf8");

function replaceOnce(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    throw new Error(`Patch target not found: ${label}`);
  }
  return source.replace(pattern, replacement);
}

/* =========================================================
   1) Frontend: add Artist Bio + Statement into FactLock review
   ========================================================= */

if (!app.includes("const ensureMetaFactLockReviews =")) {
  app = replaceOnce(
    app,
    /const normalizeLocalizedOutput = \(raw = \{\}, fallback = \{\}\) => localizeOutputClient\(raw \|\| \{\}, fallback \|\| \{\}\);/,
    `const normalizeLocalizedOutput = (raw = {}, fallback = {}) => localizeOutputClient(raw || {}, fallback || {});

const ensureMetaFactLockReviews = (reviews = [], localized = {}, context = {}) => {
  const list = Array.isArray(reviews) ? [...reviews] : [];
  const ids = new Set(list.map(item => String(item?.id || '')));
  const original = stripAiReasoningClient(context.description || '');
  const creatorLabel = context.creatorLabel || '';
  const selectedType = context.selectedCreatorType || '';
  const bioHeading = getBioHeading(selectedType, creatorLabel);
  const statementHeading = getStatementHeading(selectedType, creatorLabel);

  const factsFrom = (text = '') => {
    const stop = new Set(['the','and','for','with','that','this','from','into','have','has','had','was','were','are','you','your','their','our','but','not','can','will','about','project','projects','work','works','love','like','using','use','used','create','created','build','built','make','made','my','i','me','a','an','of','to','in','on','by','is','it']);
    return [...new Set(String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9+#.-]{2,}/g) || [])]
      .filter(token => !stop.has(token))
      .slice(0, 6);
  };

  const makeReview = (id, title, originalDesc, enhancedDesc) => ({
    id,
    title,
    originalDesc: originalDesc || 'Based on the creator information supplied in the form.',
    desc: enhancedDesc || '',
    enhancedDesc: enhancedDesc || '',
    factsPreserved: factsFrom(\`\${title} \${originalDesc}\`).length ? factsFrom(\`\${title} \${originalDesc}\`) : [title],
    unsupportedNewFacts: [],
    status: 'pending',
  });

  const bio = stripAiReasoningClient(localized.bio || localized.description || '');
  const statement = stripAiReasoningClient(localized.artistStatement || localized.statement || '');

  if (bio && !ids.has('meta:bio')) {
    list.unshift(makeReview('meta:bio', \`\${bioHeading} — portfolio profile\`, original, bio));
    ids.add('meta:bio');
  }

  if (statement && !ids.has('meta:statement')) {
    const insertAt = ids.has('meta:bio') ? 1 : 0;
    list.splice(insertAt, 0, makeReview('meta:statement', \`\${statementHeading} — portfolio voice\`, original, statement));
    ids.add('meta:statement');
  }

  return list;
};`,
    "insert ensureMetaFactLockReviews"
  );
}

/* Add meta FactLock reviews before showing the review screen */
app = replaceOnce(
  app,
  /if \(reviews\.length\) \{\s*setFactLockReviews\(reviews\);/,
  `const reviewsWithMeta = ensureMetaFactLockReviews(reviews, normalizedLocalized, {
          description,
          portfolioLanguage,
          selectedCreatorType,
          creatorLabel: CREATOR_TYPES[selectedCreatorType]?.label || '',
        });

        if (reviewsWithMeta.length) {
          setFactLockReviews(reviewsWithMeta);`,
  "inject meta reviews before FactLock display"
);

/* =========================================================
   2) Frontend: show Regenerate button for Bio/Statement too
   ========================================================= */

app = replaceOnce(
  app,
  /\{!String\(review\.id\)\.startsWith\('meta:'\) && <button type="button" onClick=\{\(\) => regenerateFactLockReview\(review\.id\)\} disabled=\{regeneratingFactLockId === String\(review\.id\)\}>\{regeneratingFactLockId === String\(review\.id\) \? 'Regenerating\.\.\.' : 'Regenerate'\}<\/button>\}/,
  `<button type="button" onClick={() => regenerateFactLockReview(review.id)} disabled={regeneratingFactLockId === String(review.id)}>{regeneratingFactLockId === String(review.id) ? 'Regenerating...' : 'Regenerate'}</button>`,
  "enable regenerate for meta FactLock items"
);

/* =========================================================
   3) Frontend: reviewed Bio/Statement must apply in every language
   ========================================================= */

app = app.replace(
  /\.\.\.\(languageFamilyName\(portfolioLanguage\) === 'english' && reviewedMeta\.bio \? \{ bio: reviewedMeta\.bio \} : \{\}\),\s*\.\.\.\(languageFamilyName\(portfolioLanguage\) === 'english' && reviewedMeta\.statement \? \{ artistStatement: reviewedMeta\.statement \} : \{\}\),/,
  `...(reviewedMeta.bio ? { bio: reviewedMeta.bio } : {}),
        ...(reviewedMeta.statement ? { artistStatement: reviewedMeta.statement } : {}),`
);

/* =========================================================
   4) Backend: make local statement fallback less stupid
   ========================================================= */

server = replaceOnce(
  server,
  /function buildLocalDistinctStatement\(\{ medium = '', creatorType = '' \} = \{\}\) \{[\s\S]*?\n\}/,
  `function buildLocalDistinctStatement({ medium = '', creatorType = '' } = {}) {
  const typeText = cleanText(creatorType).toLowerCase();
  const isCareer = /student|job|career|cv|developer|software|engineer|intern|professional/.test(typeText);
  let field = cleanText(medium);

  if (!field || /^(artist|creator|other|portfolio creator)$/i.test(field)) {
    field = isCareer ? 'my professional field' : 'visual art and creative expression';
  }

  if (isCareer) {
    return \`My direction is shaped by practical learning, honest growth, and a clear commitment to improving in \${field}. I want my portfolio to show how I think, what I can contribute, and how seriously I approach each opportunity.

I value clarity, consistency, and real progress over empty claims. Every part of this portfolio is meant to present my work truthfully, confidently, and in a way that helps others understand my potential.\`;
  }

  return \`My creative direction is guided by intention, observation, and a personal connection to \${field}. I want my work to feel expressive and meaningful while staying true to the details I have actually shared.

I see each piece as a chance to communicate mood, personality, and purpose. My goal is to keep developing a recognizable creative voice and present my work with honesty, care, and confidence.\`;
}`,
  "replace buildLocalDistinctStatement"
);

/* =========================================================
   5) Backend: if AI returns plain text instead of JSON, still use it
   ========================================================= */

server = replaceOnce(
  server,
  /const parsed = parseJsonObject\(aiText \|\| ''\);\s*const candidate = cleanText\(parsed\.statement \|\| ''\);/,
  `let candidate = '';
      try {
        const parsed = parseJsonObject(aiText || '');
        candidate = cleanText(parsed.statement || '');
      } catch (_) {
        candidate = cleanText(aiText || '')
          .replace(/^statement\\s*[:\\-]\\s*/i, '')
          .replace(/^["']|["']$/g, '');
      }`,
  "make distinct statement parser tolerant"
);

fs.writeFileSync(appPath, app, "utf8");
fs.writeFileSync(serverPath, server, "utf8");

console.log("✅ FactLock Bio/Statement patch applied.");
console.log("✅ Artist Bio will appear in FactLock.");
console.log("✅ Regenerate button enabled for Bio, Statement, Projects, and Custom items.");
console.log("✅ Statement fallback improved.");
console.log("Backups:");
console.log(`- ${appPath}.bak-factlock-bio-${stamp}`);
console.log(`- ${serverPath}.bak-factlock-bio-${stamp}`);
