var API_URL = 'https://script.google.com/macros/s/AKfycbzZ1rHLUPvFs7Qr-F2IWi2Z3yE7myADX60hX2TVwg0CFGVSdcGYDDXLEXxt3g26S9YJ/exec';

function apiGet(action) {
  return fetch(API_URL + '?action=' + action, { redirect: 'follow' })
    .then(function(res) { return res.json(); })
    .catch(function(e) { console.error('API error:', e); return null; });
}

function apiPost(action, payload) {
  payload.action = action;
  return fetch(API_URL, {
    method: 'POST',
    redirect: 'follow',
    body: JSON.stringify(payload)
  })
    .then(function(res) { return res.json(); })
    .catch(function(e) { console.error('API error:', e); return null; });
}

function getStats() { return apiGet('stats'); }
function getTrades() { return apiGet('trades'); }
function submitTrade(data) { return apiPost('submit', data); }