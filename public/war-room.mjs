// 12단계: 탈환 작전실. GET /api/war-room 응답만 글자로 보여 줍니다(메모 제목·본문·전체 ID는 받지 않습니다).
// 서버가 확인한 기록(server_record)·코드 정의(defined)·미실행(not_run)을 서로 다른 제목으로 구분합니다.
const DEVICE = { pending: '대기', approved: '승인', revoked: '취소됨' };
const LIVE = { match: '현재 메모와 해시 일치', differs: '현재 메모와 해시 다름', missing: '현재 메모 없음' };

// 화면에 쓰는 수치(합계)가 같은 응답의 가린 기록 목록과 맞는지 확인합니다.
export function checkConsistency(data) {
  const { revocation: r, restore } = data;
  const sum = Object.values(r.counts).reduce((a, b) => a + b, 0);
  return r.total === r.items.length && r.total === sum && restore.total === restore.items.length
    && ['pending', 'approved', 'revoked'].every(s => r.counts[s] === r.items.filter(i => i.status === s).length);
}

export function summarize(data) {
  const ok = checkConsistency(data);
  const zones = Object.entries(data.rules.zones).map(([k, v]) => `${k}: ${v.join(', ') || '모두 거부'}`);
  return [
    { title: '판정기 규칙 (서버 코드 정의)', lines: [`규칙 이름: ${data.rules.ruleIds.join(', ')}`, ...zones.map(z => `구역 ${z}`)] },
    { title: '탐지 사건 (미실행)', lines: [
      `${data.detection.rule} 규칙: 같은 사용자 ${data.detection.windowMinutes}분 안 GET ${data.detection.limit}건 초과일 때만 회수 제안`,
      '실제 사건 수: 확인하지 않음', data.detection.note] },
    { title: `회수 상태 (서버 기록 ${data.revocation.total}건 확인)`, lines: [
      `대기 ${data.revocation.counts.pending} · 승인 ${data.revocation.counts.approved} · 취소됨 ${data.revocation.counts.revoked}`,
      ...data.revocation.items.map(i => `기기 ${i.ref} · ${DEVICE[i.status]}`)] },
    { title: `복구 버전 (서버 기록 ${data.restore.total}건 확인)`, lines: data.restore.total
      ? data.restore.items.map(i => `사본 ${i.ref} · 해시 ${i.hashPrefix}… · ${LIVE[i.live]}`) : ['복구 사본 기록 없음'] },
    { title: '대조', lines: [ok ? `화면의 수치와 서버 기록 목록이 일치합니다 (기기 ${data.revocation.total}건, 사본 ${data.restore.total}건).`
      : '화면의 수치와 서버 기록 목록이 맞지 않습니다. 이 요약을 믿지 마세요.'] },
  ];
}

export function createWarRoom(document, fetchImpl = fetch) {
  const panel = document.getElementById('war-room');
  const body = document.getElementById('war-room-body');
  const status = document.getElementById('war-room-status');
  const errorBox = document.getElementById('war-room-error');
  const refresh = document.getElementById('war-room-refresh');
  let session = null;
  let version = 0;

  async function load() {
    const active = session;
    if (!active) return;
    const mine = ++version;
    errorBox.textContent = '';
    status.textContent = '서버에서 요약을 불러오는 중입니다.';
    try {
      const response = await fetchImpl('/api/war-room', { cache: 'no-store', headers: { Authorization: `Bearer ${active.access_token}` } });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error('summary_failed');
      if (mine !== version || session !== active) return;
      const sections = summarize(data).map(({ title, lines }) => {
        const section = document.createElement('li');
        const heading = document.createElement('strong');
        heading.textContent = title;
        const text = document.createElement('span');
        text.textContent = lines.join('\n');
        section.append(heading, text);
        return section;
      });
      body.replaceChildren(...sections);
      status.textContent = '요약을 불러왔습니다. 메모 본문은 표시하지 않습니다.';
    } catch {
      if (mine !== version || session !== active) return;
      body.replaceChildren();
      status.textContent = '';
      errorBox.textContent = '작전실 요약을 불러오지 못했습니다. 확인된 결과가 없습니다.';
    }
  }
  refresh.addEventListener('click', load);

  return function updateSession(next) {
    session = next?.access_token ? next : null;
    version += 1;
    panel.hidden = !session;
    body.replaceChildren();
    errorBox.textContent = '';
    status.textContent = '';
    if (session) load();
  };
}
