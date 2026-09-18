const { forwardGetToAppsScript } = require('../lib/forwardToAppsScript');
const { checkApiKey } = require('../lib/auth');
const { applyCors } = require('../lib/cors');

module.exports = async function handler(req, res) {
  if (applyCors(req, res, ['GET'])) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ status: 'error', message: 'Method not allowed. Use GET to fetch deficiencies.' });
  }

  if (!checkApiKey(req, res)) return;

  const baseUrl = process.env.DEFICIENCY_APPS_SCRIPT_URL;
  if (!baseUrl) {
    return res.status(500).json({ status: 'error', message: 'DEFICIENCY_APPS_SCRIPT_URL environment variable is not set.' });
  }

  const { ticketId, ticketNumber } = req.query;
  if (!ticketId && !ticketNumber) {
    return res.status(400).json({ status: 'error', message: 'Provide either ticketId or ticketNumber as a query parameter.' });
  }

  const params = new URLSearchParams();
  if (ticketId) params.set('ticketId', String(ticketId));
  if (ticketNumber) params.set('ticketNumber', String(ticketNumber));

  try {
    const result = await forwardGetToAppsScript(baseUrl + '?' + params.toString());
    res.status(result.httpStatus).json(result.body);
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
};
