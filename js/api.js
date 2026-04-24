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

var _apiCache = {};
var _apiCacheTTL = 30000; // 30 seconds

function apiGet(action) {
  if (!requireAuth()) return Promise.resolve(null);
  const now = Date.now();
  if (_apiCache[action] && (now - _apiCache[action].ts) < _apiCacheTTL) {
    return Promise.resolve(_apiCache[action].data);
  }
  return fetch(BASE_URL + '?action=' + action + '&_=' + now, {
    headers: { 'Authorization': 'Bearer ' + getToken() },
    cache: 'no-store'
  })
    .then(function(res) { 
      if (res.status === 401) {
        console.warn('Token expired, signing out');
        signOut();
        return null;
      }
      return res.json(); 
    })
    .then(function(data) {
      _apiCache[action] = { ts: Date.now(), data: data };
      return data;
    })
    .catch(function(e) { console.error('API error:', e); return null; });
}

function clearApiCache() { _apiCache = {}; }

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
    .then(function(res) { 
      if (res.status === 401) {
        console.warn('Token expired, signing out');
        signOut();
        return null;
      }
      if (!res.ok) {
        return res.json().then(function(err) {
          throw new Error(err.error || 'Request failed');
        });
      }
      return res.json(); 
    })
    .catch(function(e) { 
      console.error('API error:', e); 
      return { error: e.message }; 
    });
}

function exportTrades() {
  if (!requireAuth()) return;
  window.open(BASE_URL + '?action=export', '_blank');
}

function getStats() { return apiGet('stats'); }
function getTrades() { return apiGet('trades'); }
function submitTrade(data) { return apiPost('submit', data); }
function updateTrade(data) { return apiPost('updateTrade', data); }
function getHabits() { return apiGet('getHabits'); }
function saveHabits(data) { return apiPost('saveHabits', data); }