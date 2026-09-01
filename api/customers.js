const { forwardToAppsScript } = require('../lib/forwardToAppsScript');
const { checkApiKey } = require('../lib/auth');
const { applyCors } = require('../lib/cors');

module.exports = async function handler(req, res) {
  if (applyCors(req, res, ['POST'])) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ status: 'error', message: 'Method not allowed. Use POST to create a customer.' });
  }

  if (!checkApiKey(req, res)) return;

  try {
    const result = await forwardToAppsScript('createCustomer', req.body);
    res.status(result.httpStatus).json(result.body);
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
};
