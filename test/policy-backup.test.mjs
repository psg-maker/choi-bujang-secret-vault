import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { diffAgainst, drill, POLICY_FILES, restore, snapshot, verify } from '../scripts/policy-backup.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

test('policy backup verifies hashes, stops on missing or tampered copies, diffs and restores only policy files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'policy-root-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  try {
    for (const file of POLICY_FILES) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      cpSync(join(import.meta.dirname, '..', file), join(root, file));
    }
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-qm', 'policy');
    assert.throws(() => verify(root), /사본이 없습니다/u);
    snapshot(root);
    assert.throws(() => snapshot(root), /덮어쓰지 않습니다/u);
    assert.equal(verify(root).manifest.commit.length, 40);
    assert.deepEqual(diffAgainst(root, root).changes, []);

    const test = drill(root);
    const { changes } = diffAgainst(test, root);
    assert.deepEqual(changes.map(change => change.file), ['src/decider.mjs']);
    assert.match(changes[0].diff, /^\+.*'GET \/notes', 'GET \/notes\/:id'/mu);
    assert.equal(changes[0].diff.split('\n').filter(line => /^[-+]/u.test(line)).length, 2);

    // A reads her own note by ID; B asks for the whole note list to get A's notes.
    const { normal } = fixtureRequests();
    const aOwn = { ...normal };
    const bTakesA = { ...normal, path: '/notes', route: 'GET /notes' };
    const decisions = async dir => {
      const { decide } = await import(`${pathToFileURL(join(dir, 'src/decider.mjs')).href}?${Math.random()}`);
      return [(await decide(aOwn)).decision, (await decide(bTakesA)).decision];
    };
    assert.deepEqual(await decisions(test), ['allow', 'allow']);

    // Other service code and the earlier audit history stay as they were.
    writeFileSync(join(test, 'other-service.mjs'), 'export const keep = 1;\n');
    writeFileSync(join(test, 'policy-audit.jsonl'), '{"earlier":true}\n');
    const tampered = readFileSync(join(test, 'src/decider.mjs'), 'utf8');
    const preview = restore(test, {}, root);
    assert.deepEqual(preview.changes.map(change => change.file), ['src/decider.mjs']);
    assert.equal(readFileSync(join(test, 'src/decider.mjs'), 'utf8'), tampered, 'preview must not write');
    assert.throws(() => restore(root, { yes: true }, root), /운영 저장소/u);

    const done = restore(test, { yes: true }, root);
    assert.deepEqual(diffAgainst(test, root).changes, []);
    assert.deepEqual(await decisions(test), ['allow', 'deny']);
    assert.equal(readFileSync(join(test, 'other-service.mjs'), 'utf8'), 'export const keep = 1;\n');
    const audit = readFileSync(done.auditFile, 'utf8').trim().split('\n');
    assert.equal(audit[0], '{"earlier":true}');
    assert.equal(JSON.parse(audit[1]).files[0].file, 'src/decider.mjs');
    assert.equal(readFileSync(join(done.evidenceDir, 'src/decider.mjs'), 'utf8'), tampered);
    assert.equal(restore(test, { yes: true }, root).changes.length, 0);
    rmSync(test, { recursive: true });

    // CRLF checkout of the same content still verifies.
    const copy = join(root, 'backup/policy/aleph.config.json');
    writeFileSync(copy, readFileSync(copy, 'utf8').replaceAll('\n', '\r\n'));
    verify(root);
    writeFileSync(copy, readFileSync(copy, 'utf8').replace('"step"', '"stage"'));
    assert.throws(() => verify(root), /해시가 맞지 않습니다: aleph\.config\.json/u);
    rmSync(copy);
    assert.throws(() => verify(root), /사본 파일이 없습니다/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
