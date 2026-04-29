// =============================================================================
// TradeOS Scanner Worker (Combined)
// Benzinga-powered stock screener + extended hours data aggregator
// =============================================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// API Keys
const IEX_API_KEY = 'pk_live_YOUR_IEX_KEY'; // Get from https://iexcloud.io
const POLYGON_API_KEY = 'PlRZwYUIEzNyxe3uqN7H88yrJlUGPxNL';
const FINNHUB_API_KEY = 'YOUR_FINNHUB_KEY'; // Get from https://finnhub.io

// Screener config
const DEFAULT_FILTERS = {
  priceMin: 1,
  priceMax: 20,
  changePctMin: 10,
  volumeMin: 500_000,
  relVolMin: 2,
  floatMax: 20_000_000,
  mktCapMax: 2_000_000_000,
};

const SCAN_CACHE_TTL_SEC = 60;
const MAX_MOVERS = 200;
const QUOTE_BATCH_SIZE = 100;
const STALE_CACHE_TTL_SEC = 600;
const CACHE_TTL = 60;

// =============================================================================
// Main Router
// =============================================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return jsonResponse(null, 200);
    }

    try {
      // Screener endpoints
      if (url.pathname === "/scan")        return handleScan(url, env);
      if (url.pathname === "/scan/latest") return getScanLatest(env);
      if (url.pathname === "/news")        return handleNews(url, env);

      // Extended hours endpoints
      if (url.pathname.startsWith("/quote/"))  return handleQuoteRoute(url, env);
      if (url.pathname.startsWith("/bars/"))   return handleBarsRoute(url, env);

      if (url.pathname === "/health")      return jsonResponse({ ok: true, time: new Date().toISOString() });

      // Authenticated endpoints
      const userId = await verifyAuth(request, env);
      if (!userId) return jsonResponse({ error: "Unauthorized" }, 401);

      if (request.method === "GET") {
        const action = url.searchParams.get("action");
        if (action === "stats")  return getStats(userId, env);
        if (action === "trades") return getTrades(userId, env);
        return jsonResponse({ error: "Unknown action" }, 400);
      }

      if (request.method === "POST") {
        const body = await request.json();
        if (body.action === "submit")      return submitTrade(userId, body, env);
        if (body.action === "updateTrade") return updateTrade(userId, body, env);
        return jsonResponse({ error: "Unknown action" }, 400);
      }

      return jsonResponse({ error: "Method not allowed" }, 405);
    } catch (err) {
      console.error("Top-level error:", err.stack || err.message);
      return jsonResponse({ error: err.message }, 500);
    }
  },
};

// =============================================================================
// SCANNER: /scan
// =============================================================================
async function handleScan(url, env) {
  if (!env.BENZINGA_API_KEY) {
    return jsonResponse({
      error: "Server misconfigured: BENZINGA_API_KEY secret is not set",
      results: [],
    }, 500);
  }

  const filters = parseFilters(url.searchParams);
  const usingDefaults = JSON.stringify(filters) === JSON.stringify(DEFAULT_FILTERS);

  if (usingDefaults) {
    const cached = await kvGet(env, "scan:latest");
    if (cached) {
      const ageSec = (Date.now() - new Date(cached.timestamp).getTime()) / 1000;
      if (ageSec < SCAN_CACHE_TTL_SEC) {
        return jsonResponse({ ...cached, cached: true, ageSec: Math.round(ageSec) });
      }
    }
  }

  const session = (url.searchParams.get("session") || "REGULAR").toUpperCase();

  let movers;
  try {
    movers = await fetchMovers(env.BENZINGA_API_KEY, session, MAX_MOVERS);
  } catch (e) {
    console.error("fetchMovers error:", e.message);
    return fallbackToCachedScan(env, `movers fetch failed: ${e.message}`);
  }

  const gainers = movers.gainers || [];
  console.log(`Benzinga returned ${gainers.length} gainers`);

  const preSurvivors = gainers
    .map(normalizeMover)
    .filter((m) => prePassesFilters(m, filters));
  console.log(`After pre-filter: ${preSurvivors.length}`);

  if (preSurvivors.length === 0) {
    const empty = {
      results: [],
      timestamp: new Date().toISOString(),
      count: 0,
      moversReturned: gainers.length,
      filters,
      session,
      source: "benzinga",
    };
    if (usingDefaults) await kvPut(env, "scan:latest", empty, STALE_CACHE_TTL_SEC);
    return jsonResponse(empty);
  }

  let quotes = {};
  try {
    quotes = await fetchQuotes(
      env.BENZINGA_API_KEY,
      preSurvivors.map((s) => s.ticker),
    );
  } catch (e) {
    console.error("fetchQuotes error:", e.message);
  }

  const enriched = preSurvivors.map((s) => {
    const q = quotes[s.ticker] || {};
    return {
      ...s,
      float: q.sharesFloat ?? null,
      mktCap: q.marketCap ?? null,
      name: q.companyStandardName || q.name || s.name,
      exchange: q.bzExchange || null,
    };
  });

  const finalResults = enriched
    .filter((r) => postPassesFilters(r, filters))
    .sort((a, b) => b.changePercent - a.changePercent);

  const payload = {
    results: finalResults,
    timestamp: new Date().toISOString(),
    count: finalResults.length,
    moversReturned: gainers.length,
    preFilterSurvivors: preSurvivors.length,
    filters,
    session,
    source: "benzinga",
  };

  if (usingDefaults) await kvPut(env, "scan:latest", payload, STALE_CACHE_TTL_SEC);

  return jsonResponse(payload);
}

// =============================================================================
// EXTENDED HOURS: /quote/:ticker
// =============================================================================
async function handleQuoteRoute(url, env) {
  const ticker = url.pathname.split('/')[2]?.toUpperCase();
  if (!ticker) return jsonResponse({ error: 'Ticker required' }, 400);
  const data = await handleQuote(ticker, env);
  return jsonResponse(data);
}

async function handleQuote(ticker, env) {
  const cacheKey = `quote-${ticker}`;
  const cached = await kvGet(env, cacheKey);
  if (cached) return cached;

  try {
    // Try IEX Cloud first (best extended hours data)
    if (env.IEX_API_KEY && env.IEX_API_KEY.startsWith('pk_')) {
      const iexRes = await fetch(
        `https://cloud.iexapis.com/stable/stock/${ticker}/quote?token=${env.IEX_API_KEY}`
      );

      if (iexRes.ok) {
        const iexData = await iexRes.json();
        const quote = {
          ticker,
          price: iexData.latestPrice || iexData.lastSalePrice,
          bid: iexData.iexBidPrice || iexData.bid,
          bidSize: iexData.iexBidSize || iexData.bidSize,
          ask: iexData.iexAskPrice || iexData.ask,
          askSize: iexData.iexAskSize || iexData.askSize,
          high: iexData.high,
          low: iexData.low,
          volume: iexData.volume,
          timestamp: iexData.latestUpdate || Date.now(),
          marketStatus: iexData.isUSMarketOpen ? 'OPEN' : getMarketStatus(),
          source: 'IEX'
        };

        await kvPut(env, cacheKey, quote, CACHE_TTL);
        return quote;
      }
    }

    // Fallback to Polygon
    const polyRes = await fetch(
      `https://api.polygon.io/v1/last/quote/STOCKS/${ticker}?apiKey=${POLYGON_API_KEY}`
    );

    if (polyRes.ok) {
      const polyData = await polyRes.json();
      if (polyData.status === 'OK' && polyData.result) {
        const quote = {
          ticker,
          price: polyData.result.last,
          bid: polyData.result.bid,
          bidSize: polyData.result.bid_size,
          ask: polyData.result.ask,
          askSize: polyData.result.ask_size,
          timestamp: polyData.result.timestamp,
          marketStatus: getMarketStatus(),
          source: 'Polygon'
        };

        await kvPut(env, cacheKey, quote, CACHE_TTL);
        return quote;
      }
    }

    return { error: 'No data available', ticker };
  } catch (e) {
    console.error(`Quote fetch failed for ${ticker}:`, e.message);
    return { error: e.message, ticker };
  }
}

// =============================================================================
// EXTENDED HOURS: /bars/:ticker
// =============================================================================
async function handleBarsRoute(url, env) {
  const ticker = url.pathname.split('/')[2]?.toUpperCase();
  if (!ticker) return jsonResponse({ error: 'Ticker required' }, 400);
  const data = await handleBars(ticker, env);
  return jsonResponse(data);
}

async function handleBars(ticker, env) {
  const cacheKey = `bars-${ticker}`;
  const cached = await kvGet(env, cacheKey);
  if (cached) return cached;

  try {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];

    // Try IEX Cloud intraday (includes extended hours)
    if (env.IEX_API_KEY && env.IEX_API_KEY.startsWith('pk_')) {
      const iexRes = await fetch(
        `https://cloud.iexapis.com/stable/stock/${ticker}/intraday-prices?token=${env.IEX_API_KEY}`
      );

      if (iexRes.ok) {
        const iexBars = await iexRes.json();
        
        const bars = iexBars
          .filter(b => b.date === dateStr || !b.date)
          .map(b => ({
            time: Math.floor(new Date(b.label).getTime() / 1000),
            open: b.open || b.price,
            high: b.high || b.price,
            low: b.low || b.price,
            close: b.close || b.price,
            volume: b.volume || 0
          }))
          .sort((a, b) => a.time - b.time);

        const result = { ticker, bars, source: 'IEX', count: bars.length };
        await kvPut(env, cacheKey, result, CACHE_TTL);
        return result;
      }
    }

    // Fallback to Polygon extended hours
    const polyRes = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/minute/${dateStr}/${dateStr}?sort=asc&limit=960&apiKey=${POLYGON_API_KEY}`
    );

    if (polyRes.ok) {
      const polyData = await polyRes.json();
      
      const bars = (polyData.results || [])
        .map(b => ({
          time: Math.floor(b.t / 1000),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v
        }))
        .sort((a, b) => a.time - b.time);

      const result = { ticker, bars, source: 'Polygon', count: bars.length };
      await kvPut(env, cacheKey, result, CACHE_TTL);
      return result;
    }

    return { error: 'No bar data available', ticker };
  } catch (e) {
    console.error(`Bars fetch failed for ${ticker}:`, e.message);
    return { error: e.message, ticker };
  }
}

// =============================================================================
// NEWS: /news?ticker=AAPL
// =============================================================================
async function handleNews(url, env) {
  const ticker = url.searchParams.get("ticker");
  if (!ticker) return jsonResponse({ error: "ticker required" }, 400);

  // Prefer Benzinga news if key present, fall back to Yahoo search
  if (env.BENZINGA_API_KEY) {
    try {
      const params = new URLSearchParams({
        token: env.BENZINGA_API_KEY,
        tickers: ticker,
        pageSize: "10",
        displayOutput: "headline",
      });
      const res = await fetch(`https://api.benzinga.com/api/v2/news?${params}`, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        const items = Array.isArray(data)
          ? data.map((n) => ({
              title: n.title,
              url: n.url,
              source: n.author || "Benzinga",
              publishedAt: n.created || n.updated || null,
            }))
          : [];
        if (items.length) return jsonResponse({ ticker, items });
      }
    } catch (e) {
      console.warn("Benzinga news error:", e.message);
    }
  }

  // Fallback: Yahoo search
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=10`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    if (!res.ok) return jsonResponse({ items: [] });
    const data = await res.json();
    const items = (data.news || []).map((item) => ({
      title: item.title,
      url: item.link,
      source: item.publisher,
      publishedAt: item.providerPublishTime
        ? new Date(item.providerPublishTime * 1000).toISOString()
        : null,
    }));
    return jsonResponse({ ticker, items });
  } catch (e) {
    return jsonResponse({ ticker, items: [], error: e.message }, 500);
  }
}

// =============================================================================
// BENZINGA API CLIENTS
// =============================================================================
async function fetchMovers(token, session, maxResults) {
  const params = new URLSearchParams({ token, maxResults: String(maxResults) });
  if (session) params.set("session", session);

  const url = `https://api.benzinga.com/api/v1/market/movers?${params}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Benzinga movers HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.errors) {
    throw new Error(`Benzinga movers error: ${JSON.stringify(data.errors).slice(0, 200)}`);
  }
  return data.result || {};
}

async function fetchQuotes(token, tickers) {
  const out = {};
  for (let i = 0; i < tickers.length; i += QUOTE_BATCH_SIZE) {
    const slice = tickers.slice(i, i + QUOTE_BATCH_SIZE);
    const params = new URLSearchParams({
      token,
      symbols: slice.join(","),
    });
    const url = `https://api.benzinga.com/api/v2/quoteDelayed?${params}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      console.warn(`quoteDelayed HTTP ${res.status} for batch ${i}`);
      continue;
    }
    const data = await res.json();
    if (data && typeof data === "object" && !data.errors) {
      Object.assign(out, data);
    }
  }
  return out;
}

// =============================================================================
// SCREENER FILTERS
// =============================================================================
function parseFilters(searchParams) {
  const numOr = (key, fallback) => {
    const v = searchParams.get(key);
    if (v == null || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    priceMin:     numOr("priceMin",     DEFAULT_FILTERS.priceMin),
    priceMax:     numOr("priceMax",     DEFAULT_FILTERS.priceMax),
    changePctMin: numOr("changePctMin", DEFAULT_FILTERS.changePctMin),
    volumeMin:    numOr("volumeMin",    DEFAULT_FILTERS.volumeMin),
    relVolMin:    numOr("relVolMin",    DEFAULT_FILTERS.relVolMin),
    floatMax:     numOr("floatMax",     DEFAULT_FILTERS.floatMax),
    mktCapMax:    numOr("mktCapMax",    DEFAULT_FILTERS.mktCapMax),
  };
}

function normalizeMover(g) {
  const volume = typeof g.volume === "string" ? Number(g.volume) : g.volume;
  const avgVolume = typeof g.averageVolume === "string"
    ? Number(g.averageVolume)
    : g.averageVolume;
  const price = Number(g.price);
  const changePercent = Number(g.changePercent);
  const changeDollar = Number(g.change);

  const relVol = avgVolume && avgVolume > 0 ? volume / avgVolume : null;

  return {
    ticker: g.symbol,
    name: g.companyName || g.symbol,
    price: round(price, 2),
    change: round(changePercent, 2),
    changePercent: round(changePercent, 2),
    changeDollar: round(changeDollar, 2),
    volume,
    avgVolume,
    relVol: round(relVol, 2),
    sector: g.gicsSectorName || null,
  };
}

function prePassesFilters(m, f) {
  if (m.price == null || m.changePercent == null || m.volume == null) return false;
  if (m.price < f.priceMin || m.price > f.priceMax) return false;
  if (m.changePercent < f.changePctMin) return false;
  if (m.volume < f.volumeMin) return false;
  if (m.relVol == null || m.relVol < f.relVolMin) return false;
  return true;
}

function postPassesFilters(r, f) {
  if (r.float != null && r.float > f.floatMax) return false;
  if (r.mktCap != null && r.mktCap > f.mktCapMax) return false;
  return true;
}

function round(n, digits) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

// =============================================================================
// MARKET STATUS
// =============================================================================
function getMarketStatus() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();

  if (day === 0 || day === 6) return 'CLOSED_WEEKEND';
  if (hour >= 4 && hour < 9) return 'PRE_MARKET';
  if (hour === 9 && now.getMinutes() < 30) return 'PRE_MARKET';
  if (hour >= 9 && hour < 16) {
    if (hour === 9 && now.getMinutes() >= 30) return 'OPEN';
    if (hour > 9 && hour < 16) return 'OPEN';
  }
  if (hour >= 16 && hour < 20) return 'AFTER_HOURS';

  return 'CLOSED';
}

// =============================================================================
// KV CACHE HELPERS
// =============================================================================
async function kvGet(env, key) {
  try {
    const data = await env.TRADEOS_USERS.get(key);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error(`KV get error (${key}):`, e.message);
    return null;
  }
}

async function kvPut(env, key, value, ttlSec) {
  try {
    await env.TRADEOS_USERS.put(key, JSON.stringify(value), { expirationTtl: ttlSec });
  } catch (e) {
    console.error(`KV put error (${key}):`, e.message);
  }
}

async function fallbackToCachedScan(env, reason) {
  try {
    const cached = await kvGet(env, "scan:latest");
    if (cached) {
      return jsonResponse({ ...cached, fallback: true, reason });
    }
  } catch (e) {
    console.error("fallback cache read error:", e.message);
  }
  return jsonResponse({ results: [], error: reason }, 502);
}

async function getScanLatest(env) {
  try {
    const data = await kvGet(env, "scan:latest");
    return jsonResponse(data || { results: [] });
  } catch (e) {
    return jsonResponse({ error: e.message, results: [] }, 500);
  }
}

// =============================================================================
// TRADE JOURNAL
// =============================================================================
async function getStats(userId, env) {
  try {
    const data = await kvGet(env, `trades:${userId}`);
    if (!data) return jsonResponse({ total: 0, winRate: 0, totalPnl: 0 });
    const wins = data.filter((t) => t.pnl > 0).length;
    const totalPnl = data.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const winRate = data.length ? Math.round((wins / data.length) * 100) : 0;
    return jsonResponse({ total: data.length, winRate, totalPnl });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

async function getTrades(userId, env) {
  try {
    const data = await kvGet(env, `trades:${userId}`);
    return jsonResponse({ trades: data || [] });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

async function submitTrade(userId, body, env) {
  try {
    const key = `trades:${userId}`;
    const existing = await kvGet(env, key);
    const trades = existing || [];
    const trade = {
      id: Date.now().toString(),
      date: body.date || new Date().toISOString().split("T")[0],
      ticker: body.ticker,
      entry: parseFloat(body.entry) || 0,
      exit: parseFloat(body.exit) || 0,
      qty: parseInt(body.qty) || 0,
      pnl: parseFloat(body.pnl) || 0,
      createdAt: new Date().toISOString(),
    };
    trades.push(trade);
    await kvPut(env, key, trades);
    return jsonResponse({ success: true, trade });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

async function updateTrade(userId, body, env) {
  try {
    const key = `trades:${userId}`;
    const data = await kvGet(env, key);
    if (!data) return jsonResponse({ error: "No trades found" }, 404);
    const idx = data.findIndex((t) => t.id === body.id);
    if (idx === -1) return jsonResponse({ error: "Trade not found" }, 404);
    data[idx] = { ...data[idx], ...body, updatedAt: new Date().toISOString() };
    await kvPut(env, key, data);
    return jsonResponse({ success: true, trade: data[idx] });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// =============================================================================
// AUTH
// =============================================================================
async function verifyAuth(request, env) {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${auth.substring(7)}`,
    );
    const data = await res.json();
    if (data.aud !== env.GOOGLE_CLIENT_ID) return null;
    if (data.exp && Date.now() / 1000 > data.exp) return null;
    return data.sub;
  } catch {
    return null;
  }
}

// =============================================================================
// RESPONSE HELPER
// =============================================================================
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}