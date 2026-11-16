// 11단계 기기 승인: POST /api/device/challenge | /api/device/register | /api/device/assert
// 등록은 '대기'로만 저장하고, 승인은 관리자가 DB에서 바꿉니다. 버튼이나 등록만으로는 권한이 생기지 않습니다.
import { createPublicKey, randomUUID, verify } from 'node:crypto';
import config from '../../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../../src/verify-login.mjs';
import { b64url, CHALLENGE_SECONDS, DEVICE_TOKEN_SECONDS, readToken, sha256, signToken } from '../../src/device-auth.mjs';

let verifyLogin;
const CREDENTIAL = /^[A-Za-z0-9_-]{16,1024}$/u;
const fail = (response, code, error, extra = {}) => response.status(code).json({ error, ...extra });

function parseClientData(text, type, challenge, origin) {
  let data;
  try { data = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')); } catch { return null; }
  return data?.type === type && data.challenge === b64url(challenge) && data.origin === origin ? data : null;
}

// authenticatorData: rpIdHash(32) | flags(1) | signCount(4) | ...
function parseAuthData(text, rpId) {
  const data = Buffer.from(typeof text === 'string' ? text : '', 'base64url');
  if (data.length < 37 || !data.subarray(0, 32).equals(sha256(rpId)) || !(data[32] & 0x01)) return null;
  return { data, signCount: data.readUInt32BE(33) };
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const path = new URL(request.url ?? '', 'https://local.invalid').pathname;
  const action = /^\/api\/device\/(challenge|register|assert)\/?$/u.exec(path)?.[1];
  if (!action) return fail(response, 404, 'NOT_FOUND');
  if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); return fail(response, 405, 'METHOD_NOT_ALLOWED'); }
  const authorization = request.headers?.authorization;
  if (typeof authorization !== 'string' || !authorization) {
    response.setHeader('WWW-Authenticate', 'Bearer'); return fail(response, 401, 'UNAUTHORIZED');
  }
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  let base;
  let origin;
  try {
    base = new URL(SUPABASE_URL);
    origin = new URL(config.publicAppUrl).origin;
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search
        || base.hash || !SUPABASE_SECRET_KEY?.trim() || config.identityProvider?.issuer !== `${base.origin}/auth/v1`) {
      throw new Error('configuration');
    }
    verifyLogin ??= createLoginVerifier({ config, supabaseSecretKey: SUPABASE_SECRET_KEY });
  } catch { return fail(response, 503, 'DEVICE_NOT_CONFIGURED'); }
  let identity;
  try { identity = await verifyLogin(authorization); } catch { identity = null; }
  if (!identity) { response.setHeader('WWW-Authenticate', 'Bearer'); return fail(response, 401, 'UNAUTHORIZED'); }

  const rpId = new URL(origin).hostname;
  let input;
  try { input = typeof request.body === 'string' ? JSON.parse(request.body) : (request.body ?? {}); }
  catch { return fail(response, 400, 'INVALID_REQUEST'); }
  const rest = (params, init = {}) => {
    const url = new URL('/rest/v1/training_devices', base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return fetch(url, { ...init, headers: { apikey: SUPABASE_SECRET_KEY, Accept: 'application/json', ...init.headers },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
  };
  const rows = async res => {
    if (!res.ok) throw new Error('upstream_failed');
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('invalid_rows');
    return data;
  };

  try {
    if (action === 'challenge') {
      if (!['register', 'assert'].includes(input?.kind)) return fail(response, 400, 'INVALID_REQUEST');
      // shortcut: a stateless challenge can be replayed within its 120 s window; store used nonces if that matters.
      const challenge = signToken({ purpose: 'challenge', kind: input.kind, sub: identity.userId, nonce: randomUUID(),
        exp: Math.floor(Date.now() / 1000) + CHALLENGE_SECONDS }, SUPABASE_SECRET_KEY);
      const mine = input.kind === 'assert'
        ? (await rows(await rest({ select: 'credential_id', owner_id: `eq.${identity.userId}` }))).map(row => row.credential_id)
        : [];
      return response.status(200).json({ challenge, rpId, userId: identity.userId, credentialIds: mine });
    }

    const challenge = typeof input?.challenge === 'string' ? input.challenge : '';
    const claim = readToken(challenge, SUPABASE_SECRET_KEY, 'challenge');
    if (!claim || claim.sub !== identity.userId || claim.kind !== action) return fail(response, 400, 'CHALLENGE_INVALID');
    if (!CREDENTIAL.test(input.credentialId ?? '')) return fail(response, 400, 'INVALID_REQUEST');
    const expectedType = action === 'register' ? 'webauthn.create' : 'webauthn.get';
    if (!parseClientData(input.clientDataJSON, expectedType, challenge, origin)) return fail(response, 400, 'CLIENT_DATA_INVALID');
    const auth = parseAuthData(input.authenticatorData, rpId);
    if (!auth) return fail(response, 400, 'AUTHENTICATOR_DATA_INVALID');

    if (action === 'register') {
      let key;
      try { key = createPublicKey({ key: Buffer.from(input.publicKey ?? '', 'base64url'), format: 'der', type: 'spki' }); }
      catch { return fail(response, 400, 'PUBLIC_KEY_INVALID'); }
      if (input.alg !== -7 || key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
        return fail(response, 400, 'PUBLIC_KEY_INVALID');
      }
      const [existing] = await rows(await rest({ select: 'owner_id,status', credential_id: `eq.${input.credentialId}` }));
      if (existing && existing.owner_id !== identity.userId) return fail(response, 409, 'CREDENTIAL_OWNED_BY_OTHER');
      if (existing) return response.status(200).json({ status: existing.status });
      await rows(await rest({ select: 'status' }, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ owner_id: identity.userId, credential_id: input.credentialId,
          public_key_spki: b64url(key.export({ format: 'der', type: 'spki' })), sign_count: auth.signCount }) }));
      return response.status(201).json({ status: 'pending' });
    }

    const [device] = await rows(await rest({ select: 'id,public_key_spki,status,sign_count',
      credential_id: `eq.${input.credentialId}`, owner_id: `eq.${identity.userId}` }));
    if (!device) return fail(response, 404, 'DEVICE_NOT_FOUND');
    const clientData = Buffer.from(input.clientDataJSON, 'base64url');
    const signed = verify('sha256', Buffer.concat([auth.data, sha256(clientData)]),
      { key: Buffer.from(device.public_key_spki, 'base64url'), format: 'der', type: 'spki', dsaEncoding: 'der' },
      Buffer.from(typeof input.signature === 'string' ? input.signature : '', 'base64url'));
    if (!signed) return fail(response, 403, 'SIGNATURE_INVALID');
    if (device.status !== 'approved') return fail(response, 403, 'DEVICE_NOT_APPROVED', { status: device.status });
    // Synced passkeys report 0; a non-zero counter must grow, or the key may be cloned.
    if (device.sign_count > 0 && auth.signCount <= device.sign_count) return fail(response, 403, 'SIGN_COUNT_INVALID');
    if (auth.signCount > device.sign_count) {
      await rows(await rest({ id: `eq.${device.id}`, select: 'id' }, { method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ sign_count: auth.signCount }) }));
    }
    const deviceToken = signToken({ purpose: 'device', sub: identity.userId, deviceId: device.id,
      exp: Math.floor(Date.now() / 1000) + DEVICE_TOKEN_SECONDS }, SUPABASE_SECRET_KEY);
    return response.status(200).json({ status: 'approved', deviceToken, expiresInSeconds: DEVICE_TOKEN_SECONDS });
  } catch {
    return fail(response, 502, 'DEVICE_UNAVAILABLE');
  }
}
