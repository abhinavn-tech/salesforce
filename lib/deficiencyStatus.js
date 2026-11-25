// Change a deficiency's status in ZenFire (a Salesforce user changes it there, ZenFire follows).
// ZenFire call, captured from the ZenFire app:  PUT /api/common/fp/form/deficiency/update   body { id, status }
// Optional safety check: when the caller sends the ticketId, the deficiency is first looked up on that ticket
// (POST /api/common/fp/form/deficiency/list) so an id from the wrong ticket is refused instead of changed.
//
// Allowed statuses: DEFICIENCY_STATUSES (comma separated). ZenFire does not publish its list; "Open" and "Rejected"
// are the two seen so far, so those are the default.
//
// The answer has status:"success"|"error" for the CALL, and deficiencyStatus for the deficiency itself.

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const normKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIASES = {
  incidentId: ['incidentid', 'deficiencyid', 'id'],
  status: ['status', 'newstatus', 'deficiencystatus'],
  ticketId: ['ticketid', 'zenfireticketid']
};

function pick(data) {
  const out = {};
  const byNorm = {};
  Object.keys(data || {}).forEach((k) => { byNorm[normKey(k)] = data[k]; });
  Object.keys(ALIASES).forEach((name) => {
    for (const a of ALIASES[name]) {
      if (byNorm[a] !== undefined && byNorm[a] !== null && str(byNorm[a]) !== '') { out[name] = byNorm[a]; break; }
    }
  });
  return out;
}

const ok = (httpStatus, body) => Object.assign({}, body, { httpStatus, status: 'success' });
const fail = (httpStatus, code, message, extra) => Object.assign({}, extra || {}, { httpStatus, status: 'error', code, message });
const validationFail = (errors) => fail(400, 'VALIDATION_ERROR', `${errors.length} field(s) missing or invalid: ${errors.map((e) => e.field).join(', ')}.`, { errors });

/** ZenFire copies the caller's access token into "requestId" of many answers: nothing of ZenFire's goes out unscrubbed. */
function redact(text) {
  return String(text || '')
    .replace(/"requestId"\s*:\s*"[^"]*"/g, '"requestId":"[redacted]"')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-token]');
}

function zenfireFail(prefix, result) {
  const text = redact(result.error);
  if (/HTTP 404/.test(text) || /not\s*found/i.test(text)) return fail(404, 'NOT_FOUND', `${prefix} not found in ZenFire.`, { detail: text.slice(0, 500) });
  return fail(502, 'ZENFIRE_ERROR', `${prefix} was rejected by ZenFire.`, { detail: text.slice(0, 500) });
}

const allowedStatuses = () => String(process.env.DEFICIENCY_STATUSES || 'Open,Rejected').split(',').map((x) => x.trim()).filter(Boolean);

async function findOnTicket(zf, ticketId, id) {
  const body = { startDate: Date.UTC(2000, 0, 1), endDate: Date.now() + 5 * 365 * 24 * 3600 * 1000, ticketId: Number(ticketId) };
  const res = await zf.call('post', '/api/common/fp/form/deficiency/list', body);
  if (!res.ok) return { error: zenfireFail(`The deficiency list of ticket ${ticketId}`, res) };
  const list = Array.isArray(res.json.result) ? res.json.result : [];
  return { found: list.find((d) => String(d.id) === String(id)) || null };
}

async function updateDeficiencyStatus(data, zf) {
  const f = pick(data);
  const incidentId = str(f.incidentId);
  const wanted = str(f.status);
  const errors = [];
  if (!incidentId) errors.push({ field: 'incidentId', message: 'Required: the ZenFire deficiency id.' });
  if (!wanted) errors.push({ field: 'status', message: 'Required: the new status.' });
  if (f.ticketId !== undefined && !/^\d+$/.test(str(f.ticketId))) errors.push({ field: 'ticketId', message: 'Must be the numeric ZenFire ticket id.' });
  if (errors.length) return validationFail(errors);

  const allowed = allowedStatuses();
  const status = allowed.find((a) => a.toLowerCase() === wanted.toLowerCase());
  if (!status) {
    return fail(400, 'VALIDATION_ERROR', `Status "${wanted}" is not allowed. Allowed: ${allowed.join(', ')}.`,
      { errors: [{ field: 'status', message: `Must be one of: ${allowed.join(', ')}.` }], allowedStatuses: allowed });
  }

  let previousStatus = null;
  if (f.ticketId !== undefined) {
    const look = await findOnTicket(zf, str(f.ticketId), incidentId);
    if (look.error) return look.error;
    if (!look.found) return fail(404, 'NOT_FOUND', `Deficiency ${incidentId} was not found on ticket ${str(f.ticketId)}.`);
    previousStatus = str(look.found.status);
    if (previousStatus === status) { // already there: nothing to write
      return ok(200, { action: 'unchanged', incidentId, ticketId: str(f.ticketId), deficiencyStatus: status, previousStatus, message: `The deficiency already has the status ${status}; nothing was changed.`, warnings: [] });
    }
  }

  const res = await zf.call('put', '/api/common/fp/form/deficiency/update', { id: incidentId, status });
  if (!res.ok) return zenfireFail(`Deficiency ${incidentId}`, res);
  const r = res.json.result;
  if (!r || String(r.id) !== incidentId) return fail(404, 'NOT_FOUND', `Deficiency ${incidentId} not found in ZenFire.`); // an unknown id can come back as an empty "success"
  if (str(r.status) !== status) return fail(502, 'ZENFIRE_ERROR', `ZenFire answered success but the status is "${str(r.status)}", not "${status}".`);
  return ok(200, {
    action: 'updated', incidentId, ticketId: r.ticketId === undefined ? '' : String(r.ticketId), deficiencyStatus: str(r.status), previousStatus,
    message: `Deficiency status set to ${status}.`,
    warnings: previousStatus === null ? ['The previous status is not known: send ticketId to have it checked and reported.'] : []
  });
}

module.exports = { updateDeficiencyStatus, allowedStatuses };
