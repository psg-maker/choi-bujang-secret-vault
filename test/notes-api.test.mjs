import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import handler from '../api/notes.js';

const project = 'https://dukaexggijwbynmthyvm.supabase.co';
const issuer = `${project}/auth/v1`;
const userId = '11111111-1111-4111-8111-111111111111';
const { privateKey, publicKey } = await generateKeyPair('ES256');
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'ES256', use: 'sig' };
const sign = (claims = {}, key = privateKey) => new SignJWT({ iss: issuer, aud: 'authenticated',
  sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 300, ...claims })
  .setProtectedHeader({ alg: 'ES256', kid: 'test-key' }).sign(key);
function response() {
  return { headers: {}, code: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; } };
}

test('real login verifier gates note queries and ignores client identities', async () => {
  const before = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  const serverKey = 'test-only-server-credential';
  const rows = Array.from({ length: 4 }, (_, i) => ({ id: `22222222-2222-4222-8222-22222222222${i}`, title: `Title ${i}`, body: `Body ${i}`, owner_id: 'hidden' }));
  let reads = 0;
  let upstreamFails = false;
  try {
    process.env.SUPABASE_URL = project;
    process.env.SUPABASE_SECRET_KEY = serverKey;
    globalThis.fetch = async (url, options) => {
      if (String(url) === `${issuer}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
      reads += 1;
      assert.equal(url.origin, project);
      assert.equal(url.pathname, '/rest/v1/training_user_notes');
      assert.equal(url.searchParams.get('select'), 'id,title,body');
      assert.equal(url.searchParams.get('owner_id'), `eq.${userId}`);
      assert.equal(options.headers.apikey, serverKey);
      assert.equal(options.headers.authorization, undefined);
      assert.equal(options.redirect, 'error');
      return upstreamFails ? new Response(serverKey, { status: 403 }) : Response.json(rows);
    };
    const { privateKey: wrongKey } = await generateKeyPair('ES256');
    const invalid = [undefined, 'Bearer invalid',
      `Bearer ${await sign({ exp: 1 })}`, `Bearer ${await sign({ iss: 'https://other.supabase.co/auth/v1' })}`,
      `Bearer ${await sign({ aud: 'other' })}`, `Bearer ${await sign({}, wrongKey)}`,
      `Bearer ${await sign({ role: 'service_role' })}`];
    for (const authorization of invalid) {
      const res = response();
      await handler({ method: 'GET', headers: { authorization, 'x-user-id': userId, 'x-role': 'admin' },
        query: { userId, role: 'admin' }, body: { userId, role: 'admin' } }, res);
      assert.equal(res.code, 401);
      assert.deepEqual(res.body, { error: 'UNAUTHORIZED' });
      assert.equal(res.headers['Cache-Control'], 'no-store');
    }
    assert.equal(reads, 0);
    const request = { method: 'GET', headers: { authorization: `Bearer ${await sign()}` } };
    const ok = response();
    await handler(request, ok);
    assert.equal(ok.code, 200);
    assert.equal(reads, 1);
    assert.deepEqual(ok.body, rows.map(({ id, title, body }) => ({ id, title, body })));
    process.env.SUPABASE_URL = 'https://other.supabase.co';
    const wrongProject = response();
    await handler(request, wrongProject);
    assert.equal(wrongProject.code, 503);
    assert.equal(reads, 1);
    process.env.SUPABASE_URL = project;
    upstreamFails = true;
    const failed = response();
    await handler(request, failed);
    assert.equal(failed.code, 502);
    assert.deepEqual(failed.body, { error: 'NOTES_UNAVAILABLE' });
    delete process.env.SUPABASE_SECRET_KEY;
    const missing = response();
    await handler(request, missing);
    assert.equal(missing.code, 503);
    process.env.SUPABASE_SECRET_KEY = serverKey;
    const post = response();
    await handler({ ...request, method: 'PATCH' }, post);
    assert.equal(post.code, 405);
  } finally {
    globalThis.fetch = before.fetch;
    for (const [name, value] of [['SUPABASE_URL', before.url], ['SUPABASE_SECRET_KEY', before.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
