import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';

let verifyLogin;
// Credentials are sent only from this server to the configured Supabase API.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
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
        || config.identityProvider?.issuer !== `${base.origin}/auth/v1`) {
      throw new Error('invalid_configuration');
    }
    endpoint = new URL('/rest/v1/training_notes', base);
    endpoint.searchParams.set('select', 'id,title,content');
    endpoint.searchParams.set('order', 'id.asc');
    verifyLogin ??= createLoginVerifier({ config, supabaseSecretKey: SUPABASE_SECRET_KEY });
  } catch {
    return response.status(503).json({ error: 'NOTES_NOT_CONFIGURED' });
  }

  // Only the existing verifier may establish identity. Ignore client userId/role.
  let identity;
  try { identity = await verifyLogin(authorization); } catch { identity = null; }
  if (!identity) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return response.status(401).json({ error: 'UNAUTHORIZED' });
  }

  try {
    const upstream = await fetch(endpoint, {
      headers: { apikey: SUPABASE_SECRET_KEY, Accept: 'application/json' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) throw new Error('upstream_failed');
    const rows = await upstream.json();
    if (!Array.isArray(rows) || rows.some(row => !row || !Number.isInteger(row.id)
        || typeof row.title !== 'string' || typeof row.content !== 'string')) {
      throw new Error('invalid_notes');
    }
    // Whitelist response fields; never forward upstream headers or errors.
    return response.status(200).json({ notes: rows.map(({ id, title, content }) => ({ id, title, content })) });
  } catch {
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}
