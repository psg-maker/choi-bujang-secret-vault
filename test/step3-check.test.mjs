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
