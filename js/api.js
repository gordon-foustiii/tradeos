var BASE_URL = 'https://tradeos-proxy.gordon-foustiii.workers.dev';

function getToken() {
  return localStorage.getItem('tradeos_id_token');
}

function isLoggedIn() {
  var token = getToken();
  var expiry = localStorage.getItem('tradeos_token_expiry');
  return token && expiry && Date.now() < parseInt(expiry);
}

function requireAuth() {
  if (!isLoggedIn()) {
    window.location.href = '/tradeos/login.html';
    return false;
  }
  return true;
}

function signOut() {
  localStorage.removeItem('tradeos_id_token');
  localStorage.removeItem('tradeos_access_token');
  localStorage.removeItem('tradeos_token_expiry');
  window.location.href = '/tradeos/login.html';
}

function apiGet(action) {
  if (!requireAuth()) return Promise.resolve(null);
  return fetch(BASE_URL + '?action=' + action, {
    headers: { 'Authorization': 'Bearer ' + getToken() }
  })
    .then(function(res) { return res.json(); })
    .catch(function(e) { console.error('API error:', e); return null; });
}

function apiPost(action, payload) {
  if (!requireAuth()) return Promise.resolve(null);
  payload.action = action;
  return fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + getToken(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
    .then(function(res) { return res.json(); })
    .catch(function(e) { console.error('API error:', e); return null; });
}

function exportTrades() {
  if (!requireAuth()) return;
  window.open(BASE_URL + '?action=export', '_blank');
}

function getStats() { return apiGet('stats'); }
function getTrades() { return apiGet('trades'); }
function submitTrade(data) { return apiPost('submit', data); }