// 11단계: 서버가 서명한 짧은 토큰(도전값·기기 토큰)과 승인 기기 확인.
// 기기 개인키는 패스키 관리자(Google 비밀번호 관리자 등)에만 있고 서버·브라우저 저장소에는 없습니다.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
export const DEVICE_TOKEN_SECONDS = 900;
export const CHALLENGE_SECONDS = 120;

export const b64url = buffer => Buffer.from(buffer).toString('base64url');
export const sha256 = data => createHash('sha256').update(data).digest();
// Derived from the existing server key so no new secret has to be configured.
const keyFor = secretKey => createHmac('sha256', secretKey).update('aleph-device-v1').digest();

export function signToken(payload, secretKey) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${b64url(createHmac('sha256', keyFor(secretKey)).update(body).digest())}`;
}

export function readToken(token, secretKey, purpose, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const expected = createHmac('sha256', keyFor(secretKey)).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (payload?.purpose !== purpose || !Number.isSafeInteger(payload.exp) || payload.exp * 1000 <= now) return null;
  return payload;
}

// Student logins need a fresh device token for an approved device of the same user.
// Judge identities are excluded: the operator relay checks their devices before requests reach us.
export async function approvedDevice({ identity, headers, base, secretKey }) {
  if (identity.kind === 'judge') return true;
  const token = readToken(headers?.['x-device-token'], secretKey, 'device');
  if (!token || token.sub !== identity.userId || !UUID.test(token.deviceId ?? '')) return false;
  const url = new URL('/rest/v1/training_devices', base);
  url.searchParams.set('select', 'id');
  url.searchParams.set('id', `eq.${token.deviceId}`);
  url.searchParams.set('owner_id', `eq.${identity.userId}`);
  url.searchParams.set('status', 'eq.approved');
  const response = await fetch(url, { headers: { apikey: secretKey, Accept: 'application/json' },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('device_lookup_failed');
  const rows = await response.json();
  return Array.isArray(rows) && rows.length === 1 && rows[0].id === token.deviceId;
}
