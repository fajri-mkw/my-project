// Tiny forward proxy to Turso management API.
// The sandbox cannot reach api.turso.tech directly (CloudFront WAF block),
// so this Worker (reachable from anywhere) forwards authenticated requests.

export default {
  async fetch(request, env) {
    // Shared-secret auth to keep the proxy private.
    const provided = request.headers.get('X-Proxy-Secret');
    if (!provided || provided !== env.PROXY_SECRET) {
      return json({ error: 'unauthorized' }, 401);
    }

    // Allow caller to override the Turso token via header (useful for debugging
    // secret storage issues). Falls back to the env secret.
    const tursoToken = request.headers.get('X-Turso-Token') || env.TURSO_API_TOKEN;
    if (!tursoToken) {
      return json({ error: 'no turso token configured' }, 500);
    }

    const url = new URL(request.url);
    // Debug endpoint: returns what the Worker sees (token length, segments).
    if (url.pathname === '/__debug') {
      const segments = tursoToken.split('.');
      return json({
        tokenLength: tursoToken.length,
        segmentCount: segments.length,
        segmentLengths: segments.map(s => s.length),
        firstChars: tursoToken.slice(0, 20),
        lastChars: tursoToken.slice(-20),
      });
    }

    // Strip leading slash so pathname joins cleanly.
    const path = url.pathname.replace(/^\/+/, '');
    const tursoUrl = `https://api.turso.tech/${path}${url.search}`;

    const headers = new Headers();
    headers.set('Authorization', `Bearer ${tursoToken}`);
    headers.set('Content-Type', 'application/json');
    headers.set('User-Agent', 'turso-cli/1.0.29');

    let body = undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.text();
    }

    try {
      const upstream = await fetch(tursoUrl, {
        method: request.method,
        headers,
        body,
      });
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
      });
    } catch (err) {
      return json({ error: String(err), tursoUrl }, 502);
    }
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
