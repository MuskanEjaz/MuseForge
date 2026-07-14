'use strict';
/*
 * Generates N diverse synthetic CVs (as raw text, the way PDF extraction yields it),
 * runs them through the REAL server.js parseCvTextLocally, and scores section-parsing
 * accuracy against the ground truth used to build each CV.
 *
 * No network / no AI: parseCvTextLocally is pure JS. This is exactly the "CV parsing
 * is weak, sections not parsed correctly" problem the user asked to fix.
 */

const { __test } = require('./server.js');
const { parseCvTextLocally } = __test;

// ---------- deterministic RNG so runs are reproducible ----------
let _seed = parseInt(process.env.SEED || '1234567', 10);
function rand() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
function chance(p) { return rand() < p; }
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---------- data pools ----------
const FIRST = ['Ayesha', 'Bilal', 'Hamza', 'Fatima', 'Usman', 'Zara', 'Ali', 'Sana', 'Hassan', 'Maryam', 'Ahmed', 'Noor', 'Omar', 'Iqra', 'Saad', 'Laiba', 'Danish', 'Hira', 'Talha', 'Areeba', 'Junaid', 'Mahnoor', 'Faizan', 'Kiran', 'Rehan'];
const LAST = ['Khan', 'Ahmed', 'Malik', 'Butt', 'Raza', 'Sheikh', 'Qureshi', 'Farooq', 'Nawaz', 'Hussain', 'Iqbal', 'Siddiqui', 'Chaudhry', 'Abbasi', 'Zafar'];

const ROLES = [
  'Full Stack Developer', 'Software Engineer', 'Frontend Developer', 'Graphic Designer',
  'UI/UX Designer', 'Data Analyst', 'Computer Science Student', 'Photographer',
  'Content Writer', 'Music Producer', 'Machine Learning Engineer', 'Backend Developer',
  'Mobile App Developer', 'Digital Marketer', 'Video Editor'
];

const SKILL_POOL = ['Python', 'JavaScript', 'React', 'Node.js', 'Express', 'MongoDB', 'SQL', 'C++', 'Java', 'HTML', 'CSS', 'TypeScript', 'Django', 'Flask', 'Figma', 'Photoshop', 'Illustrator', 'Premiere Pro', 'TensorFlow', 'Git', 'Docker', 'AWS', 'PostgreSQL', 'Redux', 'Tailwind'];
const SOFT_SKILLS = ['Leadership', 'Communication', 'Teamwork', 'Problem Solving', 'Time Management', 'Adaptability'];

const PROJECT_NAMES = ['MuseForge', 'TaskFlow', 'ShopEase', 'MediTrack', 'EduConnect', 'FitPulse', 'CryptoWallet', 'FoodieHub', 'TravelMate', 'BudgetBuddy', 'CodeArena', 'ArtStation Clone', 'WeatherNow', 'ChatSphere', 'PortfolioX'];
const PROJECT_VERBS = ['Built', 'Developed', 'Designed', 'Implemented', 'Created', 'Engineered'];
const PROJECT_TECH = ['React, Node.js, MongoDB', 'Python, Flask, PostgreSQL', 'MERN Stack', 'Next.js, Tailwind, Firebase', 'Django, React, Redis', 'Vue.js, Express, MySQL'];

const UNIS = ['NUST Islamabad', 'COMSATS University', 'FAST-NUCES Lahore', 'UET Lahore', 'GIKI Topi', 'LUMS Lahore', 'Punjab University'];
const DEGREES = ['BS Computer Science', 'BS Software Engineering', 'BSc Electrical Engineering', 'BS Data Science', 'BS Artificial Intelligence'];

const COMPANIES = ['SNGPL', 'Systems Limited', 'NetSol Technologies', 'Techlogix', 'Arbisoft', '10Pearls', 'Confiz'];
const EXP_ROLES = ['Software Engineering Intern', 'Frontend Developer Intern', 'Web Development Intern', 'Data Analyst Intern', 'UI Design Intern'];

const CERTS = ['Meta Front-End Developer', 'Google Data Analytics', 'AWS Cloud Practitioner', 'Coursera Machine Learning Specialization', 'freeCodeCamp Responsive Web Design', 'IBM Data Science Professional'];
const AWARDS = ['Dean\'s List 2023', 'Winner, National Hackathon 2024', '1st Position FYP Gala', 'Best Design Award', 'Runner-up ProCom Speed Programming'];
const LANGS = ['English', 'Urdu', 'Punjabi', 'Arabic'];
const HOBBIES = ['Chess', 'Reading', 'Photography', 'Football', 'Sketching', 'Gaming'];

// Section header style variants — this is the crux of the parsing-robustness test.
const HEADERS = {
  summary: ['SUMMARY', 'PROFESSIONAL SUMMARY', 'PROFILE', 'OBJECTIVE', 'CAREER OBJECTIVE', 'ABOUT ME', 'SUMMARY OF QUALIFICATIONS'],
  skills: ['SKILLS', 'TECHNICAL SKILLS', 'CORE SKILLS', 'CORE COMPETENCIES', 'SKILLS & TOOLS', 'KEY SKILLS', 'TECHNOLOGIES', 'AREAS OF EXPERTISE'],
  projects: ['PROJECTS', 'PROJECT EXPERIENCE', 'ACADEMIC PROJECTS', 'SELECTED PROJECTS', 'KEY PROJECTS', 'PERSONAL PROJECTS'],
  education: ['EDUCATION', 'ACADEMIC BACKGROUND', 'EDUCATIONAL BACKGROUND', 'ACADEMIC QUALIFICATIONS'],
  experience: ['EXPERIENCE', 'WORK EXPERIENCE', 'PROFESSIONAL EXPERIENCE', 'WORK HISTORY', 'EMPLOYMENT HISTORY', 'INTERNSHIPS'],
  certifications: ['CERTIFICATIONS', 'CERTIFICATES', 'COURSES', 'RELEVANT COURSEWORK', 'LICENSES & CERTIFICATIONS'],
  awards: ['AWARDS', 'ACHIEVEMENTS', 'HONORS', 'AWARDS & HONORS', 'ACCOMPLISHMENTS'],
  languages: ['LANGUAGES', 'LANGUAGE PROFICIENCY'],
  interests: ['HOBBIES', 'INTERESTS', 'HOBBIES & INTERESTS'],
  references: ['REFERENCES', 'REFEREES'],
};

function emit(header, styleKind) {
  // styleKind: 'plain' | 'wrapped' | 'inline'
  if (styleKind === 'wrapped' && header.includes(' ')) {
    // split a two-word header across two lines: "TECHNICAL\nSKILLS"
    const parts = header.split(' ');
    if (parts.length === 2) return parts; // array => two lines
  }
  return [header];
}

function bullet(text) { return chance(0.6) ? `• ${text}` : (chance(0.5) ? `- ${text}` : text); }

function buildCV(i) {
  const name = `${pick(FIRST)} ${pick(LAST)}`;
  const role = pick(ROLES);
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}@gmail.com`;
  const phone = `+92 3${Math.floor(rand() * 90 + 10)} ${Math.floor(rand() * 9000000 + 1000000)}`;
  const github = `github.com/${name.split(' ')[0].toLowerCase()}${Math.floor(rand() * 99)}`;
  const linkedin = `linkedin.com/in/${name.toLowerCase().replace(/\s+/g, '-')}`;

  const lines = [];
  const truth = { name, role, sections: {}, projectCount: 0, skillCount: 0 };

  // header block
  lines.push(name);
  lines.push(role);
  if (chance(0.7)) lines.push(`${email} | ${phone}`);
  else { lines.push(email); lines.push(phone); }
  if (chance(0.6)) lines.push(`${github} | ${linkedin}`);

  // decide global header style for this CV
  const globalStyle = pick(['plain', 'plain', 'inline', 'wrapped']); // bias to plain

  function addSection(key, headerText, bodyLines, inlineContent) {
    const style = key === 'skills' && globalStyle === 'inline' ? 'inline'
      : globalStyle === 'wrapped' ? 'wrapped' : 'plain';

    if (style === 'inline' && inlineContent) {
      lines.push(`${headerText}: ${inlineContent}`);
      // remaining body still appended
      bodyLines.forEach(l => lines.push(l));
    } else {
      emit(headerText, style).forEach(h => lines.push(h));
      bodyLines.forEach(l => lines.push(l));
    }
    truth.sections[key] = true;
  }

  // SUMMARY (most CVs)
  if (chance(0.85)) {
    addSection('summary', pick(HEADERS.summary),
      [`Motivated ${role} with a strong foundation in building real-world projects and a passion for clean, effective solutions.`], null);
  }

  // EDUCATION (almost all)
  {
    const uni = pick(UNIS), deg = pick(DEGREES);
    addSection('education', pick(HEADERS.education),
      [`${uni}`, `${deg}`, chance(0.7) ? `2021 - 2025` : `Sep 2020 – Jun 2024`, chance(0.3) ? `CGPA: 3.${Math.floor(rand() * 9)}/4.0` : null].filter(Boolean), null);
  }

  // SKILLS (almost all)
  {
    const chosen = shuffle(SKILL_POOL).slice(0, Math.floor(rand() * 6) + 4);
    if (chance(0.3)) chosen.push(...shuffle(SOFT_SKILLS).slice(0, 2));
    truth.skillCount = chosen.length;
    const inline = chosen.join(', ');
    const bodyStyle = pick(['csv', 'csv', 'bullets', 'labeled']);
    let body;
    if (bodyStyle === 'csv') body = [inline];
    else if (bodyStyle === 'bullets') body = chosen.map(s => bullet(s));
    else body = [`Languages: ${chosen.slice(0, 3).join(', ')}`, `Frameworks: ${chosen.slice(3).join(', ')}`];
    addSection('skills', pick(HEADERS.skills), body, inline);
  }

  // PROJECTS (most)
  if (chance(0.9)) {
    const n = Math.floor(rand() * 3) + 1;
    truth.projectCount = n;
    const body = [];
    const usedNames = shuffle(PROJECT_NAMES).slice(0, n);
    usedNames.forEach(pn => {
      body.push(pn);
      if (chance(0.5)) body.push(pick(PROJECT_TECH));
      const nb = Math.floor(rand() * 2) + 1;
      for (let b = 0; b < nb; b++) body.push(bullet(`${pick(PROJECT_VERBS)} core features and improved the overall user experience.`));
      if (chance(0.4)) body.push(`github.com/${name.split(' ')[0].toLowerCase()}/${pn.toLowerCase().replace(/\s+/g, '-')}`);
    });
    addSection('projects', pick(HEADERS.projects), body, null);
  }

  // EXPERIENCE (some)
  if (chance(0.6)) {
    const body = [`${pick(EXP_ROLES)} — ${pick(COMPANIES)}`, chance(0.7) ? `Jun 2023 - Aug 2023` : `Summer 2023`];
    const nb = Math.floor(rand() * 2) + 1;
    for (let b = 0; b < nb; b++) body.push(bullet(`${pick(['Collaborated', 'Developed', 'Implemented', 'Built'])} on production features with the engineering team.`));
    addSection('experience', pick(HEADERS.experience), body, null);
  }

  // CERTIFICATIONS (some)
  if (chance(0.55)) {
    const body = shuffle(CERTS).slice(0, Math.floor(rand() * 2) + 1).map(c => bullet(c));
    addSection('certifications', pick(HEADERS.certifications), body, null);
  }

  // AWARDS (some)
  if (chance(0.45)) {
    const body = shuffle(AWARDS).slice(0, Math.floor(rand() * 2) + 1).map(a => bullet(a));
    addSection('awards', pick(HEADERS.awards), body, null);
  }

  // LANGUAGES (some) — currently-missed section
  if (chance(0.4)) {
    addSection('languages', pick(HEADERS.languages), [shuffle(LANGS).slice(0, 3).join(', ')], null);
  }

  // HOBBIES/INTERESTS (some) — currently-missed section
  if (chance(0.35)) {
    addSection('interests', pick(HEADERS.interests), [shuffle(HOBBIES).slice(0, 3).join(', ')], null);
  }

  // REFERENCES (some) — currently-missed section
  if (chance(0.3)) {
    addSection('references', pick(HEADERS.references), [chance(0.5) ? 'Available on request.' : 'Dr. Ahmed Raza, Professor, NUST — a.raza@nust.edu.pk'], null);
  }

  return { text: lines.join('\n'), truth, meta: { globalStyle } };
}

// ---------- map ground-truth section -> where it should show up in parser output ----------
// parser output has: name, medium, description(summary), skills[], projects[], contact{}, customSections[]
// customSections names: 'Education','Experience','Workshops & Certifications','Awards','Extracurricular Activities'
function sectionPresentInOutput(key, parsed) {
  const names = (parsed.customSections || []).map(s => (s.name || '').toLowerCase());
  const has = (substr) => names.some(n => n.includes(substr));
  switch (key) {
    case 'summary': return Boolean(parsed.description && parsed.description.length > 20
      && !/auto-filled|auto filled|please review/i.test(parsed.description));
    case 'skills': return (parsed.skills || []).length > 0;
    case 'projects': return (parsed.projects || []).length > 0;
    case 'education': return has('education');
    case 'experience': return has('experience');
    case 'certifications': return has('cert') || has('workshop') || has('course');
    case 'awards': return has('award') || has('achiev') || has('honor');
    case 'languages': return has('language');
    case 'interests': return has('hobb') || has('interest') || has('extracurricular');
    case 'references': return has('reference') || has('referee');
    default: return false;
  }
}

function nameMatches(expected, got) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
  return norm(expected) === norm(got);
}

module.exports = { buildCV, sectionPresentInOutput, nameMatches };
if (require.main !== module) { /* imported for debugging */ return; }

// ---------- run ----------
const N = parseInt(process.argv[2] || '100', 10);
const perSection = {};
const totals = { nameOK: 0, skillsCloseCount: 0, projectsCloseCount: 0, cvs: 0, falseSections: 0 };
const failures = [];

for (let i = 0; i < N; i++) {
  const { text, truth, meta } = buildCV(i);
  let parsed;
  try { parsed = parseCvTextLocally(text, []); }
  catch (e) { failures.push({ i, err: e.message, style: meta.globalStyle }); continue; }
  totals.cvs++;

  if (nameMatches(truth.name, parsed.name)) totals.nameOK++;
  else failures.push({ i, type: 'name', expected: truth.name, got: parsed.name, style: meta.globalStyle });

  // section recall
  Object.keys(truth.sections).forEach(key => {
    perSection[key] = perSection[key] || { expected: 0, found: 0 };
    perSection[key].expected++;
    if (sectionPresentInOutput(key, parsed)) perSection[key].found++;
    else if (failures.length < 400) failures.push({ i, type: 'missing-section', key, style: meta.globalStyle, header: '(see gen)' });
  });

  // skills count sanity (found at least 60% of expected)
  if (truth.skillCount) {
    if ((parsed.skills || []).length >= Math.ceil(truth.skillCount * 0.6)) totals.skillsCloseCount++;
  }
  if (truth.projectCount) {
    if ((parsed.projects || []).length >= 1) totals.projectsCloseCount++;
  }
}

console.log(`\n================ CV PARSER TEST: ${totals.cvs}/${N} CVs parsed without crash ================`);
console.log(`Name extracted correctly:        ${totals.nameOK}/${totals.cvs}  (${pct(totals.nameOK, totals.cvs)})`);
console.log(`Skills >=60% captured:           ${totals.skillsCloseCount}  CVs`);
console.log(`>=1 project captured (when any): ${totals.projectsCloseCount}  CVs`);
console.log(`\n---- Section recall (found / expected) ----`);
const order = ['summary', 'skills', 'projects', 'education', 'experience', 'certifications', 'awards', 'languages', 'interests', 'references'];
for (const key of order) {
  const s = perSection[key]; if (!s) continue;
  console.log(`  ${key.padEnd(16)} ${String(s.found).padStart(3)} / ${String(s.expected).padStart(3)}   ${pct(s.found, s.expected)}`);
}

// crashes
const crashes = failures.filter(f => f.err);
if (crashes.length) {
  console.log(`\n---- CRASHES (${crashes.length}) ----`);
  crashes.slice(0, 10).forEach(c => console.log(`  CV#${c.i} [${c.style}]: ${c.err}`));
}

// name failures
const nameFails = failures.filter(f => f.type === 'name');
if (nameFails.length) {
  console.log(`\n---- NAME failures (${nameFails.length}) ----`);
  nameFails.slice(0, 12).forEach(f => console.log(`  CV#${f.i} [${f.style}] expected="${f.expected}" got="${f.got}"`));
}

// missing-section breakdown by section+style
const miss = failures.filter(f => f.type === 'missing-section');
if (miss.length) {
  const byKey = {};
  miss.forEach(f => { byKey[f.key] = byKey[f.key] || {}; byKey[f.key][f.style] = (byKey[f.key][f.style] || 0) + 1; });
  console.log(`\n---- Missing-section failures by header style ----`);
  Object.entries(byKey).forEach(([k, styles]) => {
    console.log(`  ${k.padEnd(16)} ${JSON.stringify(styles)}`);
  });
}

function pct(a, b) { return b ? `${(100 * a / b).toFixed(1)}%` : 'n/a'; }
