import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAttackChecks } from '../src/attack-check.mjs';

const config = { step: 3, publicAppUrl: 'https://vault.vercel.app' };
test('step 3 self-check measures actual JSON rejections, identity and security header without retaining bodies', async () => {
  const original = fetch;
  const seen = [];
  try {
    globalThis.fetch = async (url, options) => {
      seen.push(`${options.method ?? 'GET'} ${url.pathname}`);
      assert.equal(options.headers?.Authorization, undefined);
      if (url.pathname === '/aleph.json') return Response.json({ step: 3, commit: 'a'.repeat(40) });
      if (url.pathname === '/') return new Response('DO_NOT_RECORD', { headers: { 'X-Content-Type-Options': 'nosniff' } });
      if (url.pathname === '/data.json') return new Response('DO_NOT_RECORD', { status: 404 });
      return Response.json({ error: 'DO_NOT_RECORD' }, { status: 401 });
    };
    const checks = await runAttackChecks(config);
    assert.equal(seen.length, 8);
    assert.ok(seen.includes('POST /api/notes'));
    assert.ok(seen.some(value => value.startsWith('PUT /api/notes/')));
    assert.match(checks.find(x => x.attackId === 'anonymous_note_list').observed, /401.*JSON/);
    assert.match(checks.find(x => x.attackId === 'deployment_identity').observed, /단계 3/);
    assert.match(checks.find(x => x.attackId === 'security_header').observed, /nosniff/);
    assert.match(checks.find(x => x.attackId === 'authenticated_note_crud').observed, /미실행/);
    assert.ok(!JSON.stringify(checks).includes('DO_NOT_RECORD'));
  } finally { globalThis.fetch = original; }
});

test('HTML rejections and connection failures are not reported as verified JSON denial', async () => {
  const original = fetch;
  try {
    globalThis.fetch = async () => new Response('<html>failure</html>', { status: 401 });
    const checks = await runAttackChecks(config);
    assert.match(checks.find(x => x.attackId === 'anonymous_note_list').observed, /JSON 오류 확인 안 됨/);
    globalThis.fetch = async () => { throw new Error('DO_NOT_RECORD'); };
    const failed = await runAttackChecks(config);
    assert.match(failed.find(x => x.attackId === 'anonymous_note_list').observed, /미확인/);
    assert.ok(!JSON.stringify(failed).includes('DO_NOT_RECORD'));
  } finally { globalThis.fetch = original; }
});

test('step 4 self-check preserves deployed identity and does not invent authenticated or RLS results', async () => {
  const original = fetch;
  try {
    globalThis.fetch = async url => {
      if (url.pathname === '/aleph.json') return Response.json({ step: 3, commit: 'b'.repeat(40) });
      if (url.pathname === '/') return new Response('', { headers: { 'X-Content-Type-Options': 'nosniff' } });
      if (url.pathname === '/data.json') return new Response('', { status: 404 });
      return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    };
    const checks = await runAttackChecks({ ...config, step: 4 });
    const identity = checks.find(x => x.attackId === 'deployment_identity');
    assert.match(identity.expected, /단계 4/);
    assert.match(identity.observed, /단계 3/);
    for (const id of ['authenticated_note_crud', 'cross_owner_access', 'owner_change', 'database_rls']) {
      assert.match(checks.find(x => x.attackId === id).observed, /미실행/);
    }
    assert.equal(checks.filter(x => x.attackId.startsWith('anonymous_note_')).length, 5);
  } finally { globalThis.fetch = original; }
});
