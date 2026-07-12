const fs = require('fs');

const path = '.\\backend\\server.js';
let code = fs.readFileSync(path, 'utf8');

fs.writeFileSync(path + '.backup.experience-only-' + Date.now(), code, 'utf8');

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

  const actionVerbRegex = /^(Designed|Collaborated|Built|Developed|Implemented|Created|Managed|Led|Worked|Improved|Used|Learned|Assisted|Conducted|Handled|Supported|Maintained|Developed|Resolved|Prepared|Presented|Wrote|Fixed|Optimized|Tested)\b/i;

  const roleRegex = /\b(Intern|Internship|Engineer|Developer|Designer|Assistant|Manager|Analyst|Officer|Specialist|Trainee|Coordinator|Volunteer|Researcher|Teacher|Tutor|Consultant|Lead|Head|Member|Representative)\b/i;

  const companyOrDateRegex = /\b(at|@)\b|[—–-]|\b(Pvt|Ltd|Limited|Inc|Company|Bank|Labs|Studio|University|School|College|Institute|SNGPL|MCB|COMSATS|NUST|SEECS)\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*(?:19|20)?\d{0,4}\b|\b(?:19|20)\d{2}\b/i;

  const possibleHeaderRegex = /\b(?:[A-Z][A-Za-z.&/+]*\s+){0,5}(?:Intern|Internship|Engineer|Developer|Designer|Assistant|Manager|Analyst|Officer|Specialist|Trainee|Coordinator|Volunteer|Researcher|Teacher|Tutor|Consultant)\b[^.]{0,120}(?:[—–-]|\bat\b|@|\bLtd\b|\bPvt\b|\bBank\b|\bCompany\b)/g;

  const expanded = [];

  raw.forEach(line => {
    const clean = cleanCvLine(line);
    if (!clean) return;

    // If pdf extraction joined multiple jobs into one line, split before the next job title.
    const marked = clean.replace(/\s+(?=(?:[A-Z][A-Za-z.&/+]*\s+){0,5}(?:Intern|Internship|Engineer|Developer|Designer|Assistant|Manager|Analyst|Officer|Specialist|Trainee|Coordinator|Volunteer|Researcher|Teacher|Tutor|Consultant)\b[^.]{0,120}(?:[—–-]|\bat\b|@|\bLtd\b|\bPvt\b|\bBank\b|\bCompany\b))/g, '\n');

    marked
      .split(/\n+/)
      .map(part => cleanCvLine(part))
      .filter(Boolean)
      .forEach(part => expanded.push(part));
  });

  const looksLikeExperienceHeader = (line = '', index = 0) => {
    const clean = cleanCvLine(stripCvBullet(line));
    if (!clean) return false;
    if (clean.length > 180) return false;
    if (actionVerbRegex.test(clean)) return false;
    if (/^(Responsibilities|Key Responsibilities|Achievements|Tasks|Duties)$/i.test(clean)) return false;

    const hasRole = roleRegex.test(clean);
    const hasCompanyOrDate = companyOrDateRegex.test(clean);

    if (hasRole && hasCompanyOrDate) return true;
    if (index === 0 && hasRole) return true;

    return false;
  };

  const items = [];
  let current = null;

  expanded.forEach((line, index) => {
    const clean = cleanCvLine(line);
    if (!clean) return;

    if (looksLikeExperienceHeader(clean, index)) {
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

console.log('Experience parser patched only.');
