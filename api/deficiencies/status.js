const { updateDeficiencyStatus } = require('../../lib/deficiencyStatus');
const { createClient } = require('../../lib/zenfireClient');
const { applyCors } = require('../../lib/cors');

// POST /api/deficiencies/status   body { incidentId, status, ticketId? }
// Same x-api-key as the other routes. Unlike them, this one refuses to run when API_KEY is not set: it writes data.
module.exports = async function handler(req, res) {
  if (applyCors(req, res, ['POST'])) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ status: 'error', code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Use POST to change a deficiency status.' });
  }

  const expected = process.env.API_KEY;
  if (!expected || req.headers['x-api-key'] !== expected) {
    return res.status(401).json({ status: 'error', code: 'UNAUTHORIZED', message: 'Invalid or missing API key.' });
  }

  let data = req.body;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = null; } }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ status: 'error', code: 'VALIDATION_ERROR', message: 'The request body must be a JSON object.' });
  }

  let result;
  try {
    result = await (req.zf ? updateDeficiencyStatus(data, req.zf) : updateDeficiencyStatus(data, createClient()));
  } catch (err) {
    result = { httpStatus: 500, status: 'error', code: 'INTERNAL_ERROR', message: 'The integration failed: ' + err.message };
  }
  const { httpStatus, ...body } = result;
  console.log(JSON.stringify({ op: 'deficiencies.status', http: httpStatus, status: body.status, code: body.code || body.action || '' }));
  return res.status(httpStatus || 200).json(body);
};
