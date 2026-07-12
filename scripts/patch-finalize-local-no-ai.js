const fs = require("fs");
const path = require("path");

const appPath = path.join("src", "App.js");

if (!fs.existsSync(appPath)) {
  throw new Error("src/App.js not found");
}

let app = fs.readFileSync(appPath, "utf8");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

fs.copyFileSync(appPath, appPath + ".bak-finalize-local-no-ai-" + stamp);

if (app.includes("Final portfolio generated locally from reviewed FactLock choices.")) {
  console.log("✅ Local finalizer already installed. No changes needed.");
  process.exit(0);
}

const target = "    setShareUrl('');\n    setShareStatus('');\n    try {";

const insert = `    setShareUrl('');
    setShareStatus('');

    // Finalize locally from reviewed FactLock choices.
    // This avoids a second AI/backend /generate call after the user has already reviewed and locked content.
    const cleanFinalSectionText = (value = '') => stripAiReasoningClient(value)
      .replace(/^#{1,6}\\s+(Artist Bio|Bio|Artist Statement|Professional Statement|Statement)\\s*/i, '')
      .replace(/\\n#{1,6}\\s+(Artist Bio|Bio|Artist Statement|Professional Statement|Statement)\\s*/gi, '\\n')
      .replace(/^["']|["']$/g, '')
      .trim();

    const fallbackLocalized = normalizeLocalizedOutput({}, {
      language: portfolioLanguage,
      name,
      medium,
      projects: reviewedProjects,
      customSections: reviewedCustomSections,
      skills,
    });

    const existingLocalizedBase = normalizeLocalizedOutput(localizedOutput || {}, fallbackLocalized);

    const finalBio = cleanFinalSectionText(
      reviewedMeta.bio ||
      existingLocalizedBase.bio ||
      existingLocalizedBase.description ||
      description ||
      ''
    );

    const finalStatement = cleanFinalSectionText(
      reviewedMeta.statement ||
      existingLocalizedBase.artistStatement ||
      existingLocalizedBase.statement ||
      description ||
      ''
    );

    const finalLocalized = {
      ...existingLocalizedBase,
      bio: finalBio,
      artistStatement: finalStatement,
    };

    setProjects(reviewedProjects);
    setCustomSections(reviewedCustomSections);
    setLocalizedOutput(finalLocalized);

    const finalPortfolioText = \`## \${getBioHeading(selectedCreatorType, CREATOR_TYPES[selectedCreatorType]?.label || '')}
\${finalBio}

## \${getStatementHeading(selectedCreatorType, CREATOR_TYPES[selectedCreatorType]?.label || '')}
\${finalStatement}\`.trim();

    setPortfolio(finalPortfolioText);
    setPortfolioReady(Boolean(finalPortfolioText));

    if (finalPortfolioText) {
      savePortfolioVersion('Reviewed portfolio', finalPortfolioText, portfolioLanguage, {
        localizedOutput: finalLocalized,
        projects: reviewedProjects,
        customSections: reviewedCustomSections,
        skills,
        contact,
        exportSettings,
        imagePreview,
        imagePosition,
      });
    }

    setGenerationNotice('Final portfolio generated locally from reviewed FactLock choices.');
    setLoading(false);
    return;

    try {`;

if (!app.includes(target)) {
  throw new Error("Could not find finalizeReviewedPortfolio insertion point.");
}

app = app.replace(target, insert);

fs.writeFileSync(appPath, app, "utf8");

console.log("✅ Final portfolio now generates locally after FactLock.");
console.log("✅ No second AI call after reviewed choices.");
console.log("✅ Groq quota/rate-limit will not block final Generate Portfolio.");
console.log("✅ Only src/App.js touched.");
console.log("Backup created: " + appPath + ".bak-finalize-local-no-ai-" + stamp);
