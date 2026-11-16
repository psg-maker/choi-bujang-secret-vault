import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import handler, { contentHash } from '../api/restore/[id].js';

const project = 'https://dukaexggijwbynmthyvm.supabase.co';
const issuer = `${project}/auth/v1`;
const B = '22222222-2222-4222-8222-2222222222b2';
const A = '11111111-1111-4111-8111-1111111111a1';
const TARGET = 'b10c0000-0000-4000-8000-0000000000b1';
const OTHER = 'b10c0000-0000-4000-8000-0000000000b2';
const { privateKey, publicKey } = await generateKeyPair('ES256');
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'ES256', use: 'sig' };
const token = sub => new SignJWT({ iss: issuer, aud: 'authenticated', role: 'authenticated', sub,
  exp: Math.floor(Date.now() / 1000) + 300 }).setProtectedHeader({ alg: 'ES256', kid: 'test-key' }).sign(privateKey);
const call = async (request) => {
  const res = { headers: {}, code: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ url: `/api/restore/${TARGET}`, method: 'POST', headers: {}, ...request }, res);
  return res;
};

test('restore brings back only B\'s one note after matching ID, owner and content hash', async () => {
  const before = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  const title = '10단계 복구 대상 가상 메모';
  const body = 'B 계정의 복구 시험용 가상 메모입니다.';
  const backups = new Map([[TARGET, { id: TARGET, owner_id: B, title, body, content_sha256: contentHash(title, body) }]]);
  // Live table: target damaged, another B note untouched.
  const live = new Map([[TARGET, { id: TARGET, owner_id: B, title: '변조됨', body: '' }],
    [OTHER, { id: OTHER, owner_id: B, title: '다른 메모', body: '보존' }]]);
  const writes = [];
  const logs = [];
  const log = console.log;
  try {
    process.env.SUPABASE_URL = project;
    process.env.SUPABASE_SECRET_KEY = 'test-only-server-credential';
    console.log = line => logs.push(line);
    globalThis.fetch = async (url, options = {}) => {
      if (String(url) === `${issuer}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
      const id = url.searchParams.get('id')?.replace('eq.', '');
      if (url.pathname === '/rest/v1/training_note_backups') return Response.json(backups.has(id) ? [backups.get(id)] : []);
      assert.equal(url.pathname, '/rest/v1/training_user_notes');
      if (options.method === 'POST') {
        assert.equal(url.searchParams.get('on_conflict'), 'id');
        const row = JSON.parse(options.body);
        writes.push(row);
        live.set(row.id, { ...live.get(row.id), ...row });
        return Response.json([live.get(row.id)]);
      }
      assert.equal(options.method, undefined, 'only GET or upsert, never delete');
      return Response.json(live.has(id) ? [live.get(id)] : []);
    };
    const auth = async sub => ({ authorization: `Bearer ${await token(sub)}` });

    assert.equal((await call({})).code, 401);
    assert.equal((await call({ method: 'GET', headers: await auth(B) })).code, 405);
    assert.equal((await call({ url: '/api/restore/not-a-uuid', headers: await auth(B) })).code, 400);
    // A cannot restore B's note; a forged body owner does not help.
    const byA = await call({ headers: await auth(A), body: { owner_id: B } });
    assert.deepEqual([byA.code, byA.body], [404, { error: 'NOT_FOUND' }]);
    assert.equal(writes.length, 0);

    const ok = await call({ headers: await auth(B) });
    assert.equal(ok.code, 200);
    assert.deepEqual(ok.body, { id: TARGET, restored: true, ownerMatched: true, contentSha256: contentHash(title, body) });
    assert.deepEqual(writes, [{ id: TARGET, owner_id: B, title, body }]);
    const restored = live.get(TARGET);
    assert.deepEqual([restored.id, restored.owner_id, contentHash(restored.title, restored.body)],
      [backups.get(TARGET).id, backups.get(TARGET).owner_id, backups.get(TARGET).content_sha256]);
    assert.deepEqual(live.get(OTHER), { id: OTHER, owner_id: B, title: '다른 메모', body: '보존' });
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0], new RegExp(`${title}|${body}|${B}`, 'u'));

    // A tampered backup copy stops the restore.
    backups.get(TARGET).body = '사본 변조';
    const tampered = await call({ headers: await auth(B) });
    assert.deepEqual([tampered.code, tampered.body], [409, { error: 'BACKUP_HASH_MISMATCH' }]);
    backups.get(TARGET).body = body;
    // The same ID owned by someone else in the live table is never overwritten.
    live.set(TARGET, { id: TARGET, owner_id: A, title: 'A 메모', body: '' });
    const taken = await call({ headers: await auth(B) });
    assert.deepEqual([taken.code, taken.body], [409, { error: 'ID_OWNED_BY_OTHER' }]);
    assert.equal(writes.length, 1);
  } finally {
    console.log = log;
    globalThis.fetch = before.fetch;
    if (before.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = before.url;
    if (before.key === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = before.key;
  }
});
