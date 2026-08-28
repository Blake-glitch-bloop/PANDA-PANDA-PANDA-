import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const output = resolve(root, 'dist', 'server');
const files = {
  '/': { source: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { source: 'index.html', type: 'text/html; charset=utf-8' },
  '/styles.css': { source: 'styles.css', type: 'text/css; charset=utf-8' },
  '/script.js': { source: 'script.js', type: 'text/javascript; charset=utf-8' }
};

await rm(resolve(root, 'dist'), { recursive: true, force: true });
await mkdir(output, { recursive: true });

const routes = {};
for (const [route, file] of Object.entries(files)) {
  routes[route] = { body: await readFile(resolve(root, file.source), 'utf8'), type: file.type };
}

const worker = `const routes = ${JSON.stringify(routes)};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const asset = routes[url.pathname];
    if (!asset) {
      return new Response('Not found', { status: 404 });
    }
    return new Response(request.method === 'HEAD' ? null : asset.body, {
      status: 200,
      headers: {
        'content-type': asset.type,
        'cache-control': url.pathname === '/' || url.pathname === '/index.html'
          ? 'no-cache'
          : 'public, max-age=3600',
        'x-content-type-options': 'nosniff'
      }
    });
  }
};
`;

await writeFile(resolve(output, 'index.js'), worker, 'utf8');
console.log('Built Notesguy into dist/server/index.js');
