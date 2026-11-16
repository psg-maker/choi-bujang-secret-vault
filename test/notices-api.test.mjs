import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import handler from '../api/notices.js';

const project = 'https://dukaexggijwbynmthyvm.supabase.co';
const issuer = `${project}/auth/v1`;
const { privateKey, publicKey } = await generateKeyPair('ES256');
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'ES256', use: 'sig' };
const token = await new SignJWT({ iss: issuer, aud: 'authenticated', role: 'authenticated',
  sub: '11111111-1111-4111-8111-111111111111', exp: Math.floor(Date.now() / 1000) + 300 })
  .setProtectedHeader({ alg: 'ES256', kid: 'test-key' }).sign(privateKey);
const call = async (request) => {
  const res = { headers: {}, code: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ url: '/api/notices', method: 'GET', headers: {}, ...request }, res);
  return res;
};

test('notices are read-only, login-gated and read from their own table', async () => {
  const before = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  const reads = [];
  try {
    process.env.SUPABASE_URL = project;
    process.env.SUPABASE_SECRET_KEY = 'test-only-server-credential';
    globalThis.fetch = async (url, options) => {
      if (String(url) === `${issuer}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
      reads.push({ url, options });
      return Response.json([{ id: '33333333-3333-4333-8333-333333333333', title: '공지', body: '가상' }]);
    };
    assert.equal((await call({})).code, 401);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal((await call({ method, headers: { authorization: `Bearer ${token}` } })).code, 405);
    }
    assert.equal((await call({ url: '/api/notices/x', headers: { authorization: `Bearer ${token}` } })).code, 404);
    const ok = await call({ headers: { authorization: `Bearer ${token}` } });
    assert.equal(ok.code, 200);
    assert.deepEqual(ok.body, [{ id: '33333333-3333-4333-8333-333333333333', title: '공지', body: '가상' }]);
    assert.equal(reads.length, 1);
    assert.equal(reads[0].url.pathname, '/rest/v1/training_instructor_notices');
    assert.equal(reads[0].options.method, undefined);
  } finally {
    globalThis.fetch = before.fetch;
    if (before.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = before.url;
    if (before.key === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = before.key;
  }
});
