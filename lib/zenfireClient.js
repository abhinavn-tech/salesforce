// ZenFire client for routes that call ZenFire directly (no Apps Script in between).
// Logs in with the integration user, keeps the token until shortly before it expires, and logs in again once on a
// 401/403. Header set confirmed against the live API: access-token (raw JWT), company-id, user-id, request-from.
//   ZENFIRE_LOGIN_EMAIL, ZENFIRE_LOGIN_PASSWORD   the integration user (put them in Vercel, never in the code)
//   ZENFIRE_BASE_URL                              default https://services.zentrades.pro

let cached = null; // { token, companyId, userId, exp }

const baseUrl = () => String(process.env.ZENFIRE_BASE_URL || 'https://services.zentrades.pro').replace(/\/+$/, '');

function jwtExpiry(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).exp || null; } catch (e) { return null; }
}

async function login(fetchFn) {
  const email = process.env.ZENFIRE_LOGIN_EMAIL;
  const password = process.env.ZENFIRE_LOGIN_PASSWORD;
  if (!email || !password) throw new Error('ZENFIRE_LOGIN_EMAIL / ZENFIRE_LOGIN_PASSWORD are not set.');
  const res = await fetchFn(baseUrl() + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'request-from': 'WEB_APP' },
    body: JSON.stringify({ username: email, password })
  });
  const text = await res.text();
  if (!res.ok) throw new Error('ZenFire login failed (HTTP ' + res.status + ').');
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error('ZenFire login answered with something that is not JSON.'); }
  const r = json.result || {};
  const token = r['access-token'];
  const companyId = r.user && r.user.company && r.user.company.id;
  const userId = r.user && r.user.id;
  if (!token || !companyId || !userId) throw new Error('ZenFire login worked but the token, company id or user id was not where expected.');
  cached = { token, companyId, userId, exp: jwtExpiry(token) || Math.floor(Date.now() / 1000) + 3600 };
  return cached;
}

async function authContext(fetchFn, force) {
  if (!force && cached && cached.exp && Date.now() / 1000 < cached.exp - 300) return cached;
  return login(fetchFn);
}

/** Returns a client with call(method, path, body) -> { ok:true, id, json } | { ok:false, error:"HTTP <code>: <body>" }. */
function createClient(fetchFn) {
  const doFetch = fetchFn || fetch;
  async function attempt(method, path, payload, force) {
    const auth = await authContext(doFetch, force);
    const res = await doFetch(baseUrl() + path + (path.includes('?') ? '&' : '?') + 'timestamp=' + Date.now(), {
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json', 'request-from': 'WEB_APP',
        'company-id': String(auth.companyId), 'user-id': String(auth.userId), 'access-token': auth.token
      },
      body: payload === null || payload === undefined ? undefined : JSON.stringify(payload)
    });
    return { code: res.status, text: await res.text() };
  }
  return {
    async call(method, path, payload) {
      let r = await attempt(method, path, payload, false);
      if (r.code === 401 || r.code === 403) r = await attempt(method, path, payload, true);
      let json = null;
      try { json = JSON.parse(r.text); } catch (e) { /* not JSON */ }
      // ZenFire sometimes answers HTTP 200 with an error body, so success also needs status === 'success'
      if (r.code >= 200 && r.code < 300 && json && json.status === 'success') return { ok: true, id: json.result && json.result.id, json };
      return { ok: false, error: 'HTTP ' + r.code + ': ' + r.text };
    }
  };
}

function resetAuthCache() { cached = null; }

module.exports = { createClient, resetAuthCache };
