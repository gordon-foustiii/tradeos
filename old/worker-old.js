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

    if (url.pathname === '/scan/latest') {
      return getScanLatest(env);
    }
    if (url.pathname === '/news') {
      return handleNews(url);
    }
    if (url.pathname === '/auth/callback') {
      return handleAuthCallback(request, url, env);
    }

    const userId = await verifyAuth(request, env);
    if (!userId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    if (request.method === 'GET') {
      const action = url.searchParams.get('action');
      if (action === 'stats') return getStats(userId, env);
      if (action === 'trades') return getTrades(userId, env);
      return jsonResponse({ error: 'Unknown action' }, 400);
    }

    if (request.method === 'POST') {
      const body = await request.json();
      if (body.action === 'submit') return submitTrade(userId, body, env);
      if (body.action === 'updateTrade') return updateTrade(userId, body, env);
      return jsonResponse({ error: 'Unknown action' }, 400);
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
};

async function handleAuthCallback(request, url, env) {
  const code = request.method === 'POST' 
    ? (await request.json()).code 
    : url.searchParams.get('code');

  if (!code) return jsonResponse({ error: 'No code provided' }, 400);

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: 'https://gordon-foustiii.github.io/tradeos/auth.html',
        grant_type: 'authorization_code'
      })
    });

    const data = await res.json();
    return jsonResponse(data.error ? { error: data.error } : {
      id_token: data.id_token,
      access_token: data.access_token,
      expires_in: data.expires_in
    }, data.error ? 400 : 200);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

async function verifyAuth(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;

  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${auth.substring(7)}`);
    const data = await res.json();
    if (data.aud !== env.GOOGLE_CLIENT_ID || (data.exp && Date.now() / 1000 > data.exp)) return null;
    return data.sub;
  } catch {
    return null;
  }
}

async function getScanLatest(env) {
  try {
    const data = await env.TRADEOS_USERS.get('scan:latest');
    return jsonResponse(data ? JSON.parse(data) : { results: [] });
  } catch (e) {
    return jsonResponse({ error: e.message, results: [] }, 500);
  }
}

async function handleNews(url) {
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return jsonResponse({ error: 'ticker required' }, 400);

  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=10`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!res.ok) return jsonResponse({ error: 'Failed to fetch news', items: [] });

    const data = await res.json();
    const items = (data.news || []).map(item => ({
      title: item.title,
      url: item.link,
      source: item.publisher,
      publishedAt: new Date(item.providerPublishTime * 1000).toISOString()
    }));
    return jsonResponse({ ticker, items });
  } catch (e) {
    return jsonResponse({ error: 'News fetch failed', items: [] }, 500);
  }
}

async function getStats(userId, env) {
  try {
    const data = await env.TRADEOS_USERS.get(`trades:${userId}`);
    if (!data) return jsonResponse({ total: 0, winRate: 0, totalPnl: 0 });
    
    const trades = JSON.parse(data);
    const wins = trades.filter(t => t.pnl > 0).length;
    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const winRate = trades.length ? Math.round((wins / trades.length) * 100) : 0;
    
    return jsonResponse({ total: trades.length, winRate, totalPnl });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

async function getTrades(userId, env) {
  try {
    const data = await env.TRADEOS_USERS.get(`trades:${userId}`);
    return jsonResponse({ trades: data ? JSON.parse(data) : [] });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

async function submitTrade(userId, body, env) {
  try {
    const key = `trades:${userId}`;
    const existing = await env.TRADEOS_USERS.get(key);
    const trades = existing ? JSON.parse(existing) : [];
    const trade = {
      id: Date.now().toString(),
      date: body.date || new Date().toISOString().split('T')[0],
      ticker: body.ticker,
      entry: parseFloat(body.entry) || 0,
      exit: parseFloat(body.exit) || 0,
      qty: parseInt(body.qty) || 0,
      pnl: parseFloat(body.pnl) || 0,
      createdAt: new Date().toISOString()
    };
    trades.push(trade);
    await env.TRADEOS_USERS.put(key, JSON.stringify(trades));
    return jsonResponse({ success: true, trade });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

async function updateTrade(userId, body, env) {
  try {
    const key = `trades:${userId}`;
    const data = await env.TRADEOS_USERS.get(key);
    if (!data) return jsonResponse({ error: 'No trades found' }, 404);
    
    const trades = JSON.parse(data);
    const idx = trades.findIndex(t => t.id === body.id);
    if (idx === -1) return jsonResponse({ error: 'Trade not found' }, 404);
    
    trades[idx] = { ...trades[idx], ...body, updatedAt: new Date().toISOString() };
    await env.TRADEOS_USERS.put(key, JSON.stringify(trades));
    return jsonResponse({ success: true, trade: trades[idx] });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}
