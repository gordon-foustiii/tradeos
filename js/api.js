var BASE_URL = 'https://tradeos-proxy.gordon-foustiii.workers.dev';

function apiGet(action) {
  return fetch(BASE_URL + '?action=' + action)
    .then(function(res) { return res.json(); })
    .catch(function(e) { console.error('API error:', e); return null; });
}

function apiPost(action, payload) {
  payload.action = action;
  return fetch(BASE_URL, {
    method: 'POST',
    body: JSON.stringify(payload)
  })
    .then(function(res) { return res.json(); })
    .catch(function(e) { console.error('API error:', e); return null; });
}

function getStats() { return apiGet('stats'); }
function getTrades() { return apiGet('trades'); }
function submitTrade(data) { return apiPost('submit', data); }