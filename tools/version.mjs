// Writes FILES and VERSION in sw.js from the app files on disk.
//   node tools/version.mjs          updates sw.js
//   node tools/version.mjs --check  fails if sw.js is out of date (run before every commit)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const swPath = join(root, 'sw.js');
const sw = readFileSync(swPath, 'utf8');

function all(dir) {
  return readdirSync(join(root, dir)).flatMap((n) => {
    const p = join(dir, n);
    return statSync(join(root, p)).isDirectory() ? all(p) : [p];
  });
}

const files = ['index.html', 'app.css', 'manifest.webmanifest', ...all('icons'), ...all('src')]
  .map((s) => s.split('\\').join('/'))
  .filter((s) => !s.endsWith('.md'))
  .sort();

const hash = createHash('sha256');
// Text is hashed with LF, so Windows (CRLF) and GitHub (LF) give the same version.
for (const f of files) {
  const body = readFileSync(join(root, f));
  hash.update(f).update(/\.(png|jpe?g|ico)$/.test(f) ? body : body.toString('utf8').replace(/\r\n/g, '\n'));
}
const version = 'workout-' + hash.digest('hex').slice(0, 8);
const list = "const FILES = [\n  './',\n" + files.map((f) => `  './${f}',`).join('\n') + '\n];';
const next = sw
  .replace(/const VERSION = '[^']+';/, `const VERSION = '${version}';`)
  .replace(/const FILES = \[[\s\S]*?\];/, list);

if (process.argv.includes('--check')) {
  if (next !== sw) { console.error('sw.js is out of date. Run: node tools/version.mjs'); process.exit(1); }
  console.log('sw.js is up to date:', version);
} else if (next === sw) {
  console.log('Unchanged:', version);
} else {
  writeFileSync(swPath, next);
  console.log('sw.js →', version, `(${files.length} files)`);
}
