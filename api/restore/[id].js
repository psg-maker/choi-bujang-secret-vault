// 10단계: 비공개 백업 사본에서 메모 한 건만 되살립니다. POST /api/restore/:id
// ID·소유자·내용 해시가 사본과 맞을 때만 그 한 건을 쓰고, 다른 메모는 읽지도 지우지도 않습니다.
import { createHash } from 'node:crypto';
import config from '../../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../../src/verify-login.mjs';

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
let verifyLogin;
export const contentHash = (title, body) => createHash('sha256').update(`${title}\n${body}`, 'utf8').digest('hex');

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  let id;
  try {
    const path = new URL(request.url ?? '', 'https://local.invalid').pathname;
    const match = /^\/api\/restore\/([^/]+)\/?$/u.exec(path);
    if (!match) return response.status(404).json({ error: 'NOT_FOUND' });
    id = decodeURIComponent(match[1]);
  } catch { return response.status(400).json({ error: 'INVALID_ID' }); }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  const authorization = request.headers?.authorization;
  if (typeof authorization !== 'string' || !authorization) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return response.status(401).json({ error: 'UNAUTHORIZED' });
  }
  if (!UUID.test(id)) return response.status(400).json({ error: 'INVALID_ID' });
  id = id.toLowerCase();

  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  let base;
  try {
    base = new URL(SUPABASE_URL);
    if (base.protocol !== 'https:' || base.username || base.password
        || base.pathname !== '/' || base.search || base.hash || !SUPABASE_SECRET_KEY?.trim()
        || config.identityProvider?.issuer !== `${base.origin}/auth/v1`) throw new Error('configuration');
    verifyLogin ??= createLoginVerifier({ config, supabaseSecretKey: SUPABASE_SECRET_KEY });
  } catch {
    return response.status(503).json({ error: 'RESTORE_NOT_CONFIGURED' });
  }
  let identity;
  try { identity = await verifyLogin(authorization); } catch { identity = null; }
  if (!identity) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return response.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const rest = (table, params, init = {}) => {
    const url = new URL(`/rest/v1/${table}`, base);
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
    const [backup] = await rows(await rest('training_note_backups',
      { select: 'id,owner_id,title,body,content_sha256', id: `eq.${id}` }));
    // Someone else's backup looks the same as no backup.
    if (!backup || backup.id !== id || backup.owner_id !== identity.userId) {
      return response.status(404).json({ error: 'NOT_FOUND' });
    }
    if (typeof backup.title !== 'string' || typeof backup.body !== 'string'
        || contentHash(backup.title, backup.body) !== backup.content_sha256) {
      return response.status(409).json({ error: 'BACKUP_HASH_MISMATCH' });
    }
    const [live] = await rows(await rest('training_user_notes', { select: 'id,owner_id', id: `eq.${id}` }));
    // shortcut: check-then-write is not atomic; move into one DB function if restores run concurrently.
    if (live && live.owner_id !== backup.owner_id) return response.status(409).json({ error: 'ID_OWNED_BY_OTHER' });
    const [saved] = await rows(await rest('training_user_notes',
      { on_conflict: 'id', select: 'id,owner_id,title,body' }, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ id, owner_id: backup.owner_id, title: backup.title, body: backup.body }),
      }));
    if (!saved || saved.id !== id || saved.owner_id !== backup.owner_id
        || contentHash(saved.title, saved.body) !== backup.content_sha256) throw new Error('restore_mismatch');
    // Audit line: no title, body, token or account ID.
    console.log(JSON.stringify({ event: 'note_restore', noteId: id, contentSha256: backup.content_sha256, at: new Date().toISOString() }));
    return response.status(200).json({ id, restored: true, ownerMatched: true, contentSha256: backup.content_sha256 });
  } catch {
    return response.status(502).json({ error: 'RESTORE_UNAVAILABLE' });
  }
}
