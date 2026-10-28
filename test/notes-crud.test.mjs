import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import handler from '../api/notes.js';

const project = 'https://dukaexggijwbynmthyvm.supabase.co';
const userId = '11111111-1111-4111-8111-111111111111';
const noteId = '22222222-2222-4222-8222-222222222222';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function response() {
  return { headers: {}, code: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }, end() { return this; } };
}
test('authenticated CRUD follows UUID contract and server-owned owner_id; anonymous mutations never reach DB', async () => {
  const before = { fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(publicKey), kid: 'crud-test-key', alg: 'ES256' };
  const token = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: jwk.kid })
    .setIssuer(`${project}/auth/v1`).setAudience('authenticated').setSubject(userId).setExpirationTime('5m').sign(privateKey);
  const rows = new Map();
  let queries = 0;
  let lastOwner;
  const send = async (method, path = '', body, authenticated = true) => {
    const res = response();
    await handler({ method, url: `/api/notes${path}`, body,
      headers: { ...(authenticated ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' } }, res);
    return res;
  };
  try {
    process.env.SUPABASE_URL = project;
    process.env.SUPABASE_SECRET_KEY = 'test-only-server-credential';
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
      queries++;
      assert.equal(url.pathname, '/rest/v1/training_user_notes');
      assert.equal(options.headers.apikey, 'test-only-server-credential');
      const id = url.searchParams.get('id')?.replace('eq.', '');
      const method = options.method ?? 'GET';
      let result;
      if (method === 'POST') {
        const row = JSON.parse(options.body);
        lastOwner = row.owner_id;
        if (rows.has(row.id)) return Response.json({ error: 'duplicate' }, { status: 409 });
        rows.set(row.id, row);
        result = [row];
      } else if (id) {
        // This stage intentionally does not apply ownership filtering to individual routes.
        assert.equal(url.searchParams.has('owner_id'), false);
        result = rows.has(id) ? [rows.get(id)] : [];
        if (method === 'PATCH' && result.length) {
          const changes = JSON.parse(options.body);
          assert.equal(changes.owner_id, undefined);
          rows.set(id, { ...rows.get(id), ...changes });
          result = [rows.get(id)];
        }
        if (method === 'DELETE') rows.delete(id);
      } else {
        assert.equal(url.searchParams.get('owner_id'), `eq.${userId}`);
        result = [...rows.values()].filter(row => row.owner_id === userId);
      }
      return Response.json(result.map(({ id, title, body }) => ({ id, title, body })));
    };
    for (const [method, path] of [['GET', ''], ['POST', ''], ['GET', `/${noteId}`], ['PUT', `/${noteId}`], ['DELETE', `/${noteId}`]]) {
      assert.equal((await send(method, path, { title: 'Synthetic', body: 'Synthetic' }, false)).code, 401);
    }
    assert.equal(queries, 0);
    const added = await send('POST', '', { id: noteId, title: 'Synthetic', body: 'Original', owner_id: 'forged', userId: 'forged' });
    assert.equal(added.code, 201);
    assert.deepEqual(added.body, { id: noteId });
    assert.equal(lastOwner, userId);
    assert.deepEqual((await send('GET', `/${noteId}`)).body, { id: noteId, title: 'Synthetic', body: 'Original' });
    assert.deepEqual((await send('GET')).body, [{ id: noteId, title: 'Synthetic', body: 'Original' }]);
    assert.equal((await send('PUT', `/${noteId}`, { title: 'Updated', body: 'Changed', owner_id: 'forged' })).code, 200);
    assert.deepEqual((await send('GET', `/${noteId}`)).body, { id: noteId, title: 'Updated', body: 'Changed' });
    assert.equal((await send('POST', '', { id: noteId, title: 'Duplicate', body: '' })).code, 409);
    const generated = await send('POST', '', { title: 'Generated', body: '' });
    assert.equal(generated.code, 201);
    assert.match(generated.body.id, uuid);
    assert.equal((await send('DELETE', `/${noteId}`)).code, 204);
    assert.equal((await send('GET', `/${noteId}`)).code, 404);
    assert.equal((await send('PUT', `/${noteId}`, { title: 'Gone', body: '' })).code, 404);
    assert.equal((await send('DELETE', `/${noteId}`)).code, 404);
    const count = queries;
    assert.equal((await send('POST', '', { id: 'invalid', title: 'Bad', body: '' })).code, 400);
    assert.equal((await send('PUT', '/invalid', { title: 'Bad', body: '' })).code, 400);
    assert.equal((await send('POST', '', { title: '', body: '' })).code, 400);
    assert.equal(queries, count);
  } finally {
    globalThis.fetch = before.fetch;
    for (const [key, value] of [['SUPABASE_URL', before.url], ['SUPABASE_SECRET_KEY', before.key]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
