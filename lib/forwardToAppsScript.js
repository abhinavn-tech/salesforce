async function forwardToAppsScript(operation, data) {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) {
    throw new Error('APPS_SCRIPT_URL environment variable is not set.');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, data })
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error('Apps Script returned a non-JSON response (HTTP ' + response.status + '): ' + text.slice(0, 500));
  }

  return { httpStatus: response.status, body: json };
}

module.exports = { forwardToAppsScript };
