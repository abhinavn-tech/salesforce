function checkApiKey(req, res) {
  const expected = process.env.API_KEY;
  if (!expected) {
    console.warn('API_KEY is not set -- requests are not being authenticated.');
    return true;
  }
  const provided = req.headers['x-api-key'];
  if (provided !== expected) {
    res.status(401).json({ status: 'error', message: 'Invalid or missing API key.' });
    return false;
  }
  return true;
}

module.exports = { checkApiKey };
