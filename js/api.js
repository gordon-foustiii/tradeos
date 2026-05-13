// TradeOS API Layer
// Parses CSV from textarea/localStorage and calculates stats

let tradesCache = null;

/**
 * Parse CSV data
 * Expected format: Ticker,Entry,Exit,Shares,High,Low,Status,Catalyst,Notes,Date
 */
function parseCsvData(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const trades = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = line.split(',');
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
      date: values[9].trim(),
      createdAt: formatDateToISO(values[9].trim())
    };

    // P&L = (exit - entry) * shares
    trade.pnl = (trade.exit - trade.entry) * trade.shares;
    trades.push(trade);
  }

  return trades;
}

/**
 * Convert MM/DD/YY to ISO YYYY-MM-DD
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
 * Get trades from textarea or localStorage
 */
function loadTrades() {
  // Check if CSV is in textarea (for testing)
  const textarea = document.getElementById('csv-textarea');
  if (textarea && textarea.value.trim()) {
    return parseCsvData(textarea.value);
  }
  
  // Otherwise load from localStorage
  const csvData = localStorage.getItem('tradeos_csv_data');
  if (csvData) {
    return parseCsvData(csvData);
  }
  
  return [];
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
 * Calculate stats
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
    if (t.pnl > 0) wins++;
    else if (t.pnl < 0) losses++;
    totalPnl += t.pnl;
  });

  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

  // Month P&L
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  let monthPnl = 0;
  trades.forEach(t => {
    const d = new Date(t.createdAt);
    if (d.getFullYear() === currentYear && d.getMonth() + 1 === currentMonth) {
      monthPnl += t.pnl;
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
 */
function importCsvFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        localStorage.setItem('tradeos_csv_data', e.target.result);
        tradesCache = null;
        resolve({ success: true });
      } catch (err) {
        reject({ error: err.message });
      }
    };
    reader.onerror = () => reject({ error: 'Failed to read file' });
    reader.readAsText(file);
  });
}

/**
 * Clear cache
 */
function clearApiCache() {
  tradesCache = null;
}