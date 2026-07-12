const fs = require("fs");
const path = require("path");

const serverPath = path.join("backend", "server.js");
const appPath = path.join("src", "App.js");

const stableBackup = path.join("backend", "server.js.before-pdf-embedded-links.bak");
const currentBackup = path.join("backend", "server.js.before-safe-cv-link-postprocess.bak");

if (!fs.existsSync(serverPath)) {
  console.error("backend/server.js not found.");
  process.exit(1);
}

if (!fs.existsSync(stableBackup)) {
  console.error("Stable backup not found: backend/server.js.before-pdf-embedded-links.bak");
  console.error("Stop. Send me this output:");
  console.error("Get-ChildItem .\\backend -Filter \"server.js*.bak\" | Select-Object Name");
  process.exit(1);
}

fs.copyFileSync(serverPath, currentBackup);
fs.copyFileSync(stableBackup, serverPath);

let server = fs.readFileSync(serverPath, "utf8");
let app = fs.existsSync(appPath) ? fs.readFileSync(appPath, "utf8") : "";

let changedServer = false;
let changedApp = false;

/* Frontend: preserve custom-section links from CV parser */
if (app && !app.includes("link: it.link || it.url || ''")) {
  const appPattern = /items:\s*\(s\.items\s*\|\|\s*\[\]\)\.map\(it\s*=>\s*\(\{\s*id:\s*newId\(\),\s*heading:\s*it\.heading\s*\|\|\s*'',\s*desc:\s*it\.desc\s*\|\|\s*''\s*\}\)\)/s;

  if (appPattern.test(app)) {
    app = app.replace(appPattern, `items: (s.items || []).map(it => ({
            id: newId(),
            heading: it.heading || '',
            desc: it.desc || '',
            link: it.link || it.url || ''
          }))`);
    fs.writeFileSync(appPath, app, "utf8");
    changedApp = true;
  } else {
    console.warn("App.js custom-section mapping pattern not found. Frontend may already be different.");
  }
}

/* Safe helper: extract PDF annotations separately, never append them to CV text */
const helper = `

/* =========================================================
   SAFE CV embedded link post-processing
   Does not change CV text parsing. It attaches PDF annotation links
   only after normal CV parsing is complete.
   ========================================================= */

function normalizeCvAutofillUrl(value = '') {
  let url = String(value || '').trim();
  if (!url) return '';
  url = url.replace(/[),.;\\]\\s]+$/g, '');
  if (/^mailto:/i.test(url)) return url;
  if (/^www\\./i.test(url)) url = 'https://' + url;
  if (!/^https?:\\/\\//i.test(url) && /^[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}(\\/|$)/.test(url)) {
    url = 'https://' + url;
  }
  return /^https?:\\/\\//i.test(url) ? url : '';
}

function isFilledCvLink(value = '') {
  const url = normalizeCvAutofillUrl(value);
  return Boolean(url && url !== 'null' && url !== 'undefined');
}

function isGithubProfileCvLink(url = '') {
  const clean = String(url || '').toLowerCase().replace(/\\/$/, '');
  return /^https?:\\/\\/(www\\.)?github\\.com\\/[a-z0-9_.-]+$/i.test(clean);
}

function isGithubRepoCvLink(url = '') {
  const clean = String(url || '').toLowerCase();
  return /^https?:\\/\\/(www\\.)?github\\.com\\/[a-z0-9_.-]+\\/[a-z0-9_.-]+/i.test(clean);
}

function isLinkedInCvLink(url = '') {
  return /linkedin\\.com\\/in\\//i.test(String(url || ''));
}

function isProfileOrContactCvLink(url = '') {
  const clean = String(url || '').toLowerCase();
  return clean.startsWith('mailto:') || isGithubProfileCvLink(clean) || isLinkedInCvLink(clean) || /github\\.io\\/?$/i.test(clean);
}

function sortPdfCvLinksReadingOrder(items = []) {
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
    } catch (error) {
      console.warn('pdfjs-dist not installed; CV embedded links skipped.');
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
        const y = rect.length >= 4 ? Math.max(rect[1], rect[3]) : 0;
        const x = rect.length >= 4 ? Math.min(rect[0], rect[2]) : 0;

        results.push({
          page: pageNumber,
          x,
          y,
          url,
        });
      }
    }

    return sortPdfCvLinksReadingOrder(results);
  } catch (error) {
    console.warn('CV embedded PDF link extraction failed:', error.message);
    return [];
  }
}

function attachCvEmbeddedLinksAfterParsing(parsed = {}, embeddedLinks = []) {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(embeddedLinks) || !embeddedLinks.length) {
    return parsed;
  }

  const links = sortPdfCvLinksReadingOrder(embeddedLinks)
    .map(item => ({ ...item, url: normalizeCvAutofillUrl(item.url) }))
    .filter(item => item.url);

  if (!parsed.contact || typeof parsed.contact !== 'object') parsed.contact = {};

  const mailLink = links.find(item => String(item.url).toLowerCase().startsWith('mailto:'));
  const githubProfile = links.find(item => isGithubProfileCvLink(item.url));
  const linkedinProfile = links.find(item => isLinkedInCvLink(item.url));
  const portfolioLink = links.find(item => /github\\.io\\/?$/i.test(String(item.url)));

  if ((!parsed.contact.email || parsed.contact.email === 'null') && mailLink) {
    parsed.contact.email = mailLink.url.replace(/^mailto:/i, '');
  }
  if ((!parsed.contact.github || parsed.contact.github === 'null') && githubProfile) {
    parsed.contact.github = githubProfile.url;
  }
  if ((!parsed.contact.linkedin || parsed.contact.linkedin === 'null') && linkedinProfile) {
    parsed.contact.linkedin = linkedinProfile.url;
  }

  if (!Array.isArray(parsed.contact.links)) parsed.contact.links = [];
  if (portfolioLink && !parsed.contact.links.some(link => String(link.url || '').toLowerCase() === portfolioLink.url.toLowerCase())) {
    parsed.contact.links.push({ label: 'Portfolio', url: portfolioLink.url });
  }

  const projectLinks = links.filter(item => isGithubRepoCvLink(item.url));
  let projectIndex = 0;

  if (Array.isArray(parsed.projects)) {
    parsed.projects = parsed.projects.map(project => {
      if (isFilledCvLink(project.link)) return project;
      const next = projectLinks[projectIndex++];
      return {
        ...project,
        link: next ? next.url : null,
      };
    });
  }

  const proofLinks = links.filter(item =>
    !isProfileOrContactCvLink(item.url) &&
    !isGithubRepoCvLink(item.url)
  );

  let proofIndex = 0;

  const shouldFillSection = (name = '') =>
    /(cert|certificate|certification|course|workshop|training|award|achievement|publication|volunteer|license|credential)/i.test(String(name || ''));

  if (Array.isArray(parsed.customSections)) {
    parsed.customSections = parsed.customSections.map(section => {
      if (!Array.isArray(section.items)) return section;

      if (!shouldFillSection(section.name)) return section;

      return {
        ...section,
        items: section.items.map(item => {
          if (isFilledCvLink(item.link || item.url)) return item;
          const next = proofLinks[proofIndex++];
          return {
            ...item,
            link: next ? next.url : null,
          };
        }),
      };
    });
  }

  return parsed;
}

`;

const insertBefore = "async function sendToParserAndRespond(cvText, res)";
if (!server.includes(insertBefore)) {
  console.error("sendToParserAndRespond function not found.");
  process.exit(1);
}

server = server.replace(insertBefore, helper + "\n" + "async function sendToParserAndRespond(cvText, res, embeddedCvLinks = [])");
changedServer = true;

/* Make parse route read embedded links separately */
const cvLine = "const cvText = await extractCvTextFromPdfBuffer(req.file.buffer);";
if (!server.includes(cvLine)) {
  console.error("CV text extraction line not found.");
  process.exit(1);
}

server = server.replace(
  cvLine,
  `const cvText = await extractCvTextFromPdfBuffer(req.file.buffer);
    const embeddedCvLinks = await extractCvEmbeddedLinksFromPdfBuffer(req.file.buffer);
    console.log('CV embedded links found:', embeddedCvLinks.length);`
);

const oldCall = "return await sendToParserAndRespond(cvText, res);";
if (!server.includes(oldCall)) {
  console.error("sendToParserAndRespond call not found.");
  process.exit(1);
}

server = server.replace(oldCall, "return await sendToParserAndRespond(cvText, res, embeddedCvLinks);");

/* Attach links only at the end, after normal parsing and normalization */
const returnLine = "return res.json(parsed);";
const functionStart = server.indexOf("async function sendToParserAndRespond");
const returnIndex = server.indexOf(returnLine, functionStart);

if (functionStart === -1 || returnIndex === -1) {
  console.error("Could not find final res.json(parsed) inside parser function.");
  process.exit(1);
}

server =
  server.slice(0, returnIndex) +
  `attachCvEmbeddedLinksAfterParsing(parsed, embeddedCvLinks);
  console.log('CV auto-link postprocess:', JSON.stringify({
    projects: Array.isArray(parsed.projects) ? parsed.projects.map(p => ({ title: p.title, link: p.link })) : [],
    customSections: Array.isArray(parsed.customSections) ? parsed.customSections.map(s => ({
      name: s.name,
      items: Array.isArray(s.items) ? s.items.map(i => ({ heading: i.heading, link: i.link })) : []
    })) : []
  }, null, 2));

  ` +
  server.slice(returnIndex);

fs.writeFileSync(serverPath, server, "utf8");

console.log("Safe CV embedded link postprocess patch applied.");
console.log("backend/server.js changed:", changedServer);
console.log("src/App.js changed:", changedApp);
