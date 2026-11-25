// 12단계: 탈환 작전실 요약. 읽기 전용 GET /api/war-room
// 로그인한 사용자 본인의 기기·백업 기록만 세어 돌려줍니다. 메모 제목·본문, 전체 ID, 계정 ID는 보내지 않습니다.
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { RULE_IDS, ZONES } from '../src/decider.mjs';
import { contentHash } from './restore/[id].js';

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const STATUSES = ['pending', 'approved', 'revoked'];
// shortcut: 한 사용자당 50건까지만 읽음, 기록이 그보다 많아지면 count=exact로 바꿀 것.
const LIMIT = '50';
let verifyLogin;

// 화면에는 앞 8자리만 보여 주어 서버 기록과 대조할 수 있되 전체 ID는 노출하지 않습니다.
const mask = id => `${id.slice(0, 8)}…`;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const path = new URL(request.url ?? '/api/war-room', 'https://local.invalid').pathname;
  if (path !== '/api/war-room' && path !== '/api/war-room/') return response.status(404).json({ error: 'NOT_FOUND' });
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  const authorization = request.headers?.authorization;
  if (typeof authorization !== 'string' || !authorization) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return response.status(401).json({ error: 'UNAUTHORIZED' });
  }
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  let base;
  try {
    base = new URL(SUPABASE_URL);
    if (base.protocol !== 'https:' || base.username || base.password
        || base.pathname !== '/' || base.search || base.hash || !SUPABASE_SECRET_KEY?.trim()
        || config.identityProvider?.issuer !== `${base.origin}/auth/v1`) throw new Error('configuration');
    verifyLogin ??= createLoginVerifier({ config, supabaseSecretKey: SUPABASE_SECRET_KEY });
  } catch {
    return response.status(503).json({ error: 'WAR_ROOM_NOT_CONFIGURED' });
  }
  let identity;
  try { identity = await verifyLogin(authorization); } catch { identity = null; }
  if (!identity || !UUID.test(identity.userId)) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return response.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const rows = async (table, params) => {
    const url = new URL(`/rest/v1/${table}`, base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const res = await fetch(url, { headers: { apikey: SUPABASE_SECRET_KEY, Accept: 'application/json' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
    const data = res.ok ? await res.json() : null;
    if (!Array.isArray(data)) throw new Error('upstream_failed');
    return data;
  };
  try {
    const owner = `eq.${identity.userId}`;
    const devices = await rows('training_devices', { select: 'id,status', owner_id: owner, order: 'created_at.asc', limit: LIMIT });
    const backups = await rows('training_note_backups',
      { select: 'id,content_sha256', owner_id: owner, order: 'created_at.asc', limit: LIMIT });
    if (devices.some(d => !UUID.test(d?.id) || !STATUSES.includes(d.status))
        || backups.some(b => !UUID.test(b?.id) || !/^[0-9a-f]{64}$/u.test(b.content_sha256))) throw new Error('invalid_rows');
    // 현재 메모와 사본의 해시만 비교합니다. 제목·본문은 이 함수 안에서만 쓰고 응답에 넣지 않습니다.
    const live = backups.length
      ? await rows('training_user_notes', { select: 'id,title,body', owner_id: owner, id: `in.(${backups.map(b => b.id).join(',')})` })
      : [];
    const liveById = new Map(live.map(note => [note.id, note]));
    const restoreItems = backups.map(({ id, content_sha256: sha }) => {
      const note = liveById.get(id);
      const state = !note ? 'missing'
        : typeof note.title === 'string' && typeof note.body === 'string' && contentHash(note.title, note.body) === sha
          ? 'match' : 'differs';
      return { ref: mask(id), hashPrefix: sha.slice(0, 8), live: state };
    });
    const count = status => devices.filter(d => d.status === status).length;
    return response.status(200).json({
      checkedAt: new Date().toISOString(),
      rules: { kind: 'defined', ruleIds: [...RULE_IDS], zones: Object.fromEntries(Object.entries(ZONES).map(([k, v]) => [k, [...v]])) },
      detection: { kind: 'not_run', rule: 'burst_read', windowMinutes: 10, limit: 120,
        note: '운영 엔진의 사건 전달이 연결되지 않아 실제 사건 수는 확인하지 않았습니다.' },
      revocation: { kind: 'server_record', total: devices.length,
        counts: { pending: count('pending'), approved: count('approved'), revoked: count('revoked') },
        items: devices.map(d => ({ ref: mask(d.id), status: d.status })) },
      restore: { kind: 'server_record', total: restoreItems.length, items: restoreItems },
    });
  } catch {
    return response.status(502).json({ error: 'WAR_ROOM_UNAVAILABLE' });
  }
}
