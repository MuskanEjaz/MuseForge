const fs = require("fs");
const path = require("path");

const serverPath = path.join("backend", "server.js");

if (!fs.existsSync(serverPath)) {
  console.error("backend/server.js not found");
  process.exit(1);
}

const backupPath = `${serverPath}.before-force-embedded-link-attach.bak`;
if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(serverPath, backupPath);
}

let server = fs.readFileSync(serverPath, "utf8");

const start = server.indexOf("function attachEmbeddedLinksToParsedCv(parsed = {}, cvText = '') {");
const end = server.indexOf("async function extractPdfEmbeddedLinksFromBuffer", start);

if (start === -1 || end === -1) {
  console.error("attachEmbeddedLinksToParsedCv block not found.");
  process.exit(1);
}

const replacement = `function isProfileLevelEmbeddedLink(url = '') {
  const clean = String(url || '').toLowerCase();

  if (!clean || clean.startsWith('mailto:')) return true;

  // GitHub profile only: github.com/username
  if (/github\\.com\\/[a-z0-9_.-]+\\/?$/i.test(clean)) return true;

  // LinkedIn profile belongs to contact, not projects/custom sections.
  if (/linkedin\\.com\\/in\\//i.test(clean)) return true;

  // Personal homepage from contact line.
  if (/github\\.io\\/?$/i.test(clean)) return true;

  return false;
}

function isProjectRepoEmbeddedLink(url = '') {
  const clean = String(url || '').toLowerCase();
  return /github\\.com\\/[a-z0-9_.-]+\\/[a-z0-9_.-]+/i.test(clean);
}

function urlSlugText(url = '') {
  return String(url || '')
    .replace(/^https?:\\/\\//i, '')
    .replace(/^[^/]+\\//, '')
    .replace(/[?#].*$/, '')
    .replace(/[\\/_-]+/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function linkAlreadyUsed(url = '', used = new Set()) {
  return used.has(String(url || '').toLowerCase());
}

function markLinkUsed(url = '', used = new Set()) {
  const clean = String(url || '').toLowerCase();
  if (clean) used.add(clean);
}

function findBestEmbeddedLinkForText(text = '', pairs = [], used = new Set()) {
  const context = normalizeLinkText(text);
  if (!context) return null;

  let best = null;
  let bestScore = 0;

  for (const pair of pairs) {
    if (!pair?.url || linkAlreadyUsed(pair.url, used)) continue;

    const pairText = normalizeLinkText(pair.text || '');
    const slugText = normalizeLinkText(urlSlugText(pair.url));
    const combined = normalizeLinkText(\`\${pairText} \${slugText}\`);

    let score = 0;
    score += tokenOverlapScore(context, pairText);
    score += tokenOverlapScore(context, slugText);
    score += tokenOverlapScore(context, combined);

    if (pairText && (context.includes(pairText) || pairText.includes(context))) score += 8;
    if (slugText && (context.includes(slugText) || slugText.includes(context))) score += 8;

    if (score > bestScore) {
      bestScore = score;
      best = pair;
    }
  }

  return bestScore >= 2 ? best : null;
}

function attachEmbeddedLinksToParsedCv(parsed = {}, cvText = '') {
  const pairs = extractEmbeddedPdfLinkPairsFromCvText(cvText)
    .map(pair => ({
      text: cleanText(pair.text || ''),
      url: normalizeEmbeddedPdfUrl(pair.url || ''),
    }))
    .filter(pair => pair.text && pair.url && !isProfileLevelEmbeddedLink(pair.url));

  if (!pairs.length || !parsed || typeof parsed !== 'object') return parsed;

  const used = new Set();

  const projectPairs = pairs.filter(pair => isProjectRepoEmbeddedLink(pair.url));
  const nonProjectPairs = pairs.filter(pair => !isProjectRepoEmbeddedLink(pair.url));

  if (Array.isArray(parsed.projects)) {
    parsed.projects = parsed.projects.map((project, index) => {
      const currentLink = normalizeEmbeddedPdfUrl(project.link || '');
      if (currentLink) {
        markLinkUsed(currentLink, used);
        return { ...project, link: currentLink };
      }

      const context = \`\${project.title || ''} \${project.desc || ''}\`;
      let match = findBestEmbeddedLinkForText(context, projectPairs, used);

      // Fallback: assign remaining GitHub repo links in order to project cards.
      if (!match) {
        match = projectPairs.find(pair => !linkAlreadyUsed(pair.url, used)) || null;
      }

      if (match?.url) {
        markLinkUsed(match.url, used);
        return { ...project, link: match.url };
      }

      return { ...project, link: null };
    });
  }

  if (Array.isArray(parsed.customSections)) {
    parsed.customSections = parsed.customSections.map(section => ({
      ...section,
      items: Array.isArray(section.items)
        ? section.items.map(item => {
            const currentLink = normalizeEmbeddedPdfUrl(item.link || item.url || '');
            if (currentLink) {
              markLinkUsed(currentLink, used);
              return { ...item, link: currentLink };
            }

            const context = \`\${section.name || ''} \${item.heading || ''} \${item.desc || ''}\`;
            const match = findBestEmbeddedLinkForText(context, nonProjectPairs, used);

            if (match?.url) {
              markLinkUsed(match.url, used);
              return { ...item, link: match.url };
            }

            return { ...item, link: null };
          })
        : [],
    }));
  }

  // Final safety: if PDF had certificate/workshop/proof links but parser did not create matching items,
  // do not lose them. Add them as real CV-derived linked items.
  const remainingProofLinks = pairs.filter(pair =>
    !linkAlreadyUsed(pair.url, used) &&
    !isProjectRepoEmbeddedLink(pair.url)
  );

  if (remainingProofLinks.length) {
    if (!Array.isArray(parsed.customSections)) parsed.customSections = [];

    parsed.customSections.push({
      name: 'Certificates / Workshops',
      items: remainingProofLinks.map((pair, index) => ({
        heading: pair.text || \`Linked CV item \${index + 1}\`,
        desc: 'Linked item extracted from the uploaded CV.',
        link: pair.url,
      })),
    });
  }

  return parsed;
}

`;

server = server.slice(0, start) + replacement + server.slice(end);

fs.writeFileSync(serverPath, server, "utf8");

console.log("Force embedded PDF link attach patch applied.");
