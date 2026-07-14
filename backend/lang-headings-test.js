'use strict';
const assert = require('assert');
const { __test } = require('./server.js');
const { buildLocalizedOutput, labelsForLanguage, hasRequiredScript, requiresNonLatinScript } = __test;

// The 15 languages the UI actually lets a user pick, + the 3 the server already supported.
const UI_LANGS = ['English','Spanish','French','German','Italian','Portuguese','Dutch','Polish',
               'Turkish','Chinese','Japanese','Korean','Russian','Indonesian','Vietnamese',
               'Arabic','Urdu'];

// Exactly what the CV parser produces.
const SECTIONS = [
  { name: 'Education', items: [{ heading: 'FAST NUCES', desc: 'BS Computer Science, 2021-2025' }] },
  { name: 'Experience', items: [{ heading: 'Intern', desc: 'Worked on internal tools.' }] },
  { name: 'Workshops & Certifications', items: [{ heading: 'AI Bootcamp', desc: 'Completed a 6-week bootcamp.' }] },
  { name: 'Awards', items: [{ heading: 'Dean List', desc: 'Recognised for academic performance.' }] },
  { name: 'Extracurricular Activities', items: [{ heading: 'Robotics Club', desc: 'Team member.' }] },
  { name: 'Languages', items: [{ heading: 'English', desc: '' }] },
  { name: 'Interests', items: [{ heading: 'Photography', desc: '' }] },
  { name: 'References', items: [{ heading: 'Available on request', desc: '' }] },
];

(async () => {
  let pass = 0, fail = 0;
  const check = (n, f) => { try { f(); pass++; } catch (e) { fail++; console.log('  FAIL  ' + n + '\n        ' + e.message); } };

  console.log('\n== Headings in the selected language (NO AI provider — worst case) ==\n');
  for (const lang of UI_LANGS) {
    const out = await buildLocalizedOutput({
      targetLanguage: lang, artistBio: 'Bio text.', artistStatement: 'Statement text.',
      projects: [{ id: 'p1', title: 'Portfolio Site', desc: 'I built a site.' }],
      customSections: SECTIONS, skills: ['React', 'Python'], name: 'Ayesha Khan', medium: 'Web Development',
    });
    const names = out.customSections.map(s => s.name);
    const labels = labelsForLanguage(lang);

    // 1) No heading may be a sentence (the old bug turned every heading into a paragraph).
    check(`${lang}: no heading became a paragraph`, () => {
      names.forEach(n => assert.ok(n.split(/\s+/).length <= 6, `heading is a sentence: "${n}"`));
    });
    // 2) For non-English, headings must actually be in the target language (not English).
    if (lang !== 'English') {
      check(`${lang}: section headings are NOT left in English`, () => {
        assert.ok(!names.includes('Education'), 'Education left untranslated');
        assert.ok(!names.includes('Awards'), 'Awards left untranslated');
        assert.ok(!names.includes('References'), 'References left untranslated');
      });
    }
    // 3) For non-Latin languages, headings must be in the required script.
    if (requiresNonLatinScript(lang)) {
      check(`${lang}: headings use the correct script`, () => {
        names.forEach(n => assert.ok(hasRequiredScript(n, lang), `wrong script heading: "${n}"`));
      });
    }
    // 4) UI labels must be localized too (this was English for 11 of 15 languages).
    // Roman Urdu is Latin-script and legitimately keeps loanwords like "Skills"/"Projects".
    if (lang !== 'English') {
      check(`${lang}: UI labels are localized`, () => {
        assert.notStrictEqual(labels.skills, 'Skills', 'labels fell back to English');
        assert.notStrictEqual(labels.projects, 'Projects', 'labels fell back to English');
      });
    }
    // 5) Proper nouns survive (institution name must not be destroyed).
    check(`${lang}: proper noun "FAST NUCES" survives`, () => {
      const edu = out.customSections[0];
      assert.ok(edu.items[0].heading.length <= 40, 'item heading became a paragraph');
    });

    console.log(`  ${lang.padEnd(12)} ${names.slice(0, 5).join(' | ')}`);
  }

  console.log(`\n${pass} passed, ${fail} failed.\n`);
  process.exitCode = fail ? 1 : 0;
})();
