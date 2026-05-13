// TradeOS API Layer
// Reads from journal (tradeos_journal) localStorage

let tradesCache = null;

/**
 * Load trades directly from journal localStorage
 */
function loadTrades() {
  const journalData = localStorage.getItem('tradeos_journal');
  if (!journalData) {
    return [];
  }
  
  try {
    const trades = JSON.parse(journalData);
    return Array.isArray(trades) ? trades : [];
  } catch (err) {
    console.error('Error parsing journal:', err);
    return [];
  }
}

/**
 * Get all trades
 */
async function getTrades() {
  if (!tradesCache) {
    tradesCache = loadTrades();
  }
  return { trades: tradesCache };
}

/**
 * Calculate stats from journal trades
 */
async function getStats() {
  if (!tradesCache) {
    tradesCache = loadTrades();
  }

  const trades = tradesCache;
  
  if (trades.length === 0) {
    return {
      total: 0,
      winRate: 0,
      totalPnl: 0,
      monthPnl: 0,
      wins: 0,
      losses: 0
    };
  }

  const total = trades.length;
  let wins = 0, losses = 0, totalPnl = 0;

  trades.forEach(t => {
    const entry = parseFloat(t.entryPrice || t.entry || 0);
    const exit = parseFloat(t.currentPrice || t.exit || 0);
    const shares = parseFloat(t.shares || 0);
    const pnl = (exit - entry) * shares;
    
    if (pnl > 0) wins++;
    else if (pnl < 0) losses++;
    totalPnl += pnl;
  });

  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

  // Month P&L - closed trades only from current month
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  let monthPnl = 0;
  trades.forEach(t => {
    // Only count CLOSED trades
    if (t.status !== 'CLOSED') return;
    
    const tradeDate = new Date(t.closedAt || t.timestamp || 0);
    if (tradeDate.getFullYear() === currentYear && tradeDate.getMonth() + 1 === currentMonth) {
      const entry = parseFloat(t.entryPrice || 0);
      const exit = parseFloat(t.currentPrice || 0);
      const shares = parseFloat(t.shares || 0);
      monthPnl += (exit - entry) * shares;
    }
  });

  return {
    total,
    winRate,
    totalPnl: parseFloat(totalPnl.toFixed(2)),
    monthPnl: parseFloat(monthPnl.toFixed(2)),
    wins,
    losses
  };
}

/**
 * Clear cache (call after journal updates)
 */
function clearApiCache() {
  tradesCache = null;
}