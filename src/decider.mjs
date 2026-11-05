// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 6단계: 엔진이 확인한 기기 등록 상태가 true일 때만 허용합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze(['device_registered', 'step_up_required']);

// 엔진 계약 입력 전용입니다. judge_fixture는 실제 위치 증거가 아닙니다.
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

export async function decide(request) {
  const registered = request.deviceRegistered === true;
  const connection = inspectConnection(request);
  // 가상 사건 기준: 새벽·낯선 네트워크·최근 60초 내 20건이 함께 있을 때만 재확인합니다.
  const unusualRead = request.service === 'notes' && request.method === 'GET'
    && connection.hour !== null && connection.hour < 6 && connection.network === 'unusual'
    && connection.recentEvents?.some(event => event.kind === 'risk_signal'
      && event.ageSeconds <= 60 && event.count >= 20);
  if (registered && unusualRead) {
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
