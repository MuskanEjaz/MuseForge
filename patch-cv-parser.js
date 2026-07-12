const fs = require('fs');
const path = require('path');

function walk(dir, matches = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'build', 'dist'].includes(item.name)) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, matches);
    else matches.push(full);
  }
  return matches;
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, text) {
  fs.writeFileSync(file, text, 'utf8');
}

function findFileByContent(fileName, mustContain) {
  return walk(process.cwd()).find(file => {
    if (path.basename(file) !== fileName) return false;
    try {
      return read(file).includes(mustContain);
    } catch (_) {
      return false;
    }
  });
}

function replaceFunction(source, functionName, replacement) {
  const needle = 'function ' + functionName;
  const start = source.indexOf(needle);
  if (start < 0) throw new Error('Function not found: ' + functionName);

  const braceStart = source.indexOf('{', start);
  if (braceStart < 0) throw new Error('Opening brace not found for: ' + functionName);

  let depth = 0;
  let inString = null;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    const prev = source[i - 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }

    if (inTemplate) {
      if (ch === '`' && prev !== '\\') inTemplate = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }

    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(0, start) + replacement.trim() + '\n\n' + source.slice(i + 1);
      }
    }
  }

  throw new Error('Closing brace not found for: ' + functionName);
}

const serverPath = findFileByContent('server.js', "app.post('/parse-cv'");
if (!serverPath) throw new Error('backend server.js with /parse-cv not found.');

let server = read(serverPath);
const backupServer = serverPath + '.backup.cv-parser-patch-' + Date.now();
write(backupServer, server);

const cvSectionsReplacement = String.raw`
function cvSoftCleanLine(value = '') {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function cvSoftStripBullet(value = '') {
  return cvSoftCleanLine(value)
    .replace(/^[\s•●▪▫◦*+\-–—]+\s*/, '')
    .replace(/^\(?\d+[\).]\s*/, '')
    .trim();
}

function cvDateRegexStrong() {
  return /\b(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*)?(?:19|20)\d{2}\s*(?:[–—-]\s*(?:Present|Current|Now|(?:19|20)\d{2}))?\b/i;
}

function cvHeadingAliasMapStrong() {
  return {
    summary: 'summary',
    profile: 'summary',
    'professional summary': 'summary',
    'career summary': 'summary',
    about: 'summary',
    'about me': 'summary',
    objective: 'summary',
    'career objective': 'summary',

    education: 'education',
    academics: 'education',
    'academic background': 'education',
    'academic qualification': 'education',
    'academic qualifications': 'education',
    qualifications: 'education',

    experience: 'experience',
    'work experience': 'experience',
    'professional experience': 'experience',
    employment: 'experience',
    'employment history': 'experience',
    internships: 'experience',
    internship: 'experience',
    'volunteer experience': 'experience',

    projects: 'projects',
    project: 'projects',
    'academic projects': 'projects',
    'personal projects': 'projects',
    'selected projects': 'projects',
    'key projects': 'projects',
    portfolio: 'projects',

    skills: 'skills',
    'technical skills': 'skills',
    'core skills': 'skills',
    'key skills': 'skills',
    technologies: 'skills',
    tools: 'skills',
    'tools and technologies': 'skills',
    'programming skills': 'skills',

    certifications: 'certifications',
    certificates: 'certifications',
    certificate: 'certifications',
    courses: 'certifications',
    'online courses': 'certifications',
    training: 'certifications',
    trainings: 'certifications',
    licenses: 'certifications',

    achievements: 'achievements',
    achievement: 'achievements',
    awards: 'achievements',
    honors: 'achievements',
    honours: 'achievements',
    accomplishments: 'achievements',

    activities: 'activities',
    'leadership': 'activities',
    'leadership and activities': 'activities',
    'extra curricular': 'activities',
    extracurricular: 'activities',
    'extracurricular activities': 'activities',
    volunteering: 'activities',
    volunteer: 'activities',
    societies: 'activities',

    publications: 'publications',
    publication: 'publications',
    research: 'publications',
    papers: 'publications',

    languages: 'languages',
    interests: 'interests',
    hobbies: 'interests',
    references: 'references'
  };
}

function cvNormalizeHeadingKeyStrong(value = '') {
  return cvSoftCleanLine(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[\/|]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cvLooksLikeGenericHeadingStrong(line = '', currentKey = '') {
  const clean = cvSoftStripBullet(line);
  if (!clean || clean.length > 70) return false;
  if (/@|https?:\/\/|www\.|github\.com|linkedin\.com/i.test(clean)) return false;
  if (cvDateRegexStrong().test(clean)) return false;
  if (/[.!?]$/.test(clean)) return false;
  if (/[,;]/.test(clean)) return false;

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 6) return false;

  const dangerousInside = ['projects', 'experience', 'education'];
  if (dangerousInside.includes(currentKey) && clean !== clean.toUpperCase()) return false;

  const mostlyUpper = clean === clean.toUpperCase() && /[A-Z]/.test(clean);
  const titleCase = words.every(word =>
    /^[A-Z][A-Za-z0-9+#.-]*$/.test(word) ||
    /^(and|of|the|in|for|to)$/i.test(word) ||
    /^[A-Z]{2,}$/.test(word)
  );

  const notContent = !/^(React|Node|Python|JavaScript|TypeScript|MongoDB|Express|HTML|CSS|SQL|Git|Github|Designed|Built|Developed|Implemented|Created|Managed|Led|Worked|Improved)\b/i.test(clean);

  return notContent && (mostlyUpper || titleCase);
}

function cvSectionFromHeadingLineStrong(line = '', currentKey = '') {
  const clean = cvSoftStripBullet(line).replace(/\s*[:：]\s*$/, '').trim();
  if (!clean) return null;

  let headingPart = clean;
  let rest = '';

  const colonIndex = clean.indexOf(':');
  if (colonIndex > 0 && colonIndex < 80) {
    headingPart = clean.slice(0, colonIndex).trim();
    rest = clean.slice(colonIndex + 1).trim();
  }

  const key = cvNormalizeHeadingKeyStrong(headingPart);
  const alias = cvHeadingAliasMapStrong()[key];
  if (alias) {
    return {
      key: alias,
      label: headingPart,
      rest
    };
  }

  if (cvLooksLikeGenericHeadingStrong(headingPart, currentKey)) {
    return {
      key: 'custom',
      label: headingPart,
      rest
    };
  }

  return null;
}

function cvEnsureSectionStore(sections, key) {
  if (!sections[key]) sections[key] = [];
  return sections[key];
}

function cvSectionsFromLines(lines = []) {
  const sections = {
    summary: [],
    education: [],
    experience: [],
    projects: [],
    skills: [],
    certifications: [],
    achievements: [],
    activities: [],
    publications: [],
    languages: [],
    interests: [],
    references: [],
    __customSections: []
  };

  let currentKey = 'summary';
  let currentCustom = null;

  for (const rawLine of lines || []) {
    const line = cvSoftCleanLine(rawLine);
    if (!line) continue;

    const heading = cvSectionFromHeadingLineStrong(line, currentKey);

    if (heading) {
      if (heading.key === 'custom') {
        currentKey = 'custom';
        currentCustom = { name: heading.label || 'Additional Section', lines: [] };
        sections.__customSections.push(currentCustom);
        if (heading.rest) currentCustom.lines.push(heading.rest);
      } else {
        currentKey = heading.key;
        currentCustom = null;
        cvEnsureSectionStore(sections, currentKey);
        if (heading.rest) sections[currentKey].push(heading.rest);
      }
      continue;
    }

    if (currentKey === 'custom' && currentCustom) {
      currentCustom.lines.push(line);
    } else {
      cvEnsureSectionStore(sections, currentKey).push(line);
    }
  }

  return sections;
}
`;

const parseCvContactReplacement = String.raw`
function parseCvContact(fullText = '', embeddedLinks = []) {
  const text = preprocessText(fullText);
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = text.match(/(?:\+?\d[\d\s().-]{8,}\d)/);

  const visibleUrls = typeof extractVisibleUrls === 'function' ? extractVisibleUrls(text) : [];
  const embeddedUrls = (Array.isArray(embeddedLinks) ? embeddedLinks : [])
    .map(item => normalizeCvUrl(item && item.url ? item.url : item))
    .filter(Boolean);

  const urls = uniq([...embeddedUrls, ...visibleUrls].map(normalizeCvUrl).filter(Boolean));

  const github = urls.find(url => typeof isGithubProfileUrl === 'function' && isGithubProfileUrl(url))
    || urls.find(url => /github\.com\/[^/\s]+\/?$/i.test(String(url)))
    || null;

  const linkedin = urls.find(url => typeof isLinkedInUrl === 'function' && isLinkedInUrl(url))
    || urls.find(url => /linkedin\.com\/in\//i.test(String(url)))
    || null;

  const portfolio = urls.find(url =>
    !/linkedin\.com|github\.com|mailto:|tel:/i.test(String(url)) &&
    !/\.(pdf|png|jpe?g)$/i.test(String(url))
  ) || null;

  const addressLine = String(text || '')
    .split(/\n| {2,}/)
    .map(line => cleanText(line))
    .find(line =>
      line &&
      line.length <= 120 &&
      /\b(Pakistan|Islamabad|Karachi|Lahore|Rawalpindi|Peshawar|Quetta|Multan|Faisalabad|Punjab|Sindh|KPK|Remote)\b/i.test(line) &&
      !/@|https?:\/\/|github\.com|linkedin\.com/i.test(line)
    ) || null;

  const links = urls
    .filter(url => !/^mailto:|^tel:/i.test(String(url)))
    .map(url => {
      let label = 'Link';
      if (/linkedin\.com/i.test(url)) label = 'LinkedIn';
      else if (/github\.com/i.test(url)) label = 'GitHub';
      else if (/behance\.net/i.test(url)) label = 'Behance';
      else if (/dribbble\.com/i.test(url)) label = 'Dribbble';
      else if (/kaggle\.com/i.test(url)) label = 'Kaggle';
      else if (/medium\.com/i.test(url)) label = 'Medium';
      else if (/youtube\.com|youtu\.be/i.test(url)) label = 'YouTube';
      else if (/vercel\.app|netlify\.app|github\.io/i.test(url)) label = 'Portfolio';
      return { label, url };
    });

  return {
    email: emailMatch ? emailMatch[0] : null,
    phone: phoneMatch ? phoneMatch[0].trim() : null,
    whatsapp: phoneMatch ? phoneMatch[0].trim() : null,
    linkedin,
    github,
    portfolio,
    address: addressLine,
    links
  };
}
`;

const parseCvProjectsReplacement = String.raw`
function parseCvProjects(projectLines = [], embeddedLinks = []) {
  const lines = (projectLines || []).map(cvSoftCleanLine).filter(Boolean);
  const projects = [];
  const projectLinks = projectLinksFromSection(lines, embeddedLinks);
  let linkCursor = 0;

  const usedLinks = new Set();
  let currentTitle = '';
  let descParts = [];

  const cleanProjectDescription = (value = '') => cleanCvLine(String(value || '')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim());

  const nextProjectLink = (blockText = '') => {
    const visible = extractVisibleUrls(blockText).find(isGithubRepoUrl);
    if (visible) {
      const normalized = normalizeCvUrl(visible);
      usedLinks.add(normalized);
      return normalized;
    }

    while (linkCursor < projectLinks.length) {
      const candidate = projectLinks[linkCursor];
      linkCursor += 1;
      if (candidate && !usedLinks.has(candidate)) {
        usedLinks.add(candidate);
        return candidate;
      }
    }

    return '';
  };

  const finishProject = () => {
    if (!currentTitle) return;
    const blockText = [currentTitle, ...descParts].join(' ');
    const desc = cleanProjectDescription(descParts.join(' '));
    projects.push({
      title: cleanCvLine(currentTitle).slice(0, 140),
      desc,
      link: nextProjectLink(blockText) || ''
    });
    currentTitle = '';
    descParts = [];
  };

  const looksProjectTitle = (line = '', index = 0) => {
    const clean = cvSoftStripBullet(line);
    if (!clean || clean.length < 2 || clean.length > 140) return false;
    if (isCvSectionHeading(clean)) return false;
    if (/@|https?:\/\/|www\.|github\.com|linkedin\.com/i.test(clean)) return false;
    if (cvDateRegexStrong().test(clean) && clean.length < 18) return false;
    if (/^(Built|Developed|Implemented|Designed|Optimized|Created|Managed|Led|Worked|Improved|Used|Learned|Collaborated|Reduced|Achieved|Presented|Wrote|Fixed)\b/i.test(clean)) return false;
    if (typeof isTechStackLine === 'function' && isTechStackLine(clean)) return false;

    const next = lines.slice(index + 1, index + 4).map(cvSoftCleanLine).filter(Boolean);
    if (!next.length) return false;

    if (/[:|]/.test(clean) && clean.length <= 100) return true;
    if (!/^[A-Z0-9]/.test(clean)) return false;
    if (/[.!?]$/.test(clean)) return false;
    if (next.some(item => isCvBullet(item))) return true;
    if (next.some(item => /^(Tech|Tools|Stack|Technologies)\b/i.test(item))) return true;
    if (next.some(item => /github\.com|https?:\/\/|www\./i.test(item))) return true;
    if (next.some(item => /^(Built|Developed|Implemented|Designed|Optimized|Created|Managed|Led|Worked|Improved)\b/i.test(cvSoftStripBullet(item)))) return true;

    return false;
  };

  lines.forEach((line, index) => {
    const clean = cvSoftCleanLine(line);
    if (!clean) return;

    if (/github\.com|https?:\/\/|www\./i.test(clean)) {
      if (currentTitle) descParts.push(clean);
      return;
    }

    const colonProject = clean.match(/^([^:]{3,90})\s*:\s*(.{8,})$/);
    if (colonProject && !isCvBullet(clean)) {
      finishProject();
      currentTitle = cleanCvLine(colonProject[1]);
      descParts = [cleanCvLine(colonProject[2])];
      return;
    }

    if (looksProjectTitle(clean, index)) {
      finishProject();
      currentTitle = clean;
      return;
    }

    if (!currentTitle && !isCvBullet(clean) && /^[A-Z0-9]/.test(clean) && clean.length <= 90 && !/[.!?]$/.test(clean)) {
      currentTitle = clean;
      return;
    }

    if (currentTitle) descParts.push(stripCvBullet(clean));
  });

  finishProject();

  for (const link of projectLinks) {
    if (usedLinks.has(link)) continue;
    const repoName = String(link).replace(/\/$/, '').split('/').slice(-1)[0] || 'GitHub Project';
    projects.push({
      title: repoName.replace(/[-_]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()),
      desc: 'Project link recovered from the CV.',
      link
    });
    usedLinks.add(link);
  }

  return projects
    .filter(project => project.title && project.title.length > 1)
    .slice(0, 12);
}
`;

const parseCvEducationReplacement = String.raw`
function parseCvEducation(educationLines = []) {
  const raw = (educationLines || []).map(cvSoftStripBullet).map(cleanCvLine).filter(Boolean);
  if (!raw.length) return [];

  const blocks = cvSplitEntryBlocksStrong(raw, 'education');

  return blocks.map((block, index) => {
    const degreeIndex = block.findIndex(line => /\b(BS|B\.?S\.?|Bachelor|BSc|MS|M\.?S\.?|Master|MSc|PhD|Matric|Intermediate|A\s*Levels?|O\s*Levels?|Diploma|Degree)\b/i.test(line));
    const institutionIndex = block.findIndex(line => /\b(University|College|School|Institute|Academy|NUST|SEECS|FAST|COMSATS|LUMS|GIKI|UET|IBA)\b/i.test(line));

    let headingIndex = degreeIndex >= 0 ? degreeIndex : (institutionIndex >= 0 ? institutionIndex : 0);
    let heading = cleanCvLine(block[headingIndex] || ('Education ' + (index + 1)))
      .replace(cvDateRegexStrong(), '')
      .replace(/^[|,\-–—\s]+|[|,\-–—\s]+$/g, '')
      .trim();

    if (!heading) heading = block[headingIndex] || ('Education ' + (index + 1));

    const descParts = block
      .filter((_, i) => i !== headingIndex)
      .map(line => cleanCvLine(line))
      .filter(Boolean);

    const dates = block.map(line => line.match(cvDateRegexStrong())?.[0]).filter(Boolean);
    if (dates.length && !descParts.join(' ').includes(dates[0])) descParts.unshift(dates.join(' '));

    const blockText = block.join(' ');
    const link = extractVisibleUrls(blockText)[0] || '';

    return {
      heading: cleanCvLine(heading),
      desc: cleanCvLine(descParts.join('. ')),
      link
    };
  }).filter(item => item.heading);
}
`;

const parseCvExperienceReplacement = String.raw`
function parseCvExperience(experienceLines = []) {
  const raw = (experienceLines || []).map(cvSoftStripBullet).map(cleanCvLine).filter(Boolean);
  if (!raw.length) return [];

  const blocks = cvSplitEntryBlocksStrong(raw, 'experience');

  return blocks.map((block, index) => {
    const headerIndex = block.findIndex(line => cvLooksExperienceHeaderStrong(line, true));
    const headingIndex = headerIndex >= 0 ? headerIndex : 0;

    const heading = cleanCvLine(block[headingIndex] || ('Experience ' + (index + 1)))
      .replace(/^[|,\-–—\s]+|[|,\-–—\s]+$/g, '')
      .trim();

    const descParts = block
      .filter((_, i) => i !== headingIndex)
      .map(line => stripCvBullet(line))
      .map(cleanCvLine)
      .filter(Boolean);

    const blockText = block.join(' ');
    const link = extractVisibleUrls(blockText)[0] || '';

    return {
      heading: heading || ('Experience ' + (index + 1)),
      desc: cleanCvLine(descParts.join(' ')),
      link
    };
  }).filter(item => item.heading);
}
`;

const parseCvTextLocallyReplacement = String.raw`
function parseCvTextLocally(cvText = '', embeddedLinks = []) {
  const text = preprocessText(String(cvText || '').replace(/\r/g, '\n'));
  const lines = linesFromCvText(text);
  const sections = cvSectionsFromLines(lines);
  const identity = extractNameAndMedium(lines);
  const contact = parseCvContact(text, embeddedLinks);

  const summaryText = cleanCvLine((sections.summary || []).join(' '));
  const fallbackDescription = lines
    .map(cvSoftCleanLine)
    .filter(line => line)
    .filter(line => !isCvSectionHeading(line))
    .filter(line => line !== identity.name && line !== identity.medium)
    .filter(line => !/@|https?:\/\/|www\.|github\.com|linkedin\.com/i.test(line))
    .filter(line => !/\+?\d[\d\s().-]{8,}/.test(line))
    .slice(0, 3)
    .join(' ');

  const description = summaryText || cleanCvLine(fallbackDescription);

  const skills = parseCvSkills(sections.skills || []);
  let projects = parseCvProjects(sections.projects || [], embeddedLinks);

  if (!projects.length) {
    projects = parseCvProjects(lines, embeddedLinks).slice(0, 8);
  }

  const educationItems = parseCvEducation(sections.education || []);
  const experienceItems = parseCvExperience(sections.experience || []);

  const customSections = [];
  const usedLinks = new Set();

  const rememberLinks = (items = []) => {
    items.forEach(item => {
      if (item && item.link) usedLinks.add(normalizeCvUrl(item.link));
    });
  };

  rememberLinks(projects);
  [contact.linkedin, contact.github, contact.portfolio].filter(Boolean).forEach(url => usedLinks.add(normalizeCvUrl(url)));

  const addSection = (name, items = []) => {
    const cleanItems = (items || [])
      .map((item, index) => ({
        heading: cleanCvLine(item.heading || item.title || (name + ' ' + (index + 1))),
        desc: cleanCvLine(item.desc || item.description || ''),
        link: normalizeCvUrl(item.link || item.url || '')
      }))
      .filter(item => item.heading || item.desc || item.link);

    if (!cleanItems.length) return;
    rememberLinks(cleanItems);
    customSections.push({ name, items: cleanItems });
  };

  addSection('Education', educationItems);
  addSection('Experience', experienceItems);

  const extraSectionLabels = {
    certifications: 'Certifications',
    achievements: 'Achievements',
    activities: 'Activities',
    publications: 'Publications / Research',
    languages: 'Languages',
    interests: 'Interests',
    references: 'References'
  };

  Object.entries(extraSectionLabels).forEach(([key, label]) => {
    addSection(label, cvGenericSectionItemsStrong(sections[key] || [], label));
  });

  (sections.__customSections || []).forEach(section => {
    if (!section || !section.name) return;
    addSection(section.name, cvGenericSectionItemsStrong(section.lines || [], section.name));
  });

  const allLinks = cvAllLinksStrong(text, embeddedLinks);
  const extraLinks = allLinks
    .filter(Boolean)
    .filter(url => !usedLinks.has(normalizeCvUrl(url)))
    .filter(url => !/^mailto:|^tel:/i.test(String(url)))
    .map((url, index) => ({
      heading: cvLabelForUrlStrong(url) || ('Recovered Link ' + (index + 1)),
      desc: 'Embedded or visible link recovered from the CV.',
      link: url
    }));

  addSection('Additional Links', extraLinks);

  return {
    name: identity.name || '',
    medium: identity.medium || 'Student / Job Seeker',
    description,
    projects,
    contact,
    skills,
    customSections,
    warning: ''
  };
}
`;

const helperBlock = String.raw`
function cvAllLinksStrong(fullText = '', embeddedLinks = []) {
  const visible = typeof extractVisibleUrls === 'function' ? extractVisibleUrls(fullText) : [];
  const embedded = (Array.isArray(embeddedLinks) ? embeddedLinks : [])
    .map(item => normalizeCvUrl(item && item.url ? item.url : item))
    .filter(Boolean);

  return uniq([...embedded, ...visible].map(normalizeCvUrl).filter(Boolean));
}

function cvLabelForUrlStrong(url = '') {
  const clean = String(url || '');
  if (/linkedin\.com/i.test(clean)) return 'LinkedIn';
  if (/github\.com/i.test(clean)) return /github\.com\/[^/]+\/[^/]+/i.test(clean) ? 'GitHub Project' : 'GitHub';
  if (/kaggle\.com/i.test(clean)) return 'Kaggle';
  if (/behance\.net/i.test(clean)) return 'Behance';
  if (/dribbble\.com/i.test(clean)) return 'Dribbble';
  if (/medium\.com/i.test(clean)) return 'Medium';
  if (/youtube\.com|youtu\.be/i.test(clean)) return 'YouTube';
  if (/vercel\.app|netlify\.app|github\.io/i.test(clean)) return 'Portfolio';
  return 'Link';
}

function cvLooksExperienceHeaderStrong(line = '', allowLoose = false) {
  const clean = cvSoftStripBullet(line);
  if (!clean || clean.length > 150) return false;
  if (/@|https?:\/\/|www\.|github\.com|linkedin\.com/i.test(clean)) return false;
  if (/^(Designed|Built|Developed|Implemented|Optimized|Created|Managed|Led|Worked|Improved|Used|Learned|Collaborated|Reduced|Achieved|Presented|Wrote|Fixed|Assisted|Conducted)\b/i.test(clean)) return false;

  const jobSignal = /\b(Intern|Internship|Engineer|Developer|Designer|Assistant|Manager|Analyst|Researcher|Research|Volunteer|Lead|Coordinator|Officer|Specialist|Trainee|Teacher|Consultant|Freelance|Founder|Member|Head|Director|Instructor|Tutor|Representative)\b/i.test(clean);
  const companySignal = /\b(at|@)\b|[|–—-]|\b(Pvt|Ltd|Limited|Inc|Company|Labs|Studio|University|School|College|Institute|NUST|SEECS)\b/i.test(clean);
  const dateSignal = cvDateRegexStrong().test(clean);

  return jobSignal || (allowLoose && (companySignal || dateSignal));
}

function cvLooksEducationHeaderStrong(line = '') {
  const clean = cvSoftStripBullet(line);
  if (!clean || clean.length > 160) return false;

  return /\b(BS|B\.?S\.?|Bachelor|BSc|MS|M\.?S\.?|Master|MSc|PhD|Matric|Intermediate|A\s*Levels?|O\s*Levels?|Diploma|Degree|University|College|School|Institute|Academy|NUST|SEECS|FAST|COMSATS|LUMS|GIKI|UET|IBA)\b/i.test(clean);
}

function cvSplitEntryBlocksStrong(lines = [], mode = 'generic') {
  const raw = (lines || []).map(cvSoftCleanLine).filter(Boolean);
  const blocks = [];
  let current = [];

  const shouldStartNew = (line, index) => {
    if (!current.length) return false;
    if (isCvBullet(line)) return false;
    if (isCvSectionHeading(line)) return true;

    if (mode === 'education') {
      return cvLooksEducationHeaderStrong(line) && current.length >= 2;
    }

    if (mode === 'experience') {
      return cvLooksExperienceHeaderStrong(line) && current.length >= 2;
    }

    const clean = cvSoftStripBullet(line);
    if (clean.length > 110) return false;
    if (/@|https?:\/\/|www\./i.test(clean)) return false;
    if (/^(Designed|Built|Developed|Implemented|Optimized|Created|Managed|Led|Worked|Improved|Used|Learned|Collaborated|Reduced|Achieved|Presented|Wrote|Fixed)\b/i.test(clean)) return false;
    if (cvDateRegexStrong().test(clean)) return true;
    if (/^[A-Z0-9][A-Za-z0-9+#().,&/ -]{2,90}$/.test(clean) && !/[.!?]$/.test(clean)) return true;
    return false;
  };

  raw.forEach((line, index) => {
    if (shouldStartNew(line, index)) {
      blocks.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  });

  if (current.length) blocks.push(current);
  return blocks.filter(block => block.some(Boolean));
}

function cvGenericSectionItemsStrong(sectionLines = [], sectionName = 'Section') {
  const raw = (sectionLines || []).map(cvSoftCleanLine).filter(Boolean);
  if (!raw.length) return [];

  const bulletLines = raw.filter(line => isCvBullet(line));
  if (bulletLines.length >= 2) {
    return bulletLines.map((line, index) => cvGenericItemFromBlockStrong([line], sectionName, index));
  }

  const blocks = cvSplitEntryBlocksStrong(raw, 'generic');
  return blocks.map((block, index) => cvGenericItemFromBlockStrong(block, sectionName, index));
}

function cvGenericItemFromBlockStrong(block = [], sectionName = 'Section', index = 0) {
  const cleanBlock = (block || []).map(cvSoftStripBullet).map(cleanCvLine).filter(Boolean);
  if (!cleanBlock.length) {
    return { heading: sectionName + ' ' + (index + 1), desc: '', link: '' };
  }

  const joined = cleanBlock.join(' ');
  const link = extractVisibleUrls(joined)[0] || '';

  const first = cleanBlock[0];
  const colon = first.match(/^([^:]{2,90})\s*:\s*(.*)$/);

  if (colon) {
    const desc = [colon[2], ...cleanBlock.slice(1)].join(' ');
    return {
      heading: cleanCvLine(colon[1]),
      desc: cleanCvLine(desc.replace(link, '')),
      link
    };
  }

  if (cleanBlock.length === 1) {
    return {
      heading: cleanCvLine(first.replace(link, '')).slice(0, 140),
      desc: '',
      link
    };
  }

  return {
    heading: cleanCvLine(first.replace(link, '')).slice(0, 140),
    desc: cleanCvLine(cleanBlock.slice(1).join(' ').replace(link, '')),
    link
  };
}
`;

server = replaceFunction(server, 'cvSectionsFromLines', helperBlock + '\n\n' + cvSectionsReplacement);
server = replaceFunction(server, 'parseCvContact', parseCvContactReplacement);
server = replaceFunction(server, 'parseCvProjects', parseCvProjectsReplacement);
server = replaceFunction(server, 'parseCvEducation', parseCvEducationReplacement);
server = replaceFunction(server, 'parseCvExperience', parseCvExperienceReplacement);
server = replaceFunction(server, 'parseCvTextLocally', parseCvTextLocallyReplacement);

write(serverPath, server);
console.log('Patched server parser:', serverPath);
console.log('Server backup:', backupServer);

const appPath = findFileByContent('App.js', 'CV parsing failed');
if (appPath) {
  let app = read(appPath);
  const backupApp = appPath + '.backup.cv-links-patch-' + Date.now();
  write(backupApp, app);

  const contactLinksRegex = /links:\s*\[\s*data\.contact\.linkedin\s*\?\s*\{\s*id:\s*newId\(\),\s*label:\s*'LinkedIn',\s*url:\s*data\.contact\.linkedin\s*\}\s*:\s*null,\s*data\.contact\.github\s*\?\s*\{\s*id:\s*newId\(\),\s*label:\s*'GitHub',\s*url:\s*data\.contact\.github\s*\}\s*:\s*null,\s*\]\.filter\(Boolean\),/m;

  const contactLinksReplacement = String.raw`links: [
            ...(Array.isArray(data.contact.links) ? data.contact.links.map((link, index) => ({
              id: newId(),
              label: String(link?.label || link?.title || ('Link ' + (index + 1))).trim() || ('Link ' + (index + 1)),
              url: String(link?.url || link?.href || link || '').trim(),
            })) : []),
            data.contact.linkedin ? { id: newId(), label: 'LinkedIn', url: data.contact.linkedin } : null,
            data.contact.github ? { id: newId(), label: 'GitHub', url: data.contact.github } : null,
          ]
            .filter(item => item && item.url)
            .filter((item, index, array) => array.findIndex(other => String(other.url || '').trim().toLowerCase().replace(/\/$/, '') === String(item.url || '').trim().toLowerCase().replace(/\/$/, '')) === index),`;

  if (contactLinksRegex.test(app)) {
    app = app.replace(contactLinksRegex, contactLinksReplacement);
    write(appPath, app);
    console.log('Patched App.js contact link preservation:', appPath);
    console.log('App backup:', backupApp);
  } else {
    console.log('App.js contact links block not found. Server patch still applied.');
  }
} else {
  console.log('App.js not found. Server patch still applied.');
}
