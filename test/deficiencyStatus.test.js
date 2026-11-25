const test = require('node:test');
const assert = require('node:assert');
const { updateDeficiencyStatus: setStatus } = require('../lib/deficiencyStatus');
const handler = require('../api/deficiencies/status');
const { createClient, resetAuthCache } = require('../lib/zenfireClient');

// A fake ZenFire holding deficiencies, answering like the real calls did in the captures.
function fakeZenfire(initial) {
  const defs = initial.map((d) => Object.assign({}, d)); const calls = [];
  return {
    calls, defs,
    async call(method, path, body) {
      calls.push({ method, path, body });
      if (method === 'post' && path === '/api/common/fp/form/deficiency/list') return { ok: true, json: { status: 'success', result: defs.filter((d) => d.ticketId === body.ticketId) } };
      if (method === 'put' && path === '/api/common/fp/form/deficiency/update') {
        if (this.failWith) return { ok: false, error: this.failWith };
        const d = defs.find((x) => x.id === body.id);
        if (!d) return { ok: true, json: { status: 'success', result: null } }; // unknown id: an empty "success"
        if (this.ignoreStatus) return { ok: true, json: { status: 'success', result: Object.assign({}, d) } };
        d.status = body.status;
        return { ok: true, json: { status: 'success', result: Object.assign({}, d) } };
      }
      return { ok: false, error: 'HTTP 404: nope' };
    }
  };
}
const base = () => [
  { id: '5XFeHeZCzM', ticketId: 1936539, status: 'Open', question: '(d) Provided with appropriate wrenches?' },
  { id: 'AAAAAAAAAA', ticketId: 1111111, status: 'Open', question: 'other ticket' }
];

test('the answer keeps status:"success" for the call and puts the deficiency status in deficiencyStatus', async () => {
  const zf = fakeZenfire(base());
  const r = await setStatus({ incidentId: '5XFeHeZCzM', status: 'Rejected' }, zf);
  assert.equal(r.httpStatus, 200); assert.equal(r.status, 'success'); assert.equal(r.action, 'updated');
  assert.equal(r.deficiencyStatus, 'Rejected'); assert.equal(r.ticketId, '1936539');
  assert.deepEqual(zf.calls[0], { method: 'put', path: '/api/common/fp/form/deficiency/update', body: { id: '5XFeHeZCzM', status: 'Rejected' } });
  assert.equal(zf.defs[0].status, 'Rejected');
  assert.ok(r.warnings.length === 1 && /previous status/.test(r.warnings[0]));
});

test('with ticketId: previous status is reported; the same status is a no-op that writes nothing', async () => {
  const zf = fakeZenfire(base());
  const r1 = await setStatus({ incidentId: '5XFeHeZCzM', ticketId: 1936539, status: 'Rejected' }, zf);
  assert.equal(r1.action, 'updated'); assert.equal(r1.previousStatus, 'Open'); assert.deepEqual(r1.warnings, []);
  const writes = () => zf.calls.filter((c) => c.method === 'put').length;
  assert.equal(writes(), 1);
  const r2 = await setStatus({ incidentId: '5XFeHeZCzM', ticketId: '1936539', status: 'Rejected' }, zf);
  assert.equal(r2.action, 'unchanged'); assert.equal(r2.status, 'success'); assert.equal(r2.deficiencyStatus, 'Rejected'); assert.equal(writes(), 1);
});

test('a deficiency that is not on the given ticket is refused and not touched', async () => {
  const zf = fakeZenfire(base());
  const r = await setStatus({ incidentId: 'AAAAAAAAAA', ticketId: 1936539, status: 'Rejected' }, zf);
  assert.equal(r.httpStatus, 404); assert.equal(r.code, 'NOT_FOUND'); assert.match(r.message, /not found on ticket 1936539/);
  assert.ok(!zf.calls.some((c) => c.method === 'put')); assert.equal(zf.defs[1].status, 'Open');
});

test('status matches without case; anything else is refused with the allowed list; DEFICIENCY_STATUSES extends it', async () => {
  assert.equal((await setStatus({ incidentId: '5XFeHeZCzM', status: ' rejected ' }, fakeZenfire(base()))).deficiencyStatus, 'Rejected');
  const bad = await setStatus({ incidentId: '5XFeHeZCzM', status: 'Banana' }, fakeZenfire(base()));
  assert.equal(bad.httpStatus, 400); assert.deepEqual(bad.allowedStatuses, ['Open', 'Rejected', 'Resolved']); assert.match(bad.message, /Allowed: Open, Rejected, Resolved/);
  const resolved = await setStatus({ incidentId: '5XFeHeZCzM', ticketId: 1936539, status: 'resolved' }, fakeZenfire(base()));
  assert.equal(resolved.action, 'updated'); assert.equal(resolved.deficiencyStatus, 'Resolved'); assert.equal(resolved.previousStatus, 'Open');
  process.env.DEFICIENCY_STATUSES = 'Open,Closed';
  const custom = await setStatus({ incidentId: '5XFeHeZCzM', status: 'closed' }, fakeZenfire(base()));
  const old = await setStatus({ incidentId: '5XFeHeZCzM', status: 'Resolved' }, fakeZenfire(base()));
  delete process.env.DEFICIENCY_STATUSES;
  assert.equal(custom.deficiencyStatus, 'Closed'); assert.equal(old.httpStatus, 400); // the setting replaces the default list
});

test('missing/malformed input -> 400 per field; aliases deficiencyId / newStatus are accepted', async () => {
  const none = await setStatus({}, fakeZenfire(base()));
  assert.equal(none.httpStatus, 400); assert.deepEqual(none.errors.map((e) => e.field), ['incidentId', 'status']);
  assert.ok((await setStatus({ incidentId: 'x', status: 'Open', ticketId: 'abc' }, fakeZenfire(base()))).errors.some((e) => e.field === 'ticketId'));
  assert.equal((await setStatus({ deficiencyId: '5XFeHeZCzM', newStatus: 'Rejected' }, fakeZenfire(base()))).httpStatus, 200);
});

test('unknown id (ZenFire answers an empty success) -> 404; ZenFire refusal -> 502 scrubbed; fake success is not trusted', async () => {
  assert.equal((await setStatus({ incidentId: 'ZZZZZZZZZZ', status: 'Rejected' }, fakeZenfire(base()))).httpStatus, 404);
  const zf = fakeZenfire(base()); zf.failWith = 'HTTP 500: {"message":"nope","requestId":"eyJabcdefghijk.lmnopqrstuvw.xyzabcdefgh"}';
  const r = await setStatus({ incidentId: '5XFeHeZCzM', status: 'Rejected' }, zf);
  assert.equal(r.httpStatus, 502); assert.ok(!JSON.stringify(r).includes('eyJ'));
  const lying = fakeZenfire(base()); lying.ignoreStatus = true;
  const l = await setStatus({ incidentId: '5XFeHeZCzM', status: 'Rejected' }, lying);
  assert.equal(l.httpStatus, 502); assert.match(l.message, /not "Rejected"/);
});

// ---- the route ----
function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = () => r;
  return r;
}

test('route: key required (and refused when none is configured), POST only, JSON object body, answer without httpStatus', async () => {
  const zf = fakeZenfire(base());
  const call = async (req) => { const res = fakeRes(); await handler(Object.assign({ zf }, req), res); return res; };
  delete process.env.API_KEY;
  assert.equal((await call({ method: 'POST', headers: {}, body: {} })).statusCode, 401); // no key configured -> closed
  process.env.API_KEY = 'secret';
  assert.equal((await call({ method: 'POST', headers: {}, body: {} })).statusCode, 401);
  assert.equal((await call({ method: 'POST', headers: { 'x-api-key': 'wrong' }, body: {} })).statusCode, 401);
  assert.equal((await call({ method: 'GET', headers: { 'x-api-key': 'secret' } })).statusCode, 405);
  assert.equal((await call({ method: 'OPTIONS', headers: {} })).statusCode, 204);
  assert.equal((await call({ method: 'POST', headers: { 'x-api-key': 'secret' }, body: [1] })).statusCode, 400);
  const good = await call({ method: 'POST', headers: { 'x-api-key': 'secret' }, body: JSON.stringify({ incidentId: '5XFeHeZCzM', ticketId: 1936539, status: 'Rejected' }) });
  assert.equal(good.statusCode, 200); assert.equal(good.body.status, 'success'); assert.equal(good.body.deficiencyStatus, 'Rejected'); assert.ok(!('httpStatus' in good.body));
  delete process.env.API_KEY;
});

// ---- the ZenFire login ----
test('client: logs in once, reuses the token, logs in again after a 401, and sends the right headers', async () => {
  resetAuthCache();
  process.env.ZENFIRE_LOGIN_EMAIL = 'u@x.com'; process.env.ZENFIRE_LOGIN_PASSWORD = 'pw';
  const jwt = 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.s';
  let logins = 0; let refuse = 0; const seen = [];
  const f = async (url, o) => {
    if (String(url).endsWith('/api/auth/login')) { logins++; return { ok: true, status: 200, text: async () => JSON.stringify({ result: { 'access-token': jwt + logins, user: { id: 9, company: { id: 580 } } } }) }; }
    seen.push(o.headers);
    if (refuse > 0) { refuse--; return { ok: false, status: 401, text: async () => '{}' }; }
    return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'success', result: { id: 1 } }) };
  };
  const zf = createClient(f);
  assert.equal((await zf.call('get', '/api/x')).ok, true); await zf.call('get', '/api/y');
  assert.equal(logins, 1);
  assert.equal(seen[0]['company-id'], '580'); assert.equal(seen[0]['user-id'], '9'); assert.equal(seen[0]['request-from'], 'WEB_APP'); assert.ok(seen[0]['access-token'].startsWith('h.'));
  refuse = 1; assert.equal((await zf.call('get', '/api/z')).ok, true); assert.equal(logins, 2);
  delete process.env.ZENFIRE_LOGIN_EMAIL; delete process.env.ZENFIRE_LOGIN_PASSWORD; resetAuthCache();
});
