const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'build', 'dist'].includes(item.name)) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function findFile(name, mustContain) {
  return walk(process.cwd()).find(file => {
    if (path.basename(file) !== name) return false;
    try {
      return fs.readFileSync(file, 'utf8').includes(mustContain);
    } catch {
      return false;
    }
  });
}

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

const serverPath = findFile('server.js', 'const ACTIVE_OUTPUT_LANGUAGES');
const appPath = findFile('App.js', 'const LANGUAGE_OPTIONS');

if (!serverPath) throw new Error('server.js not found');
if (!appPath) throw new Error('App.js not found');

let server = fs.readFileSync(serverPath, 'utf8');
let app = fs.readFileSync(appPath, 'utf8');

fs.writeFileSync(serverPath + '.backup.language-final-10-' + Date.now(), server, 'utf8');
fs.writeFileSync(appPath + '.backup.language-final-10-' + Date.now(), app, 'utf8');

server = server.replace(
  /const\s+ACTIVE_OUTPUT_LANGUAGES\s*=\s*new\s+Set\s*\(\s*\[[\s\S]*?\]\s*\);/,
  `const ACTIVE_OUTPUT_LANGUAGES = new Set(${languagesBlock});`
);

app = app.replace(
  /const\s+LANGUAGE_OPTIONS\s*=\s*\[[\s\S]*?\];/,
  `const LANGUAGE_OPTIONS = ${languagesBlock};`
);

fs.writeFileSync(serverPath, server, 'utf8');
fs.writeFileSync(appPath, app, 'utf8');

console.log('Final 10 languages patched.');
console.log('Server:', serverPath);
console.log('App:', appPath);
