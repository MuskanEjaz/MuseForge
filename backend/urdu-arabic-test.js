'use strict';
// Urdu and Arabic share the Unicode block U+0600–U+06FF. The one thing that can silently ruin
// either language is the model answering in the OTHER one and a naive script check waving it
// through. This suite exists purely to make that impossible.
process.env.AI_PROVIDER = 'groq';
process.env.GROQ_API_KEY = 'test-key';
process.env.AI_PROVIDER_COOLDOWN_MS = '0';

const assert = require('assert');
const { __test } = require('./server.js');
const express = require('express');
const { hasRequiredScript, hasUnexpectedScriptForLanguage, regenerationIsStrongEnough,
        buildLocalizedOutput, labelsForLanguage } = __test;

const generate = express.__lastApp.__routes['POST /generate'];

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
};
const checkAsync = async (name, fn) => {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
};

const ARABIC = 'أنا مصور فوتوغرافي وألتقط صورًا للأسواق القديمة في المدينة، وأحرص على إبراز التفاصيل.';
const URDU   = 'میں ایک فوٹوگرافر ہوں اور پرانی عمارتوں کی تصاویر بناتی ہوں، اور ہر تصویر میں تفصیل پر توجہ دیتی ہوں۔';

(async () => {
  console.log('\n== Urdu / Arabic separation (they share one Unicode block) ==');

  check('Arabic prose is REJECTED when the target is Urdu', () => {
    assert.strictEqual(hasRequiredScript(ARABIC, 'Urdu'), false);
    assert.strictEqual(hasUnexpectedScriptForLanguage(ARABIC, 'Urdu'), true);
  });

  check('Urdu prose is REJECTED when the target is Arabic', () => {
    assert.strictEqual(hasRequiredScript(URDU, 'Arabic'), false);
    assert.strictEqual(hasUnexpectedScriptForLanguage(URDU, 'Arabic'), true);
  });

  check('Urdu prose is ACCEPTED for Urdu; Arabic prose is ACCEPTED for Arabic', () => {
    assert.strictEqual(hasRequiredScript(URDU, 'Urdu'), true);
    assert.strictEqual(hasRequiredScript(ARABIC, 'Arabic'), true);
    assert.strictEqual(hasUnexpectedScriptForLanguage(URDU, 'Urdu'), false);
    assert.strictEqual(hasUnexpectedScriptForLanguage(ARABIC, 'Arabic'), false);
  });

  check('English prose is REJECTED for both Urdu and Arabic', () => {
    const en = 'I am a photographer and I take pictures of old buildings in the city.';
    assert.strictEqual(hasUnexpectedScriptForLanguage(en, 'Urdu'), true);
    assert.strictEqual(hasUnexpectedScriptForLanguage(en, 'Arabic'), true);
  });

  check('a regeneration that came back in Arabic is rejected for an Urdu target', () => {
    const strong = regenerationIsStrongEnough(ARABIC + ' ' + ARABIC, {
      isProject: true, targetLanguage: 'Urdu',
      originalDesc: 'I photograph old buildings.', title: 'Old City',
    });
    assert.strictEqual(strong, false, 'Arabic text passed the Urdu regeneration gate');
  });

  check('a regeneration that came back in Urdu is rejected for an Arabic target', () => {
    const strong = regenerationIsStrongEnough(URDU + ' ' + URDU, {
      isProject: true, targetLanguage: 'Arabic',
      originalDesc: 'I photograph old buildings.', title: 'Old City',
    });
    assert.strictEqual(strong, false, 'Urdu text passed the Arabic regeneration gate');
  });

  console.log('\n== Deterministic Urdu / Arabic output (works with NO model at all) ==');

  for (const lang of ['Urdu', 'Arabic']) {
    // eslint-disable-next-line no-await-in-loop
    await checkAsync(`${lang}: headings, labels and medium are correct with no AI provider`, async () => {
      const out = await buildLocalizedOutput({
        targetLanguage: lang,
        artistBio: 'Bio text.', artistStatement: 'Statement text.',
        projects: [{ id: 'p1', title: 'Old City', desc: 'I photographed 20 old buildings.' }],
        customSections: [
          { name: 'Education', items: [{ heading: 'NCA Lahore', desc: 'BFA, 2020-2024' }] },
          { name: 'Awards', items: [{ heading: 'Best Photo', desc: 'Recognised at a campus show.' }] },
          { name: 'Languages', items: [{ heading: 'English', desc: '' }] },
        ],
        skills: ['Photography'], name: 'Sana Malik', medium: 'Photography', description: 'x',
      });

      const labels = labelsForLanguage(lang);
      assert.notStrictEqual(labels.skills, 'Skills', `${lang} labels fell back to English`);

      out.customSections.forEach(section => {
        assert.ok(hasRequiredScript(section.name, lang), `heading not in ${lang}: "${section.name}"`);
        assert.ok(!hasUnexpectedScriptForLanguage(section.name, lang), `wrong script heading: "${section.name}"`);
        assert.ok(section.name.split(/\s+/).length <= 6, `heading became a sentence: "${section.name}"`);
      });

      assert.ok(hasRequiredScript(out.medium, lang), `medium not in ${lang}: "${out.medium}"`);
      assert.ok(hasRequiredScript(out.bio, lang), `bio not in ${lang}`);
      assert.ok(hasRequiredScript(out.artistStatement, lang), `statement not in ${lang}`);
      assert.ok(hasRequiredScript(out.projects[0].desc, lang), `project desc not in ${lang}`);
    });
  }

  console.log('\n== Full /generate: a model that answers in the WRONG one of the two ==');

  for (const target of ['Urdu', 'Arabic']) {
    const wrong = target === 'Urdu' ? ARABIC : URDU;
    // The model stubbornly replies in the sibling language every single time.
    global.__MOCK_AI__ = async (messages) => {
      const prompt = messages.map(m => String(m.content || '')).join('\n');
      if (/translate SHORT portfolio headings/i.test(prompt)) return wrong.split(/\s+/).slice(0, 3).join(' ');
      if (/Return only the two markdown sections/i.test(prompt)) {
        return `## Artist Bio\n${wrong} ${wrong}\n\n## Artist Statement\n${wrong} ${wrong}`;
      }
      if (/"projects"\s*:/.test(prompt)) return JSON.stringify({ projects: [{ id: 'p1', desc: `${wrong} ${wrong}` }] });
      return `${wrong} ${wrong}`;
    };

    // eslint-disable-next-line no-await-in-loop
    await checkAsync(`${target}: a model replying in the sibling language never reaches the user`, async () => {
      const data = await new Promise((resolve) => {
        const res = { status() { return this; }, json(d) { resolve(d); } };
        generate({
          body: {
            name: 'Sana Malik', medium: 'Photography',
            description: 'I photograph old buildings.',
            projects: [{ id: 'p1', title: 'Old City', desc: 'I photographed 20 old buildings.' }],
            projectList: ['Old City'],
            customSections: [{ id: 's1', name: 'Awards', items: [{ id: 'i1', heading: 'Best Photo', desc: 'Recognised at a show.' }] }],
            skills: ['Photography'], contact: { email: 'x@y.com' }, creatorType: 'photographer',
            enhanceProjectDescriptions: true, targetLanguage: target, aiTone: 'Professional',
          },
        }, res).catch(() => resolve({}));
      });

      const out = data.localizedOutput || {};
      const strings = [out.bio, out.artistStatement, out.medium,
        ...(out.projects || []).map(p => p.desc),
        ...(out.customSections || []).map(s => s.name),
      ].filter(Boolean);

      assert.ok(strings.length, 'no output produced');
      strings.forEach(text => {
        assert.ok(!hasUnexpectedScriptForLanguage(text, target),
          `sibling-language text reached the user for ${target}: "${String(text).slice(0, 45)}"`);
        assert.ok(hasRequiredScript(text, target),
          `output is not in ${target}: "${String(text).slice(0, 45)}"`);
      });
    });
  }

  console.log(`\n${pass} passed, ${fail} failed.\n`);
  process.exitCode = fail ? 1 : 0;
})();
