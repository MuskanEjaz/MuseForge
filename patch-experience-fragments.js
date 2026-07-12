const fs = require('fs');

const path = '.\\backend\\server.js';
let code = fs.readFileSync(path, 'utf8');

fs.writeFileSync(path + '.backup.experience-fragment-fix-' + Date.now(), code, 'utf8');

function replaceFunction(source, name, replacement) {
  const start = source.indexOf('function ' + name);
  if (start < 0) throw new Error(name + ' not found');

  const braceStart = source.indexOf('{', start);
  let depth = 0;

  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(0, start) + replacement.trim() + '\n\n' + source.slice(i + 1);
      }
    }
  }

  throw new Error('Could not replace ' + name);
}

const newParseCvExperience = String.raw`
function parseCvExperience(experienceLines = []) {
  const raw = experienceLines
    .map(line => stripCvBullet(line))
    .map(cleanCvLine)
    .filter(Boolean);

  if (!raw.length) return [];

  const actionVerbRegex = /^(Designed|Collaborated|Built|Developed|Implemented|Created|Managed|Led|Worked|Improved|Used|Learned|Assisted|Conducted|Handled|Supported|Maintained|Resolved|Prepared|Presented|Wrote|Fixed|Optimized|Tested|Integrated|Configured)\b/i;

  const roleRegex = /\b(Intern|Internship|Engineer|Developer|Designer|Assistant|Manager|Analyst|Officer|Specialist|Trainee|Coordinator|Volunteer|Researcher|Teacher|Tutor|Consultant|Lead|Head|Member|Representative)\b/i;

  const companyOrDateRegex = /\b(at|@)\b|[—–-]|\b(Pvt|Ltd|Limited|Inc|Company|Bank|Labs|Studio|University|School|College|Institute|SNGPL|MCB|COMSATS|NUST|SEECS)\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*(?:19|20)?\d{0,4}\b|\b(?:19|20)\d{2}\b/i;

  const looksLikeExperienceHeader = (line = '', allowLoose = false) => {
    const clean = cleanCvLine(stripCvBullet(line));
    if (!clean) return false;
    if (clean.length > 190) return false;
    if (actionVerbRegex.test(clean)) return false;
    if (/^(Responsibilities|Key Responsibilities|Achievements|Tasks|Duties)$/i.test(clean)) return false;

    const hasRole = roleRegex.test(clean);
    const hasCompanyOrDate = companyOrDateRegex.test(clean);

    if (hasRole && hasCompanyOrDate) return true;
    if (allowLoose && hasRole && /intern|engineer|developer|designer|assistant|analyst|manager/i.test(clean)) return true;

    return false;
  };

  const isLikelyTitleFragment = (line = '') => {
    const clean = cleanCvLine(stripCvBullet(line));
    if (!clean) return false;
    if (clean.length > 45) return false;
    if (actionVerbRegex.test(clean)) return false;
    if (companyOrDateRegex.test(clean)) return false;
    if (/@|https?:\/\/|www\.|github\.com|linkedin\.com/i.test(clean)) return false;
    if (/[.!?]$/.test(clean)) return false;

    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length > 4) return false;

    return /^[A-Za-z][A-Za-z0-9+#/&.\s-]*$/.test(clean);
  };

  const hasHeaderSoon = (index) => {
    for (let j = index + 1; j < Math.min(raw.length, index + 4); j++) {
      if (looksLikeExperienceHeader(raw[j], true)) return true;
    }
    return false;
  };

  // Fix PDF line breaks like:
  // Web
  // Development
  // Intern — Company
  // => Web Development Intern — Company
  const normalized = [];
  let pendingTitleFragments = [];

  raw.forEach((line, index) => {
    const clean = cleanCvLine(line);
    if (!clean) return;

    if (looksLikeExperienceHeader(clean, true)) {
      const prefix = pendingTitleFragments.join(' ').trim();
      normalized.push(prefix ? cleanCvLine(prefix + ' ' + clean) : clean);
      pendingTitleFragments = [];
      return;
    }

    if (isLikelyTitleFragment(clean) && hasHeaderSoon(index)) {
      pendingTitleFragments.push(clean);
      return;
    }

    if (pendingTitleFragments.length) {
      normalized.push(pendingTitleFragments.join(' '));
      pendingTitleFragments = [];
    }

    normalized.push(clean);
  });

  if (pendingTitleFragments.length) {
    normalized.push(pendingTitleFragments.join(' '));
  }

  const items = [];
  let current = null;

  normalized.forEach((line, index) => {
    const clean = cleanCvLine(line);
    if (!clean) return;

    if (looksLikeExperienceHeader(clean, index === 0)) {
      if (current) items.push(current);
      current = {
        heading: clean.replace(/\s*[.]$/, ''),
        descParts: [],
        link: null
      };
      return;
    }

    if (!current) {
      current = {
        heading: clean.replace(/\s*[.]$/, ''),
        descParts: [],
        link: null
      };
      return;
    }

    current.descParts.push(clean);
  });

  if (current) items.push(current);

  return items
    .map(item => ({
      heading: cleanCvLine(item.heading || ''),
      desc: cleanCvLine((item.descParts || []).join(' ')),
      link: item.link || null
    }))
    .filter(item => item.heading)
    .slice(0, 12);
}
`;

code = replaceFunction(code, 'parseCvExperience', newParseCvExperience);
fs.writeFileSync(path, code, 'utf8');

console.log('Experience fragment parser fixed.');
