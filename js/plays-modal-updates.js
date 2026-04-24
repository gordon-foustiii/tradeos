// IN PLAYS.HTML - Update openPlaysModal function (around line 200)

    function openPlaysModal(idx) {
      const play = _playsCache.plays[idx];
      if (!play) return;

      document.getElementById('pdm-ticker').textContent = play.ticker || '?';
      document.getElementById('pdm-catalyst').textContent = play.catalyst || 'No catalyst logged';

      const fields = [
        ['Setup', play.setup],
        ['Float', play.float],
        ['Rel Volume', play.relVol],
        ['Planned Entry', play.plannedEntry ? '$' + parseFloat(play.plannedEntry).toFixed(2) : null],
        ['Stop Loss', play.stopLoss ? '$' + parseFloat(play.stopLoss).toFixed(2) : null],
        ['Target', play.target ? '$' + parseFloat(play.target).toFixed(2) : null],
        ['Emotion', play.emotion],
        ['Notes', play.notes],
      ].filter(([, v]) => v && String(v).trim());

      let bodyHTML = '';

      // CHART
      const ticker = play.ticker || '?';
      bodyHTML += `
        <div style="margin-bottom:12px;border-radius:10px;overflow:hidden;background:rgba(255,255,255,0.04);">
          <img src="https://finviz.com/chart.ashx?t=${ticker}&ty=c&ta=1&p=i5" alt="${ticker} chart" style="width:100%;height:auto;display:block;" onerror="this.style.display='none'">
        </div>
      `;

      // STATS
      const plannedEntry = parseFloat(play.plannedEntry) || 0;
      const stopLoss = parseFloat(play.stopLoss) || 0;
      const target = parseFloat(play.target) || 0;
      const rr = plannedEntry > 0 && target > plannedEntry ? ((target - plannedEntry) / (plannedEntry - stopLoss)).toFixed(2) : '—';

      bodyHTML += `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
          <div style="background: rgba(255,255,255,0.04); border-radius: 10px; padding: 10px; text-align: center;">
            <div style="font-size: 9px; font-weight: 700; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px;">R/R Ratio</div>
            <div style="font-size: 16px; font-weight: 800; color: #7f5af0;">${rr}</div>
          </div>
          <div style="background: rgba(255,255,255,0.04); border-radius: 10px; padding: 10px; text-align: center;">
            <div style="font-size: 9px; font-weight: 700; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px;">Status</div>
            <div style="font-size: 14px; font-weight: 800; color: #e8e8f0;">${play.status || 'planned'}</div>
          </div>
        </div>
      `;

      // FIELDS
      if (fields.length) {
        bodyHTML += fields.map(([label, value]) => `
          <div style="background: rgba(255,255,255,0.04); border-radius: 10px; padding: 12px;">
            <div style="font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 5px;">${label}</div>
            <div style="font-size: 14px; color: #e8e8f0; line-height: 1.5; word-break: break-word;">${value}</div>
          </div>
        `).join('');
      }

      // ARTICLE LINKS (from plan.news array)
      const articles = play.news || [];
      if (articles.length > 0) {
        bodyHTML += `<div style="border-top: 1px solid rgba(255,255,255,0.06); padding-top: 12px; margin-top: 12px;"><div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(255,255,255,0.3); margin-bottom: 10px;">Articles (${articles.length})</div>`;
        bodyHTML += articles.map(a => {
          const time = a.publishedAt ? new Date(a.publishedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
          return `
            <div style="background: rgba(255,255,255,0.04); border-radius: 10px; padding: 10px; margin-bottom: 8px;">
              <div style="font-size: 12px; font-weight: 700; color: #e8e8f0; margin-bottom: 4px; line-height: 1.4;">${a.title}</div>
              <div style="font-size: 11px; color: rgba(255,255,255,0.4); margin-bottom: 6px;">${a.source} — ${time}</div>
              <a href="${a.url}" target="_blank" style="color: #7f5af0; text-decoration: none; font-size: 11px; font-weight: 700;">Read more →</a>
            </div>
          `;
        }).join('');
        bodyHTML += '</div>';
      }

      document.getElementById('pdm-body').innerHTML = bodyHTML;
      document.getElementById('play-detail-modal').style.display = 'block';
      document.body.style.overflow = 'hidden';
    }
