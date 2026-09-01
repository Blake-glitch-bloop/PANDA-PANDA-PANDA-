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

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

async function handleState(request, env) {
  if (!env.DB) return new Response(JSON.stringify({ error: 'Storage unavailable' }), { status: 503, headers: jsonHeaders });
  const userKey = request.headers.get('oai-authenticated-user-email') || 'owner';

  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT payload, updated_at FROM app_state WHERE user_key = ?')
      .bind(userKey)
      .first();
    if (!row) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    try {
      return new Response(JSON.stringify({ state: JSON.parse(row.payload), updatedAt: row.updated_at }), { headers: jsonHeaders });
    } catch {
      return new Response(JSON.stringify({ error: 'Saved state is unreadable' }), { status: 500, headers: jsonHeaders });
    }
  }

  if (request.method === 'POST') {
    const text = await request.text();
    if (text.length > 3000000) return new Response(JSON.stringify({ error: 'Board is too large to save' }), { status: 413, headers: jsonHeaders });
    let payload;
    try {
      payload = JSON.parse(text);
      if (!payload || !Array.isArray(payload.notes) || !Array.isArray(payload.saved)) throw new Error('invalid');
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid board state' }), { status: 400, headers: jsonHeaders });
    }
    const updatedAt = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO app_state (user_key, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at'
    ).bind(userKey, JSON.stringify(payload), updatedAt).run();
    return new Response(JSON.stringify({ ok: true, updatedAt }), { headers: jsonHeaders });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...jsonHeaders, allow: 'GET, POST' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/state') return handleState(request, env);
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
