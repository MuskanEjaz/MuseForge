const fs = require("fs");
const path = require("path");

const appPath = path.join("src", "App.js");
const serverPath = path.join("backend", "server.js");

if (!fs.existsSync(appPath)) throw new Error("src/App.js not found. Run this from MuseForge project root.");
if (!fs.existsSync(serverPath)) throw new Error("server.js not found. Run this from MuseForge project root.");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.copyFileSync(appPath, `${appPath}.bak-${stamp}`);
fs.copyFileSync(serverPath, `${serverPath}.bak-${stamp}`);

let app = fs.readFileSync(appPath, "utf8");
let server = fs.readFileSync(serverPath, "utf8");

const LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Portuguese",
  "Dutch",
  "Turkish",
  "Arabic",
  "Chinese",
  "Japanese",
  "Korean",
  "Russian",
  "Indonesian",
  "Vietnamese"
];

const languageArray = LANGUAGES.map(lang => `  '${lang}'`).join(",\n");

function mustReplace(source, regex, replacement, label) {
  if (!regex.test(source)) {
    throw new Error(`Patch target not found: ${label}`);
  }
  return source.replace(regex, replacement);
}

/* =========================
   FRONTEND: App.js
   ========================= */

app = mustReplace(
  app,
  /const LANGUAGE_OPTIONS = \[[\s\S]*?\];/,
  `const LANGUAGE_OPTIONS = [\n${languageArray}\n];`,
  "LANGUAGE_OPTIONS"
);

app = mustReplace(
  app,
  /const isSupportedOutputLanguage = \(language = ''\) => LANGUAGE_OPTIONS\.includes\(String\(language \|\| ''\)\.trim\(\)\);/,
  `const normalizeClientOutputLanguage = (language = '') => {
  const clean = String(language || '').trim();
  return LANGUAGE_OPTIONS.find(item => item.toLowerCase() === clean.toLowerCase()) || 'English';
};

const isSupportedOutputLanguage = (language = '') =>
  LANGUAGE_OPTIONS.some(item => item.toLowerCase() === String(language || '').trim().toLowerCase());`,
  "frontend language normalizer"
);

/* Add missing German labels because App already has most other extra labels. */
if (!app.includes("COMPETITION_MINIMAL_PORTFOLIO_LABELS")) {
  app = mustReplace(
    app,
    /Object\.entries\(EXTRA_PORTFOLIO_LABELS\)\.forEach\(\(\[language, labels\]\) => \{\n\s*PORTFOLIO_LABELS\[language\] = \{ \.\.\.PORTFOLIO_LABELS\.English, \.\.\.labels \};\n\}\);/,
    match => `${match}

const COMPETITION_MINIMAL_PORTFOLIO_LABELS = {
  German: {
    contact: 'Kontakt',
    linkedin: 'LinkedIn',
    github: 'GitHub',
    phone: 'Telefon',
    email: 'E-Mail',
    location: 'Standort',
    skills: 'Fähigkeiten',
    projects: 'Projekte',
    artistBio: 'Biografie',
    artistStatement: 'Künstlerisches Statement',
    technicalSkills: 'Technische Fähigkeiten',
    about: 'Über mich',
    statement: 'Statement',
    factLockTrustReport: 'FactLock-Vertrauensbericht',
    trustSubtitle: 'Messbarer Nachweis, dass die KI-Verbesserung überprüfbar und faktenbasiert ist.',
    yourPortfolio: 'Dein Portfolio',
    copyPortfolio: 'Portfolio kopieren',
    copied: 'Kopiert',
    exportHtml: 'HTML exportieren',
    createShareLink: 'Öffentlichen Link erstellen',
    projectsReviewed: 'Geprüfte Projekte',
    enhancedInUse: 'Verwendete Verbesserungen',
    originalKept: 'Original beibehalten',
    unsupportedFactsDetected: 'Nicht belegte Fakten',
    inputLanguage: 'Eingabesprache',
    outputLanguage: 'Ausgabesprache',
    shareLinkCreated: 'Link erstellt',
    yes: 'Ja',
    no: 'Nein',
  },
};

Object.entries(COMPETITION_MINIMAL_PORTFOLIO_LABELS).forEach(([language, labels]) => {
  PORTFOLIO_LABELS[language] = { ...PORTFOLIO_LABELS.English, ...labels };
});`,
    "German labels"
  );
}

/* Strong generic fallback for all 15 languages, so sections do not fall back to English silently. */
const frontendGenericLocalized = `const frontendGenericLocalized = (language = 'English', kind = 'description') => {
  const family = languageFamilyName(normalizeClientOutputLanguage(language));
  const map = {
    english: { medium:'Creative Portfolio', description:'This section presents the creator’s supplied information in clear professional English while preserving the original facts.', project:'This project presents the creator’s supplied work in clear professional English.', section:'Additional Section', item:'Additional Detail' },
    spanish: { medium:'Campo creativo', description:'Esta sección presenta la información proporcionada por el creador de forma clara, profesional y fiel a los hechos originales.', project:'Este proyecto presenta el trabajo proporcionado por el creador de forma clara y organizada.', section:'Sección adicional', item:'Detalle adicional' },
    french: { medium:'Domaine créatif', description:'Cette section présente les informations fournies par le créateur de manière claire, professionnelle et fidèle aux faits d’origine.', project:'Ce projet présente le travail fourni par le créateur de façon claire et organisée.', section:'Section supplémentaire', item:'Détail supplémentaire' },
    german: { medium:'Kreatives Feld', description:'Dieser Abschnitt stellt die vom Creator bereitgestellten Informationen klar, professionell und faktengetreu dar.', project:'Dieses Projekt präsentiert die bereitgestellte Arbeit klar und strukturiert.', section:'Zusätzlicher Abschnitt', item:'Zusätzliches Detail' },
    italian: { medium:'Ambito creativo', description:'Questa sezione presenta le informazioni fornite dal creator in modo chiaro, professionale e fedele ai fatti originali.', project:'Questo progetto presenta il lavoro fornito dal creator in modo chiaro e organizzato.', section:'Sezione aggiuntiva', item:'Dettaglio aggiuntivo' },
    portuguese: { medium:'Área criativa', description:'Esta seção apresenta as informações fornecidas pelo criador de forma clara, profissional e fiel aos fatos originais.', project:'Este projeto apresenta o trabalho fornecido pelo criador de forma clara e organizada.', section:'Seção adicional', item:'Detalhe adicional' },
    dutch: { medium:'Creatief vakgebied', description:'Deze sectie presenteert de door de maker aangeleverde informatie helder, professioneel en trouw aan de oorspronkelijke feiten.', project:'Dit project presenteert het aangeleverde werk duidelijk en gestructureerd.', section:'Extra sectie', item:'Extra detail' },
    turkish: { medium:'Yaratıcı alan', description:'Bu bölüm, kullanıcının sağladığı bilgileri özgün gerçeklere bağlı kalarak açık ve profesyonel biçimde sunar.', project:'Bu proje, kullanıcının sağladığı çalışmayı açık ve düzenli biçimde sunar.', section:'Ek bölüm', item:'Ek ayrıntı' },
    arabic: { medium:'مجال إبداعي', description:'يعرض هذا القسم المعلومات التي قدّمها المستخدم بأسلوب واضح ومهني يحافظ على الحقائق الأصلية.', project:'يعرض هذا المشروع فكرة قدّمها المستخدم بطريقة واضحة ومنظمة.', section:'قسم إضافي', item:'تفصيل إضافي' },
    chinese: { medium:'创意领域', description:'本部分以清晰、专业的方式呈现用户提供的信息，并保持原始事实。', project:'该项目以清晰、有条理的方式展示用户提供的作品。', section:'附加部分', item:'附加说明' },
    japanese: { medium:'クリエイティブ分野', description:'このセクションは、ユーザーが提供した情報を事実に基づいて明確かつ専門的に示します。', project:'このプロジェクトは、ユーザーが提供した作品を明確で整理された形で紹介します。', section:'追加セクション', item:'追加詳細' },
    korean: { medium:'창작 분야', description:'이 섹션은 사용자가 제공한 정보를 원래 사실에 맞게 명확하고 전문적으로 보여줍니다.', project:'이 프로젝트는 사용자가 제공한 작업을 명확하고 체계적으로 보여줍니다.', section:'추가 섹션', item:'추가 설명' },
    russian: { medium:'Творческая область', description:'Этот раздел ясно и профессионально представляет информацию, предоставленную пользователем, сохраняя исходные факты.', project:'Этот проект ясно и структурированно представляет работу, предоставленную пользователем.', section:'Дополнительный раздел', item:'Дополнительная деталь' },
    indonesian: { medium:'Bidang kreatif', description:'Bagian ini menyajikan informasi yang diberikan kreator secara jelas, profesional, dan tetap sesuai fakta asli.', project:'Proyek ini menyajikan karya yang diberikan kreator secara jelas dan terstruktur.', section:'Bagian tambahan', item:'Detail tambahan' },
    vietnamese: { medium:'Lĩnh vực sáng tạo', description:'Phần này trình bày thông tin do người sáng tạo cung cấp một cách rõ ràng, chuyên nghiệp và giữ nguyên các sự thật ban đầu.', project:'Dự án này trình bày công việc do người sáng tạo cung cấp một cách rõ ràng và có tổ chức.', section:'Phần bổ sung', item:'Chi tiết bổ sung' },
  };
  return map[family]?.[kind] || map.english[kind] || '';
};`;

app = mustReplace(
  app,
  /const frontendGenericLocalized = \(language = 'English', kind = 'description'\) => \{[\s\S]*?\n\};\n\n\nconst hasUnexpectedScriptForLanguage/,
  `${frontendGenericLocalized}\n\n\nconst hasUnexpectedScriptForLanguage`,
  "frontendGenericLocalized"
);

/* Make frontend reject unchanged English/source text for non-English output. */
const safeClientLocalized = `const safeClientLocalized = (candidate = '', fallback = '', language = 'English', kind = 'description') => {
  const cleanCandidate = stripAiReasoningClient(candidate);
  const cleanFallback = stripAiReasoningClient(fallback);
  const normalizedLanguage = normalizeClientOutputLanguage(language);
  const family = languageFamilyName(normalizedLanguage);
  const localizedFallback = localizeClientText(cleanFallback, normalizedLanguage);
  const candidateSameAsFallback = cleanCandidate && cleanFallback && textKey(cleanCandidate) === textKey(cleanFallback);

  if (family === 'english') {
    if (cleanCandidate && !hasUnexpectedScriptForLanguage(cleanCandidate, normalizedLanguage)) return cleanCandidate;
    return cleanFallback || '';
  }

  if (
    cleanCandidate &&
    !candidateSameAsFallback &&
    !hasUnexpectedScriptForLanguage(cleanCandidate, normalizedLanguage) &&
    !frontendLooksLikeWrongEnglishForTarget(cleanCandidate, normalizedLanguage)
  ) return cleanCandidate;

  if (
    localizedFallback &&
    !hasUnexpectedScriptForLanguage(localizedFallback, normalizedLanguage) &&
    !frontendLooksLikeWrongEnglishForTarget(localizedFallback, normalizedLanguage) &&
    textKey(localizedFallback) !== textKey(cleanFallback)
  ) return localizedFallback;

  return frontendGenericLocalized(normalizedLanguage, kind) || localizedFallback || '';
};`;

app = mustReplace(
  app,
  /const safeClientLocalized = \(candidate = '', fallback = '', language = 'English', kind = 'description'\) => \{[\s\S]*?\n\};\n\n\nconst textKey/,
  `${safeClientLocalized}\n\n\nconst textKey`,
  "safeClientLocalized"
);

/* =========================
   BACKEND: server.js
   ========================= */

const activeBlock = `const ACTIVE_OUTPUT_LANGUAGES = new Set([
${languageArray}
]);

function normalizeOutputLanguageName(value = 'English') {
  const clean = String(value || '').trim();
  const aliases = new Map([
    ['simplified chinese', 'Chinese'],
    ['mandarin', 'Chinese'],
    ['bahasa indonesia', 'Indonesian'],
    ['brazilian portuguese', 'Portuguese'],
    ['portuguese brazilian', 'Portuguese'],
  ]);
  const direct = [...ACTIVE_OUTPUT_LANGUAGES].find(item => item.toLowerCase() === clean.toLowerCase());
  return direct || aliases.get(clean.toLowerCase()) || 'English';
}

function normalizeServerOutputLanguage(value = 'English') {
  return normalizeOutputLanguageName(value);
}`;

server = mustReplace(
  server,
  /const ACTIVE_OUTPUT_LANGUAGES = new Set\(\[[\s\S]*?\]\);\n\nfunction normalizeServerOutputLanguage\(value = 'English'\) \{[\s\S]*?\n\}/,
  activeBlock,
  "ACTIVE_OUTPUT_LANGUAGES"
);

/* Stronger server generic fallback for all 15 languages. */
const serverGenericStrict = `function genericLocalizedText(targetLanguage = 'English', kind = 'description') {
  const family = languageFamily(normalizeServerOutputLanguage(targetLanguage));
  const text = {
    english: { medium:'Creative Portfolio', description:'This section presents the creator’s supplied information in clear professional English while preserving the original facts.', project:'This project presents the creator’s supplied work in clear professional English.', section:'Additional Section', item:'Additional Detail' },
    spanish: { medium:'Campo creativo', description:'Esta sección presenta la información proporcionada por el creador de forma clara, profesional y fiel a los hechos originales.', project:'Este proyecto presenta el trabajo proporcionado por el creador de forma clara y organizada.', section:'Sección adicional', item:'Detalle adicional' },
    french: { medium:'Domaine créatif', description:'Cette section présente les informations fournies par le créateur de manière claire, professionnelle et fidèle aux faits d’origine.', project:'Ce projet présente le travail fourni par le créateur de façon claire et organisée.', section:'Section supplémentaire', item:'Détail supplémentaire' },
    german: { medium:'Kreatives Feld', description:'Dieser Abschnitt stellt die vom Creator bereitgestellten Informationen klar, professionell und faktengetreu dar.', project:'Dieses Projekt präsentiert die bereitgestellte Arbeit klar und strukturiert.', section:'Zusätzlicher Abschnitt', item:'Zusätzliches Detail' },
    italian: { medium:'Ambito creativo', description:'Questa sezione presenta le informazioni fornite dal creator in modo chiaro, professionale e fedele ai fatti originali.', project:'Questo progetto presenta il lavoro fornito dal creator in modo chiaro e organizzato.', section:'Sezione aggiuntiva', item:'Dettaglio aggiuntivo' },
    portuguese: { medium:'Área criativa', description:'Esta seção apresenta as informações fornecidas pelo criador de forma clara, profissional e fiel aos fatos originais.', project:'Este projeto apresenta o trabalho fornecido pelo criador de forma clara e organizada.', section:'Seção adicional', item:'Detalhe adicional' },
    dutch: { medium:'Creatief vakgebied', description:'Deze sectie presenteert de door de maker aangeleverde informatie helder, professioneel en trouw aan de oorspronkelijke feiten.', project:'Dit project presenteert het aangeleverde werk duidelijk en gestructureerd.', section:'Extra sectie', item:'Extra detail' },
    turkish: { medium:'Yaratıcı alan', description:'Bu bölüm, kullanıcının sağladığı bilgileri özgün gerçeklere bağlı kalarak açık ve profesyonel biçimde sunar.', project:'Bu proje, kullanıcının sağladığı çalışmayı açık ve düzenli biçimde sunar.', section:'Ek bölüm', item:'Ek ayrıntı' },
    arabic: { medium:'مجال إبداعي', description:'يعرض هذا القسم المعلومات التي قدّمها المستخدم بأسلوب واضح ومهني يحافظ على الحقائق الأصلية.', project:'يعرض هذا المشروع فكرة قدّمها المستخدم بطريقة واضحة ومنظمة.', section:'قسم إضافي', item:'تفصيل إضافي' },
    chinese: { medium:'创意领域', description:'本部分以清晰、专业的方式呈现用户提供的信息，并保持原始事实。', project:'该项目以清晰、有条理的方式展示用户提供的作品。', section:'附加部分', item:'附加说明' },
    japanese: { medium:'クリエイティブ分野', description:'このセクションは、ユーザーが提供した情報を事実に基づいて明確かつ専門的に示します。', project:'このプロジェクトは、ユーザーが提供した作品を明確で整理された形で紹介します。', section:'追加セクション', item:'追加詳細' },
    korean: { medium:'창작 분야', description:'이 섹션은 사용자가 제공한 정보를 원래 사실에 맞게 명확하고 전문적으로 보여줍니다.', project:'이 프로젝트는 사용자가 제공한 작업을 명확하고 체계적으로 보여줍니다.', section:'추가 섹션', item:'추가 설명' },
    russian: { medium:'Творческая область', description:'Этот раздел ясно и профессионально представляет информацию, предоставленную пользователем, сохраняя исходные факты.', project:'Этот проект ясно и структурированно представляет работу, предоставленную пользователем.', section:'Дополнительный раздел', item:'Дополнительная деталь' },
    indonesian: { medium:'Bidang kreatif', description:'Bagian ini menyajikan informasi yang diberikan kreator secara jelas, profesional, dan tetap sesuai fakta asli.', project:'Proyek ini menyajikan karya yang diberikan kreator secara jelas dan terstruktur.', section:'Bagian tambahan', item:'Detail tambahan' },
    vietnamese: { medium:'Lĩnh vực sáng tạo', description:'Phần này trình bày thông tin do người sáng tạo cung cấp một cách rõ ràng, chuyên nghiệp và giữ nguyên các sự thật ban đầu.', project:'Dự án này trình bày công việc do người sáng tạo cung cấp một cách rõ ràng và có tổ chức.', section:'Phần bổ sung', item:'Chi tiết bổ sung' },
  };
  return (text[family] && text[family][kind]) || text.english[kind] || '';
}

function strictLocalizeFallback(value = '', targetLanguage = 'English', kind = 'description') {
  const original = cleanText(value);
  const localized = cleanText(localizeBasicTextFallback(original, targetLanguage));
  const family = languageFamily(normalizeServerOutputLanguage(targetLanguage));
  if (!original) return '';
  if (family === 'english' && looksRomanUrdu(original)) return localized || original;
  if (family === 'english') return localized || original;
  if (!requiresNonLatinScript(targetLanguage) && family !== 'roman urdu') {
    if (localized && !sameCleanText(localized, original) && !looksLikeWrongEnglishForTarget(localized, targetLanguage)) return localized;
    return genericLocalizedText(targetLanguage, kind) || '';
  }
  if (localized && !sameCleanText(localized, original) && !leaksLatinForTarget(localized, targetLanguage)) return localized;
  return genericLocalizedText(targetLanguage, kind) || localized || '';
}

function hasUnexpectedScriptForLanguage`;

server = mustReplace(
  server,
  /function genericLocalizedText\(targetLanguage = 'English', kind = 'description'\) \{[\s\S]*?function hasUnexpectedScriptForLanguage/,
  serverGenericStrict,
  "server genericLocalizedText + strictLocalizeFallback"
);

/* Stronger backend AI localization prompt for all sections. */
const localizedPrompt = [
  "content: `You are MuseForge's STRICT full-portfolio localization engine.",
  "",
  "${languageStrictInstruction(lang)}",
  "",
  "OUTPUT CONTRACT:",
  "- Return only valid JSON matching the requested shape.",
  "- Localize every user-visible value into ${lang}: labels, name when the target script needs transliteration, medium, bio, artistStatement, project titles, project descriptions, custom section names, custom item headings, custom item descriptions, and plain-language skills.",
  "- Do not leave English/source-language titles or descriptions unchanged unless they are protected exceptions.",
  "- Protected exceptions only: person names, company/brand names, emails, phone numbers, URLs, GitHub/LinkedIn usernames, programming languages, frameworks, tools, and registered product names.",
  "- Project titles are not automatically protected. Translate by meaning unless they are a real brand/person/product name.",
  "- Preserve IDs and links exactly.",
  "- Never invent facts, metrics, dates, awards, clients, tools, responsibilities, or achievements.",
  "- No markdown, no comments, no explanations.`"
].join("\\n");

server = mustReplace(
  server,
  /content:\s*`Translate or transliterate user-visible portfolio content into \$\{lang\}[\s\S]*?Return only valid JSON\.`/,
  localizedPrompt,
  "buildLocalizedOutput prompt"
);

fs.writeFileSync(appPath, app, "utf8");
fs.writeFileSync(serverPath, server, "utf8");

console.log("✅ Language patch applied.");
console.log("✅ Output languages locked to 15.");
console.log("✅ Urdu, Roman Urdu, and Hindi removed from selectable output languages.");
console.log("✅ Backend localization prompt/fallback strengthened.");
console.log("Backups created:");
console.log(`- ${appPath}.bak-${stamp}`);
console.log(`- ${serverPath}.bak-${stamp}`);

