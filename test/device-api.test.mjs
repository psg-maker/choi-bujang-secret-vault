import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as signData } from 'node:crypto';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import config from '../aleph.config.json' with { type: 'json' };
import handler from '../api/device/[action].js';
import notesHandler from '../api/notes.js';

const project = 'https://dukaexggijwbynmthyvm.supabase.co';
const issuer = `${project}/auth/v1`;
const A = '11111111-1111-4111-8111-1111111111a1';
const B = '22222222-2222-4222-8222-2222222222b2';
const origin = new URL(config.publicAppUrl).origin;
const rpId = new URL(origin).hostname;
const sha = data => createHash('sha256').update(data).digest();
const b64 = data => Buffer.from(data).toString('base64url');
const { privateKey, publicKey } = await generateKeyPair('ES256');
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'ES256', use: 'sig' };
const login = sub => new SignJWT({ iss: issuer, aud: 'authenticated', role: 'authenticated', sub,
  exp: Math.floor(Date.now() / 1000) + 300 }).setProtectedHeader({ alg: 'ES256', kid: 'test-key' }).sign(privateKey);

// A fake passkey: the private key stays in this object, like an authenticator.
function passkey() {
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialId = b64(Buffer.from(`credential-${Math.random()}`));
  let counter = 0;
  const authData = () => Buffer.concat([sha(rpId), Buffer.from([0x05]), Buffer.from([0, 0, 0, counter])]);
  return {
    credentialId,
    create: (challenge, at = origin) => ({ credentialId, alg: -7, challenge,
      publicKey: b64(keys.publicKey.export({ format: 'der', type: 'spki' })),
      clientDataJSON: b64(JSON.stringify({ type: 'webauthn.create', challenge: b64(challenge), origin: at })),
      authenticatorData: b64(authData()) }),
    get(challenge, { at = origin, tamper = false, count = 0 } = {}) {
      counter = count;
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: b64(challenge), origin: at }));
      const data = authData();
      const signature = signData('sha256', Buffer.concat([data, sha(clientData)]), keys.privateKey);
      if (tamper) signature[signature.length - 1] ^= 1;
      return { credentialId, challenge, clientDataJSON: b64(clientData), authenticatorData: b64(data), signature: b64(signature) };
    },
  };
}

test('device approval: request stays pending, only a server-approved passkey opens notes', async () => {
  const saved = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  const devices = [];
  const call = async (path, sub, body, method = 'POST', extra = {}) => {
    const res = { headers: {}, code: 200, body: null, setHeader(n, v) { this.headers[n] = v; },
      status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
    const auth = sub ? { authorization: `Bearer ${await login(sub)}` } : {};
    await (path.startsWith('/api/notes') ? notesHandler : handler)({ url: path, method, body, headers: { ...auth, ...extra } }, res);
    return res;
  };
  try {
    process.env.SUPABASE_URL = project;
    process.env.SUPABASE_SECRET_KEY = 'test-only-server-credential';
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
      const q = name => url.searchParams.get(name)?.replace('eq.', '');
      if (url.pathname === '/rest/v1/training_user_notes') return Response.json([]);
      assert.equal(url.pathname, '/rest/v1/training_devices');
      if (options.method === 'POST') {
        const row = { id: `44444444-4444-4444-8444-44444444444${devices.length}`, status: 'pending', ...JSON.parse(options.body) };
        devices.push(row);
        return Response.json([{ status: row.status }]);
      }
      if (options.method === 'PATCH') {
        const row = devices.find(d => d.id === q('id'));
        Object.assign(row, JSON.parse(options.body));
        return Response.json([{ id: row.id }]);
      }
      return Response.json(devices.filter(d => (!q('id') || d.id === q('id')) && (!q('owner_id') || d.owner_id === q('owner_id'))
        && (!q('credential_id') || d.credential_id === q('credential_id')) && (!q('status') || d.status === q('status'))));
    };
    const key = passkey();
    const challenge = async (sub, kind) => (await call('/api/device/challenge', sub, { kind })).body;

    assert.equal((await call('/api/device/challenge', null, { kind: 'register' })).code, 401);
    assert.equal((await call('/api/device/challenge', A, {}, 'GET')).code, 405);

    // Request approval: stored as pending, no token, notes stay closed.
    const reg = await challenge(A, 'register');
    assert.equal(reg.rpId, rpId);
    assert.equal((await call('/api/device/register', A, key.create(reg.challenge, 'https://evil.example'))).code, 400);
    const pending = await call('/api/device/register', A, key.create(reg.challenge));
    assert.deepEqual([pending.code, pending.body], [201, { status: 'pending' }]);
    assert.equal(devices[0].status, 'pending');
    assert.equal(JSON.stringify(pending.body).includes('deviceToken'), false);
    const early = await call('/api/device/assert', A, key.get((await challenge(A, 'assert')).challenge));
    assert.deepEqual([early.code, early.body.error, early.body.deviceToken], [403, 'DEVICE_NOT_APPROVED', undefined]);
    assert.equal((await call('/api/notes', A, undefined, 'GET')).code, 403);

    // The register challenge cannot be reused for assert, and B cannot use A's passkey.
    assert.equal((await call('/api/device/assert', A, key.get(reg.challenge))).body.error, 'CHALLENGE_INVALID');
    assert.equal((await call('/api/device/assert', B, key.get((await challenge(B, 'assert')).challenge))).body.error, 'DEVICE_NOT_FOUND');

    // Admin approves in the DB; a forged signature still fails, a real one gets a short-lived token.
    devices[0].status = 'approved';
    const forged = await call('/api/device/assert', A, key.get((await challenge(A, 'assert')).challenge, { tamper: true }));
    assert.deepEqual([forged.code, forged.body.error], [403, 'SIGNATURE_INVALID']);
    const ok = await call('/api/device/assert', A, key.get((await challenge(A, 'assert')).challenge, { count: 3 }));
    assert.equal(ok.code, 200);
    assert.equal(ok.body.status, 'approved');
    assert.equal(devices[0].sign_count, 3);
    const replayCount = await call('/api/device/assert', A, key.get((await challenge(A, 'assert')).challenge, { count: 3 }));
    assert.equal(replayCount.body.error, 'SIGN_COUNT_INVALID');
    assert.equal((await call('/api/notes', A, undefined, 'GET', { 'x-device-token': ok.body.deviceToken })).code, 200);
    assert.equal((await call('/api/notes', B, undefined, 'GET', { 'x-device-token': ok.body.deviceToken })).code, 403);

    // Revoking the device closes notes again even with an unexpired token.
    devices[0].status = 'revoked';
    assert.equal((await call('/api/notes', A, undefined, 'GET', { 'x-device-token': ok.body.deviceToken })).code, 403);
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [name, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_SECRET_KEY', saved.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
