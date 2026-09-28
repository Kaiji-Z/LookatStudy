// Preview the GitHub Pages landing page locally, staged exactly like CI does.
//   node scripts/preview-pages.mjs          → http://localhost:4173/
// Stages site/ + docs/screenshots into dist-pages/ (gitignored), then serves it.
// What you see here is byte-identical to what pages.yml deploys.

import { createServer } from 'node:http';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const dest = join(repoRoot, 'dist-pages');
const port = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

if (!existsSync(join(repoRoot, 'site', 'index.html'))) {
  console.error('site/index.html not found — run from the repo root.');
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
await mkdir(join(dest, 'docs'), { recursive: true });
await cp(join(repoRoot, 'site'), dest, { recursive: true });
await cp(join(repoRoot, 'docs', 'screenshots'), join(dest, 'docs', 'screenshots'), { recursive: true });

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(dest, path));
    if (!file.startsWith(dest)) throw new Error('traversal');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
});

server.listen(port, () => {
  console.log(`Pages preview (staged in dist-pages/): http://localhost:${port}/`);
});
