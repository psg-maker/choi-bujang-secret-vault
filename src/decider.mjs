// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 6단계: 엔진이 확인한 기기 등록 상태가 true일 때만 허용합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze(['device_registered', 'step_up_required', 'resource_zone']);

// judge_fixture is virtual evidence from the engine, not a browser location claim.
export function inspectConnection(request) {
  const signals = request.signals;
  const source = signals?.source === 'judge_fixture' ? 'judge_fixture'
    : signals?.source === 'none' ? 'none' : 'unknown';
  const fixture = source === 'judge_fixture';
  const text = value => typeof value === 'string' && value.trim() ? value : null;
  const events = request.recentEvents;
  const validEvents = fixture && Array.isArray(events) && events.length <= 12
    && events.every(event => event && text(event.kind)
      && Number.isSafeInteger(event.ageSeconds) && event.ageSeconds >= 0
      && Number.isSafeInteger(event.count) && event.count >= 0);
  return {
    source,
    region: fixture ? text(signals.region) : null,
    network: fixture ? text(signals.network) : null,
    hour: fixture && Number.isInteger(signals.hour) && signals.hour >= 0 && signals.hour <= 23
      ? signals.hour : null,
    recentEvents: validEvents ? events : null,
  };
}

// 8단계 구역: 서비스마다 허용하는 정확한 route 모양입니다. 여기 없는 서비스·경로는 거부합니다.
// 메모는 ID 하나를 고르는 경로만(전체 목록·ID 없는 생성은 거부), 공지는 읽기만, 강사 자료는 전부 거부.
// 메모 주인 비교와 ID 형식 검사는 판정기가 아니라 /api/notes 서버가 합니다.
export const ZONES = Object.freeze({
  notes: Object.freeze(['GET /notes/:id', 'PUT /notes/:id', 'DELETE /notes/:id']),
  notices: Object.freeze(['GET /notices']),
  materials: Object.freeze([]),
});

export function inZone(request) {
  const routes = Object.hasOwn(ZONES, request.service) ? ZONES[request.service] : [];
  if (typeof request.route !== 'string' || !routes.includes(request.route)) return false;
  const [method, shape] = request.route.split(' ');
  // :id matches exactly one non-empty segment, so /notes/a/export never fits GET /notes/:id.
  const pattern = new RegExp(`^${shape.replaceAll(':id', '[^/]+')}$`, 'u');
  return request.method === method && typeof request.path === 'string' && pattern.test(request.path)
    && request.queryLength === 0;
}

export async function decide(request) {
  const registered = request.deviceRegistered === true;
  if (registered && !inZone(request)) {
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'deny',
      reasonCode: 'route_not_allowed',
      ruleIds: ['resource_zone'],
    };
  }
  const connection = inspectConnection(request);
  // shortcut: fixture thresholds only; revise when the engine supplies a verified baseline.
  const unusualRead = request.service === 'notes' && request.method === 'GET'
    && connection.hour !== null && connection.hour < 6 && connection.network === 'unusual'
    && connection.recentEvents?.some(event => event.kind === 'risk_signal'
      && event.ageSeconds <= 60 && event.count >= 20);
  const confirmed = request.stepUp?.verified === true
    && Number.isFinite(request.stepUp.authAgeSeconds)
    && request.stepUp.authAgeSeconds >= 0 && request.stepUp.authAgeSeconds <= 900;
  if (registered && unusualRead && !confirmed) {
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'step_up',
      reasonCode: 'step_up_required',
      ruleIds: ['device_registered', 'step_up_required'],
    };
  }
  return {
    schema: 'aleph.decision.v1',
    requestId: request.requestId,
    decision: registered ? 'allow' : 'deny',
    reasonCode: registered ? 'approved' : 'device_not_registered',
    ruleIds: ['device_registered'],
  };
}
