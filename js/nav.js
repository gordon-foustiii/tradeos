// ============================================================
// TradeOS Nav — shared bottom navigation
// ============================================================

function renderNav(active) {
  const pages = [
    { id: '', label: 'Home', icon: `<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>` },
    { id: 'journal', label: 'Journal', icon: `<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>` },
    { id: 'candies', label: 'Candies', icon: `<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>` },
    { id: 'calendar', label: 'Calendar', icon: `<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>` },
    { id: 'calculator', label: 'Calc', icon: `<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/>` },
    { id: 'notes', label: 'Scanner', icon: `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>` }
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