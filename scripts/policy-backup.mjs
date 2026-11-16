// 10단계: 접근 규칙(판정기·허용 경로·DB 접근 SQL)을 안전 정책으로 사본·해시를 남기고,
// 검증한 사본과 다른 정책 폴더의 차이만 보여 줍니다. 운영 파일은 읽기만 하고 고치지 않습니다.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const POLICY_FILES = Object.freeze([
  'src/decider.mjs',
  'aleph.config.json',
  'supabase/step3-user-notes.sql',
  'supabase/step5-revoke-note-access.sql',
  'supabase/step8-instructor-notices.sql',
]);
const ROOT = resolve(import.meta.dirname, '..');
const BACKUP = 'backup/policy';
const sha256 = text => createHash('sha256').update(text).digest('hex');
// Windows Git can check files out as CRLF; hash the LF form so a fresh clone still verifies.
const fileHash = path => sha256(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'));
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();

// 사본을 만들 때 운영 파일이 마지막 커밋과 같아야 합니다(커밋되지 않은 변경은 안전 정책이 아님).
export function snapshot(root = ROOT) {
  const dir = join(root, BACKUP);
  if (existsSync(dir)) throw new Error(`이미 안전 정책 사본이 있습니다: ${BACKUP} (덮어쓰지 않습니다)`);
  if (git(root, 'status', '--porcelain', '--', ...POLICY_FILES)) {
    throw new Error('정책 파일에 커밋되지 않은 변경이 있습니다. 커밋한 뒤 사본을 만드세요.');
  }
  const files = {};
  for (const file of POLICY_FILES) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), readFileSync(join(root, file)));
    files[file] = fileHash(join(dir, file));
  }
  const manifest = { schema: 'policy-backup.v1', commit: git(root, 'rev-parse', 'HEAD'),
    createdAt: new Date().toISOString(), files };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(dir, 'manifest.json'), text);
  return { manifest, manifestSha256: sha256(text) };
}

// 사본이 없거나, 파일이 빠졌거나, 해시가 하나라도 다르면 중단합니다.
export function verify(root = ROOT) {
  const dir = join(root, BACKUP);
  if (!existsSync(join(dir, 'manifest.json'))) throw new Error(`안전 정책 사본이 없습니다: ${BACKUP}/manifest.json`);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const listed = Object.keys(manifest.files ?? {}).sort();
  if (manifest.schema !== 'policy-backup.v1' || listed.join() !== [...POLICY_FILES].sort().join()) {
    throw new Error('사본 목록이 안전 정책 파일 목록과 다릅니다.');
  }
  for (const file of listed) {
    const path = join(dir, file);
    if (!existsSync(path)) throw new Error(`사본 파일이 없습니다: ${file}`);
    if (fileHash(path) !== manifest.files[file]) throw new Error(`해시가 맞지 않습니다: ${file}`);
  }
  return { dir, manifest };
}

// 검증한 사본과 대상 폴더의 정책 파일 차이만 돌려줍니다. 아무것도 복원하지 않습니다.
export function diffAgainst(target, root = ROOT) {
  const { dir, manifest } = verify(root);
  const changes = [];
  for (const file of POLICY_FILES) {
    const other = join(target, file);
    if (!existsSync(other)) { changes.push({ file, status: 'missing', diff: '' }); continue; }
    if (fileHash(other) === manifest.files[file]) continue;
    let diff = '';
    try {
      execFileSync('git', ['-c', 'core.autocrlf=false', 'diff', '--no-index', '--no-color', '--ignore-cr-at-eol', '-U0',
        join(dir, file), other], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (error) {
      if (error.status !== 1) throw error;
      diff = error.stdout.split('\n').filter(line => /^[-+@]/u.test(line) && !/^(---|\+\+\+) /u.test(line)).join('\n');
    }
    changes.push({ file, status: 'changed', diff });
  }
  return { manifest, changes };
}

// 침공 흉내: 검증한 사본을 임시 폴더에 복사하고 그 시험 사본에서만 규칙 한 줄을 바꿉니다.
export function drill(root = ROOT) {
  const { dir } = verify(root);
  const test = mkdtempSync(join(tmpdir(), 'policy-drill-'));
  cpSync(dir, test, { recursive: true });
  const decider = join(test, 'src/decider.mjs');
  const before = readFileSync(decider, 'utf8');
  // 메모 전체 목록을 열면 판정기는 B가 A의 메모까지 받는 길을 허용하게 됩니다.
  const after = before.replace("notes: Object.freeze(['GET /notes/:id',", "notes: Object.freeze(['GET /notes', 'GET /notes/:id',");
  if (after === before) throw new Error('시험 사본에서 바꿀 규칙 줄을 찾지 못했습니다.');
  writeFileSync(decider, after);
  return test;
}

// 되돌리기: 검증한 사본과 다른 정책 파일만 사본 내용으로 바꿉니다. yes가 없으면 계획만 돌려줍니다.
// 정책 목록 밖의 파일(다른 서비스 코드)과 기존 감사 기록은 건드리지 않고, 바꾸기 전 내용은 증거로 남깁니다.
// shortcut: 시험 정책 폴더만 되돌립니다. 운영 저장소 복구는 Git 커밋으로 따로 진행합니다.
export function restore(target, { yes = false } = {}, root = ROOT) {
  if (resolve(target) === resolve(root)) throw new Error('운영 저장소는 이 절차로 되돌리지 않습니다. 시험 정책 폴더를 지정하세요.');
  const plan = diffAgainst(target, root);
  if (!yes || !plan.changes.length) return plan;
  const { dir, manifest } = verify(root);
  const at = new Date().toISOString();
  const evidenceDir = join(target, 'policy-audit', at.replaceAll(':', '-'));
  const record = { at, action: 'restore', backupCommit: manifest.commit, files: [] };
  for (const { file, status } of plan.changes) {
    const current = join(target, file);
    const before = status === 'missing' ? null : fileHash(current);
    if (before) {
      mkdirSync(dirname(join(evidenceDir, file)), { recursive: true });
      cpSync(current, join(evidenceDir, file));
    }
    mkdirSync(dirname(current), { recursive: true });
    cpSync(join(dir, file), current);
    record.files.push({ file, before, after: manifest.files[file] });
  }
  if (diffAgainst(target, root).changes.length) throw new Error('되돌린 뒤에도 안전 정책과 다릅니다. 감사 기록을 확인하세요.');
  const auditFile = join(target, 'policy-audit.jsonl');
  appendFileSync(auditFile, `${JSON.stringify(record)}\n`);
  return { ...plan, auditFile, evidenceDir };
}

function report({ manifest, changes }, target) {
  const short = manifest.commit.slice(0, 7);
  console.log(`복원할 버전: 안전 정책 사본 · 커밋 ${short} · 만든 시각 ${manifest.createdAt}`);
  console.log(`비교 대상: ${target}`);
  if (!changes.length) return console.log('변경 범위: 없음 (모든 정책 파일 해시 일치)');
  console.log(`변경 범위: ${changes.length}개 파일`);
  for (const change of changes) {
    console.log(`\n== ${change.file} (${change.status === 'missing' ? '파일 없음' : '내용 다름'})`);
    if (change.diff) console.log(change.diff);
  }
  console.log('\n이 명령은 차이만 보여 주며 아무것도 복원하지 않았습니다.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, target] = process.argv.slice(2);
  try {
    if (command === 'snapshot') {
      const { manifest, manifestSha256 } = snapshot();
      console.log(`안전 정책 사본 생성: ${BACKUP} · 커밋 ${manifest.commit.slice(0, 7)} · 파일 ${POLICY_FILES.length}개`);
      for (const [file, hash] of Object.entries(manifest.files)) console.log(`${hash}  ${file}`);
      console.log(`manifest.json SHA-256: ${manifestSha256}`);
    } else if (command === 'verify') {
      const { manifest } = verify();
      console.log(`사본 검증 통과 · 커밋 ${manifest.commit.slice(0, 7)} · 파일 ${POLICY_FILES.length}개 해시 일치`);
    } else if (command === 'drill') {
      const test = drill();
      console.log('침공 흉내: 시험 사본의 메모 구역에 전체 목록 GET /notes를 열었습니다. 운영 파일은 그대로입니다.\n');
      report(diffAgainst(test), test);
      console.log(`되돌리기 미리보기: npm.cmd run policy:restore -- "${test}"`);
    } else if (command === 'restore') {
      const yes = process.argv.includes('--yes');
      if (!target || target === '--yes') throw new Error('되돌릴 시험 정책 폴더를 적어 주세요.');
      const dir = resolve(target);
      const result = restore(dir, { yes });
      report(result, dir);
      if (!result.changes.length) console.log('되돌릴 항목이 없습니다.');
      else if (!yes) console.log(`\n위 항목을 안전 정책으로 되돌리려면: npm.cmd run policy:restore -- "${dir}" --yes`);
      else console.log(`\n되돌리기 완료: ${result.changes.length}개 파일 · 감사 기록 ${result.auditFile} · 이전 내용 ${result.evidenceDir}`);
    } else if (command === 'diff') {
      const dir = resolve(target ?? ROOT);
      report(diffAgainst(dir), dir);
    } else {
      throw new Error('사용법: node scripts/policy-backup.mjs snapshot | verify | drill | diff [정책 폴더] | restore <시험 정책 폴더> [--yes]');
    }
  } catch (error) {
    console.error(`중단: ${error.message}`);
    process.exitCode = 1;
  }
}
