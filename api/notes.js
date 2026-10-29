import { randomUUID } from 'node:crypto';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
let verifyLogin;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const authorization = request.headers?.authorization;
  if (typeof authorization !== 'string' || !authorization) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return response.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  let endpoint;
  try {
    const base = new URL(SUPABASE_URL);
    if (base.protocol !== 'https:' || base.username || base.password
        || base.pathname !== '/' || base.search || base.hash || !SUPABASE_SECRET_KEY?.trim()
        || config.identityProvider?.issuer !== `${base.origin}/auth/v1`) throw new Error('configuration');
    endpoint = new URL('/rest/v1/training_user_notes', base);
    verifyLogin ??= createLoginVerifier({ config, supabaseSecretKey: SUPABASE_SECRET_KEY });
  } catch {
    return response.status(503).json({ error: 'NOTES_NOT_CONFIGURED' });
  }

  let identity;
  try { identity = await verifyLogin(authorization); } catch { identity = null; }
  if (!identity) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return response.status(401).json({ error: 'UNAUTHORIZED' });
  }

  let id;
  try {
    const path = new URL(request.url ?? '/api/notes', 'https://local.invalid').pathname;
    if (path !== '/api/notes' && path !== '/api/notes/') {
      const match = /^\/api\/notes\/([^/]+)\/?$/u.exec(path);
      if (!match) return response.status(404).json({ error: 'NOT_FOUND' });
      id = decodeURIComponent(match[1]);
      if (!UUID.test(id)) return response.status(400).json({ error: 'INVALID_ID' });
      id = id.toLowerCase();
    }
  } catch {
    return response.status(400).json({ error: 'INVALID_ID' });
  }
  const methods = id ? ['GET', 'PUT', 'DELETE'] : ['GET', 'POST'];
  if (!methods.includes(request.method)) {
    response.setHeader('Allow', methods.join(', '));
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  let payload;
  if (request.method === 'POST' || request.method === 'PUT') {
    if (!/^application\/json(?:\s*;|$)/iu.test(request.headers?.['content-type'] ?? '')) {
      return response.status(415).json({ error: 'JSON_REQUIRED' });
    }
    let input;
    try { input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body; }
    catch { return response.status(400).json({ error: 'INVALID_NOTE' }); }
    if (!input || Array.isArray(input) || typeof input.title !== 'string' || !input.title.trim()
        || input.title.length > 200 || typeof input.body !== 'string' || input.body.length > 10000) {
      return response.status(400).json({ error: 'INVALID_NOTE' });
    }
    if (request.method === 'PUT' && Object.hasOwn(input, 'owner_id')
        && input.owner_id !== identity.userId) {
      return response.status(403).json({ error: 'OWNER_CHANGE_FORBIDDEN' });
    }
    // PUT only writes title/body, so the new row keeps the existing owner.
    payload = { title: input.title.trim(), body: input.body };
    if (request.method === 'POST') {
      if (input.id !== undefined && (typeof input.id !== 'string' || !UUID.test(input.id))) {
        return response.status(400).json({ error: 'INVALID_ID' });
      }
      // Identity comes only from the unchanged verifier; ignore supplied owner_id/userId/role.
      payload.id = input.id?.toLowerCase() ?? randomUUID();
      payload.owner_id = identity.userId;
    }
  }

  endpoint.searchParams.set('select', 'id,title,body');
  if (id) {
    endpoint.searchParams.set('id', `eq.${id}`);
    // Check the existing owner in the same DB operation to avoid a check/write race.
    endpoint.searchParams.set('owner_id', `eq.${identity.userId}`);
  } else if (request.method === 'GET') {
    endpoint.searchParams.set('owner_id', `eq.${identity.userId}`);
    endpoint.searchParams.set('order', 'created_at.desc,id.asc');
  }
  try {
    const upstream = await fetch(endpoint, {
      method: request.method === 'PUT' ? 'PATCH' : request.method,
      headers: { apikey: SUPABASE_SECRET_KEY, Accept: 'application/json',
        ...(request.method !== 'GET' ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (request.method === 'POST' && upstream.status === 409) {
      return response.status(409).json({ error: 'NOTE_ALREADY_EXISTS' });
    }
    if (!upstream.ok) throw new Error('upstream_failed');
    const rows = await upstream.json();
    if (!Array.isArray(rows) || rows.some(row => !row || !UUID.test(row.id)
        || typeof row.title !== 'string' || typeof row.body !== 'string')) throw new Error('invalid_notes');
    if (id && !rows.length) return response.status(404).json({ error: 'NOT_FOUND' });
    if (request.method === 'DELETE') return response.status(204).end();
    if (request.method === 'POST') {
      if (rows.length !== 1 || rows[0].id !== payload.id) throw new Error('invalid_insert');
      return response.status(201).json({ id: rows[0].id });
    }
    const notes = rows.map(({ id, title, body }) => ({ id, title, body }));
    return response.status(200).json(id ? notes[0] : notes);
  } catch {
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}
