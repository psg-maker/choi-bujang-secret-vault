import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
let verifyLogin;

// Instructor notices: read-only for any verified login, separate table from user notes.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const path = new URL(request.url ?? '/api/notices', 'https://local.invalid').pathname;
  if (path !== '/api/notices' && path !== '/api/notices/') return response.status(404).json({ error: 'NOT_FOUND' });
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
  let endpoint;
  try {
    const base = new URL(SUPABASE_URL);
    if (base.protocol !== 'https:' || base.username || base.password
        || base.pathname !== '/' || base.search || base.hash || !SUPABASE_SECRET_KEY?.trim()
        || config.identityProvider?.issuer !== `${base.origin}/auth/v1`) throw new Error('configuration');
    endpoint = new URL('/rest/v1/training_instructor_notices', base);
    verifyLogin ??= createLoginVerifier({ config, supabaseSecretKey: SUPABASE_SECRET_KEY });
  } catch {
    return response.status(503).json({ error: 'NOTICES_NOT_CONFIGURED' });
  }

  let identity;
  try { identity = await verifyLogin(authorization); } catch { identity = null; }
  if (!identity) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return response.status(401).json({ error: 'UNAUTHORIZED' });
  }

  endpoint.searchParams.set('select', 'id,title,body');
  endpoint.searchParams.set('order', 'created_at.desc,id.asc');
  try {
    const upstream = await fetch(endpoint, {
      headers: { apikey: SUPABASE_SECRET_KEY, Accept: 'application/json' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) throw new Error('upstream_failed');
    const rows = await upstream.json();
    if (!Array.isArray(rows) || rows.some(row => !row || !UUID.test(row.id)
        || typeof row.title !== 'string' || typeof row.body !== 'string')) throw new Error('invalid_notices');
    return response.status(200).json(rows.map(({ id, title, body }) => ({ id, title, body })));
  } catch {
    return response.status(502).json({ error: 'NOTICES_UNAVAILABLE' });
  }
}
