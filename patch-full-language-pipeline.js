const fs = require('fs');

const serverPath = '.\\backend\\server.js';
const appPath = '.\\src\\App.js';

if (!fs.existsSync(serverPath)) throw new Error('backend/server.js not found');
if (!fs.existsSync(appPath)) throw new Error('src/App.js not found');

let server = fs.readFileSync(serverPath, 'utf8');
let app = fs.readFileSync(appPath, 'utf8');

fs.writeFileSync(serverPath + '.backup.full-language-pipeline-' + Date.now(), server, 'utf8');
fs.writeFileSync(appPath + '.backup.full-language-pipeline-' + Date.now(), app, 'utf8');

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

// Frontend labels: selected-language labels must win over partial server labels.
app = app.replace(
  /const labels = \{ \.\.\.getPortfolioLabels\(language\), \.\.\.\(output\.labels \|\| \{\}\) \};/g,
  `const labels = { ...(output.labels || {}), ...getPortfolioLabels(language) };`
);

// Do NOT overwrite translated bio/statement with reviewed English text for non-English output.
app = app.replace(
  /const finalLocalized = \{\s*\n\s*\.\.\.finalLocalizedBase,\s*\n\s*\.\.\.\(reviewedMeta\.bio \? \{ bio: reviewedMeta\.bio \} : \{\}\),\s*\n\s*\.\.\.\(reviewedMeta\.statement \? \{ artistStatement: reviewedMeta\.statement \} : \{\}\),\s*\n\s*\};/g,
  `const finalLocalized = {
        ...finalLocalizedBase,
        ...(languageFamilyName(portfolioLanguage) === 'english' && reviewedMeta.bio ? { bio: reviewedMeta.bio } : {}),
        ...(languageFamilyName(portfolioLanguage) === 'english' && reviewedMeta.statement ? { artistStatement: reviewedMeta.statement } : {}),
      };`
);

const buildLocalizedOutputReplacement = String.raw`
async function buildLocalizedOutput({
  targetLanguage = 'English',
  artistBio = '',
  artistStatement = '',
  projects = [],
  customSections = [],
  skills = [],
  name = '',
  medium = '',
  description = '',
} = {}) {
  const lang = normalizeServerOutputLanguage(targetLanguage || 'English');
  const labels = labelsForLanguage(lang);

  const sourceProjects = sanitizeLocalizedProjects(Array.isArray(projects) ? projects : [], []);
  const sourceSections = sanitizeLocalizedSections(Array.isArray(customSections) ? customSections : [], []);
  const sourceSkills = (Array.isArray(skills) ? skills : [])
    .map(item => cleanText(item))
    .filter(Boolean);

  const base = {
    labels,
    name: cleanText(name),
    medium: cleanText(medium),
    bio: cleanText(artistBio || description),
    artistStatement: cleanText(artistStatement),
    projects: sourceProjects.map((project, index) => ({
      id: cleanText(project.id || 'project-' + (index + 1)),
      title: cleanText(project.title),
      desc: cleanText(project.desc),
      link: cleanText(project.link),
    })),
    customSections: sourceSections.map((section, sectionIndex) => ({
      id: cleanText(section.id || 'section-' + (sectionIndex + 1)),
      name: cleanText(section.name),
      items: (Array.isArray(section.items) ? section.items : []).map((item, itemIndex) => ({
        id: cleanText(item.id || 'item-' + (itemIndex + 1)),
        heading: cleanText(item.heading),
        desc: cleanText(item.desc),
        link: cleanText(item.link),
        media: item.media || null,
      })),
    })),
    skills: sourceSkills,
  };

  if (languageFamily(lang) === 'english') return base;

  const preserveMap = {
    name: base.name,
    projects: base.projects.map(project => ({ id: project.id, link: project.link })),
    customSections: base.customSections.map(section => ({
      id: section.id,
      items: section.items.map(item => ({ id: item.id, link: item.link, media: item.media || null })),
    })),
  };

  const normalizeTranslated = (candidate = {}) => {
    const raw = candidate && typeof candidate === 'object' ? candidate : {};

    const translatedProjects = Array.isArray(raw.projects) ? raw.projects : [];
    const translatedSections = Array.isArray(raw.customSections) ? raw.customSections : [];
    const translatedSkills = Array.isArray(raw.skills) ? raw.skills : [];

    return {
      labels,
      name: cleanText(raw.name || base.name),
      medium: cleanText(raw.medium || base.medium),
      bio: cleanText(raw.bio || base.bio),
      artistStatement: cleanText(raw.artistStatement || base.artistStatement),
      projects: base.projects.map((original, index) => {
        const item = translatedProjects.find(project => String(project.id) === String(original.id)) || translatedProjects[index] || {};
        return {
          id: original.id,
          title: cleanText(item.title || original.title),
          desc: cleanText(item.desc || original.desc),
          link: original.link,
        };
      }),
      customSections: base.customSections.map((originalSection, sectionIndex) => {
        const section = translatedSections.find(item => String(item.id) === String(originalSection.id)) || translatedSections[sectionIndex] || {};
        const translatedItems = Array.isArray(section.items) ? section.items : [];
        return {
          id: originalSection.id,
          name: cleanText(section.name || originalSection.name),
          items: originalSection.items.map((originalItem, itemIndex) => {
            const item = translatedItems.find(entry => String(entry.id) === String(originalItem.id)) || translatedItems[itemIndex] || {};
            return {
              id: originalItem.id,
              heading: cleanText(item.heading || originalItem.heading),
              desc: cleanText(item.desc || originalItem.desc),
              link: originalItem.link,
              media: originalItem.media || null,
            };
          }),
        };
      }),
      skills: sourceSkills.map((skill, index) => cleanText(translatedSkills[index] || skill)).filter(Boolean),
    };
  };

  const looksStillEnglish = (value = '') => {
    const text = cleanText(value).toLowerCase();
    if (!text) return false;
    if (requiresNonLatinScript(lang)) return leaksLatinForTarget(text, lang) || hasUnexpectedScriptForLanguage(text, lang);

    const tokens = text.match(/\b[a-z][a-z']+\b/g) || [];
    if (tokens.length < 5) return false;

    const allowedTech = new Set([
      'react','node','nodejs','express','mongodb','python','java','javascript','typescript','html','css','sql','plsql',
      'github','linkedin','git','api','apis','rest','mern','ai','ml','ui','ux','cv','pdf','nust','seecs','comsats',
      'azure','docker','kubernetes','visual','studio','code','scikit','learn','pytorch','firebase','postgresql',
      'librosa','numpy','pandas','webrtc','aes','kyber'
    ]);

    const englishWords = new Set([
      'the','and','with','for','from','that','this','which','where','while','because','about','through','into','without',
      'student','profile','dedicated','clear','focus','growth','practical','learning','real','world','contribution',
      'computer','science','hands','experience','development','completed','academic','projects','including','system',
      'skilled','seeking','internship','portfolio','highlights','skills','experiences','provided','professional',
      'opportunities','work','works','project','education','responsible','designed','developed','built','created',
      'managed','improved','implemented','knowledge','strong','passionate','career','ready','software','explored',
      'learned','completed','identified','achieved','reduced','optimized','demonstrate','browser','communication'
    ]);

    const englishHits = tokens.filter(token => englishWords.has(token) && !allowedTech.has(token)).length;
    const targetHits = typeof targetLanguageSignalScore === 'function' ? targetLanguageSignalScore(text, lang) : 0;

    return englishHits >= 3 && englishHits >= targetHits + 2;
  };

  const outputNeedsRetry = (out = {}) => {
    const combined = [
      out.medium,
      out.bio,
      out.artistStatement,
      ...(out.projects || []).flatMap(project => [project.title, project.desc]),
      ...(out.customSections || []).flatMap(section => [
        section.name,
        ...((section.items || []).flatMap(item => [item.heading, item.desc])),
      ]),
      ...(out.skills || []),
    ].join(' ');

    return hasUnexpectedScriptForLanguage(combined, lang) || looksLikeWrongEnglishForTarget(combined, lang) || looksStillEnglish(combined);
  };

  const translateOne = async (text = '', kind = 'description') => {
    const clean = cleanText(text);
    if (!clean) return '';
    const translated = await translateTextStrict(clean, lang);
    if (translated && !sameCleanText(translated, clean) && !hasUnexpectedScriptForLanguage(translated, lang) && !looksStillEnglish(translated)) {
      return translated;
    }
    return translated || clean;
  };

  let aiOutput = null;

  if (aiAvailable()) {
    try {
      const aiText = await generateAiText({
        temperature: 0.01,
        maxTokens: 5200,
        messages: [
          {
            role: 'system',
            content:
              'You are MuseForge strict portfolio localizer. ' +
              languageStrictInstruction(lang) +
              ' Return ONLY valid JSON. Translate EVERY user-visible field into ' + lang + '. ' +
              'Translate section names, item headings, project titles, project descriptions, bio, statement, and skill phrases. ' +
              'Preserve unchanged: person names, company names, university names, emails, URLs, phone numbers, GitHub/LinkedIn usernames, programming languages, technology/tool names such as React, Python, Node.js, MongoDB, SQL, GitHub, Azure, Docker. ' +
              'Do not invent facts. Do not remove items. Keep all ids and links exactly.'
          },
          {
            role: 'user',
            content: JSON.stringify({
              targetLanguage: lang,
              portfolio: base,
              preserveExactly: preserveMap,
              requiredShape: {
                labels: 'object',
                name: 'string',
                medium: 'string',
                bio: 'string',
                artistStatement: 'string',
                projects: [{ id: 'same id', title: 'translated title', desc: 'translated description', link: 'same link' }],
                customSections: [{ id: 'same id', name: 'translated section name', items: [{ id: 'same id', heading: 'translated heading', desc: 'translated description', link: 'same link' }] }],
                skills: ['translated skill phrase or preserved tech name']
              }
            }, null, 2)
          }
        ],
      });

      aiOutput = normalizeTranslated(parseJsonObject(aiText || '{}'));
    } catch (error) {
      console.warn('Full localizedOutput JSON translation failed; per-field translation fallback used:', error.message);
    }
  }

  if (aiOutput && !outputNeedsRetry(aiOutput)) return aiOutput;

  const fallback = {
    labels,
    name: base.name,
    medium: await translateOne(base.medium, 'medium'),
    bio: await translateOne(base.bio, 'description'),
    artistStatement: await translateOne(base.artistStatement, 'description'),
    projects: await Promise.all(base.projects.map(async project => ({
      id: project.id,
      title: await translateOne(project.title, 'project'),
      desc: await translateOne(project.desc, 'project'),
      link: project.link,
    }))),
    customSections: await Promise.all(base.customSections.map(async section => ({
      id: section.id,
      name: await translateOne(section.name, 'section'),
      items: await Promise.all((section.items || []).map(async item => ({
        id: item.id,
        heading: await translateOne(item.heading, 'item'),
        desc: await translateOne(item.desc, 'item'),
        link: item.link,
        media: item.media || null,
      }))),
    }))),
    skills: await Promise.all(sourceSkills.map(skill => translateOne(skill, 'item'))),
  };

  return fallback;
}
`;

server = replaceFunction(server, 'buildLocalizedOutput', buildLocalizedOutputReplacement);

fs.writeFileSync(serverPath, server, 'utf8');
fs.writeFileSync(appPath, app, 'utf8');

console.log('FULL language pipeline patched.');
console.log('Server:', serverPath);
console.log('App:', appPath);
