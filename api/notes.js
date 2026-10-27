// Stage 2: deliberately public. Authentication is added in a later stage.
// Credentials are sent only from this server to the configured Supabase API.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  let endpoint;
  try {
    const base = new URL(SUPABASE_URL);
    if (base.protocol !== 'https:' || base.username || base.password
        || base.pathname !== '/' || base.search || base.hash || !SUPABASE_SECRET_KEY?.trim()) {
      throw new Error('invalid_configuration');
    }
    endpoint = new URL('/rest/v1/training_notes', base);
    endpoint.searchParams.set('select', 'id,title,content');
    endpoint.searchParams.set('order', 'id.asc');
  } catch {
    return response.status(503).json({ error: 'NOTES_NOT_CONFIGURED' });
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
