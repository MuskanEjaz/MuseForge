'use strict';
/**
 * Tests the /suggest-projects handler logic in isolation, with mocked server internals.
 * The handler body here is IDENTICAL to the snippet delivered for server.js — same logic,
 * only the dependencies are injected so we can test without booting the whole server.
 *
 *   node test-suggest-projects.js
 */
const assert = require('assert');

// --- factory: identical body to the delivered route, deps injected for testing ---
function makeSuggestProjectsHandler({ generateAiText, parseJsonObject, cleanText, fallbackProjectSuggestions, log = () => {} }) {
  return async (req, res) => {
    try {
      const body = req.body || {};
      const name = cleanText(body.name || '');
      const medium = cleanText(body.medium || '');
      const description = cleanText(body.description || '');
      const targetLanguage = cleanText(body.targetLanguage || 'English') || 'English';
      const existing = Array.isArray(body.projects)
        ? body.projects.map(p => cleanText(p && p.title)).filter(Boolean)
        : [];

      try {
        const existingLine = existing.length
          ? `The creator already has these projects (do not repeat them): ${existing.join('; ')}.`
          : '';
        const aiText = await generateAiText({
          messages: [
            {
              role: 'system',
              content:
                'You suggest portfolio project ideas for a creative professional. ' +
                'Return ONLY valid JSON in this exact shape: ' +
                '{"suggestions":[{"title":"","desc":""},{"title":"","desc":""},{"title":"","desc":""}]}. ' +
                'Provide exactly 3 suggestions. Each "title" is short (2-5 words). Each "desc" is one or two ' +
                'sentences telling the creator what to include. Write everything in ' + targetLanguage + '. ' +
                'Do not invent facts about the creator; only propose ideas they could build. No text outside the JSON.',
            },
            {
              role: 'user',
              content:
                'Creator name: ' + (name || 'A creator') + '\n' +
                'Medium / field: ' + (medium || 'general creative work') + '\n' +
                'About them: ' + (description || '(not provided)') + '\n' +
                existingLine,
            },
          ],
          temperature: 0.4,
          maxTokens: 600,
        });

        const parsed = parseJsonObject(aiText);
        const suggestions = Array.isArray(parsed && parsed.suggestions) ? parsed.suggestions : [];
        const cleanSuggestions = suggestions
          .map(s => ({ title: cleanText(s && s.title), desc: cleanText(s && s.desc) }))
          .filter(s => s.title && s.desc)
          .slice(0, 3);

        if (cleanSuggestions.length) {
          return res.json({ suggestions: cleanSuggestions });
        }
      } catch (aiError) {
        log('suggest-projects: AI path failed, using fallback:', aiError.message);
      }

      return res.json({ suggestions: fallbackProjectSuggestions({ medium, description, targetLanguage }) });
    } catch (error) {
      return res.json({
        suggestions: fallbackProjectSuggestions({
          medium: cleanText((req.body || {}).medium || ''),
          description: cleanText((req.body || {}).description || ''),
          targetLanguage: cleanText((req.body || {}).targetLanguage || 'English') || 'English',
        }),
      });
    }
  };
}

// --- mocks ---
const cleanText = (v = '') => String(v || '').replace(/\s+/g, ' ').trim();
const fallbackProjectSuggestions = ({ medium = '' }) => ([
  { title: 'Fallback A', desc: 'Fallback description A for ' + (medium || 'creative') + '.' },
  { title: 'Fallback B', desc: 'Fallback description B.' },
  { title: 'Fallback C', desc: 'Fallback description C.' },
]);
const parseJsonObject = (raw = '') => {
  const cleaned = String(raw).replace(/```json|```/gi, '').trim();
  try { return JSON.parse(cleaned); }
  catch (_) {
    const s = cleaned.indexOf('{'); const e = cleaned.lastIndexOf('}');
    if (s >= 0 && e > s) return JSON.parse(cleaned.slice(s, e + 1));
    throw new Error('AI returned invalid JSON');
  }
};

let passed = 0;
const ok = (l) => { console.log('  PASS  ' + l); passed += 1; };
const run = (handler, body) => new Promise((resolve) => {
  const res = { json: (payload) => resolve(payload) };
  handler({ body }, res);
});

(async () => {
  // 1. AI returns valid JSON with 3 suggestions -> those are returned
  {
    const generateAiText = async () => '{"suggestions":[{"title":"T1","desc":"D1"},{"title":"T2","desc":"D2"},{"title":"T3","desc":"D3"}]}';
    const handler = makeSuggestProjectsHandler({ generateAiText, parseJsonObject, cleanText, fallbackProjectSuggestions });
    const out = await run(handler, { name: 'Ayesha', medium: 'design', targetLanguage: 'English' });
    assert.strictEqual(out.suggestions.length, 3, '3 suggestions');
    assert.strictEqual(out.suggestions[0].title, 'T1', 'AI suggestion used');
    ok('valid AI JSON -> returns AI suggestions');
  }

  // 2. AI returns garbage -> fallback
  {
    const generateAiText = async () => 'sorry, here are some ideas but not json';
    const handler = makeSuggestProjectsHandler({ generateAiText, parseJsonObject, cleanText, fallbackProjectSuggestions });
    const out = await run(handler, { medium: 'music' });
    assert.strictEqual(out.suggestions[0].title, 'Fallback A', 'fell back on garbage');
    assert.ok(out.suggestions[0].desc.includes('music'), 'fallback used medium');
    ok('garbage AI output -> falls back gracefully');
  }

  // 3. AI throws -> fallback
  {
    const generateAiText = async () => { throw new Error('watsonx timeout'); };
    const handler = makeSuggestProjectsHandler({ generateAiText, parseJsonObject, cleanText, fallbackProjectSuggestions });
    const out = await run(handler, { medium: 'developer' });
    assert.strictEqual(out.suggestions.length, 3, 'fallback has 3');
    assert.strictEqual(out.suggestions[0].title, 'Fallback A', 'fell back on throw');
    ok('AI throws -> falls back gracefully (button never dies)');
  }

  // 4. AI returns valid JSON but empty suggestions -> fallback
  {
    const generateAiText = async () => '{"suggestions":[]}';
    const handler = makeSuggestProjectsHandler({ generateAiText, parseJsonObject, cleanText, fallbackProjectSuggestions });
    const out = await run(handler, { medium: 'art' });
    assert.strictEqual(out.suggestions[0].title, 'Fallback A', 'empty -> fallback');
    ok('empty AI suggestions -> falls back');
  }

  // 5. response shape always { suggestions: [{title, desc}] }
  {
    const generateAiText = async () => '{"suggestions":[{"title":"Only","desc":"One","extra":"ignored"}]}';
    const handler = makeSuggestProjectsHandler({ generateAiText, parseJsonObject, cleanText, fallbackProjectSuggestions });
    const out = await run(handler, {});
    assert.ok(Array.isArray(out.suggestions), 'suggestions is array');
    for (const s of out.suggestions) {
      assert.deepStrictEqual(Object.keys(s).sort(), ['desc', 'title'], 'each item is exactly {title, desc}');
    }
    ok('response is always { suggestions: [{title, desc}] } (matches App.js expectation)');
  }

  console.log('\n  ALL ' + passed + ' CHECKS PASSED');
})().catch((e) => { console.error('  FAIL ', e.message); process.exit(1); });
