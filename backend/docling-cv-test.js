'use strict';
// The test I should have written the first time.
// Docling does not return plain text — it returns MARKDOWN, and a real CV is mostly TABLES.
// This generates the markdown Docling actually produces (## headings, | tables |, |---| separator
// rows, <!-- image --> placeholders, [text](url) links) in 17 languages and checks the parse.
const { __test } = require('./server.js');
const { parseCvTextLocally, doclingMarkdownToCvText } = __test;

let seed = parseInt(process.env.SEED || '20260713', 10);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const H = {
  English:    { edu:'EDUCATION', exp:'WORK EXPERIENCE', skills:'SKILLS', proj:'PROJECTS', cert:'CERTIFICATIONS', awards:'AWARDS' },
  Spanish:    { edu:'FORMACIÓN ACADÉMICA', exp:'EXPERIENCIA LABORAL', skills:'HABILIDADES', proj:'PROYECTOS', cert:'CERTIFICACIONES', awards:'PREMIOS' },
  French:     { edu:'FORMATION', exp:'EXPÉRIENCE PROFESSIONNELLE', skills:'COMPÉTENCES', proj:'PROJETS', cert:'CERTIFICATIONS', awards:'DISTINCTIONS' },
  German:     { edu:'AUSBILDUNG', exp:'BERUFSERFAHRUNG', skills:'FÄHIGKEITEN', proj:'PROJEKTE', cert:'ZERTIFIKATE', awards:'AUSZEICHNUNGEN' },
  Italian:    { edu:'ISTRUZIONE', exp:'ESPERIENZA LAVORATIVA', skills:'COMPETENZE', proj:'PROGETTI', cert:'CERTIFICAZIONI', awards:'PREMI' },
  Portuguese: { edu:'FORMAÇÃO ACADÉMICA', exp:'EXPERIÊNCIA PROFISSIONAL', skills:'COMPETÊNCIAS', proj:'PROJETOS', cert:'CERTIFICAÇÕES', awards:'PRÉMIOS' },
  Dutch:      { edu:'OPLEIDING', exp:'WERKERVARING', skills:'VAARDIGHEDEN', proj:'PROJECTEN', cert:'CERTIFICATEN', awards:'ONDERSCHEIDINGEN' },
  Polish:     { edu:'WYKSZTAŁCENIE', exp:'DOŚWIADCZENIE ZAWODOWE', skills:'UMIEJĘTNOŚCI', proj:'PROJEKTY', cert:'CERTYFIKATY', awards:'WYRÓŻNIENIA' },
  Turkish:    { edu:'EĞİTİM', exp:'İŞ DENEYİMİ', skills:'YETENEKLER', proj:'PROJELER', cert:'SERTİFİKALAR', awards:'ÖDÜLLER' },
  Chinese:    { edu:'教育背景', exp:'工作经历', skills:'专业技能', proj:'项目经验', cert:'证书', awards:'奖项' },
  Japanese:   { edu:'学歴', exp:'職務経歴', skills:'スキル', proj:'プロジェクト', cert:'資格', awards:'受賞歴' },
  Korean:     { edu:'학력', exp:'경력', skills:'보유 기술', proj:'프로젝트', cert:'자격증', awards:'수상 경력' },
  Russian:    { edu:'ОБРАЗОВАНИЕ', exp:'ОПЫТ РАБОТЫ', skills:'НАВЫКИ', proj:'ПРОЕКТЫ', cert:'СЕРТИФИКАТЫ', awards:'НАГРАДЫ' },
  Indonesian: { edu:'PENDIDIKAN', exp:'PENGALAMAN KERJA', skills:'KEAHLIAN', proj:'PROYEK', cert:'SERTIFIKASI', awards:'PENGHARGAAN' },
  Vietnamese: { edu:'HỌC VẤN', exp:'KINH NGHIỆM LÀM VIỆC', skills:'KỸ NĂNG', proj:'DỰ ÁN', cert:'CHỨNG CHỈ', awards:'GIẢI THƯỞNG' },
  Arabic:     { edu:'التعليم', exp:'الخبرة العملية', skills:'المهارات', proj:'المشاريع', cert:'الشهادات', awards:'الجوائز' },
  Urdu:       { edu:'تعلیم', exp:'تجربہ', skills:'مہارتیں', proj:'منصوبے', cert:'اسناد', awards:'اعزازات' },
};

const BODY = {
  latin: { name:'Dr. Bilal Ahmed Khan', title:'Consultant Cardiologist', school:'Rawalpindi Medical University', degree:'MBBS', years:'2008 - 2014',
    org:'Shifa International Hospital', role:'Consultant Cardiologist', period:'Jul 2018 - Present',
    skills:'Coronary Angiography, Angioplasty, Stenting, Echocardiography',
    proj:'Outcomes of Primary PCI in STEMI Patients', projDesc:'Published in the Journal of Pakistan Medical Association, 2022',
    cert:'Advanced Cardiac Life Support (ACLS)', certBody:'American Heart Association', certYear:'2023',
    award:'Best Resident Award', awardBody:'PIMS Cardiology Dept.', awardYear:'2019' },
  cjk: { name:'李伟', title:'音乐制作人', school:'中央音乐学院', degree:'学士', years:'2018 - 2022',
    org:'星光工作室', role:'制作助理', period:'2022 - 至今',
    skills:'Ableton、混音、编曲、母带处理',
    proj:'霓虹音轨', projDesc:'制作了5首电子音乐曲目。',
    cert:'Adobe 认证', certBody:'Adobe', certYear:'2023',
    award:'优秀作品奖', awardBody:'学院', awardYear:'2021' },
  rtl: { name:'ثنا ملک', title:'فوٹوگرافر', school:'نیشنل کالج آف آرٹس', degree:'بی ایف اے', years:'2019 - 2023',
    org:'اسٹوڈیو لاہور', role:'اسسٹنٹ', period:'2023 - تاحال',
    skills:'فوٹوگرافی، لائٹ روم، فوٹوشاپ، ایڈیٹنگ',
    proj:'پرانا لاہور', projDesc:'میں نے 20 عمارتوں کی تصاویر بنائیں۔',
    cert:'ادوبی سرٹیفکیٹ', certBody:'Adobe', certYear:'2023',
    award:'بہترین پورٹ فولیو', awardBody:'کالج', awardYear:'2022' },
};
const famOf = (l) => (['Chinese','Japanese','Korean'].includes(l) ? 'cjk' : (['Arabic','Urdu'].includes(l) ? 'rtl' : 'latin'));

// Build the markdown Docling really emits.
function buildDoclingMarkdown(lang) {
  const h = H[lang];
  const b = BODY[famOf(lang)];
  const useTables = rnd() < 0.7;          // most real CVs come back as tables
  const leadImage = rnd() < 0.6;          // Docling emits <!-- image --> for the photo
  const md = [];

  if (leadImage) md.push('<!-- image -->', '');
  md.push(`## ${b.name}`, '', b.title, '', 'dr.bilalkhan@example.com | +92 333 4567890 | linkedin.com/in/bilalkhan', '');

  const table = (headers, rows) => {
    md.push(`| ${headers.join(' | ')} |`);
    md.push(`|${headers.map(() => '---------').join('|')}|`);
    rows.forEach(r => md.push(`| ${r.join(' | ')} |`));
    md.push('');
  };

  md.push(`## ${h.edu}`, '');
  if (useTables) table(['Degree', 'Institution', 'Year'], [[b.degree, b.school, b.years]]);
  else { md.push(`- ${b.degree}, ${b.school}`, `- ${b.years}`, ''); }

  md.push(`## ${h.exp}`, '');
  if (useTables) table(['Role', 'Organisation', 'Period'], [[b.role, b.org, b.period]]);
  else { md.push(`- ${b.role}, ${b.org}`, `- ${b.period}`, ''); }

  md.push(`## ${h.skills}`, '', b.skills, '');

  md.push(`## ${h.proj}`, '', `**${b.proj}**`, `${b.projDesc} [Read publication](https://jpma.org.pk/article/12345)`, '');

  md.push(`## ${h.cert}`, '');
  if (useTables) table(['Certification', 'Body', 'Year'], [[b.cert, b.certBody, b.certYear]]);
  else { md.push(`- ${b.cert}, ${b.certBody}, ${b.certYear}`, ''); }

  md.push(`## ${h.awards}`, '');
  if (useTables) table(['Award', 'Body', 'Year'], [[b.award, b.awardBody, b.awardYear]]);
  else { md.push(`- ${b.award}, ${b.awardBody}, ${b.awardYear}`, ''); }

  if (rnd() < 0.4) md.push('<!-- image -->');
  return md.join('\n');
}

const RUNS = Number(process.env.RUNS || 60);
const LANGS = Object.keys(H);

console.log(`\n=== Docling output -> parser: ${LANGS.length} languages x ${RUNS} CVs ===`);
console.log('    (markdown with ## headings, | tables |, |---| separators, <!-- image -->, [links](url))\n');
console.log('  language      name   medium  skills  projects  education  experience  certs  awards   junk?');
console.log('  ' + '-'.repeat(96));

let total = 0, ok = 0;
const problems = [];

for (const lang of LANGS) {
  const sc = { name:0, medium:0, skills:0, projects:0, education:0, experience:0, certifications:0, awards:0 };
  let junk = 0;

  for (let i = 0; i < RUNS; i += 1) {
    const md = buildDoclingMarkdown(lang);
    const text = doclingMarkdownToCvText(md);
    const p = parseCvTextLocally(text, []);
    const names = (p.customSections || []).map(s => String(s.name).toLowerCase());

    if (p.name && p.name.length >= 3 && !/<!--|-->/.test(p.name)) sc.name += 1;
    if (p.medium && !/<!--|-->/.test(p.medium)) sc.medium += 1;
    if ((p.skills || []).length >= 2) sc.skills += 1;
    if ((p.projects || []).length >= 1) sc.projects += 1;
    if (names.includes('education')) sc.education += 1;
    if (names.includes('experience')) sc.experience += 1;
    if (names.includes('workshops & certifications')) sc.certifications += 1;
    if (names.includes('awards')) sc.awards += 1;

    // No markdown artefact may appear ANYWHERE the user can see.
    const visible = JSON.stringify(p);
    if (/<!--|-->|\|-{3,}|-{6,}/.test(visible)) {
      junk += 1;
      if (problems.length < 6) problems.push({ lang, name: p.name, snippet: (visible.match(/.{0,50}(<!--|-{6,}).{0,30}/) || [''])[0] });
    }
  }

  const cells = ['name','medium','skills','projects','education','experience','certifications','awards']
    .map(k => { total += RUNS; ok += sc[k]; const v = (sc[k]/RUNS)*100; return (v===100?'100%':v.toFixed(0)+'%').padStart(6); });
  total += RUNS; ok += (RUNS - junk);
  console.log(`  ${lang.padEnd(12)}${cells.join('  ')}  ${junk ? String(junk).padStart(5) + ' !!' : '    0'}`);
}

console.log('  ' + '-'.repeat(96));
console.log(`\n  TOTAL: ${ok} / ${total} checks passed  (${((ok/total)*100).toFixed(2)}%)\n`);
if (problems.length) {
  console.log('  Markdown artefacts that reached the user:');
  problems.forEach(p => console.log(`    [${p.lang}] name="${p.name}"  ...${p.snippet}...`));
  console.log('');
}
process.exitCode = ok === total ? 0 : 1;
