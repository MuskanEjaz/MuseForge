'use strict';
const assert = require('assert');
const { __test } = require('./server.js');
const { parseCvTextLocally } = __test;

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

// A CV with a header, two projects and three certificates.
const CV = [
  'Ayesha Khan',
  'Software Engineer',
  'ayesha@example.com | +92 300 1234567',
  'SKILLS',
  'React, Node.js, Python',
  'PROJECTS',
  'TaskFlow',
  '• A task manager built with React.',
  'DataViz',
  '• A dashboard that charts CSV data.',
  'CERTIFICATIONS',
  '• IBM AI Fundamentals',
  '• Google Data Analytics',
  '• Meta Front-End Developer',
].join('\n');

// pdfjs gives {page, x, y, url} where y is the TOP edge in PDF space (bottom-left origin),
// so a LARGER y sits HIGHER on the page. Deliberately supplied in scrambled order.
const LINKS = [
  { page: 1, x: 100, y: 300, url: 'https://coursera.org/verify/meta-frontend' },   // 3rd cert (lowest)
  { page: 1, x: 100, y: 700, url: 'https://linkedin.com/in/ayeshakhan' },          // header (highest)
  { page: 1, x: 100, y: 380, url: 'https://coursera.org/verify/ibm-ai' },          // 1st cert
  { page: 1, x: 100, y: 520, url: 'https://github.com/ayesha/taskflow' },          // project 1
  { page: 1, x: 100, y: 340, url: 'https://coursera.org/verify/google-data' },     // 2nd cert
  { page: 1, x: 100, y: 480, url: 'https://github.com/ayesha/dataviz' },           // project 2
];

console.log('\n== Embedded PDF links ==');

check('contact links are routed to contact, not to certificates', () => {
  const p = parseCvTextLocally(CV, LINKS);
  const contactValues = JSON.stringify(p.contact).toLowerCase();
  assert.ok(contactValues.includes('linkedin.com/in/ayeshakhan'), 'linkedin missing from contact: ' + JSON.stringify(p.contact));
});

check('GitHub repo links attach to projects in reading order', () => {
  const p = parseCvTextLocally(CV, LINKS);
  assert.strictEqual(p.projects.length, 2, 'expected 2 projects, got ' + p.projects.length);
  // TaskFlow appears first in the CV and its link sits higher on the page (y=520).
  assert.ok(/taskflow/i.test(p.projects[0].link || ''), 'project 1 got wrong link: ' + p.projects[0].link);
  assert.ok(/dataviz/i.test(p.projects[1].link || ''), 'project 2 got wrong link: ' + p.projects[1].link);
});

check('certificate links attach top-to-bottom (the reading-order fix)', () => {
  const p = parseCvTextLocally(CV, LINKS);
  const certs = p.customSections.find(s => /certification/i.test(s.name));
  assert.ok(certs, 'certifications section missing');
  assert.ok(/ibm-ai/.test(certs.items[0].link || ''), 'cert 1 link wrong: ' + certs.items[0].link);
  assert.ok(/google-data/.test(certs.items[1].link || ''), 'cert 2 link wrong: ' + certs.items[1].link);
  assert.ok(/meta-frontend/.test(certs.items[2].link || ''), 'cert 3 link wrong: ' + certs.items[2].link);
});

check('a repeated header link does not consume a certificate slot (dedupe)', () => {
  // Same portfolio link repeated on every page, as page furniture.
  const dupes = [
    { page: 1, x: 50, y: 760, url: 'https://ayesha.dev' },
    { page: 1, x: 50, y: 760, url: 'https://ayesha.dev' },
    { page: 2, x: 50, y: 760, url: 'https://ayesha.dev' },
    ...LINKS,
  ];
  const p = parseCvTextLocally(CV, dupes);
  const certs = p.customSections.find(s => /certification/i.test(s.name));
  const links = certs.items.map(i => i.link);
  const seen = new Set();
  links.filter(Boolean).forEach(l => {
    assert.ok(!seen.has(l), 'duplicate link assigned twice: ' + l);
    seen.add(l);
  });
  // The three real certificate links must still all be present.
  assert.ok(links.some(l => /ibm-ai/.test(l || '')), 'ibm cert link lost to the duplicate: ' + JSON.stringify(links));
  assert.ok(links.some(l => /google-data/.test(l || '')), 'google cert link lost: ' + JSON.stringify(links));
  assert.ok(links.some(l => /meta-frontend/.test(l || '')), 'meta cert link lost: ' + JSON.stringify(links));
});

check('multi-page: page 1 links are read before page 2 links', () => {
  const multi = [
    { page: 2, x: 100, y: 700, url: 'https://coursera.org/verify/meta-frontend' },
    { page: 1, x: 100, y: 380, url: 'https://coursera.org/verify/ibm-ai' },
    { page: 1, x: 100, y: 340, url: 'https://coursera.org/verify/google-data' },
  ];
  const p = parseCvTextLocally(CV, multi);
  const certs = p.customSections.find(s => /certification/i.test(s.name));
  assert.ok(/ibm-ai/.test(certs.items[0].link || ''), 'page ordering broken: ' + certs.items[0].link);
  assert.ok(/google-data/.test(certs.items[1].link || ''), 'page ordering broken: ' + certs.items[1].link);
  assert.ok(/meta-frontend/.test(certs.items[2].link || ''), 'page-2 link not last: ' + certs.items[2].link);
});

check('links with missing x/y/page do not crash the parser', () => {
  const noCoords = [
    { url: 'https://coursera.org/verify/ibm-ai' },
    { url: 'https://github.com/ayesha/taskflow' },
    { url: 'https://linkedin.com/in/ayeshakhan' },
  ];
  const p = parseCvTextLocally(CV, noCoords);
  assert.ok(p && Array.isArray(p.projects), 'parser returned nothing');
  assert.ok(p.projects.length === 2, 'projects broken without coords');
});

check('an empty link list still parses the CV fine', () => {
  const p = parseCvTextLocally(CV, []);
  assert.strictEqual(p.projects.length, 2);
  assert.ok(p.customSections.some(s => /certification/i.test(s.name)));
});

check('mailto links are treated as contact, never as a certificate proof', () => {
  const withMail = [{ page: 1, x: 10, y: 750, url: 'mailto:ayesha@example.com' }, ...LINKS];
  const p = parseCvTextLocally(CV, withMail);
  const certs = p.customSections.find(s => /certification/i.test(s.name));
  certs.items.forEach(i => assert.ok(!/mailto:/i.test(i.link || ''), 'mailto leaked into certificates: ' + i.link));
});

console.log(`\n${pass} passed, ${fail} failed.\n`);
process.exitCode = fail ? 1 : 0;

// Hardest case: the PDF stores links in an order that does NOT match the certificate order.
// Positional assignment would put every certificate on the wrong URL; content matching fixes it.
check('scrambled link order still lands each certificate on ITS OWN url', () => {
  const scrambled = [
    { page: 1, x: 100, y: 700, url: 'https://linkedin.com/in/ayeshakhan' },
    { page: 1, x: 100, y: 690, url: 'https://ayesha.dev' },                       // page furniture
    { page: 1, x: 100, y: 380, url: 'https://coursera.org/verify/google-data' },  // belongs to cert #2
    { page: 1, x: 100, y: 360, url: 'https://coursera.org/verify/meta-frontend' },// belongs to cert #3
    { page: 1, x: 100, y: 340, url: 'https://credly.com/badges/ibm-ai-fundamentals' }, // belongs to cert #1
  ];
  const p = parseCvTextLocally(CV, scrambled);
  const certs = p.customSections.find(s => /certification/i.test(s.name));
  const [c1, c2, c3] = certs.items;
  assert.ok(/ibm/i.test(c1.link || ''), 'IBM cert got wrong link: ' + c1.link);
  assert.ok(/google-data/.test(c2.link || ''), 'Google cert got wrong link: ' + c2.link);
  assert.ok(/meta-frontend/.test(c3.link || ''), 'Meta cert got wrong link: ' + c3.link);
  certs.items.forEach(i => assert.ok(!/ayesha\.dev/.test(i.link || ''), 'personal site leaked onto a certificate'));
});

// Award / competition links used to be hard-coded to null and thrown away.
check('award verification links are no longer discarded', () => {
  const cvWithAward = [
    'Ayesha Khan', 'Software Engineer', 'ayesha@example.com',
    'CERTIFICATIONS', '• IBM AI Fundamentals',
    'AWARDS', '• Winner, National Hackathon 2024', '• Dean List',
  ].join('\n');
  const links = [
    { page: 1, x: 10, y: 500, url: 'https://credly.com/badges/ibm-ai-fundamentals' },
    { page: 1, x: 10, y: 400, url: 'https://devpost.com/national-hackathon-2024/winner' },
  ];
  const p = parseCvTextLocally(cvWithAward, links);
  const awards = p.customSections.find(s => /award/i.test(s.name));
  assert.ok(awards, 'awards section missing');
  assert.ok(/hackathon/i.test(awards.items[0].link || ''), 'hackathon award link not attached: ' + awards.items[0].link);
  // "Dean List" has no matching link, so it must stay null rather than borrow the IBM one.
  assert.strictEqual(awards.items[1].link, null, 'unrelated link guessed onto Dean List: ' + awards.items[1].link);
  const certs = p.customSections.find(s => /certification/i.test(s.name));
  assert.ok(/ibm/i.test(certs.items[0].link || ''), 'certificate lost its link: ' + certs.items[0].link);
});
