const API_URL = 'https://script.google.com/macros/s/AKfycbzZ1rHLUPvFs7Qr-F2IWi2Z3yE7myADX60hX2TVwg0CFGVSdcGYDDXLEXxt3g26S9YJ/exec';

async function apiGet(action) {
  try {
    const res = await fetch(`${API_URL}?action=${action}`, {
      redirect: 'follow'
    });
    const data = await res.json();
    return data;
  } catch(e) {
    console.error('API GET error:', e);
    return null;
  }
}

async function apiPost(action, payload) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      redirect: 'follow',
      body: JSON.stringify({ action, ...payload })
    });
    const data = await res.json();
    return data;
  } catch(e) {
    console.error('API POST error:', e);
    return null;
  }
}

async function getStats() { return await apiGet('stats'); }
async function getTrades() { return await apiGet('trades'); }
async function submitTrade(data) { return await apiPost('submit', data); }