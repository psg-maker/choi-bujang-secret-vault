// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (![1, 2, 3].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (config.step === 1 && (typeof config.sampleMarker !== 'string' || !config.sampleMarker)) throw new Error('가상 메모의 확인 표시를 넣어 주세요.');
  if (config.step === 3) {
    const results = [];
    const probe = async (attackId, expected, path, inspect, method = 'GET') => {
      let observed;
      try {
        const response = await fetch(new URL(path, app), {
          method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
          ...(['POST', 'PUT'].includes(method)
            ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}),
        });
        observed = await inspect(response);
      } catch { observed = '미확인 (접속 또는 응답 확인 실패)'; }
      results.push({ attackId, expected, observed });
    };
    const denial = async response => {
      let jsonError = false;
      if (/^application\/json(?:;|$)/iu.test(response.headers.get('content-type') ?? '')) {
        try {
          const body = await response.json();
          jsonError = body && !Array.isArray(body) && typeof body.error === 'string' && Boolean(body.error.trim())
            && !('notes' in body) && !('title' in body) && !('body' in body) && !('content' in body);
        } catch { /* Never store response bodies. */ }
      }
      return `HTTP ${response.status} · ${jsonError ? 'JSON 오류 확인' : 'JSON 오류 확인 안 됨'} · ${[401, 403].includes(response.status) && jsonError ? '거부 조건 충족' : '거부 조건 미충족'}`;
    };
    await probe('anonymous_note_list', '비로그인 목록 GET은 401/403과 자료 없는 JSON 오류', '/api/notes', denial);
    const item = '/api/notes/22222222-2222-4222-8222-222222222222';
    for (const [method, path, id] of [['POST', '/api/notes', 'anonymous_note_create'],
      ['GET', item, 'anonymous_note_item'], ['PUT', item, 'anonymous_note_update'], ['DELETE', item, 'anonymous_note_delete']]) {
      await probe(id, `비로그인 ${method}은 401/403과 자료 없는 JSON 오류`, path, denial, method);
    }
    await probe('deployment_identity', 'aleph.json HTTP 200 · 단계 3 · 커밋 식별', '/aleph.json', async response => {
      const identity = await response.json();
      const commit = typeof identity?.commit === 'string' && /^[0-9a-f]{40}$/u.test(identity.commit) ? identity.commit : '미확인';
      const step = Number.isInteger(identity?.step) ? identity.step : '미확인';
      return `HTTP ${response.status} · 단계 ${step} · 커밋 ${commit}`;
    });
    await probe('security_header', '첫 화면 HTTP 200과 nosniff 또는 CSP 헤더', '/', async response => {
      const nosniff = response.headers.get('x-content-type-options')?.toLowerCase() === 'nosniff';
      const csp = Boolean(response.headers.get('content-security-policy')?.trim());
      return `HTTP ${response.status} · ${nosniff ? 'nosniff 확인' : csp ? 'CSP 확인' : '보안 헤더 미확인'}`;
    });
    await probe('static_notes_absent', '과거 공개 data.json HTTP 404', '/data.json', async response => `HTTP ${response.status}`);
    results.push({ attackId: 'authenticated_note_crud', expected: 'A 계정의 생성·조회·수정·삭제와 삭제 후 404',
      observed: '미실행 (실제 A 계정 배포 CRUD는 별도 확인 필요, 로컬 시험으로 대체하지 않음)' });
    return results;
  }
  const response = await fetch(new URL('/data.json', app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  let visible = false;
  let empty = false;
  let valid = false;
  if (response.ok) {
    try {
      const data = await response.json();
      valid = Array.isArray(data?.notes);
      empty = valid && data.notes.length === 0;
      visible = data?.sampleMarker === config.sampleMarker && Array.isArray(data.notes)
        && data.notes.length > 0;
    } catch {
      // A non-JSON response is a failed check, not a successful deployment.
    }
  }
  if (config.step === 2) {
    return [{ attackId: 'anonymous_note_read', expected: '공개 data.json이 없거나 자료 목록이 비어 있음',
      observed: response.status === 404 ? '공개 자료 없음 (HTTP 404)' : empty ? '공개 자료 없음 (빈 목록 확인)'
        : valid ? '공개 자료 있음 (노출 확인)' : `확인 불가 (HTTP ${response.status})` }];
  }
  return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
    observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임' : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
}
