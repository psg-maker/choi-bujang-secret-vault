import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import handler from '../api/war-room.js';
import { contentHash } from '../api/restore/[id].js';
import { detect } from '../src/detect.mjs';
import { checkConsistency, summarize, createWarRoom } from '../public/war-room.mjs';

const project = 'https://dukaexggijwbynmthyvm.supabase.co';
const issuer = `${project}/auth/v1`;
const A = '11111111-1111-4111-8111-1111111111a1';
const B = '22222222-2222-4222-8222-2222222222b2';
const NOTE = 'b10c0000-0000-4000-8000-0000000000b1';
const TITLE = '복구 시험용 제목';
const BODY = '복구 시험용 가상 본문 문장';
const { privateKey, publicKey } = await generateKeyPair('ES256');
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'ES256', use: 'sig' };
const token = sub => new SignJWT({ iss: issuer, aud: 'authenticated', role: 'authenticated', sub,
  exp: Math.floor(Date.now() / 1000) + 300 }).setProtectedHeader({ alg: 'ES256', kid: 'test-key' }).sign(privateKey);
const call = async request => {
  const res = { headers: {}, code: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ url: '/api/war-room', method: 'GET', headers: {}, ...request }, res);
  return res;
};

async function withServer(rowsByTable, run) {
  const before = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  const owners = [];
  try {
    process.env.SUPABASE_URL = project;
    process.env.SUPABASE_SECRET_KEY = 'test-only-server-credential';
    globalThis.fetch = async (url, options = {}) => {
      if (String(url) === `${issuer}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
      assert.equal(options.method, undefined, '읽기 전용: GET만 사용');
      owners.push(url.searchParams.get('owner_id'));
      return Response.json(rowsByTable[url.pathname.split('/').pop()] ?? []);
    };
    await run(owners);
  } finally {
    globalThis.fetch = before.fetch;
    if (before.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = before.url;
    if (before.key === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = before.key;
  }
}

test('api: 로그인 필수, GET만, 본인 기록만 세고 본문·전체 ID는 내보내지 않음', async () => {
  const rows = {
    training_devices: [{ id: 'd0000000-0000-4000-8000-000000000001', status: 'approved' },
      { id: 'd0000000-0000-4000-8000-000000000002', status: 'revoked' }],
    training_note_backups: [{ id: NOTE, content_sha256: contentHash(TITLE, BODY) }],
    training_user_notes: [{ id: NOTE, title: TITLE, body: BODY }],
  };
  await withServer(rows, async owners => {
    assert.equal((await call({})).code, 401);
    assert.equal((await call({ headers: { authorization: 'Bearer x' } })).code, 401);
    assert.equal((await call({ method: 'POST', headers: { authorization: `Bearer ${await token(B)}` } })).code, 405);
    const ok = await call({ headers: { authorization: `Bearer ${await token(B)}` } });
    assert.equal(ok.code, 200);
    assert.ok(owners.length >= 3 && owners.every(o => o === `eq.${B}`), '다른 사용자 조건이 섞이지 않음');
    const { revocation, restore, rules, detection } = ok.body;
    assert.deepEqual([revocation.total, revocation.counts], [2, { pending: 0, approved: 1, revoked: 1 }]);
    assert.deepEqual(restore.items, [{ ref: 'b10c0000…', hashPrefix: contentHash(TITLE, BODY).slice(0, 8), live: 'match' }]);
    assert.ok(rules.ruleIds.includes('resource_zone'));
    assert.equal(detection.kind, 'not_run');
    assert.equal(checkConsistency(ok.body), true);
    const text = JSON.stringify(ok.body);
    for (const secret of [TITLE, BODY, B, NOTE, 'd0000000-0000-4000-8000-000000000001']) assert.ok(!text.includes(secret), `노출: ${secret}`);

    // 같은 ID의 현재 메모가 바뀌면 "다름", 없으면 "없음"으로 구분합니다.
    rows.training_user_notes = [{ id: NOTE, title: '변조됨', body: '' }];
    assert.equal((await call({ headers: { authorization: `Bearer ${await token(B)}` } })).body.restore.items[0].live, 'differs');
    rows.training_user_notes = [];
    assert.equal((await call({ headers: { authorization: `Bearer ${await token(B)}` } })).body.restore.items[0].live, 'missing');
  });
});

test('api: 서버 기록 형식이 틀리거나 조회에 실패하면 502이며 값을 지어내지 않음', async () => {
  await withServer({ training_devices: [{ id: 'bad', status: 'approved' }] }, async () => {
    const res = await call({ headers: { authorization: `Bearer ${await token(A)}` } });
    assert.deepEqual([res.code, res.body], [502, { error: 'WAR_ROOM_UNAVAILABLE' }]);
  });
});

test('탐지 기준(10분·120건)이 detect.mjs와 같음', async () => {
  await withServer({}, async () => {
    const { detection } = (await call({ headers: { authorization: `Bearer ${await token(A)}` } })).body;
    const events = n => Array.from({ length: n }, (_, i) => ({ at: new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString(),
      method: 'GET', identity: { sub: 'learner_fixture' } }));
    assert.equal(detect(events(detection.limit)).action, 'observe');
    assert.equal(detect(events(detection.limit + 1)).action, 'propose_revocation');
    assert.equal(detection.windowMinutes, 10);
  });
});

test('화면: 숫자와 가린 기록이 어긋나면 불일치로 표시', () => {
  const data = { rules: { ruleIds: ['a'], zones: { notes: ['GET /notes/:id'], materials: [] } },
    detection: { rule: 'burst_read', windowMinutes: 10, limit: 120, note: 'n' },
    revocation: { total: 2, counts: { pending: 1, approved: 1, revoked: 0 }, items: [{ ref: 'aaaaaaaa…', status: 'pending' }, { ref: 'bbbbbbbb…', status: 'approved' }] },
    restore: { total: 1, items: [{ ref: 'cccccccc…', hashPrefix: '12345678', live: 'match' }] } };
  assert.match(summarize(data).at(-1).lines[0], /일치합니다/u);
  data.revocation.total = 3;
  assert.equal(checkConsistency(data), false);
  assert.match(summarize(data).at(-1).lines[0], /맞지 않습니다/u);
});

test('화면: 로그인하면 불러오고, 실패하면 확인된 결과 없음, 로그아웃하면 비움', async () => {
  const node = () => ({ textContent: '', hidden: false, children: [],
    replaceChildren(...n) { this.children = n; }, append(...n) { this.children.push(...n); }, addEventListener(t, f) { this[t] = f; } });
  const ids = ['war-room', 'war-room-body', 'war-room-status', 'war-room-error', 'war-room-refresh'];
  const els = Object.fromEntries(ids.map(id => [id, node()]));
  const document = { getElementById: id => els[id], createElement: node };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  let fail = false;
  const data = { rules: { ruleIds: ['x'], zones: {} }, detection: { rule: 'burst_read', windowMinutes: 10, limit: 120, note: 'n' },
    revocation: { total: 0, counts: { pending: 0, approved: 0, revoked: 0 }, items: [] }, restore: { total: 0, items: [] } };
  const update = createWarRoom(document, async () => fail ? Response.json({ error: 'X' }, { status: 502 }) : Response.json(data));
  update({ access_token: 's' }); await tick(); await tick();
  assert.equal(els['war-room'].hidden, false);
  assert.equal(els['war-room-body'].children.length, 5);
  fail = true; els['war-room-refresh'].click(); await tick(); await tick();
  assert.equal(els['war-room-body'].children.length, 0);
  assert.match(els['war-room-error'].textContent, /확인된 결과가 없습니다/u);
  update(null);
  assert.equal(els['war-room'].hidden, true);
});
