'use strict';
// Can MuseForge read a CV written in the creator's OWN language?
// Generates CVs in all 17 languages, with the structural variations real PDFs produce
// (bullets, wrapped headings, "HEADING: content" on one line), and measures section recall.
const { __test } = require('./server.js');
const { parseCvTextLocally } = __test;

let seed = parseInt(process.env.SEED || '20260712', 10);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

// Headings exactly as they appear on a real CV in each language.
const H = {
  English:    { summary:'PROFILE', education:'EDUCATION', skills:'SKILLS', experience:'WORK EXPERIENCE', projects:'PROJECTS', certifications:'CERTIFICATIONS', awards:'AWARDS', languages:'LANGUAGES', interests:'INTERESTS', references:'REFERENCES' },
  Spanish:    { summary:'PERFIL', education:'FORMACIÓN ACADÉMICA', skills:'HABILIDADES', experience:'EXPERIENCIA LABORAL', projects:'PROYECTOS', certifications:'CERTIFICACIONES', awards:'PREMIOS', languages:'IDIOMAS', interests:'INTERESES', references:'REFERENCIAS' },
  French:     { summary:'PROFIL', education:'FORMATION', skills:'COMPÉTENCES', experience:'EXPÉRIENCE PROFESSIONNELLE', projects:'PROJETS', certifications:'CERTIFICATIONS', awards:'DISTINCTIONS', languages:'LANGUES', interests:'LOISIRS', references:'RÉFÉRENCES' },
  German:     { summary:'PROFIL', education:'AUSBILDUNG', skills:'FÄHIGKEITEN', experience:'BERUFSERFAHRUNG', projects:'PROJEKTE', certifications:'ZERTIFIKATE', awards:'AUSZEICHNUNGEN', languages:'SPRACHEN', interests:'INTERESSEN', references:'REFERENZEN' },
  Italian:    { summary:'PROFILO', education:'ISTRUZIONE', skills:'COMPETENZE', experience:'ESPERIENZA LAVORATIVA', projects:'PROGETTI', certifications:'CERTIFICAZIONI', awards:'PREMI', languages:'LINGUE', interests:'INTERESSI', references:'REFERENZE' },
  Portuguese: { summary:'PERFIL', education:'FORMAÇÃO ACADÉMICA', skills:'COMPETÊNCIAS', experience:'EXPERIÊNCIA PROFISSIONAL', projects:'PROJETOS', certifications:'CERTIFICAÇÕES', awards:'PRÉMIOS', languages:'IDIOMAS', interests:'INTERESSES', references:'REFERÊNCIAS' },
  Dutch:      { summary:'PROFIEL', education:'OPLEIDING', skills:'VAARDIGHEDEN', experience:'WERKERVARING', projects:'PROJECTEN', certifications:'CERTIFICATEN', awards:'ONDERSCHEIDINGEN', languages:'TALEN', interests:'INTERESSES', references:'REFERENTIES' },
  Polish:     { summary:'PROFIL', education:'WYKSZTAŁCENIE', skills:'UMIEJĘTNOŚCI', experience:'DOŚWIADCZENIE ZAWODOWE', projects:'PROJEKTY', certifications:'CERTYFIKATY', awards:'WYRÓŻNIENIA', languages:'JĘZYKI', interests:'ZAINTERESOWANIA', references:'REFERENCJE' },
  Turkish:    { summary:'PROFİL', education:'EĞİTİM', skills:'YETENEKLER', experience:'İŞ DENEYİMİ', projects:'PROJELER', certifications:'SERTİFİKALAR', awards:'ÖDÜLLER', languages:'DİLLER', interests:'İLGİ ALANLARI', references:'REFERANSLAR' },
  Chinese:    { summary:'个人简介', education:'教育背景', skills:'专业技能', experience:'工作经历', projects:'项目经验', certifications:'证书', awards:'奖项', languages:'语言能力', interests:'兴趣爱好', references:'推荐人' },
  Japanese:   { summary:'自己紹介', education:'学歴', skills:'スキル', experience:'職務経歴', projects:'プロジェクト', certifications:'資格', awards:'受賞歴', languages:'語学', interests:'趣味', references:'推薦者' },
  Korean:     { summary:'자기소개', education:'학력', skills:'보유 기술', experience:'경력', projects:'프로젝트', certifications:'자격증', awards:'수상 경력', languages:'언어', interests:'관심사', references:'추천인' },
  Russian:    { summary:'ПРОФИЛЬ', education:'ОБРАЗОВАНИЕ', skills:'НАВЫКИ', experience:'ОПЫТ РАБОТЫ', projects:'ПРОЕКТЫ', certifications:'СЕРТИФИКАТЫ', awards:'НАГРАДЫ', languages:'ЯЗЫКИ', interests:'ИНТЕРЕСЫ', references:'РЕКОМЕНДАЦИИ' },
  Indonesian: { summary:'PROFIL', education:'PENDIDIKAN', skills:'KEAHLIAN', experience:'PENGALAMAN KERJA', projects:'PROYEK', certifications:'SERTIFIKASI', awards:'PENGHARGAAN', languages:'BAHASA', interests:'MINAT', references:'REFERENSI' },
  Vietnamese: { summary:'GIỚI THIỆU', education:'HỌC VẤN', skills:'KỸ NĂNG', experience:'KINH NGHIỆM LÀM VIỆC', projects:'DỰ ÁN', certifications:'CHỨNG CHỈ', awards:'GIẢI THƯỞNG', languages:'NGÔN NGỮ', interests:'SỞ THÍCH', references:'NGƯỜI THAM CHIẾU' },
  Arabic:     { summary:'نبذة', education:'التعليم', skills:'المهارات', experience:'الخبرة العملية', projects:'المشاريع', certifications:'الشهادات', awards:'الجوائز', languages:'اللغات', interests:'الاهتمامات', references:'المراجع' },
  Urdu:       { summary:'خلاصہ', education:'تعلیم', skills:'مہارتیں', experience:'تجربہ', projects:'منصوبے', certifications:'اسناد', awards:'اعزازات', languages:'زبانیں', interests:'دلچسپیاں', references:'حوالہ جات' },
};

// Body content per script family. Skills use the separator that script actually uses.
const BODY = {
  latin: {
    names: ['Claire Dubois', 'Diego Ramos', 'Anna Kowalska', 'Luca Rossi', 'Sofia Almeida'],
    skills: ['Photoshop, Illustrator, After Effects', 'Figma, Blender, Procreate', 'Ableton, Logic Pro, Audacity'],
    school: 'Academy of Fine Arts', degree: 'BFA, 2019-2023',
    job: 'Studio Nord', role: 'Junior Designer',
    project: 'Night Market', projDesc: 'A poster series of 12 illustrated pieces.',
    cert: 'Adobe Certified Professional', award: 'Best Student Portfolio',
    langs: 'English, French, Spanish', interests: 'Cycling, Film, Cooking', refs: 'Available on request',
  },
  cjk: {
    names: ['李伟', '田中優子', '김민준'],
    skills: ['Ableton、混音、编曲', 'Photoshop、イラスト、動画編集', 'Figma、디자인、편집'],
    school: '中央美术学院', degree: '学士, 2019-2023',
    job: '星光工作室', role: '设计助理',
    project: '霓虹夜市', projDesc: '制作了12幅插画作品。',
    cert: 'Adobe 认证', award: '优秀作品奖',
    langs: '中文、英语', interests: '摄影、电影', refs: '可应要求提供',
  },
  rtl: {
    names: ['ثنا ملک', 'عمر حسن', 'ليلى أحمد'],
    skills: ['فوٹوگرافی، لائٹ روم، فوٹوشاپ', 'التصوير، الإضاءة، المونتاج'],
    school: 'نیشنل کالج آف آرٹس', degree: 'بی ایف اے، 2019-2023',
    job: 'اسٹوڈیو لاہور', role: 'اسسٹنٹ',
    project: 'پرانا لاہور', projDesc: 'میں نے 12 تصاویر بنائیں۔',
    cert: 'ادوبی سرٹیفکیٹ', award: 'بہترین پورٹ فولیو',
    langs: 'اردو، انگریزی', interests: 'فوٹوگرافی، سفر', refs: 'درخواست پر دستیاب',
  },
};

const familyOf = (lang) => {
  if (['Chinese', 'Japanese', 'Korean'].includes(lang)) return 'cjk';
  if (['Arabic', 'Urdu'].includes(lang)) return 'rtl';
  return 'latin';
};

function buildCv(lang) {
  const h = H[lang];
  const b = BODY[familyOf(lang)];
  const style = pick(['plain', 'inline', 'bulleted']);
  const bullet = pick(['• ', '- ', '']);
  const L = [];

  L.push(pick(b.names));
  L.push('Creative Professional');
  L.push('mail@example.com');

  const section = (heading, lines) => {
    if (style === 'inline' && lines.length === 1) {
      L.push(`${heading}: ${lines[0]}`);
    } else {
      L.push(heading);
      lines.forEach(line => L.push(style === 'bulleted' ? bullet + line : line));
    }
  };

  section(h.summary, ['A creative professional building a portfolio of real work.']);
  section(h.education, [b.school, b.degree]);
  section(h.skills, [pick(b.skills)]);
  section(h.experience, [b.job, b.role]);
  section(h.projects, [b.project, b.projDesc]);
  section(h.certifications, [b.cert]);
  section(h.awards, [b.award]);
  section(h.languages, [b.langs]);
  section(h.interests, [b.interests]);
  section(h.references, [b.refs]);

  return L.join('\n');
}

const SECTION_OF = {
  education: 'Education', experience: 'Experience', certifications: 'Workshops & Certifications',
  awards: 'Awards', languages: 'Languages', interests: 'Interests', references: 'References',
};

const RUNS = Number(process.env.RUNS || 60);
const LANGS = Object.keys(H);

console.log(`\n=== CV parsing in the creator's own language — ${LANGS.length} languages x ${RUNS} CVs ===\n`);
console.log('  language      CVs   name   summary  skills  projects  education  experience  certs  awards  langs  interests  refs');
console.log('  ' + '-'.repeat(112));

const totals = {};
let grandTotal = 0, grandOk = 0;

for (const lang of LANGS) {
  const score = { name: 0, summary: 0, skills: 0, projects: 0, education: 0, experience: 0, certifications: 0, awards: 0, languages: 0, interests: 0, references: 0 };

  for (let i = 0; i < RUNS; i += 1) {
    const cv = buildCv(lang);
    let p;
    try { p = parseCvTextLocally(cv, []); } catch (e) { p = null; }
    if (!p) continue;

    const names = (p.customSections || []).map(s => String(s.name).toLowerCase());
    if (p.name) score.name += 1;
    if (String(p.description || '').trim()) score.summary += 1;
    if ((p.skills || []).length >= 2) score.skills += 1;
    if ((p.projects || []).length >= 1) score.projects += 1;
    Object.entries(SECTION_OF).forEach(([key, label]) => {
      if (names.includes(label.toLowerCase())) score[key] += 1;
    });
  }

  const cells = ['name', 'summary', 'skills', 'projects', 'education', 'experience', 'certifications', 'awards', 'languages', 'interests', 'references']
    .map(k => {
      grandTotal += RUNS; grandOk += score[k];
      const pct = (score[k] / RUNS) * 100;
      return (pct === 100 ? '100%' : pct.toFixed(0) + '%').padStart(6);
    });
  totals[lang] = score;
  console.log(`  ${lang.padEnd(12)} ${String(RUNS).padStart(4)}  ${cells.join('  ')}`);
}

console.log('  ' + '-'.repeat(112));
const pct = (grandOk / grandTotal) * 100;
console.log(`\n  TOTAL: ${grandOk} / ${grandTotal} checks passed  (${pct.toFixed(2)}%)\n`);
process.exitCode = grandOk === grandTotal ? 0 : 1;
