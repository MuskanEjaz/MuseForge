
function stripAiReasoning(value = '') { return String(value || ''); }
function cleanText(value = '') { return String(value || '').replace(/\s+/g, ' ').trim(); }
function normalizeCvTextForParsing(text = '') { return String(text || '').replace(/\r/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim(); }
function normalizeCvAutofillUrl(value = '') {
  let url = String(value || '').trim();
  if (!url || url === 'null' || url === 'undefined') return '';
  url = url.replace(/[),.;\]\s]+$/g, '');
  if (/^mailto:/i.test(url)) return url;
  if (/^www\./i.test(url)) url = `https://${url}`;
  if (!/^https?:\/\//i.test(url) && /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/|$)/.test(url)) url = `https://${url}`;
  return /^https?:\/\//i.test(url) ? url : '';
}

function normalizeCvVisibleUrl(value = '') {
  return normalizeCvAutofillUrl(value) || String(value || '').trim();
}

function isGithubRepoCvLink(url = '') {
  return /^https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/i.test(String(url || ''));
}

function isGithubProfileCvLink(url = '') {
  const clean = String(url || '').trim().replace(/\/$/, '');
  return /^https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9_.-]+$/i.test(clean);
}

function isLinkedInCvLink(url = '') {
  return /linkedin\.com\/in\//i.test(String(url || ''));
}

function isContactCvLink(url = '') {
  const clean = String(url || '').toLowerCase();
  return clean.startsWith('mailto:') || isGithubProfileCvLink(clean) || isLinkedInCvLink(clean) || /github\.io\/?(?:[?#].*)?$/i.test(clean);
}

function uniq(items = []) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const value = String(item || '').trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function extractUrlsFromText(value = '') {
  const text = String(value || '');
  const matches = text.match(/(?:https?:\/\/|www\.)[^\s)\]}>,;]+|(?:github\.com|linkedin\.com\/in|behance\.net|youtube\.com|youtu\.be|instagram\.com|drive\.google\.com|docs\.google\.com|medium\.com|devpost\.com|kaggle\.com)\/[^\s)\]}>,;]+/gi) || [];
  return uniq(matches.map(normalizeCvAutofillUrl).filter(Boolean));
}

function sortCvPdfLinksReadingOrder(items = []) {
  return [...items].sort((a, b) => {
    if ((a.page || 0) !== (b.page || 0)) return (a.page || 0) - (b.page || 0);
    return (b.y || 0) - (a.y || 0);
  });
}

async function extractCvEmbeddedLinksFromPdfBuffer(buffer) {
  try {
    let pdfjsLib;
    try {
      pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    } catch (_) {
      return [];
    }

    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      useWorkerFetch: false,
      isEvalSupported: false,
    }).promise;

    const results = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const annotations = await page.getAnnotations({ intent: 'display' });
      for (const annotation of annotations || []) {
        const url = normalizeCvAutofillUrl(annotation.url || annotation.unsafeUrl || '');
        if (!url) continue;
        const rect = Array.isArray(annotation.rect) ? annotation.rect.map(Number) : [];
        results.push({
          page: pageNumber,
          x: rect.length >= 4 ? Math.min(rect[0], rect[2]) : 0,
          y: rect.length >= 4 ? Math.max(rect[1], rect[3]) : 0,
          url,
        });
      }
    }

    const seen = new Set();
    return sortCvPdfLinksReadingOrder(results).filter(item => {
      const key = item.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (error) {
    console.warn('CV embedded link extraction failed:', error.message);
    return [];
  }
}

function preprocessText(text) {
  let t = String(text || '').replace(/\r/g, '\n');
  t = t.replace(/([a-zA-Z])\s+\.\s*(com|edu|pk|org|net|io|dev|app)\b/gi, '$1.$2');
  t = t.replace(/(github)\s*\.\s*com\s*\/\s*/gi, 'github.com/');
  t = t.replace(/(linkedin)\s*\.\s*com\s*\/\s*in\s*\/\s*/gi, 'linkedin.com/in/');
  t = t.replace(/([•▪●◦])/g, '\n$1 ');
  const headings = 'Summary|Profile|Objective|Education|Academic Background|Experience|Work Experience|Internships|Projects|Project Experience|Academic Projects|Skills|Technical Skills|Core Skills|Technologies|Certifications|Certificates|Courses|Workshops|Training|Awards|Achievements|Volunteering|Publications|Languages|Interests|Contact';
  t = t.replace(new RegExp(`\\b(${headings})\\b\\s*:?`, 'gi'), '\n$1\n');
  return normalizeCvTextForParsing(t);
}

const CV_SECTION_ALIASES = {
  summary: ['summary', 'profile', 'objective', 'about'],
  education: ['education', 'academic background', 'academics'],
  experience: ['experience', 'work experience', 'internships', 'employment', 'professional experience'],
  projects: ['projects', 'project experience', 'academic projects', 'selected projects'],
  skills: ['skills', 'technical skills', 'core skills', 'technologies', 'tools'],
  certifications: ['certifications', 'certificates', 'courses', 'workshops', 'training', 'licenses', 'credentials'],
  awards: ['awards', 'achievements', 'honors'],
  volunteering: ['volunteering', 'volunteer experience'],
  publications: ['publications', 'research'],
  languages: ['languages'],
  interests: ['interests'],
  contact: ['contact'],
};

function canonicalSectionName(line = '') {
  const cleaned = String(line || '').trim().replace(/^[-•▪●◦\s]+/, '').replace(/[:\-–—]+$/, '').replace(/\s+/g, ' ').toLowerCase();
  if (!cleaned || cleaned.length > 45) return '';
  for (const [canonical, aliases] of Object.entries(CV_SECTION_ALIASES)) {
    if (aliases.includes(cleaned)) return canonical;
  }
  return '';
}

function sectionTitle(canonical = '') {
  return {
    education: 'Education',
    experience: 'Experience',
    certifications: 'Certifications',
    awards: 'Awards',
    volunteering: 'Volunteering',
    publications: 'Publications',
    languages: 'Languages',
    interests: 'Interests',
  }[canonical] || canonical;
}

function buildCvSections(text = '') {
  const prepared = preprocessText(text);
  const lines = prepared.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const sections = {};
  let current = 'header';
  sections[current] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    const canonical = canonicalSectionName(line);
    if (canonical) {
      current = canonical;
      if (!sections[current]) sections[current] = [];
      continue;
    }
    if (!sections[current]) sections[current] = [];
    sections[current].push(line);
  }
  return sections;
}

function splitEntryCandidates(lines = []) {
  const joined = (Array.isArray(lines) ? lines : String(lines || '').split(/\n+/)).join('\n');
  const rough = joined
    .split(/\n(?=\s*(?:[-*•▪●◦]|[A-Z][^\n]{2,90}(?:\s[-–—:]|$)))|[•▪●◦]|\s\|\s|;(?=\s*[A-Z])/g)
    .map(item => item.replace(/^[-*•▪●◦]\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(item => item.length > 2 && !canonicalSectionName(item));

  const output = [];
  for (const item of rough) {
    const starts = [];
    const re = /(?:^|\s)([A-Z][A-Za-z0-9&+#/() ]{2,80}?)\s[-–—:]\s/g;
    let match;
    while ((match = re.exec(item)) !== null) {
      const idx = match.index + (match[0].startsWith(' ') ? 1 : 0);
      if (!starts.length || idx - starts[starts.length - 1] > 10) starts.push(idx);
    }
    if (starts.length <= 1) {
      output.push(item);
      continue;
    }
    starts.push(item.length);
    for (let i = 0; i < starts.length - 1; i += 1) {
      const part = item.slice(starts[i], starts[i + 1]).trim();
      if (part.length > 2 && !canonicalSectionName(part)) output.push(part);
    }
  }

  return output.slice(0, 30);
}

function splitSkills(lines = []) {
  const text = (Array.isArray(lines) ? lines.join('\n') : String(lines || ''));
  return uniq(text
    .split(/,|\n|•|\u2022|\||;/g)
    .map(s => s.replace(/^[-*]\s*/, '').replace(/\(.+?\)/g, '').trim())
    .filter(s => s.length > 1 && s.length < 45 && !canonicalSectionName(s) && !/^(proficient|familiar|tools|languages)$/i.test(s)));
}

function entryTitleAndDesc(entry = '', fallbackTitle = 'Item') {
  const clean = String(entry || '').replace(/\s+/g, ' ').trim();
  const withoutUrl = clean.replace(/(?:https?:\/\/|www\.)\S+/gi, '').trim();
  const parts = withoutUrl.split(/\s[-–—:]\s|[-–—:](?=\s)/);
  const rawTitle = (parts[0] || withoutUrl || fallbackTitle).trim();
  const title = rawTitle.slice(0, 110) || fallbackTitle;
  const desc = (parts.length > 1 ? parts.slice(1).join(' - ') : withoutUrl).trim().slice(0, 420);
  return { title, desc: desc || withoutUrl.slice(0, 420) || title };
}

function nextUnusedLink(links = [], used = new Set(), predicate = () => true) {
  for (const link of links) {
    const url = normalizeCvAutofillUrl(link.url || link);
    if (!url || used.has(url.toLowerCase()) || !predicate(url)) continue;
    used.add(url.toLowerCase());
    return url;
  }
  return null;
}

function visibleOrNextLink(entry = '', allLinks = [], used = new Set(), predicate = () => true) {
  const visible = extractUrlsFromText(entry).find(url => predicate(url));
  if (visible) {
    used.add(visible.toLowerCase());
    return visible;
  }
  return nextUnusedLink(allLinks, used, predicate);
}

function normalizeContactUrl(url = '') {
  const clean = normalizeCvAutofillUrl(url);
  return clean && !clean.startsWith('mailto:') ? clean : null;
}

function parseCvTextLocally(cvText = '', embeddedLinks = []) {
  const text = preprocessText(cvText);
  const sections = buildCvSections(text);
  const headerLines = sections.header || [];
  const allLines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const visibleLinks = extractUrlsFromText(text).map(url => ({ url, page: 0, y: 0 }));
  const allLinks = sortCvPdfLinksReadingOrder([...(Array.isArray(embeddedLinks) ? embeddedLinks : []), ...visibleLinks])
    .map(item => ({ ...item, url: normalizeCvAutofillUrl(item.url || item) }))
    .filter(item => item.url);
  const usedLinks = new Set();

  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = text.match(/(?:\+?\d[\d\s().-]{8,}\d)/);
  const githubProfile = allLinks.find(item => isGithubProfileCvLink(item.url));
  const linkedinProfile = allLinks.find(item => isLinkedInCvLink(item.url));
  const portfolioLink = allLinks.find(item => /github\.io\/?(?:[?#].*)?$/i.test(item.url));
  const mailtoLink = allLinks.find(item => String(item.url).toLowerCase().startsWith('mailto:'));

  const name = (headerLines.concat(allLines)).find(line =>
    line.length <= 80 &&
    /[A-Za-z]/.test(line) &&
    !/@/.test(line) &&
    !/https?:\/\//i.test(line) &&
    !/^(curriculum vitae|resume|cv|profile|summary|contact|portfolio)$/i.test(line) &&
    !/(github|linkedin|phone|email|islamabad|pakistan)/i.test(line)
  ) || (emailMatch ? emailMatch[0].split('@')[0].replace(/[._-]+/g, ' ') : 'Your Name');

  const skills = splitSkills(sections.skills || []);

  const projectEntries = splitEntryCandidates(sections.projects || []).slice(0, 10);
  const projectLinks = allLinks.filter(item => isGithubRepoCvLink(item.url));
  const projects = projectEntries.map((entry, index) => {
    const { title, desc } = entryTitleAndDesc(entry, `Project ${index + 1}`);
    const link = visibleOrNextLink(entry, projectLinks, usedLinks, isGithubRepoCvLink);
    return { title, desc, link };
  });

  const proofLinks = allLinks.filter(item => !isContactCvLink(item.url) && !isGithubRepoCvLink(item.url));
  const customSections = [];
  const addSection = (canonical, displayName = sectionTitle(canonical)) => {
    const entries = splitEntryCandidates(sections[canonical] || []).slice(0, 12);
    if (!entries.length) return;
    const shouldAttachProof = /cert|course|workshop|training|award|achievement|publication|volunteer|license|credential/i.test(displayName);
    customSections.push({
      name: displayName,
      items: entries.map((entry, index) => {
        const { title, desc } = entryTitleAndDesc(entry, `${displayName} ${index + 1}`);
        const link = visibleOrNextLink(entry, shouldAttachProof ? proofLinks : [], usedLinks, () => true);
        return { heading: title, desc, link };
      })
    });
  };

  addSection('education', 'Education');
  addSection('experience', 'Experience');
  addSection('certifications', 'Certifications');
  addSection('awards', 'Awards');
  addSection('volunteering', 'Volunteering');
  addSection('publications', 'Publications');

  const remainingProofLinks = proofLinks.filter(item => !usedLinks.has(String(item.url || '').toLowerCase()));
  if (remainingProofLinks.length && !customSections.some(section => /cert|workshop|course|training/i.test(section.name))) {
    customSections.push({
      name: 'Certifications',
      items: remainingProofLinks.slice(0, 8).map((item, index) => ({
        heading: `Linked CV item ${index + 1}`,
        desc: 'Certificate, workshop, or proof link extracted from the uploaded CV.',
        link: item.url,
      }))
    });
  }

  const descriptionParts = [];
  if (skills.length) descriptionParts.push(`I work with ${skills.slice(0, 8).join(', ')}.`);
  if (projects.length) descriptionParts.push(`My portfolio includes ${projects.length} project${projects.length > 1 ? 's' : ''} extracted from my CV.`);
  if (!descriptionParts.length) descriptionParts.push('This portfolio was auto-filled from the uploaded CV. Please review and edit the details before generating the final portfolio.');

  return {
    name: cleanText(name),
    medium: skills.length ? 'Student / Job Seeker' : 'Portfolio Creator',
    description: descriptionParts.join(' '),
    projects,
    skills,
    contact: {
      email: emailMatch ? emailMatch[0] : (mailtoLink ? mailtoLink.url.replace(/^mailto:/i, '') : null),
      phone: phoneMatch ? phoneMatch[0].trim() : null,
      whatsapp: phoneMatch ? phoneMatch[0].trim() : null,
      github: normalizeContactUrl(githubProfile?.url),
      linkedin: normalizeContactUrl(linkedinProfile?.url),
      address: null,
      links: portfolioLink ? [{ label: 'Portfolio', url: portfolioLink.url }] : [],
    },
    customSections,
    parser: 'local-robust',
  };
}

function attachCvEmbeddedLinksAfterParsing(parsed = {}, embeddedLinks = [], cvText = '') {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const visibleLinks = extractUrlsFromText(cvText).map(url => ({ url, page: 0, y: 0 }));
  const links = sortCvPdfLinksReadingOrder([...(Array.isArray(embeddedLinks) ? embeddedLinks : []), ...visibleLinks])
    .map(item => ({ ...item, url: normalizeCvAutofillUrl(item.url || item) }))
    .filter(item => item.url);
  if (!links.length) return parsed;

  if (!parsed.contact || typeof parsed.contact !== 'object') parsed.contact = {};
  const emailLink = links.find(item => String(item.url).toLowerCase().startsWith('mailto:'));
  const githubProfile = links.find(item => isGithubProfileCvLink(item.url));
  const linkedinProfile = links.find(item => isLinkedInCvLink(item.url));
  const portfolioLink = links.find(item => /github\.io\/?(?:[?#].*)?$/i.test(item.url));

  if ((!parsed.contact.email || parsed.contact.email === 'null') && emailLink) parsed.contact.email = emailLink.url.replace(/^mailto:/i, '');
  if ((!parsed.contact.github || parsed.contact.github === 'null') && githubProfile) parsed.contact.github = githubProfile.url;
  if ((!parsed.contact.linkedin || parsed.contact.linkedin === 'null') && linkedinProfile) parsed.contact.linkedin = linkedinProfile.url;
  if (!Array.isArray(parsed.contact.links)) parsed.contact.links = [];
  if (portfolioLink && !parsed.contact.links.some(link => String(link.url || '').toLowerCase() === portfolioLink.url.toLowerCase())) parsed.contact.links.push({ label: 'Portfolio', url: portfolioLink.url });

  const used = new Set();
  const projectLinks = links.filter(item => isGithubRepoCvLink(item.url));
  if (Array.isArray(parsed.projects)) {
    parsed.projects = parsed.projects.map(project => {
      if (normalizeCvAutofillUrl(project.link || '')) return { ...project, link: normalizeCvAutofillUrl(project.link) };
      const next = nextUnusedLink(projectLinks, used, isGithubRepoCvLink);
      return { ...project, link: next || null };
    });
  }

  const proofLinks = links.filter(item => !isContactCvLink(item.url) && !isGithubRepoCvLink(item.url));
  if (Array.isArray(parsed.customSections)) {
    parsed.customSections = parsed.customSections.map(section => ({
      ...section,
      items: Array.isArray(section.items) ? section.items.map(item => {
        if (normalizeCvAutofillUrl(item.link || item.url || '')) return { ...item, link: normalizeCvAutofillUrl(item.link || item.url) };
        if (!/(cert|certificate|course|workshop|training|award|achievement|publication|volunteer|license|credential)/i.test(section.name || '')) return { ...item, link: null };
        const next = nextUnusedLink(proofLinks, used, () => true);
        return { ...item, link: next || null };
      }) : [],
    }));
  }
  return parsed;
}



const first = ['Ayesha','Zain','Muskan','Hamza','Sara','Ali','Fatima','Bilal','Hira','Usman'];
const last = ['Khan','Ahmed','Ejaz','Malik','Raza','Sheikh','Tariq','Nadeem','Iqbal','Farooq'];
const skillsPool = ['React','Node.js','Python','C++','MongoDB','Express','SQL','JavaScript','TensorFlow','OpenCV','Docker','Git'];
const sections = ['Certifications','Certificates','Courses','Workshops','Training'];
let failures = [];
function assert(cond, msg){ if(!cond) failures.push(msg); }
function makeCv(i){
  const name = `${first[i%first.length]} ${last[i%last.length]}`;
  const skills = [skillsPool[i%skillsPool.length], skillsPool[(i+3)%skillsPool.length], skillsPool[(i+5)%skillsPool.length], skillsPool[(i+7)%skillsPool.length]];
  const projectA = `Campus Opportunity Aggregator - Built a MERN platform for campus opportunities and filtering.`;
  const projectB = `Social Graph Explorer - Implemented graph algorithms including BFS and Dijkstra for network exploration.`;
  const certHead = sections[i%sections.length];
  const bullet = ['-','•','*'][i%3];
  const visibleProjectLinks = i % 4 === 0;
  const visibleProofLinks = i % 5 === 0;
  const sameLine = i % 6 === 0;
  const lines = [
    name,
    `me${i}@example.com | +92 300 12345${String(i).padStart(2,'0')} | github.com/user${i} | linkedin.com/in/user${i}`,
    sameLine ? `Skills ${skills.join(', ')} Projects ${projectA}${visibleProjectLinks ? ` https://github.com/user${i}/campus-aggregator` : ''} ${projectB}${visibleProjectLinks ? ` https://github.com/user${i}/social-graph` : ''} Education BS Computer Science - NUST Islamabad, 2024 Present ${certHead} IBM AI Certificate - IBM SkillsBuild${visibleProofLinks ? ` https://drive.google.com/file/d/proof${i}a` : ''} Agentic AI Workshop - NSTP${visibleProofLinks ? ` https://drive.google.com/file/d/proof${i}b` : ''}` : null,
    !sameLine ? 'Skills' : null,
    !sameLine ? skills.join(', ') : null,
    !sameLine ? 'Projects' : null,
    !sameLine ? `${bullet} ${projectA}${visibleProjectLinks ? ` https://github.com/user${i}/campus-aggregator` : ''}` : null,
    !sameLine ? `${bullet} ${projectB}${visibleProjectLinks ? ` https://github.com/user${i}/social-graph` : ''}` : null,
    !sameLine ? 'Education' : null,
    !sameLine ? `${bullet} BS Computer Science - NUST Islamabad, 2024 Present` : null,
    !sameLine ? certHead : null,
    !sameLine ? `${bullet} IBM AI Certificate - IBM SkillsBuild${visibleProofLinks ? ` https://drive.google.com/file/d/proof${i}a` : ''}` : null,
    !sameLine ? `${bullet} Agentic AI Workshop - NSTP${visibleProofLinks ? ` https://drive.google.com/file/d/proof${i}b` : ''}` : null,
  ].filter(Boolean);
  const embeddedLinks = [
    {url:`mailto:me${i}@example.com`, page:1, y:900},
    {url:`https://github.com/user${i}`, page:1, y:890},
    {url:`https://www.linkedin.com/in/user${i}/`, page:1, y:880},
    {url:`https://github.com/user${i}/campus-aggregator`, page:1, y:600},
    {url:`https://github.com/user${i}/social-graph`, page:1, y:580},
    {url:`https://drive.google.com/file/d/proof${i}a`, page:1, y:220},
    {url:`https://drive.google.com/file/d/proof${i}b`, page:1, y:200},
  ];
  return {text: lines.join('\n'), embeddedLinks, name, skills};
}

for(let i=0;i<100;i++){
  const cv = makeCv(i);
  const parsed = parseCvTextLocally(cv.text, cv.embeddedLinks);
  assert(parsed.name && parsed.name.includes(cv.name.split(' ')[0]), `#${i} name failed: ${parsed.name}`);
  assert(parsed.contact && parsed.contact.email === `me${i}@example.com`, `#${i} email failed`);
  assert(parsed.contact.github === `https://github.com/user${i}`, `#${i} github profile failed: ${parsed.contact.github}`);
  assert(parsed.contact.linkedin && parsed.contact.linkedin.includes(`/user${i}`), `#${i} linkedin failed: ${parsed.contact.linkedin}`);
  assert(parsed.skills.length >= 3, `#${i} skills failed: ${parsed.skills.join(',')}`);
  assert(parsed.projects.length >= 2, `#${i} projects count failed: ${parsed.projects.length}`);
  assert(parsed.projects[0] && parsed.projects[0].link === `https://github.com/user${i}/campus-aggregator`, `#${i} project 1 link failed: ${parsed.projects[0] && parsed.projects[0].link}`);
  assert(parsed.projects[1] && parsed.projects[1].link === `https://github.com/user${i}/social-graph`, `#${i} project 2 link failed: ${parsed.projects[1] && parsed.projects[1].link}`);
  const certSec = (parsed.customSections || []).find(s => /cert|course|workshop|training/i.test(s.name));
  assert(certSec && certSec.items.length >= 2, `#${i} cert section failed`);
  assert(certSec && certSec.items[0] && certSec.items[0].link === `https://drive.google.com/file/d/proof${i}a`, `#${i} proof 1 link failed: ${certSec && certSec.items[0] && certSec.items[0].link}`);
  assert(certSec && certSec.items[1] && certSec.items[1].link === `https://drive.google.com/file/d/proof${i}b`, `#${i} proof 2 link failed: ${certSec && certSec.items[1] && certSec.items[1].link}`);
}
if(failures.length){
  console.error(`FAILED ${failures.length} assertions`);
  console.error(failures.slice(0,50).join('\n'));
  process.exit(1);
}
console.log('PASS: 100 synthetic CV parser cases passed (names, contact, skills, projects, custom sections, visible links, embedded links).');
