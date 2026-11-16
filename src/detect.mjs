// 9단계에서 학생이 채우는 탐지 함수입니다. 이 기본값은 어떤 접속도 회수하지 않습니다.
// 반 엔진이 검증한 사건만 전달해야 하며, 브라우저가 보낸 사용자 번호는 받지 않습니다.

// 사건마다 at·method·identity.sub 세 값만 읽습니다. 다른 값(본문·토큰·네트워크·기기·지역)은 복사하지 않습니다.
// 형식이 틀린 사건은 다른 값으로 채우지 않고 뺍니다.
export function readEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');
  const read = [];
  for (const event of events) {
    const at = typeof event?.at === 'string' ? Date.parse(event.at) : NaN;
    const method = event?.method;
    const sub = event?.identity?.sub;
    if (!Number.isFinite(at) || typeof method !== 'string' || !method
        || typeof sub !== 'string' || !sub.trim()) continue;
    read.push({ at, method, sub });
  }
  return read;
}

const WINDOW_MS = 10 * 60 * 1000;
const BURST_LIMIT = 120;

// burst_read: 같은 sub의 GET이 at 기준 10분 구간 [t, t+10분) 안에서 120건을 넘을 때만 회수 제안.
export function detect(events) {
  const times = new Map();
  for (const { at, method, sub } of readEvents(events)) {
    if (method !== 'GET') continue;
    if (!times.has(sub)) times.set(sub, []);
    times.get(sub).push(at);
  }
  // shortcut: reports only the first sub found over the limit; return all when the engine accepts several.
  for (const [sub, list] of times) {
    list.sort((a, b) => a - b);
    for (let end = 0, start = 0; end < list.length; end++) {
      while (list[end] - list[start] >= WINDOW_MS) start++;
      if (end - start + 1 > BURST_LIMIT) {
        return { action: 'propose_revocation', reasonCode: 'burst_read', subject: sub };
      }
    }
  }
  return { action: 'observe' };
}
