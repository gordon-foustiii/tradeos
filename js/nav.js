// ============================================================
// TradeOS Nav — shared bottom navigation
// ============================================================

function renderNav(active) {
  const pages = [
    { id: '', label: 'Home', icon: `<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>` },
    { id: 'journal', label: 'Journal', icon: `<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>` },
    { id: 'candies', label: 'Candies', icon: `<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>` },
    { id: 'scanner', label: 'Scanner', icon: `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>` },
    { id: 'plays', label: 'Plays', icon: `<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>` },
    { id: 'tools', label: 'Tools', icon: `<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>` },
    { id: 'settings', label: 'Profile', icon: `<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>` }
  ];

  const base = '/tradeos/';
  const html = pages.map(p => `
    <a href="${base}${p.id ? p.id + '.html' : 'index.html'}" class="nav-item ${active === p.id ? 'active' : ''}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p.icon}</svg>
      ${p.label}
    </a>`).join('');

  document.getElementById('bottom-nav').innerHTML = html;
}

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/tradeos/sw.js').catch(err => console.log('SW error:', err));
  });
}