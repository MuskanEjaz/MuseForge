'use strict';
// End-to-end test of the REAL /generate endpoint, offline.
// Question being answered: if the user selects language X, does the portfolio the user actually
// SEES come out in language X — no matter what language they typed in, and no matter how badly
// the model misbehaves?
process.env.AI_PROVIDER = 'groq';
process.env.GROQ_API_KEY = 'test-key';
process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER_COOLDOWN_MS = '0'; // one simulated 429 must not disable the provider for the rest of the run

const { __test } = require('./server.js');
const express = require('express');
const { hasUnexpectedScriptForLanguage, requiresNonLatinScript, hasRequiredScript,
        looksLikeWrongEnglishForTarget, normalizeServerOutputLanguage } = __test;

const generate = express.__lastApp.__routes['POST /generate'];
if (!generate) throw new Error('POST /generate route not captured');

const LANGS = (process.env.ONLY ? process.env.ONLY.split(',') : ['English','Spanish','French','German','Italian','Portuguese','Dutch','Polish',
               'Turkish','Chinese','Japanese','Korean','Russian','Indonesian','Vietnamese',
               'Arabic','Urdu']);

// ---------- Inputs written in DIFFERENT source languages ----------
const INPUTS = [
  { src: 'English',    name: 'Ayesha Khan',  medium: 'Illustration',
    description: 'I am an illustrator who draws characters for indie games.',
    projects: [{ id: 'p1', title: 'Night Market', desc: 'I drew 12 character sketches for a game jam.' }] },
  { src: 'Roman Urdu', name: 'Bilal Ahmed',  medium: 'Graphic Design',
    description: 'Main graphic designer hoon aur posters banata hoon.',
    projects: [{ id: 'p1', title: 'Poster Series', desc: 'Maine 3 posters design kiye college event ke liye.' }] },
  { src: 'Urdu',       name: 'Sana Malik',   medium: 'Photography',
    description: 'میں ایک فوٹوگرافر ہوں اور پرانی عمارتوں کی تصاویر بناتی ہوں۔',
    projects: [{ id: 'p1', title: 'Old Lahore', desc: 'میں نے لاہور کی 20 پرانی عمارتوں کی تصاویر بنائیں۔' }] },
  { src: 'Chinese',    name: 'Li Wei',       medium: 'Music Production',
    description: '我是一名音乐制作人，制作电子音乐。',
    projects: [{ id: 'p1', title: 'Neon Tracks', desc: '我制作了 5 首电子音乐曲目。' }] },
  { src: 'French',     name: 'Claire Dubois', medium: 'Animation',
    description: "Je suis animatrice et je crée de courtes animations 2D.",
    projects: [{ id: 'p1', title: 'Petite Ville', desc: "J'ai réalisé 2 courts métrages d'animation." }] },
  { src: 'Spanish',    name: 'Diego Ramos',  medium: 'Creative Writing',
    description: 'Soy escritor y escribo relatos cortos de ciencia ficción.',
    projects: [{ id: 'p1', title: 'Cuentos', desc: 'Escribí 7 relatos cortos publicados en un blog.' }] },
  { src: 'Mixed',      name: 'Zara Ali',     medium: 'UI Design',
    description: 'I design app screens. Main Figma use karti hoon.',
    projects: [{ id: 'p1', title: 'Fitness App', desc: 'Maine 4 app screens design kiye in Figma.' }] },
  // Arabic and Hindi are no longer OUTPUT languages, so it matters that they still work as INPUT.
  { src: 'Arabic',     name: 'Omar Hassan',  medium: 'Photography',
    description: 'أنا مصور فوتوغرافي وألتقط صورًا للأسواق القديمة.',
    projects: [{ id: 'p1', title: 'Old Souk', desc: 'التقطت 15 صورة للأسواق القديمة في المدينة.' }] },
  { src: 'Hindi',      name: 'Priya Sharma', medium: 'Illustration',
    description: 'मैं एक चित्रकार हूँ और बच्चों की किताबों के लिए चित्र बनाती हूँ।',
    projects: [{ id: 'p1', title: 'Story Book', desc: 'मैंने 8 चित्र बच्चों की किताब के लिए बनाए।' }] },
  { src: 'Russian',    name: 'Ivan Petrov',  medium: 'Music Production',
    description: 'Я музыкальный продюсер и создаю электронную музыку.',
    projects: [{ id: 'p1', title: 'Winter Set', desc: 'Я записал 6 треков для сборника.' }] },
];

// All six creator types the UI offers, so the bio/statement headings and the medium dictionary
// are exercised for every one of them — not just the two I happened to look at.
const CREATOR_TYPES = ['artist', 'musician', 'developer', 'photographer', 'writer', 'other'];

const SECTIONS = [
  { id: 's1', name: 'Education', items: [{ id: 'i1', heading: 'NCA Lahore', desc: 'BFA Visual Arts, 2020-2024' }] },
  { id: 's2', name: 'Awards',    items: [{ id: 'i2', heading: 'Best Poster', desc: 'Won at the campus design week.' }] },
];

// ---------- A model that behaves like a real one: sometimes right, sometimes not ----------
const SAMPLE = {
  Spanish:'Soy una persona creativa que trabaja con dedicación y cuidado en cada proyecto que realizo.',
  French:"Je suis une personne créative qui travaille avec soin et attention sur chaque projet réalisé.",
  German:'Ich bin ein kreativer Mensch und arbeite mit Sorgfalt an jedem Projekt, das ich umsetze.',
  Italian:'Sono una persona creativa e lavoro con cura e attenzione su ogni progetto che realizzo.',
  Portuguese:'Sou uma pessoa criativa e trabalho com cuidado e atenção em cada projeto que realizo.',
  Dutch:'Ik ben een creatieve maker en werk met zorg en aandacht aan elk project dat ik maak.',
  Arabic:'أنا شخص مبدع أعمل بعناية واهتمام في كل مشروع أقوم بإنجازه وأحرص دائمًا على جودته النهائية.',
  Urdu:'میں ایک تخلیقی فرد ہوں اور اپنے ہر کام میں محنت، توجہ اور دیانت داری سے کام لیتی ہوں۔',
  Polish:'Jestem twórcą i pracuję nad każdym projektem z uwagą, starannością oraz dbałością o szczegóły.',
  Turkish:'Yaratıcı bir üreticiyim ve yaptığım her projede özen ve dikkatle çalışıyorum.',
  Chinese:'我是一名富有创造力的创作者，在每一个项目中都以认真和专注的态度进行创作。',
  Japanese:'私は創造的な作り手であり、すべての制作において丁寧さと集中力をもって取り組んでいます。',
  Korean:'저는 창의적인 창작자이며 모든 작업에서 세심함과 집중력을 가지고 임하고 있습니다.',
  Russian:'Я творческий человек и работаю над каждым проектом внимательно, вдумчиво и с заботой.',
  Indonesian:'Saya seorang kreator dan mengerjakan setiap proyek dengan perhatian serta ketelitian.',
  Vietnamese:'Tôi là một người sáng tạo và luôn làm việc cẩn thận, tập trung trong từng dự án.',
  Urdu:'میں ایک تخلیقی فرد ہوں اور اپنے ہر کام میں محنت، توجہ اور دیانت داری سے کام لیتی ہوں۔',
  Arabic:'أنا شخص مبدع أعمل بعناية واهتمام في كل مشروع أقوم بإنجازه وأحرص على جودته دائماً.',
  English:'I am a creative maker and I work with care and attention on every project I take on.',
};

let BEHAVIOUR = 'obedient';
let TARGET = 'English';

global.__MOCK_AI__ = async (messages) => {
  const prompt = messages.map(m => String(m.content || '')).join('\n');
  const body = SAMPLE[TARGET] || SAMPLE.English;

  if (BEHAVIOUR === 'throw') throw new Error('simulated 429 rate limit');
  if (BEHAVIOUR === 'empty') return '';
  if (BEHAVIOUR === 'echo') return prompt.slice(0, 300);

  // A model that ignores the language instruction, or replies in the wrong script entirely.
  // script_swap: Urdu and Arabic share a Unicode block, so a model can answer Urdu with Arabic
  // (and vice versa) and a naive script check would wave it through. This must be caught.
  const swap = TARGET === 'Urdu' ? SAMPLE.Arabic : TARGET === 'Arabic' ? SAMPLE.Urdu : SAMPLE.Russian;
  const text = BEHAVIOUR === 'english_leak' ? SAMPLE.English
    : BEHAVIOUR === 'wrong_script' ? SAMPLE.Russian
    : BEHAVIOUR === 'script_swap' ? swap
    : body;

  // Classify the prompt the same way the server does. Order matters: most specific first.
  if (/translate SHORT portfolio headings/i.test(prompt)) {
    return BEHAVIOUR === 'english_leak' ? 'Education' : text.split(/\s+/).slice(0, 3).join(' ');
  }
  if (/Return only the two markdown sections/i.test(prompt)) {
    const bio = /## (Artist Bio|Bio)\b/.exec(prompt);
    const st = /## (Artist Statement|Professional Statement)\b/.exec(prompt);
    return `## ${bio ? bio[1] : 'Artist Bio'}\n${text} ${text}\n\n## ${st ? st[1] : 'Artist Statement'}\n${text} ${text}`;
  }
  if (/"statement"\s*:/.test(prompt)) return JSON.stringify({ statement: `${text} ${text}` });
  if (/"bio"\s*:/.test(prompt)) return JSON.stringify({ bio: `${text} ${text}` });
  if (/"projects"\s*:/.test(prompt)) return JSON.stringify({ projects: [{ id: 'p1', desc: `${text} ${text}` }] });
  if (/valid JSON/i.test(prompt)) return JSON.stringify({ desc: `${text} ${text}` });
  // Everything else is a plain translation request.
  return `${text} ${text}`;
};

function callGenerate(payload) {
  return new Promise((resolve) => {
    const res = {
      status() { return this; },
      json(data) { resolve(data); },
    };
    generate({ body: payload }, res).catch(() => resolve({ __error: true }));
  });
}

// PROSE is everything the portfolio actually reads as text: it MUST be in the selected language.
// NAMES are titles of works and institution names ("Night Market", "NCA Lahore"). A model may
// translate them; if it cannot, they must be preserved verbatim, never mangled or replaced.
function visibleStrings(out) {
  const prose = [];
  const names = [];
  const P = (field, v) => { const s = String(v || '').trim(); if (s) prose.push({ field, s }); };
  const N = (field, v) => { const s = String(v || '').trim(); if (s) names.push({ field, s }); };
  P('bio', out.bio); P('statement', out.artistStatement); P('medium', out.medium);
  (out.projects || []).forEach((p, i) => { N(`project${i}.title`, p.title); P(`project${i}.desc`, p.desc); });
  (out.customSections || []).forEach((s, i) => {
    P(`section${i}.name`, s.name);
    (s.items || []).forEach((it, j) => { N(`section${i}.item${j}.heading`, it.heading); P(`section${i}.item${j}.desc`, it.desc); });
  });
  return { prose, names };
}

// Is this string acceptable for the target language?
function stringIsInLanguage(value, lang) {
  if (hasUnexpectedScriptForLanguage(value, lang)) return false;
  if (requiresNonLatinScript(lang) && !hasRequiredScript(value, lang)) return false;
  return true;
}

(async () => {
  const RUNS = Number(process.env.RUNS || 100);
  const BEHAVIOURS = [
    'obedient','obedient','obedient','obedient','obedient',             // 50% well-behaved
    'english_leak','english_leak',                                      // 20% replies in English
    'wrong_script',                                                     // 10% wrong script
    'script_swap',                                                      // 10% Urdu<->Arabic swap
    'throw',                                                            // 10% provider failure
  ];

  console.log(`\n=== /generate end-to-end: ${LANGS.length} languages x ${RUNS} runs each ===`);
  console.log('    (inputs written in English, Urdu, Roman Urdu, Chinese, French, Spanish and mixed)\n');
  console.log('  language      runs   output in selected language   failures');
  console.log('  ' + '-'.repeat(62));

  let grandTotal = 0, grandOk = 0, nameTotal = 0, nameCorrupted = 0;
  const failureSamples = [];

  for (const lang of LANGS) {
    let ok = 0, total = 0;
    TARGET = normalizeServerOutputLanguage(lang);

    for (let i = 0; i < RUNS; i += 1) {
      const input = INPUTS[i % INPUTS.length];
      BEHAVIOUR = BEHAVIOURS[i % BEHAVIOURS.length];

      const data = await callGenerate({
        name: input.name, medium: input.medium, description: input.description,
        projects: input.projects, projectList: input.projects.map(p => p.title),
        customSections: SECTIONS, skills: ['Figma', 'Photoshop'],
        contact: { email: 'x@y.com' }, creatorType: CREATOR_TYPES[i % CREATOR_TYPES.length],
        enhanceProjectDescriptions: true, targetLanguage: lang, aiTone: 'Professional',
      });

      total += 1;
      const out = data.localizedOutput || {};
      const { prose, names } = visibleStrings(out);
      const bad = prose.filter(x => !stringIsInLanguage(x.s, lang));
      if (!bad.length) ok += 1;
      else if (failureSamples.length < 10) {
        failureSamples.push({ lang, src: input.src, behaviour: BEHAVIOUR, field: bad[0].field, bad: bad[0].s.slice(0, 90) });
      }
      // Names must never be corrupted into generic filler even when they cannot be translated.
      names.forEach(n => { if (/^\s*$/.test(n.s) || n.s.split(/\s+/).length > 8) nameCorrupted += 1; });
      nameTotal += names.length;
    }

    grandTotal += total; grandOk += ok;
    const pct = ((ok / total) * 100).toFixed(1);
    const flag = ok === total ? '' : `  <-- ${total - ok} FAILED`;
    console.log(`  ${lang.padEnd(12)}  ${String(total).padStart(4)}   ${String(ok).padStart(5)} / ${total}  (${pct}%)${flag}`);
  }

  console.log('  ' + '-'.repeat(62));
  console.log(`  TOTAL         ${String(grandTotal).padStart(4)}   ${grandOk} / ${grandTotal}  (${((grandOk/grandTotal)*100).toFixed(2)}%)\n`);
  console.log(`  Prose (bio, statement, descriptions, section headings, medium): MUST be in the selected language.`);
  console.log(`  Work/institution names checked: ${nameTotal}, corrupted: ${nameCorrupted}\n`);

  if (failureSamples.length) {
    console.log('  Sample failures:');
    failureSamples.forEach(f => console.log(`    [${f.lang}] src=${f.src} model=${f.behaviour} field=${f.field}\n        "${f.bad}"`));
    console.log('');
  }
  process.exitCode = grandOk === grandTotal ? 0 : 1;
})();
