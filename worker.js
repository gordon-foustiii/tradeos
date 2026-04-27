// TradeOS Cloudflare Worker - Stable v2
// All secrets are set via Cloudflare dashboard or wrangler secret put
const GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID || 'SET_VIA_WRANGLER';
const GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET || 'SET_VIA_WRANGLER';
const REDIRECT_URI = env.REDIRECT_URI || 'https://gordon-foustiii.github.io/tradeos/auth.html';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Public scanner endpoints (no auth required)
    if (url.pathname === '/scan/premarket') {
      return scan(null, url, env);
    }
    if (url.pathname === '/scan/latest') {
      return getScanLatest(null, env);
    }
    if (url.pathname === '/scan/history') {
      return getScanHistory(null, env);
    }
    if (url.pathname === '/scan/tickers') {
      return getScanTickers(null, env);
    }

    try {
      if (url.pathname === '/news') {
        return handleNews(url, env);
      }
      if (url.pathname === '/auth/callback') {
        return handleAuthCallback(request, url, env);
      }

      const userId = await verifyAuth(request, env);
      if (!userId && !url.pathname.startsWith('/public')) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      if (request.method === 'GET') {
        return handleGet(url, userId, env);
      } else if (request.method === 'POST') {
        return handlePost(request, url, userId, env);
      }

      return jsonResponse({ error: 'Method not allowed' }, 405);
    } catch (e) {
      console.error('Worker error:', e.message);
      return jsonResponse({ error: e.message }, 500);
    }
  }
};

async function handleAuthCallback(request, url, env) {
  let code;
  if (request.method === 'POST') {
    const body = await request.json();
    code = body.code;
  } else {
    code = url.searchParams.get('code');
  }

  if (!code) return jsonResponse({ error: 'No code provided' }, 400);

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    const tokens = await tokenResponse.json();
    if (tokens.error) return jsonResponse({ error: tokens.error }, 400);

    return jsonResponse({
      id_token: tokens.id_token,
      access_token: tokens.access_token,
      expires_in: tokens.expires_in
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

async function verifyAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  
  try {
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
    const data = await response.json();
    if (data.aud !== GOOGLE_CLIENT_ID) return null;
    if (data.exp && Date.now() / 1000 > data.exp) return null;
    return data.sub;
  } catch (e) {
    return null;
  }
}

async function handleGet(url, userId, env) {
  const action = url.searchParams.get('action');
  if (!action) return jsonResponse({ error: 'Not found' }, 404);
  
  switch (action) {
    case 'stats': return getStats(userId, env);
    case 'trades': return getTrades(userId, env);
    case 'getHabits': return getHabits(userId, env);
    case 'plans': return getPlans(userId, env);
    case 'playbook': return getPlaybook(userId, env);
    case 'watchlist': return getWatchlist(userId, env);
    case 'alerts': return getAlerts(userId, env);
    case 'journal': return getJournal(userId, env);
    case 'performance': return getPerformance(userId, env);
    case 'getPlan': return getPlan(userId, url, env);
    case 'export': return exportTrades(userId, env);
    default: return jsonResponse({ error: 'Unknown action' }, 400);
  }
}

async function handlePost(request, url, userId, env) {
  const body = await request.json();
  const action = body.action || url.searchParams.get('action');
  
  switch (action) {
    case 'submit': return submitTrade(userId, body, env);
    case 'updateTrade': return updateTrade(userId, body, env);
    case 'saveHabits': return saveHabits(userId, body, env);
    case 'savePlaybook': return savePlaybook(userId, body, env);
    case 'saveWatchlist': return saveWatchlist(userId, body, env);
    case 'createAlert': return createAlert(userId, body, env);
    case 'saveJournal': return saveJournal(userId, body, env);
    case 'updatePerformance': return updatePerformance(userId, body, env);
    case 'savePlan': return savePlan(userId, body, env);
    default: return jsonResponse({ error: 'Unknown action' }, 400);
  }
}

// SCANNER
async function scan(userId, url, env) {
  try {
    const apiKey = 'sZY7MF0wbnTHpYgaFqfbn0kfDzzTT5Mo';
    const res = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/gainers?apikey=${apiKey}&limit=50`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );

    if (!res.ok) {
      return jsonResponse({ error: `Polygon error: ${res.status}`, results: [] }, 400);
    }

    const data = await res.json();
    const tickers = data.results || [];

    const results = tickers
      .filter(t => {
        const price = parseFloat(t.lastQuote?.ask) || 0;
        const change = parseFloat(t.todaysChangePercent) || 0;
        return price >= 1 && price <= 20 && change >= 10;
      })
      .map(t => ({
        ticker: t.ticker,
        price: parseFloat(t.lastQuote?.ask).toFixed(2),
        change: parseFloat(t.todaysChangePercent).toFixed(2),
        scannedAt: new Date().toISOString()
      }))
      .sort((a, b) => parseFloat(b.change) - parseFloat(a.change));

    const scannedAt = new Date().toISOString();
    const historyKey = `scan:history:${Date.now()}`;
    await env.TRADEOS_USERS.put(historyKey, JSON.stringify({ scannedAt, count: results.length, tickers: results }), { expirationTtl: 604800 });
    
    const latestKey = 'scan:latest';
    await env.TRADEOS_USERS.put(latestKey, JSON.stringify({ scannedAt, results }));

    return jsonResponse({ scannedAt, results, count: results.length });
  } catch (e) {
    console.error('Scanner error:', e);
    return jsonResponse({ error: e.message, results: [] }, 500);
  }
}

async function getScanLatest(userId, env) {
  const data = await env.TRADEOS_USERS.get('scan:latest');
  if (!data) return jsonResponse({ results: [] });
  return jsonResponse(JSON.parse(data));
}

async function getScanHistory(userId, env) {
  const list = await env.TRADEOS_USERS.list({ prefix: 'scan:history:', limit: 50 });
  const runs = await Promise.all(list.keys.map(async k => {
    const data = await env.TRADEOS_USERS.get(k.name);
    return data ? JSON.parse(data) : null;
  }));
  return jsonResponse({ runs: runs.filter(r => r).sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt)) });
}

async function getScanTickers(userId, env) {
  const data = await env.TRADEOS_USERS.get('scan:latest');
  if (!data) return jsonResponse({ tickers: [] });
  return jsonResponse({ tickers: JSON.parse(data).results || [] });
}

async function handleNews(url, env) {
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return jsonResponse({ error: 'ticker required' }, 400);

  try {
    const response = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=10`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!response.ok) return jsonResponse({ error: 'Failed to fetch news', items: [] });

    const data = await response.json();
    const news = data.news || [];
    const items = news.map(item => ({
      title: item.title,
      url: item.link,
      source: item.publisher,
      publishedAt: new Date(item.providerPublishTime * 1000).toISOString()
    }));
    return jsonResponse({ ticker, items });
  } catch (e) {
    return jsonResponse({ error: 'News fetch failed', items: [] });
  }
}

// TRADES
async function getStats(userId, env) {
  const data = await env.TRADEOS_USERS.get(`trades:${userId}`);
  if (!data) return jsonResponse({ total: 0, winRate: 0, totalPnl: 0 });
  
  const trades = JSON.parse(data);
  const wins = trades.filter(t => (t.pnl || 0) > 0);
  const losses = trades.filter(t => (t.pnl || 0) < 0);
  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const winRate = trades.length > 0 ? Math.round((wins.length / trades.length) * 100) : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const totalMade = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLost = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const best = trades.length > 0 ? Math.max(...trades.map(t => t.pnl || 0)) : 0;
  const tradeDates = [...new Set(trades.map(t => t.date))];
  const avgPerDay = tradeDates.length > 0 ? totalPnl / tradeDates.length : 0;
  
  return jsonResponse({ total: trades.length, winRate, totalPnl, avgWin, avgLoss, totalMade, totalLost, best, avgPerDay });
}

async function getTrades(userId, env) {
  const data = await env.TRADEOS_USERS.get(`trades:${userId}`);
  if (!data) return jsonResponse({ trades: [] });
  return jsonResponse({ trades: JSON.parse(data) });
}

async function submitTrade(userId, body, env) {
  const key = `trades:${userId}`;
  const existing = await env.TRADEOS_USERS.get(key);
  const trades = existing ? JSON.parse(existing) : [];
  const trade = {
    id: Date.now().toString(),
    date: body.date || new Date().toISOString().split('T')[0],
    ticker: body.ticker,
    catalyst: body.catalyst,
    entry: parseFloat(body.entry) || 0,
    exit: parseFloat(body.exit) || 0,
    qty: parseInt(body.qty) || 0,
    pnl: parseFloat(body.pnl) || 0,
    stop: parseFloat(body.stop) || 0,
    target: parseFloat(body.target) || 0,
    setup: body.setup || '',
    notes: body.notes || '',
    status: 'active',
    createdAt: new Date().toISOString()
  };
  trades.push(trade);
  await env.TRADEOS_USERS.put(key, JSON.stringify(trades));
  return jsonResponse({ success: true, trade });
}

async function updateTrade(userId, body, env) {
  const key = `trades:${userId}`;
  const data = await env.TRADEOS_USERS.get(key);
  if (!data) return jsonResponse({ error: 'No trades found' }, 404);
  
  const trades = JSON.parse(data);
  const index = trades.findIndex(t => t.id === body.id);
  if (index === -1) return jsonResponse({ error: 'Trade not found' }, 404);
  
  trades[index] = { ...trades[index], ...body, updatedAt: new Date().toISOString() };
  await env.TRADEOS_USERS.put(key, JSON.stringify(trades));
  return jsonResponse({ success: true, trade: trades[index] });
}

async function exportTrades(userId, env) {
  const data = await env.TRADEOS_USERS.get(`trades:${userId}`);
  const csv = 'Date,Ticker,Entry,Exit,Qty,P&L,Notes\n' + 
    (data ? JSON.parse(data).map(t => `${t.date},${t.ticker},${t.entry},${t.exit},${t.qty},${t.pnl},"${(t.notes || '').replace(/"/g, '""')}"`) : []).join('\n');
  
  return new Response(csv, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="trades.csv"'
    }
  });
}

// HABITS
async function getHabits(userId, env) {
  const data = await env.TRADEOS_USERS.get(`habits:${userId}`);
  return jsonResponse(data ? JSON.parse(data) : []);
}

async function saveHabits(userId, body, env) {
  const key = `habits:${userId}`;
  const existing = await env.TRADEOS_USERS.get(key);
  const habits = existing ? JSON.parse(existing) : [];
  const habit = {
    date: body.date || new Date().toISOString(),
    type: body.type || 'morning',
    items: body.items || [],
    score: body.score || 0,
    createdAt: new Date().toISOString()
  };
  habits.push(habit);
  await env.TRADEOS_USERS.put(key, JSON.stringify(habits));
  return jsonResponse({ success: true, habit });
}

// PLAYBOOK
async function getPlaybook(userId, env) {
  const data = await env.TRADEOS_USERS.get(`playbook:${userId}`);
  return jsonResponse(data ? JSON.parse(data) : { setups: [], rules: [] });
}

async function savePlaybook(userId, body, env) {
  const playbook = {
    setups: body.setups || [],
    rules: body.rules || [],
    updatedAt: new Date().toISOString()
  };
  await env.TRADEOS_USERS.put(`playbook:${userId}`, JSON.stringify(playbook));
  return jsonResponse({ success: true, playbook });
}

// WATCHLIST
async function getWatchlist(userId, env) {
  const data = await env.TRADEOS_USERS.get(`watchlist:${userId}`);
  return jsonResponse(data ? JSON.parse(data) : { tickers: [] });
}

async function saveWatchlist(userId, body, env) {
  const watchlist = {
    tickers: body.tickers || [],
    updatedAt: new Date().toISOString()
  };
  await env.TRADEOS_USERS.put(`watchlist:${userId}`, JSON.stringify(watchlist));
  return jsonResponse({ success: true, watchlist });
}

// ALERTS
async function getAlerts(userId, env) {
  const data = await env.TRADEOS_USERS.get(`alerts:${userId}`);
  return jsonResponse(data ? JSON.parse(data) : { alerts: [] });
}

async function createAlert(userId, body, env) {
  const key = `alerts:${userId}`;
  const existing = await env.TRADEOS_USERS.get(key);
  const alerts = existing ? JSON.parse(existing) : [];
  const alert = {
    id: Date.now().toString(),
    ticker: body.ticker,
    type: body.type,
    value: body.value,
    createdAt: new Date().toISOString()
  };
  alerts.push(alert);
  await env.TRADEOS_USERS.put(key, JSON.stringify(alerts));
  return jsonResponse({ success: true, alert });
}

// JOURNAL
async function getJournal(userId, env) {
  const data = await env.TRADEOS_USERS.get(`journal:${userId}`);
  return jsonResponse(data ? JSON.parse(data) : { entries: [] });
}

async function saveJournal(userId, body, env) {
  const key = `journal:${userId}`;
  const existing = await env.TRADEOS_USERS.get(key);
  const entries = existing ? JSON.parse(existing) : [];
  const entry = {
    id: Date.now().toString(),
    date: body.date || new Date().toISOString(),
    content: body.content,
    tradeId: body.tradeId,
    createdAt: new Date().toISOString()
  };
  entries.push(entry);
  await env.TRADEOS_USERS.put(key, JSON.stringify(entries));
  return jsonResponse({ success: true, entry });
}

// PERFORMANCE
async function getPerformance(userId, env) {
  const data = await env.TRADEOS_USERS.get(`performance:${userId}`);
  return jsonResponse(data ? JSON.parse(data) : { monthly: {}, yearly: {} });
}

async function updatePerformance(userId, body, env) {
  const key = `performance:${userId}`;
  const existing = await env.TRADEOS_USERS.get(key);
  const performance = existing ? JSON.parse(existing) : { monthly: {}, yearly: {} };
  performance.monthly = body.monthly || performance.monthly;
  performance.yearly = body.yearly || performance.yearly;
  performance.updatedAt = new Date().toISOString();
  await env.TRADEOS_USERS.put(key, JSON.stringify(performance));
  return jsonResponse({ success: true, performance });
}

// PLANS
async function getPlans(userId, env) {
  const list = await env.TRADEOS_USERS.list({ prefix: `plan:${userId}:`, limit: 100 });
  const plans = await Promise.all(list.keys.map(async k => {
    const data = await env.TRADEOS_USERS.get(k.name);
    return data ? JSON.parse(data) : null;
  }));
  return jsonResponse({ plans: plans.filter(p => p) });
}

async function getPlan(userId, url, env) {
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return jsonResponse({ error: 'Ticker required' }, 400);
  const data = await env.TRADEOS_USERS.get(`plan:${userId}:${ticker}`);
  if (!data) return jsonResponse({ error: 'Plan not found' }, 404);
  return jsonResponse(JSON.parse(data));
}

async function savePlan(userId, body, env) {
  const { ticker, entry, stop, target, setupQuality, riskReward, articles, notes } = body;
  if (!ticker) return jsonResponse({ error: 'Ticker required' }, 400);
  
  const plan = {
    ticker,
    entry: parseFloat(entry) || 0,
    stop: parseFloat(stop) || 0,
    target: parseFloat(target) || 0,
    setupQuality: setupQuality || 'A',
    riskReward: riskReward || '1:1',
    articles: articles || [],
    notes: notes || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await env.TRADEOS_USERS.put(`plan:${userId}:${ticker}`, JSON.stringify(plan));
  return jsonResponse({ success: true, plan });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}
