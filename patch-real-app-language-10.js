const fs = require('fs');

const appPath = '.\\src\\App.js';
const serverPath = '.\\backend\\server.js';

const languagesBlock = `[
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Turkish',
  'Chinese',
  'Japanese',
  'Korean'
]`;

if (!fs.existsSync(appPath)) throw new Error('Real src/App.js not found');
if (!fs.existsSync(serverPath)) throw new Error('backend/server.js not found');

let app = fs.readFileSync(appPath, 'utf8');
let server = fs.readFileSync(serverPath, 'utf8');

fs.writeFileSync(appPath + '.backup.real-language-10-' + Date.now(), app, 'utf8');
fs.writeFileSync(serverPath + '.backup.real-language-10-' + Date.now(), server, 'utf8');

app = app.replace(
  /const\s+LANGUAGE_OPTIONS\s*=\s*\[[\s\S]*?\];/,
  `const LANGUAGE_OPTIONS = ${languagesBlock};`
);

server = server.replace(
  /const\s+ACTIVE_OUTPUT_LANGUAGES\s*=\s*new\s+Set\s*\(\s*\[[\s\S]*?\]\s*\);/,
  `const ACTIVE_OUTPUT_LANGUAGES = new Set(${languagesBlock});`
);

fs.writeFileSync(appPath, app, 'utf8');
fs.writeFileSync(serverPath, server, 'utf8');

console.log('Patched REAL frontend App.js:', appPath);
console.log('Patched backend server.js:', serverPath);
