// REPLACE the fetchNews() and selectNews() functions in scanner.html with these:

let selectedNewsItems = []; // Track selected news globally

async function fetchNews() {
  if (!currentTicker) return;
  const btn = document.getElementById('news-btn');
  const container = document.getElementById('news-container');
  const list = document.getElementById('news-list');
  
  btn.disabled = true;
  btn.textContent = '⏳ Loading...';
  container.style.display = '';
  list.innerHTML = '<div class="news-empty">Fetching headlines...</div>';

  selectedNewsItems = []; // Reset on new search

  try {
    const res = await fetch(`${WORKER}/news?ticker=${encodeURIComponent(currentTicker.ticker)}`);
    const data = await res.json();

    if (!data.items || !data.items.length) {
      list.innerHTML = '<div class="news-empty">No recent news found for ' + currentTicker.ticker + '</div>';
    } else {
      list.innerHTML = data.items.slice(0, 6).map((item, i) => {
        const age = item.publishedAt ? timeAgo(item.publishedAt) : '';
        return `
          <div class="news-item" id="news-item-${i}" onclick="toggleNewsSelect(${i}, event)" data-news='${JSON.stringify(item).replace(/'/g, "&#39;")}'>
            <div style="display:flex;gap:10px;align-items:flex-start">
              <input type="checkbox" id="news-check-${i}" onclick="event.stopPropagation(); toggleNewsSelect(${i}, event)" style="width:18px;height:18px;margin-top:2px;cursor:pointer;flex-shrink:0">
              <div style="flex:1">
                <div class="news-headline">${escHtml(item.title)}</div>
                <div class="news-meta">
                  <span class="news-source">${escHtml(item.source||'')}</span>
                  ${age ? `<span>${age}</span>` : ''}
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch(e) {
    list.innerHTML = '<div class="news-empty">News fetch failed — check connection</div>';
  }
  
  btn.disabled = false;
  btn.textContent = '🔍 Search News';
}

function toggleNewsSelect(idx, event) {
  const checkbox = document.getElementById('news-check-' + idx);
  const item = document.getElementById('news-item-' + idx);
  
  if (!checkbox || !item) return;
  
  // Toggle checkbox if card was clicked
  if (event.target !== checkbox) {
    checkbox.checked = !checkbox.checked;
  }

  // Update visual
  if (checkbox.checked) {
    item.classList.add('selected');
  } else {
    item.classList.remove('selected');
  }

  // Update selected array
  const newsData = JSON.parse(item.dataset.news);
  
  if (checkbox.checked) {
    // Add to selected
    if (!selectedNewsItems.find(n => n.url === newsData.url)) {
      selectedNewsItems.push(newsData);
    }
  } else {
    // Remove from selected
    selectedNewsItems = selectedNewsItems.filter(n => n.url !== newsData.url);
  }

  console.log('Selected news:', selectedNewsItems.length);
}

// UPDATE savePlan() to include news:

async function savePlan() {
  if (!currentTicker) return;
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  const plan = {
    catalysts: selectedCats,
    catalystNote: document.getElementById('cat-custom').value.trim(),
    rating: selectedRating,
    entry: document.getElementById('p-entry').value,
    stop: document.getElementById('p-stop').value,
    target: document.getElementById('p-target').value,
    shares: document.getElementById('p-shares').value || null,
    support: document.getElementById('p-support').value,
    resistance: document.getElementById('p-resist').value,
    notes: document.getElementById('p-notes').value.trim(),
    news: selectedNewsItems, // CRITICAL: Include selected news
    savedAt: new Date().toISOString(),
    status: 'planned'
  };

  try {
    const res = await fetch(WORKER + '/scan/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: currentTicker.ticker, plan })
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    btn.textContent = 'Plan Saved ✓';
    btn.classList.add('saved');

    currentTicker.plan = plan;
    refreshCardInDOM(currentTicker);

    setTimeout(() => closeModal(), 800);
  } catch(e) {
    btn.textContent = 'Save Failed — Retry';
    btn.disabled = false;
    btn.classList.remove('saved');
    console.error(e);
  }
}