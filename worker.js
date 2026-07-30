const SUPABASE_URL = 'https://meaakswalvliphlexqqd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lYWFrc3dhbHZsaXBobGV4cXFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzNDE5NzUsImV4cCI6MjEwMDkxNzk3NX0.TQulUFAumLl7V-9Rw6Tm5Vreyp2SyRA8BnYyIdZNyqU';

const COOKIE_ACCESS = 'ou_access';
const COOKIE_REFRESH = 'ou_refresh';
const COOKIE_EXPIRES = 'ou_expires';
const COOKIE_BASE = 'Path=/; HttpOnly; Secure; SameSite=Strict';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function json(data, status = 200, headers = new Headers()) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  responseHeaders.set('Cache-Control', 'no-store, private');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders,
  });
}

function parseCookies(request) {
  const result = {};
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function cookie(name, value, maxAge = COOKIE_MAX_AGE) {
  return `${name}=${encodeURIComponent(value)}; ${COOKIE_BASE}; Max-Age=${maxAge}`;
}

function clearCookie(name) {
  return `${name}=; ${COOKIE_BASE}; Max-Age=0`;
}

function appendSessionCookies(headers, session) {
  const expiresAt = session.expires_at || Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
  headers.append('Set-Cookie', cookie(COOKIE_ACCESS, session.access_token));
  headers.append('Set-Cookie', cookie(COOKIE_REFRESH, session.refresh_token));
  headers.append('Set-Cookie', cookie(COOKIE_EXPIRES, String(expiresAt)));
}

function appendClearedCookies(headers) {
  headers.append('Set-Cookie', clearCookie(COOKIE_ACCESS));
  headers.append('Set-Cookie', clearCookie(COOKIE_REFRESH));
  headers.append('Set-Cookie', clearCookie(COOKIE_EXPIRES));
}

async function supabaseAuth(path, { method = 'POST', body, accessToken } = {}) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.msg || data.message || data.error_description || data.error || 'Authentication failed');
  }
  return data;
}

async function currentSession(request) {
  const cookies = parseCookies(request);
  let accessToken = cookies[COOKIE_ACCESS];
  let refreshToken = cookies[COOKIE_REFRESH];
  let expiresAt = Number(cookies[COOKIE_EXPIRES] || 0);

  if (!refreshToken) throw new Error('No saved login');

  // Reuse the access token until it is genuinely close to expiry.
  if (accessToken && expiresAt > Math.floor(Date.now() / 1000) + 120) {
    try {
      const user = await supabaseAuth('user', { method: 'GET', accessToken });
      return { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt, user, rotated: false };
    } catch (_) {
      // Fall through to refresh.
    }
  }

  const session = await supabaseAuth('token?grant_type=refresh_token', {
    body: { refresh_token: refreshToken },
  });
  return { ...session, rotated: true };
}

async function handleApi(request, env, url) {
  try {
    if (url.pathname === '/api/cookie-check' && request.method === 'GET') {
      const cookies = parseCookies(request);
      return json({
        access_cookie: Boolean(cookies[COOKIE_ACCESS]),
        refresh_cookie: Boolean(cookies[COOKIE_REFRESH]),
        expires_cookie: Boolean(cookies[COOKIE_EXPIRES]),
      });
    }
    if (url.pathname === '/api/login' && request.method === 'POST') {
      const body = await request.json();
      if (!body?.email || !body?.password) return json({ error: 'Email and password are required.' }, 400);
      const session = await supabaseAuth('token?grant_type=password', {
        body: { email: body.email, password: body.password },
      });
      const headers = new Headers();
      appendSessionCookies(headers, session);
      return json({
        access_token: session.access_token,
        expires_at: session.expires_at || Math.floor(Date.now() / 1000) + (session.expires_in || 3600),
        user: session.user,
      }, 200, headers);
    }

    if (url.pathname === '/api/session' && request.method === 'GET') {
      const session = await currentSession(request);
      const headers = new Headers();
      if (session.rotated) appendSessionCookies(headers, session);
      return json({
        access_token: session.access_token,
        expires_at: session.expires_at || Math.floor(Date.now() / 1000) + (session.expires_in || 3600),
        user: session.user,
      }, 200, headers);
    }

    if (url.pathname === '/api/logout' && request.method === 'POST') {
      const cookies = parseCookies(request);
      const accessToken = cookies[COOKIE_ACCESS];
      if (accessToken) {
        try { await supabaseAuth('logout', { accessToken }); } catch (_) {}
      }
      const headers = new Headers();
      appendClearedCookies(headers);
      return json({ ok: true }, 200, headers);
    }

    if (url.pathname === '/api/recover' && request.method === 'POST') {
      const body = await request.json();
      if (!body?.email) return json({ error: 'Email is required.' }, 400);
      await supabaseAuth(`recover?redirect_to=${encodeURIComponent(`${url.origin}/`)}`, {
        body: { email: body.email },
      });
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  } catch (error) {
    const headers = new Headers();
    // Clear only when session restoration failed, not for an incorrect password.
    if (url.pathname === '/api/session') appendClearedCookies(headers);
    return json({ error: error?.message || 'Authentication failed' }, 401, headers);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/vendor/supabase.js') {
      const cache = caches.default;
      const cacheKey = new Request('https://organiseus.internal/vendor/supabase-js-v2');
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const upstream = await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', {
        headers: { 'User-Agent': 'OrganiseUs-Worker' },
      });
      if (!upstream.ok) {
        return new Response(
          "console.error('Supabase library upstream failed: " + upstream.status + "');",
          {
            status: 502,
            headers: {
              'Content-Type': 'application/javascript; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          }
        );
      }

      const response = new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        },
      });
      await cache.put(cacheKey, response.clone());
      return response;
    }

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
};
