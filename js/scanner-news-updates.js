// ADD THIS SECTION after the savePlan() function (around line 772)

    // ── NEWS SEARCH ──
    let selectedNews = [];

    async function searchNews() {
      const newsBtn = document.getElementById('news-search-btn');
      const newsContainer = document.getElementById('news-results');
      
      newsBtn.disabled = true;
      newsBtn.textContent = 'Searching...';
      newsContainer.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:16px">Loading news...</div>';

      try {
        const res = await fetch(WORKER + '/news?ticker=' + currentTicker.ticker);
        const data = await res.json();
        
        if (!data.items || !data.items.length) {
          newsContainer.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:16px">No news found</div>';
          newsBtn.disabled = false;
          newsBtn.textContent = 'Search News';
          return;
        }

        newsContainer.innerHTML = data.items.map((n, idx) => {
          const time = n.publishedAt ? new Date(n.publishedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
          const isSelected = selectedNews.some(sn => sn.url === n.url);
          return `
            <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:10px;margin-bottom:8px;">
              <div style="display:flex;gap:8px;">
                <input type="checkbox" id="news-${idx}" ${isSelected ? 'checked' : ''} onchange="toggleNewsSelect(${idx}, '${n.title.replace(/'/g, "\\'")}', '${n.url.replace(/'/g, "\\'")}', '${n.source.replace(/'/g, "\\'")}')" style="width:18px;height:18px;cursor:pointer;margin-top:2px;flex-shrink:0;">
                <div style="flex:1;">
                  <div style="font-size:12px;font-weight:700;color:#e8e8f0;margin-bottom:4px;line-height:1.3;">${n.title}</div>
                  <div style="font-size:11px;color:rgba(255,255,255,0.4);">${n.source} — ${time}</div>
                  <a href="${n.url}" target="_blank" style="color:#7f5af0;text-decoration:none;font-size:11px;font-weight:700;margin-top:4px;display:inline-block;">Read →</a>
                </div>
              </div>
            </div>
          `;
        }).join('');
        
        newsBtn.disabled = false;
        newsBtn.textContent = 'Search News';
      } catch(e) {
        newsContainer.innerHTML = `<div style="text-align:center;color:#ef4565;padding:16px">Error: ${e.message}</div>`;
        newsBtn.disabled = false;
        newsBtn.textContent = 'Search News';
        console.error(e);
      }
    }

    function toggleNewsSelect(idx, title, url, source) {
      const checkbox = document.getElementById('news-' + idx);
      if (checkbox.checked) {
        if (!selectedNews.find(n => n.url === url)) {
          selectedNews.push({ title, url, source });
        }
      } else {
        selectedNews = selectedNews.filter(n => n.url !== url);
      }
      updateNewsLinks();
    }

    function updateNewsLinks() {
      const container = document.getElementById('news-links-container');
      if (!selectedNews.length) {
        container.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.3);">No articles selected</div>';
        return;
      }
      container.innerHTML = selectedNews.map(n => `
        <div style="background:rgba(127,90,240,0.1);border:1px solid rgba(127,90,240,0.2);border-radius:8px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <a href="${n.url}" target="_blank" style="color:#7f5af0;text-decoration:none;font-size:12px;font-weight:700;flex:1;line-height:1.3;">${n.title}</a>
          <button onclick="removeNewsLink('${n.url.replace(/'/g, "\\'")}')" style="background:rgba(239,69,101,0.2);border:none;color:#ef4565;width:20px;height:20px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">×</button>
        </div>
      `).join('');
    }

    function removeNewsLink(url) {
      selectedNews = selectedNews.filter(n => n.url !== url);
      document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (cb.value && cb.value.includes(url)) cb.checked = false;
      });
      updateNewsLinks();
    }

// IN THE MODAL HTML (in the catalyst section), ADD THIS:

    <!-- AFTER the catalyst pills and before plan inputs -->
    <div style="margin-bottom:14px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.07);">
      <button id="news-search-btn" onclick="searchNews()" style="width:100%;background:rgba(127,90,240,0.2);border:1px solid rgba(127,90,240,0.4);color:#a78bfa;padding:9px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:10px;">Search News</button>
      <div id="news-results" style="max-height:240px;overflow-y:auto;margin-bottom:10px;"></div>
      <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Selected Articles</div>
      <div id="news-links-container" style="font-size:12px;color:rgba(255,255,255,0.3);">No articles selected</div>
    </div>
