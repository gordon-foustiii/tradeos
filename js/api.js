var BASE_URL = 'https://script.google.com/macros/s/AKfycbzZ1rHLUPvFs7Qr-F2IWi2Z3yE7myADX60hX2TVwg0CFGVSdcGYDDXLEXxt3g26S9YJ/exec';
var API_URL = 'https://corsproxy.io/?' + encodeURIComponent(BASE_URL);

function apiGet(action) {
  return fetch('https://corsproxy.io/?' + encodeURIComponent(BASE_URL + '?action=' + action))
    .then(function(res) { return res.json(); })
    .catch(function(e) { console.error('API error:', e); return null; });
}

function apiPost(action, payload) {
  payload.action = action;
  return fetch('https://corsproxy.io/?' + encodeURIComponent(BASE_URL), {
    method: 'POST',
    body: JSON.stringify(payload)
  })
    .then(function(res) { return res.json(); })
    .catch(function(e) { console.error('API error:', e); return null; });
}

function getStats() { return apiGet('stats'); }
function getTrades() { return apiGet('trades'); }
function submitTrade(data) { return apiPost('submit', data); }