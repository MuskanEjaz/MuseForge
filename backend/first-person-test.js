'use strict';
// A portfolio speaks as the creator. Every prose field must be in FIRST PERSON, in every
// language, even when the model writes third person or is unavailable entirely.
process.env.AI_PROVIDER = 'groq';
process.env.GROQ_API_KEY = 'test-key';
process.env.AI_PROVIDER_COOLDOWN_MS = '0';

const assert = require('assert');
const { __test } = require('./server.js');
const express = require('express');
const { regenerationIsStrongEnough, regenerationUsesFirstPerson, normalizeServerOutputLanguage } = __test;

const generate = express.__lastApp.__routes['POST /generate'];

const LANGS = ['English','Spanish','French','German','Italian','Portuguese','Dutch','Polish',
               'Turkish','Chinese','Japanese','Korean','Russian','Indonesian','Vietnamese',
               'Arabic','Urdu'];

// A THIRD-person rewrite the model might return. FactLock must reject every one of these.
const THIRD_PERSON = {
  English:'The creator built this piece with care and the studio refined it until the idea was clear enough for any viewer to follow.',
  Spanish:'El creador construyó esta pieza con cuidado y el estudio la refinó hasta que la idea quedó clara para cualquier espectador.',
  French:'Le créateur a construit cette pièce avec soin et le studio l’a affinée jusqu’à ce que l’idée devienne claire pour le spectateur.',
  German:'Der Urheber baute dieses Stück sorgfältig auf und das Studio verfeinerte es, bis die Idee für jeden Betrachter klar wurde.',
  Italian:'Il creatore ha costruito questo lavoro con cura e lo studio lo ha rifinito finché l’idea non è diventata chiara.',
  Portuguese:'O criador construiu esta peça com cuidado e o estúdio refinou-a até a ideia ficar clara para o espectador.',
  Dutch:'De maker bouwde dit werk zorgvuldig op en de studio verfijnde het totdat het idee helder werd voor de kijker.',
  Polish:'Twórca zbudował tę pracę starannie, a studio dopracowywało ją, aż zamysł stał się czytelny dla widza.',
  Turkish:'Yaratıcı bu çalışmayı özenle kurdu ve stüdyo fikir izleyici için netleşene kadar onu geliştirdi.',
  Chinese:'这位创作者用心完成了这件作品，工作室不断打磨，直到这个想法足够清晰。',
  Japanese:'その制作者は丁寧にこの作品を組み立て、スタジオは意図が明確になるまで磨き上げました。',
  Korean:'그 창작자는 이 작업을 정성껏 만들었고 스튜디오는 의도가 분명해질 때까지 다듬었습니다.',
  Russian:'Автор создал эту работу с вниманием, и студия дорабатывала её, пока замысел не стал ясным.',
  Indonesian:'Pencipta membangun karya ini dengan cermat dan studio menyempurnakannya hingga idenya terbaca jelas.',
  Vietnamese:'Người sáng tạo đã thực hiện tác phẩm này cẩn thận và xưởng đã hoàn thiện nó cho đến khi ý tưởng rõ ràng.',
  Arabic:'قام المبدع ببناء هذا العمل بعناية وقام الاستوديو بتحسينه حتى أصبحت الفكرة واضحة تمامًا للمشاهد.',
  Urdu:'اس تخلیق کار نے یہ کام توجہ سے بنایا اور اسٹوڈیو نے اسے اُس وقت تک نکھارا جب تک خیال واضح نہ ہو گیا۔',
};

// The same content, written properly in FIRST person. These must be accepted.
const FIRST_PERSON = {
  English:'I built this piece with steady care and I kept refining it until the idea read clearly. I wanted every part of it to feel intentional and honest to the work I set out to make.',
  Spanish:'Construí esta pieza con cuidado constante y la refiné hasta que la idea se leyó con claridad. Quería que cada parte de mi trabajo se sintiera intencionada y honesta con lo que me propuse hacer.',
  French:"J'ai construit cette pièce avec un soin constant et je l'ai affinée jusqu'à ce que mon idée soit claire. Je voulais que chaque partie de mon travail paraisse intentionnelle et honnête envers ce que je cherchais à faire.",
  German:'Ich habe dieses Stück mit Sorgfalt aufgebaut und ich habe es so lange verfeinert, bis meine Idee klar lesbar war. Ich wollte, dass jeder Teil meiner Arbeit bewusst und ehrlich wirkt.',
  Italian:"Ho costruito questo lavoro con cura e l'ho rifinito finché la mia idea non è risultata chiara. Volevo che ogni parte del mio lavoro sembrasse intenzionale e onesta rispetto a ciò che volevo fare.",
  Portuguese:'Construí esta peça com cuidado e refinei-a até a minha ideia ficar clara. Queria que cada parte do meu trabalho parecesse intencional e honesta em relação ao que me propus fazer.',
  Dutch:'Ik heb dit werk met zorg opgebouwd en ik heb het verfijnd tot mijn idee helder overkwam. Ik wilde dat elk onderdeel van mijn werk bewust en eerlijk aanvoelde.',
  Polish:'Zbudowałam tę pracę z uwagą i dopracowywałam ją, aż mój zamysł stał się czytelny. Chciałam, żeby każdy element mojego projektu był świadomy i uczciwy wobec tego, co chciałam zrobić.',
  Turkish:'Bu çalışmayı özenle kurdum ve benim fikrim net okunana kadar geliştirmeye devam ettim. İşimin her parçasının bilinçli ve dürüst hissettirmesini istedim, çünkü kendi emeğimi olduğu gibi göstermek benim için önemliydi.',
  Chinese:'我用心完成了这件作品，并不断打磨，直到我的想法能够被清晰地读出来。我希望我的作品的每一个部分都显得有意图且真实，也希望别人能从中看到我投入的时间与思考，而不是被夸大的说辞。我一直相信，诚实的作品比华丽的宣传更有力量。',
  Japanese:'私はこの作品を丁寧に組み立て、私の意図が明確に伝わるまで繰り返し磨き上げました。私は自分の仕事のすべての部分が意図的で誠実であってほしいと考えており、誇張ではなく実際に費やした時間と思考が伝わることを望んでいます。',
  Korean:'저는 이 작업을 정성껏 만들었고 제 의도가 분명히 읽힐 때까지 계속 다듬었습니다. 저는 제 작업의 모든 부분이 의도적이고 정직하게 느껴지기를 바랐으며, 과장이 아니라 제가 들인 시간과 고민이 그대로 전해지기를 원했습니다.',
  Russian:'Я создала эту работу с вниманием и дорабатывала её, пока мой замысел не стал ясным. Я хотела, чтобы каждая часть моей работы была осознанной и честной.',
  Indonesian:'Saya membangun karya ini dengan cermat dan saya terus menyempurnakannya hingga ide saya terbaca jelas. Saya ingin setiap bagian dari karya saya terasa disengaja dan jujur, karena bagi saya penting untuk menunjukkan usaha yang sebenarnya.',
  Vietnamese:'Tôi đã thực hiện tác phẩm này một cách cẩn thận và tôi tiếp tục hoàn thiện cho đến khi ý tưởng của tôi rõ ràng. Tôi muốn mọi phần trong công việc của tôi đều có chủ đích và trung thực.',
  Arabic:'بنيت هذا العمل بعناية واستمررت في تحسينه حتى صارت فكرتي واضحة تمامًا. أردت أن يبدو كل جزء من عملي مقصودًا وصادقًا مع ما سعيت إليه.',
  Urdu:'میں نے یہ کام توجہ سے بنایا اور اسے اُس وقت تک نکھارتی رہی جب تک میرا خیال واضح نہ ہو گیا۔ میں چاہتی تھی کہ میرے کام کا ہر حصہ بامقصد اور دیانت دارانہ محسوس ہو۔',
};

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
};

(async () => {
  console.log('\n== FactLock rejects THIRD-person prose in every language ==');
  for (const lang of LANGS) {
    check(`${lang}: third person rejected`, () => {
      const ok = regenerationIsStrongEnough(THIRD_PERSON[lang] + ' ' + THIRD_PERSON[lang], {
        isProject: true, targetLanguage: lang,
        originalDesc: 'made a piece for a show', title: 'Piece',
      });
      assert.strictEqual(ok, false, 'third-person text was accepted');
    });
    check(`${lang}: first person accepted`, () => {
      const ok = regenerationIsStrongEnough(FIRST_PERSON[lang], {
        isProject: true, targetLanguage: lang,
        originalDesc: 'made a piece for a show', title: 'Piece',
      });
      assert.strictEqual(ok, true, 'first-person text was rejected');
    });
  }
  console.log(`  ${pass} checks passed, ${fail} failed`);

  console.log('\n== /generate: a model writing THIRD person never reaches the user ==');
  let e2ePass = 0, e2eFail = 0;
  for (const lang of LANGS) {
    const target = normalizeServerOutputLanguage(lang);
    const third = THIRD_PERSON[target];

    global.__MOCK_AI__ = async (messages) => {
      const prompt = messages.map(m => String(m.content || '')).join('\n');
      if (/translate SHORT portfolio headings/i.test(prompt)) return third.split(/\s+/).slice(0, 3).join(' ');
      if (/Return only the two markdown sections/i.test(prompt)) {
        return `## Artist Bio\n${third} ${third}\n\n## Artist Statement\n${third} ${third}`;
      }
      if (/"projects"\s*:/.test(prompt)) return JSON.stringify({ projects: [{ id: 'p1', desc: `${third} ${third}` }] });
      return `${third} ${third}`;
    };

    const data = await new Promise((resolve) => {
      const res = { status() { return this; }, json(d) { resolve(d); } };
      generate({
        body: {
          name: 'Sana Malik', medium: 'Illustration',
          description: 'I draw characters for indie games.',
          projects: [{ id: 'p1', title: 'Night Market', desc: 'I drew 12 character sketches.' }],
          projectList: ['Night Market'],
          customSections: [{ id: 's1', name: 'Awards', items: [{ id: 'i1', heading: 'Best Poster', desc: 'Recognised at a campus show.' }] }],
          skills: ['Procreate'], contact: { email: 'x@y.com' }, creatorType: 'artist',
          enhanceProjectDescriptions: true, targetLanguage: lang, aiTone: 'Professional',
        },
      }, res).catch(() => resolve({}));
    });

    const out = data.localizedOutput || {};
    const prose = [out.bio, out.artistStatement, ...(out.projects || []).map(p => p.desc)].filter(Boolean);

    // Every prose field the user sees must still read as first person.
    const bad = prose.filter(text => !regenerationUsesFirstPerson(text, lang));

    if (!bad.length && prose.length) { e2ePass += 1; }
    else {
      e2eFail += 1;
      console.log(`  FAIL  ${lang}: "${String(bad[0] || '(empty)').slice(0, 60)}"`);
    }
  }
  console.log(`  ${e2ePass} / ${LANGS.length} languages keep first person even when the model does not`);

  const total = fail + e2eFail;
  console.log(`\n${total === 0 ? 'ALL FIRST-PERSON CHECKS PASSED' : total + ' FAILURES'}\n`);
  process.exitCode = total ? 1 : 0;
})();
