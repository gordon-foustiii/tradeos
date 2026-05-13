// TradeOS API Layer
// Loads CSV from localStorage and calculates stats

let tradesCache = null;

/**
 * Parse CSV data from localStorage
 * Expected format: Ticker,Entry,Exit,Shares,High,Low,Status,Catalyst,Notes,Date
 */
function parseCsvData(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',');
  const trades = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    if (values.length < 10) continue;

    const trade = {
      ticker: values[0].trim(),
      entry: parseFloat(values[1]) || 0,
      exit: parseFloat(values[2]) || 0,
      shares: parseInt(values[3]) || 0,
      high: parseFloat(values[4]) || 0,
      low: parseFloat(values[5]) || 0,
      status: values[6].trim(),
      catalyst: values[7].trim(),
      notes: values[8].trim(),
      date: values[9].trim(), // MM/DD/YY format
      createdAt: formatDateToISO(values[9].trim())
    };

    // Calculate P&L: (exit - entry) * shares
    trade.pnl = (trade.exit - trade.entry) * trade.shares;
    
    trades.push(trade);
  }

  return trades;
}

/**
 * Convert MM/DD/YY to ISO format YYYY-MM-DD
 */
function formatDateToISO(dateStr) {
  if (!dateStr) return new Date().toISOString();
  
  const parts = dateStr.split('/');
  if (parts.length !== 3) return new Date().toISOString();
  
  let [month, day, year] = parts;
  year = parseInt(year) < 50 ? '20' + year : '19' + year;
  
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`;
}

/**
 * Load trades from localStorage
 */
function loadTrades() {
  const csvData = localStorage.getItem('tradeos_csv_data');
  if (!csvData) {
    return [];
  }
  return parseCsvData(csvData);
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
 * Calculate statistics from trades
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

  // Total trades
  const total = trades.length;

  // Win/loss count
  let wins = 0;
  let losses = 0;
  let totalPnl = 0;

  trades.forEach(trade => {
    if (trade.pnl > 0) wins++;
    else if (trade.pnl < 0) losses++;
    totalPnl += trade.pnl;
  });

  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

  // Current month P&L
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  let monthPnl = 0;
  trades.forEach(trade => {
    const tradeDate = new Date(trade.createdAt);
    const tradeYear = tradeDate.getFullYear();
    const tradeMonth = tradeDate.getMonth() + 1;

    if (tradeYear === currentYear && tradeMonth === currentMonth) {
      monthPnl += trade.pnl;
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
 * Import CSV file into localStorage
 * Call this when user uploads CSV
 */
function importCsvFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = function(e) {
      try {
        const csvText = e.target.result;
        localStorage.setItem('tradeos_csv_data', csvText);
        tradesCache = null; // Clear cache
        resolve({ success: true, message: 'CSV imported successfully' });
      } catch (err) {
        reject({ success: false, error: err.message });
      }
    };

    reader.onerror = function() {
      reject({ success: false, error: 'Failed to read file' });
    };

    reader.readAsText(file);
  });
}

/**
 * Clear cache (call after import)
 */
function clearApiCache() {
  tradesCache = null;
}

/**
 * Export trades as CSV
 */
function exportTradesAsCsv() {
  if (!tradesCache) {
    tradesCache = loadTrades();
  }

  const header = 'Ticker,Entry,Exit,Shares,High,Low,Status,Catalyst,Notes,Date,P&L\n';
  const rows = tradesCache.map(t => {
    const date = t.date || new Date(t.createdAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
    return `${t.ticker},${t.entry},${t.exit},${t.shares},${t.high},${t.low},${t.status},${t.catalyst},${t.notes},${date},${t.pnl.toFixed(2)}`;
  }).join('\n');

  const csv = header + rows;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `trades_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}