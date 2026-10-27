import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runAttackChecks } from '../src/attack-check.mjs';
import { deploymentIdentity } from '../scripts/deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');

test('step 2 build never republishes source notes or stale public notes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vault-step2-'));
  try {
    await cp(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true });
    await mkdir(join(dir, 'public'));
    await writeFile(join(dir, 'aleph.config.json'), JSON.stringify({ step: 2 }));
    const payload = JSON.stringify({ notes: [{ content: 'DO_NOT_PUBLISH' }] });
    await writeFile(join(dir, 'data.json'), payload);
    await writeFile(join(dir, 'public/data.json'), payload);
    execFileSync(process.execPath, [join(dir, 'scripts/build-public.mjs'), '--local']);
    await assert.rejects(readFile(join(dir, 'public/data.json')), { code: 'ENOENT' });
    // Deployment builds must still emit identity for later stages.
    await writeFile(join(dir, 'aleph.config.json'), JSON.stringify({ step: 12,
      judgeIssuer: 'https://aleph-judge-production.up.railway.app/defense/judge', sampleMarker: 'SAMPLE_NOTE_1' }));
    execFileSync(process.execPath, [join(dir, 'scripts/build-public.mjs')], { env: { ...process.env,
      VERCEL_GIT_PROVIDER: 'github', VERCEL_GIT_REPO_OWNER: 'student', VERCEL_GIT_REPO_SLUG: 'vault',
      VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), VERCEL_URL: 'vault.vercel.app' } });
    assert.equal(JSON.parse(await readFile(join(dir, 'public/aleph.json'), 'utf8')).step, 12);
  } finally {
    assert.ok(dir.startsWith(join(tmpdir(), 'vault-step2-')));
    await rm(dir, { recursive: true, force: true });
  }
});

test('step 2 identity records the current stage', () => {
  const identity = deploymentIdentity({
    VERCEL_GIT_PROVIDER: 'github', VERCEL_GIT_REPO_OWNER: 'student',
    VERCEL_GIT_REPO_SLUG: 'vault', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
    VERCEL_URL: 'vault.vercel.app',
  }, { step: 2, judgeIssuer: 'https://aleph-judge-production.up.railway.app/defense/judge', sampleMarker: 'SAMPLE_NOTE_1' });
  assert.equal(identity.step, 2);
});

test('step 2 anonymous check distinguishes empty data, leaks and unexpected responses', async () => {
  const original = globalThis.fetch;
  try {
    for (const [body, expected] of [
      [{ notes: [] }, /공개 자료 없음/u],
      [{ notes: [{ content: 'DO_NOT_PUBLISH' }] }, /공개 자료 있음/u],
      [{}, /확인 불가/u],
    ]) {
      globalThis.fetch = async () => Response.json(body);
      const [result] = await runAttackChecks({ step: 2, publicAppUrl: 'https://vault.vercel.app' });
      assert.match(result.observed, expected);
      assert.ok(!result.observed.includes('DO_NOT_PUBLISH'));
    }
    globalThis.fetch = async () => new Response('Not found', { status: 404 });
    const [missing] = await runAttackChecks({ step: 2, publicAppUrl: 'https://vault.vercel.app' });
    assert.match(missing.observed, /공개 자료 없음.*404/u);
  } finally {
    globalThis.fetch = original;
  }
});
