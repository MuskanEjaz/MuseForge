const fs = require('fs');

const serverPath = '.\\backend\\server.js';
const appPath = '.\\src\\App.js';

if (!fs.existsSync(serverPath)) throw new Error('backend/server.js not found');
if (!fs.existsSync(appPath)) throw new Error('src/App.js not found');

let server = fs.readFileSync(serverPath, 'utf8');
let app = fs.readFileSync(appPath, 'utf8');

fs.writeFileSync(serverPath + '.backup.language-enforce-' + Date.now(), server, 'utf8');
fs.writeFileSync(appPath + '.backup.language-enforce-' + Date.now(), app, 'utf8');

function replaceFunction(source, name, replacement) {
  const start = source.indexOf('function ' + name);
  if (start < 0) throw new Error(name + ' not found');
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  let inString = null;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    const prev = source[i - 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }
    if (inTemplate) {
      if (ch === '`' && prev !== '\\') inTemplate = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(0, start) + replacement.trim() + '\n\n' + source.slice(i + 1);
      }
    }
  }
  throw new Error('Could not replace ' + name);
}

function replaceConstArrowFunction(source, name, replacement) {
  const start = source.indexOf('const ' + name + ' =');
  if (start < 0) throw new Error(name + ' not found');
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        let end = i + 1;
        if (source[end] === ';') end++;
        return source.slice(0, start) + replacement.trim() + '\n\n' + source.slice(end);
      }
    }
  }
  throw new Error('Could not replace ' + name);
}

const languagesBlock = `[
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Turkish',
  'Chinese',
  'Japanese',
  'Korean'
]`;

server = server.replace(
  /const\s+ACTIVE_OUTPUT_LANGUAGES\s*=\s*new\s+Set\s*\(\s*\[[\s\S]*?\]\s*\);/,
  `const ACTIVE_OUTPUT_LANGUAGES = new Set(${languagesBlock});`
);

app = app.replace(
  /const\s+LANGUAGE_OPTIONS\s*=\s*\[[\s\S]*?\];/,
  `const LANGUAGE_OPTIONS = ${languagesBlock};`
);

const strictServerHelpers = String.raw`
function strictEnglishLeakForTarget(value = '', targetLanguage = 'English') {
  const family = languageFamily(targetLanguage);
  if (family === 'english') return false;

  const text = cleanText(value).toLowerCase();
  if (!text) return false;

  if (requiresNonLatinScript(targetLanguage)) {
    return leaksLatinForTarget(text, targetLanguage) || hasUnexpectedScriptForLanguage(text, targetLanguage);
  }

  const tokens = text.match(/\b[a-z][a-z']+\b/g) || [];
  if (tokens.length < 6) return false;

  const allowed = new Set([
    'react','node','nodejs','express','mongodb','python','java','javascript','typescript','html','css','sql','plsql',
    'github','linkedin','git','api','apis','rest','mern','ai','ml','ui','ux','cv','pdf','nust','seecs','comsats',
    'azure','docker','kubernetes','visual','studio','code','scikit','learn','pytorch','firebase','postgresql'
  ]);

  const englishWords = new Set([
    'the','and','with','for','from','that','this','which','where','while','because','about','through','into','without',
    'student','profile','dedicated','clear','focus','growth','practical','learning','real','world','contribution',
    'computer','science','hands','experience','development','completed','academic','projects','including','system',
    'skilled','seeking','internship','portfolio','highlights','skills','experiences','provided','professional',
    'opportunities','work','works','project','education','experience','responsible','designed','developed','built',
    'created','managed','improved','implemented','knowledge','strong','passionate','career','ready','software'
  ]);

  const englishHits = tokens.filter(token => englishWords.has(token) && !allowed.has(token)).length;
  const targetHits = typeof targetLanguageSignalScore === 'function' ? targetLanguageSignalScore(text, targetLanguage) : 0;

  return englishHits >= 4 && englishHits >= targetHits + 2;
}

async function forceTranslatePortfolioField(value = '', targetLanguage = 'English', kind = 'description') {
  const original = cleanText(value);
  const family = languageFamily(targetLanguage);
  if (!original || family === 'english') return original;

  const alreadyBad =
    hasUnexpectedScriptForLanguage(original, targetLanguage) ||
    looksLikeWrongEnglishForTarget(original, targetLanguage) ||
    strictEnglishLeakForTarget(original, targetLanguage);

  if (!alreadyBad) return original;

  let translated = await translateTextStrict(original, targetLanguage);

  if (
    translated &&
    !sameCleanText(translated, original) &&
    !hasUnexpectedScriptForLanguage(translated, targetLanguage) &&
    !looksLikeWrongEnglishForTarget(translated, targetLanguage) &&
    !strictEnglishLeakForTarget(translated, targetLanguage)
  ) {
    return translated;
  }

  if (aiAvailable()) {
    try {
      const aiText = await generateAiText({
        temperature: 0.01,
        maxTokens: 900,
        messages: [
          {
            role: 'system',
            content: `You are a strict translation engine. ${languageStrictInstruction(targetLanguage)} Translate the user text into ${targetLanguage}. Preserve names, emails, URLs, phone numbers, usernames, brand names, company names, and technology names. Return only valid JSON: {"text":"translated text"}.`
          },
          {
            role: 'user',
            content: original
          }
        ]
      });
      const parsed = parseJsonObject(aiText || '');
      const candidate = cleanText(parsed.text || '');
      if (
        candidate &&
        !sameCleanText(candidate, original) &&
        !hasUnexpectedScriptForLanguage(candidate, targetLanguage) &&
        !looksLikeWrongEnglishForTarget(candidate, targetLanguage) &&
        !strictEnglishLeakForTarget(candidate, targetLanguage)
      ) {
        return candidate;
      }
    } catch (error) {
      console.warn('Hard translation retry failed:', error.message);
    }
  }

  return translated || original;
}
`;

if (!server.includes('function strictEnglishLeakForTarget')) {
  server = server.replace(/\napp\.post\('\/generate'/, '\n' + strictServerHelpers + "\n\napp.post('/generate'");
}

server = server.replace(
  /const\s+generatedArtistBio\s*=\s*extractGeneratedPortfolioSection\(portfolio,\s*_genBioHeading\);/,
  `let generatedArtistBio = extractGeneratedPortfolioSection(portfolio, _genBioHeading);`
);

server = server.replace(
  /portfolio\s*=\s*replaceGeneratedPortfolioSection\(portfolio,\s*_genStatementHeading,\s*generatedArtistStatement\);\s*\n\s*const\s+localizedOutput\s*=\s*await\s+buildLocalizedOutput\(\{/,
  `generatedArtistBio = await forceTranslatePortfolioField(generatedArtistBio || description, safeTargetLanguage, 'description');
generatedArtistStatement = await forceTranslatePortfolioField(generatedArtistStatement, safeTargetLanguage, 'description');

portfolio = replaceGeneratedPortfolioSection(portfolio, _genBioHeading, generatedArtistBio);
portfolio = replaceGeneratedPortfolioSection(portfolio, _genStatementHeading, generatedArtistStatement);

  let localizedOutput = await buildLocalizedOutput({`
);

server = server.replace(
  /(\s*)return\s+res\.json\(\{\s*\n\s*portfolio,/,
  `$1localizedOutput = {
$1  ...localizedOutput,
$1  bio: await forceTranslatePortfolioField(localizedOutput.bio || generatedArtistBio || description, safeTargetLanguage, 'description'),
$1  artistStatement: await forceTranslatePortfolioField(localizedOutput.artistStatement || generatedArtistStatement || '', safeTargetLanguage, 'description'),
$1};

$1portfolio = replaceGeneratedPortfolioSection(portfolio, _genBioHeading, localizedOutput.bio || generatedArtistBio || '');
$1portfolio = replaceGeneratedPortfolioSection(portfolio, _genStatementHeading, localizedOutput.artistStatement || generatedArtistStatement || '');

$1if (safeTargetLanguage !== 'English' && strictEnglishLeakForTarget(`${'${localizedOutput.bio || ""} ${localizedOutput.artistStatement || ""}'}`, safeTargetLanguage)) {
$1  warnings.push('Selected-language translation could not fully complete. Check AI provider quota/key and regenerate.');
$1}

$1return res.json({
$1  portfolio,`
);

const strictFrontendLooksWrong = String.raw`
const frontendLooksLikeWrongEnglishForTarget = (value = '', language = 'English') => {
  const family = languageFamilyName(language);
  if (family === 'english' || family === 'roman urdu') return false;

  const text = String(value || '').toLowerCase();
  if (!text.trim()) return false;

  if (frontendNeedsNativeScript(language)) {
    return frontendLeaksLatinForTarget(text, language) || !frontendHasRequiredScript(text, language);
  }

  const tokens = text.match(/\b[a-z][a-z']+\b/g) || [];
  if (tokens.length < 6) return false;

  const allowed = new Set([
    'react','node','nodejs','express','mongodb','python','java','javascript','typescript','html','css','sql','plsql',
    'github','linkedin','git','api','apis','rest','mern','ai','ml','ui','ux','cv','pdf','nust','seecs','comsats',
    'azure','docker','kubernetes','visual','studio','code','scikit','learn','pytorch','firebase','postgresql'
  ]);

  const englishWords = new Set([
    'the','and','with','for','from','that','this','which','where','while','because','about','through','into','without',
    'student','profile','dedicated','clear','focus','growth','practical','learning','real','world','contribution',
    'computer','science','hands','experience','development','completed','academic','projects','including','system',
    'skilled','seeking','internship','portfolio','highlights','skills','experiences','provided','professional',
    'opportunities','work','works','project','education','experience','responsible','designed','developed','built',
    'created','managed','improved','implemented','knowledge','strong','passionate','career','ready','software'
  ]);

  const englishHits = tokens.filter(token => englishWords.has(token) && !allowed.has(token)).length;
  const targetScore = frontendTargetLanguageSignalScore(value, language);

  return englishHits >= 4 && englishHits >= targetScore + 2;
};
`;

if (app.includes('const frontendLooksLikeWrongEnglishForTarget =')) {
  app = replaceConstArrowFunction(app, 'frontendLooksLikeWrongEnglishForTarget', strictFrontendLooksWrong);
}

app = app.replace(
  /const\s+finalLocalized\s*=\s*\{\s*\n\s*\.\.\.finalLocalizedBase,\s*\n\s*\.\.\.\(reviewedMeta\.bio\s*\?\s*\{\s*bio:\s*reviewedMeta\.bio\s*\}\s*:\s*\{\}\),\s*\n\s*\.\.\.\(reviewedMeta\.statement\s*\?\s*\{\s*artistStatement:\s*reviewedMeta\.statement\s*\}\s*:\s*\{\}\),\s*\n\s*\};/,
  `const finalLocalized = {
        ...finalLocalizedBase,
        ...(languageFamilyName(portfolioLanguage) === 'english' && reviewedMeta.bio ? { bio: reviewedMeta.bio } : {}),
        ...(languageFamilyName(portfolioLanguage) === 'english' && reviewedMeta.statement ? { artistStatement: reviewedMeta.statement } : {}),
      };`
);

fs.writeFileSync(serverPath, server, 'utf8');
fs.writeFileSync(appPath, app, 'utf8');

console.log('Language enforcement patched.');
console.log('Server:', serverPath);
console.log('App:', appPath);
