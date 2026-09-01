const { forwardToAppsScript } = require('../../lib/forwardToAppsScript');
const { checkApiKey } = require('../../lib/auth');
const { applyCors } = require('../../lib/cors');

module.exports = async function handler(req, res) {
  if (applyCors(req, res, ['PUT'])) return;

  if (req.method !== 'PUT') {
    res.setHeader('Allow', 'PUT');
    return res.status(405).json({ status: 'error', message: 'Method not allowed. Use PUT to update an item.' });
  }

  if (!checkApiKey(req, res)) return;

  const { id } = req.query;

  try {
    const result = await forwardToAppsScript('updateItem', Object.assign({}, req.body, { id }));
    res.status(result.httpStatus).json(result.body);
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
};
