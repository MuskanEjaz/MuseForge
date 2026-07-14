'use strict';
// End-to-end test of the REAL /factlock/regenerate endpoint, offline.
// Three questions, all answered against the live route rather than the helpers:
//   1. Does Regenerate always return text in the SELECTED language?
//   2. Is the regenerated text always STRONGER than the original (never an echo/stub)?
//   3. Does FactLock still block a model that tries to smuggle in a fabricated fact?
process.env.AI_PROVIDER = 'groq';
process.env.GROQ_API_KEY = 'test-key';
process.env.AI_PROVIDER_COOLDOWN_MS = '0';
process.env.NODE_ENV = 'test';

const { __test } = require('./server.js');
const express = require('express');
const { hasUnexpectedScriptForLanguage, requiresNonLatinScript, hasRequiredScript,
        normalizeServerOutputLanguage } = __test;

const regenerate = express.__lastApp.__routes['POST /factlock/regenerate'];
if (!regenerate) throw new Error('POST /factlock/regenerate route not captured');

const LANGS = (process.env.ONLY ? process.env.ONLY.split(',') : ['English','Spanish','French','German','Italian','Portuguese','Dutch','Polish',
               'Turkish','Chinese','Japanese','Korean','Russian','Indonesian','Vietnamese',
               'Arabic','Urdu']);

const SAMPLE = {
  Urdu:'میں نے یہ کام مسلسل توجہ کے ساتھ بنایا اور اسے اُس وقت تک نکھارتی رہی جب تک خیال واضح نہ ہو گیا۔',
  Arabic:'بنيت هذا العمل بعناية مستمرة واستمررت في تحسينه حتى صارت الفكرة واضحة تمامًا للمشاهد.',
  English:'I built this piece with steady care and I kept refining it until the idea read clearly.',
  Spanish:'Construí esta pieza con cuidado constante y la refiné hasta que la idea se leyera con claridad.',
  French:"J'ai construit cette pièce avec un soin constant et je l'ai affinée jusqu'à ce que l'idée soit claire.",
  German:'Ich habe dieses Stück sorgfältig aufgebaut und so lange verfeinert, bis die Idee klar lesbar war.',
  Italian:"Ho costruito questo lavoro con cura costante e l'ho rifinito finché l'idea non è risultata chiara.",
  Portuguese:'Construí esta peça com cuidado constante e refinei-a até que a ideia ficasse clara.',
  Dutch:'Ik heb dit werk met zorg opgebouwd en het verfijnd tot het idee helder overkwam.',
  Arabic:'بنيت هذا العمل بعناية مستمرة واستمررت في تحسينه حتى صارت الفكرة واضحة تمامًا للمشاهد.',
  Urdu:'میں نے یہ کام مسلسل توجہ کے ساتھ بنایا اور اسے اُس وقت تک نکھارتی رہی جب تک خیال واضح نہ ہو گیا۔',
  Polish:'Zbudowałam tę pracę z nieustanną uwagą i dopracowywałam ją, aż zamysł stał się w pełni czytelny.',
  Turkish:'Bu çalışmayı özenle kurdum ve fikir net biçimde okunana kadar geliştirmeye devam ettim.',
  Chinese:'我以持续的耐心完成了这件作品，并不断打磨，直到想法能够被清晰地读出来。',
  Japanese:'私はこの作品を丁寧に組み立て、意図が明確に伝わるまで繰り返し磨き上げていきました。',
  Korean:'저는 이 작업을 꾸준한 정성으로 만들었고 의도가 분명히 읽힐 때까지 계속 다듬었습니다.',
  Russian:'Я создавала эту работу с постоянным вниманием и дорабатывала её, пока замысел не стал ясным.',
  Indonesian:'Saya membangun karya ini dengan ketelitian dan terus menyempurnakannya hingga idenya terbaca jelas.',
  Vietnamese:'Tôi đã thực hiện tác phẩm này một cách cẩn thận và tiếp tục hoàn thiện cho đến khi ý tưởng rõ ràng.',
};

let BEHAVIOUR = 'obedient';
let TARGET = 'English';

global.__MOCK_AI__ = async (messages) => {
  const prompt = messages.map(m => String(m.content || '')).join('\n');
  if (BEHAVIOUR === 'throw') throw new Error('simulated 429 rate limit');
  if (BEHAVIOUR === 'empty') return '';
  if (BEHAVIOUR === 'echo') return prompt.slice(0, 200);

  const good = SAMPLE[TARGET] || SAMPLE.English;
  const isLabel = /translate SHORT portfolio headings/i.test(prompt);
  const isRegen = /"enhanced"|Rewrite|regenerat/i.test(prompt) && !/strict translator/i.test(prompt);

  if (isLabel) return good.split(/\s+/).slice(0, 3).join(' ');

  // A model that tries to smuggle in a metric the user never wrote — but only on the actual
  // regeneration call. A plain translation request gets an honest translation, so this measures
  // FactLock rather than an artefact of the stub.
  if (BEHAVIOUR === 'fabricate' && isRegen) {
    const lie = `${good} ${good} 5000 users saw this and it won first prize. ${good}`;
    return JSON.stringify({ enhanced: lie });
  }

  const swap = TARGET === 'Urdu' ? SAMPLE.Arabic : TARGET === 'Arabic' ? SAMPLE.Urdu : SAMPLE.Russian;
  const text = BEHAVIOUR === 'english_leak' ? SAMPLE.English
    : BEHAVIOUR === 'wrong_script' ? SAMPLE.Russian
    : BEHAVIOUR === 'script_swap' ? swap
    : good;
  if (isRegen) return JSON.stringify({ enhanced: `${text} ${text} ${text}` });
  return `${text} ${text}`;   // strict-translation call
};

function callRegenerate(payload) {
  return new Promise((resolve) => {
    const res = { status() { return this; }, json(data) { resolve(data); } };
    regenerate({ body: payload }, res).catch(() => resolve({ __error: true }));
  });
}

const ITEMS = [
  { kind: 'project',   id: 'p1', title: 'Night Market', desc: 'I drew 12 character sketches for a game jam.' },
  { kind: 'bio',       id: 'meta:bio', title: 'Bio', desc: 'I am an illustrator who draws characters for indie games.' },
  { kind: 'statement', id: 'meta:statement', title: 'Statement', desc: 'I want my drawings to feel warm and lived in.' },
  { kind: 'project',   id: 'i1', title: 'Poster Series', desc: 'Maine 3 posters design kiye college event ke liye.' },
];

const inLanguage = (value, lang) => {
  if (hasUnexpectedScriptForLanguage(value, lang)) return false;
  if (requiresNonLatinScript(lang) && !hasRequiredScript(value, lang)) return false;
  return true;
};

(async () => {
  const RUNS = Number(process.env.RUNS || 100);
  const BEHAVIOURS = [
    'obedient','obedient','obedient','obedient','obedient',  // 50%
    'english_leak','english_leak',                           // 20%
    'wrong_script',                                          // 10%
    'fabricate',                                             // 10% tries to invent "5000"
    'throw',                                                 // 10% provider down
  ];

  console.log(`\n=== /factlock/regenerate end-to-end: ${LANGS.length} languages x ${RUNS} runs ===\n`);
  console.log('  language      in selected language     stronger than original    fabricated fact blocked');
  console.log('  ' + '-'.repeat(78));

  let tLang = 0, tLangOk = 0, tStrong = 0, tStrongOk = 0, tFab = 0, tFabOk = 0;

  for (const lang of LANGS) {
    TARGET = normalizeServerOutputLanguage(lang);
    let langOk = 0, langTotal = 0, strongOk = 0, strongTotal = 0, fabOk = 0, fabTotal = 0;

    for (let i = 0; i < RUNS; i += 1) {
      BEHAVIOUR = BEHAVIOURS[i % BEHAVIOURS.length];
      const item = ITEMS[i % ITEMS.length];

      const data = await callRegenerate({
        id: item.id, title: item.title, originalDesc: item.desc, itemKind: item.kind,
        targetLanguage: lang, creatorType: 'artist', medium: 'Illustration',
        aiTone: 'Professional', name: 'Ayesha Khan',
      });

      const out = String(data.desc || data.enhancedDesc || '').trim();

      langTotal += 1;
      if (out && inLanguage(out, lang)) langOk += 1;

      // "Stronger" = a real rewrite: not empty, not the original echoed back, and substantial.
      // Chinese/Japanese/Korean say the same thing in far fewer characters, so the length floor
      // is script-aware — otherwise a perfectly good CJK rewrite is scored as "weak".
      strongTotal += 1;
      const compact = ['Chinese', 'Japanese', 'Korean'].includes(lang);
      const floor = compact ? 18 : 40;
      const echoed = out.toLowerCase().trim() === item.desc.toLowerCase().trim();
      if (out && !echoed && out.length >= floor) strongOk += 1;

      // FactLock: when the model invents "5000", it must not survive into the output.
      if (BEHAVIOUR === 'fabricate') {
        fabTotal += 1;
        if (!/5000/.test(out)) fabOk += 1;
      }
    }

    tLang += langTotal; tLangOk += langOk;
    tStrong += strongTotal; tStrongOk += strongOk;
    tFab += fabTotal; tFabOk += fabOk;

    const f = (a, b) => `${String(a).padStart(3)}/${String(b).padEnd(3)} (${((a / b) * 100).toFixed(0)}%)`;
    const flag = (langOk === langTotal && strongOk === strongTotal && fabOk === fabTotal) ? '' : '   <-- CHECK';
    console.log(`  ${lang.padEnd(12)}  ${f(langOk, langTotal)}          ${f(strongOk, strongTotal)}         ${f(fabOk, fabTotal)}${flag}`);
  }

  console.log('  ' + '-'.repeat(78));
  const pct = (a, b) => `${a}/${b} (${((a / b) * 100).toFixed(2)}%)`;
  console.log(`  TOTAL         language: ${pct(tLangOk, tLang)}   strength: ${pct(tStrongOk, tStrong)}   fabrication blocked: ${pct(tFabOk, tFab)}\n`);
  process.exitCode = (tLangOk === tLang && tStrongOk === tStrong && tFabOk === tFab) ? 0 : 1;
})();
