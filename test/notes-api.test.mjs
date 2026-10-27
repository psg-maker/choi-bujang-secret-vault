import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import handler from '../api/notes.js';

function response() {
  return { headers: {}, code: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; } };
}

test('notes API uses server environment, returns only note fields and hides failures', async () => {
  const before = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY, fetch: globalThis.fetch };
  const key = 'test-only-server-credential';
  const rows = Array.from({ length: 4 }, (_, i) => ({ id: i + 1, title: `Title ${i}`, content: `Body ${i}`, owner_id: 'hidden' }));
  try {
    process.env.SUPABASE_URL = 'https://test-project.supabase.co';
    process.env.SUPABASE_SECRET_KEY = key;
    globalThis.fetch = async (url, options) => {
      assert.equal(url.origin, process.env.SUPABASE_URL);
      assert.equal(url.pathname, '/rest/v1/training_notes');
      assert.equal(url.searchParams.get('select'), 'id,title,content');
      assert.equal(url.searchParams.get('order'), 'id.asc');
      assert.equal(options.headers.apikey, key);
      assert.equal(options.headers.authorization, undefined);
      assert.equal(options.redirect, 'error');
      return Response.json(rows);
    };
    const ok = response();
    await handler({ method: 'GET', headers: { authorization: 'untrusted-client-value' } }, ok);
    assert.equal(ok.code, 200);
    assert.equal(ok.headers['Cache-Control'], 'no-store');
    assert.deepEqual(ok.body.notes, rows.map(({ id, title, content }) => ({ id, title, content })));
    for (const fakeFetch of [
      async () => new Response(key, { status: 403 }),
      async () => { throw new Error(key); },
      async () => Response.json({ error: key }),
    ]) {
      globalThis.fetch = fakeFetch;
      const failed = response();
      await handler({ method: 'GET' }, failed);
      assert.equal(failed.code, 502);
      assert.deepEqual(failed.body, { error: 'NOTES_UNAVAILABLE' });
    }
    delete process.env.SUPABASE_SECRET_KEY;
    globalThis.fetch = async () => { assert.fail('missing configuration must not send a request'); };
    const missing = response();
    await handler({ method: 'GET' }, missing);
    assert.equal(missing.code, 503);
    const post = response();
    await handler({ method: 'POST' }, post);
    assert.equal(post.code, 405);
    assert.equal(post.headers.Allow, 'GET');
  } finally {
    for (const [name, value] of [['SUPABASE_URL', before.url], ['SUPABASE_SECRET_KEY', before.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    globalThis.fetch = before.fetch;
  }
});

test('page loads four cards through the notes API and renders DB values as text', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const list = { children: [], replaceChildren(...nodes) { this.children = nodes; } };
  const document = { querySelector: () => list, createElement: () => ({ append(...nodes) { this.children = nodes; } }) };
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const notes = Array.from({ length: 4 }, (_, i) => ({ title: `<b>${i}</b>`, content: `Training ${i}` }));
  await vm.runInNewContext(`(async () => {${script}})()`, { document, fetch: async url => {
    assert.equal(url, '/api/notes');
    return Response.json({ notes });
  } });
  assert.equal(list.children.length, 4);
  assert.equal(list.children[0].children[0].textContent, '<b>0</b>');
});
