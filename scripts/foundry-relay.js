#!/usr/bin/env node
const http = require('http');

const PORT = Number(process.env.AUTOAPPLY_FOUNDRY_RELAY_PORT || 8765);
const HOST = '127.0.0.1';

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 2_000_000) {
        req.destroy();
        reject(new Error('Request too large'));
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

async function callFoundry(urls, apiKey, body) {
  let lastError = 'No Foundry endpoint configured.';
  for (const url of urls || []) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'api-key': apiKey,
          'x-api-key': apiKey,
          'authorization': `Bearer ${apiKey}`,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body || {})
      });
      const text = await response.text();
      let json = {};
      try { json = text ? JSON.parse(text) : {}; }
      catch { json = { text }; }
      if (response.ok) return json;
      lastError = json.error?.message || json.message || `Foundry request failed: ${response.status}`;
      if (![404, 405].includes(response.status)) break;
    } catch (error) {
      lastError = error.message || String(error);
    }
  }
  throw new Error(lastError);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST' || req.url !== '/foundry') return send(res, 404, { error: 'Not found' });

  try {
    const payload = await readJson(req);
    if (!payload.apiKey) return send(res, 400, { error: 'Missing apiKey' });
    const json = await callFoundry(payload.urls, payload.apiKey, payload.body);
    send(res, 200, json);
  } catch (error) {
    send(res, 502, { error: error.message || String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AutoApply Foundry relay listening on http://${HOST}:${PORT}`);
});
