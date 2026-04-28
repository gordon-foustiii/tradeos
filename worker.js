// =============================================================================
// TradeOS Scanner Worker — Benzinga-powered Stock Screener
// =============================================================================
// Architecture (kept deliberately simple and scalable):
//
//   1. GET /api/v1/market/movers  -> top 200 gainers + losers (one call)
//   2. GET /api/v2/quoteDelayed   -> marketCap + sharesFloat for survivors (one call)
//   3. Apply user filters in-memory -> return ranked results
//
// Why this is the right design:
//   - 2 outbound API calls per scan, regardless of universe size
//   - Cloudflare Workers free tier (50 subreq) is plenty
//   - 60s KV cache means N concurrent users = 1 actual scan
//   - Benzinga's movers endpoint already pre-screens to top movers across ALL
//     US exchanges, so we don't miss tickers like the previous Yahoo-trending
//     implementation did
//
// Field mapping (Benzinga -> internal):
//   movers.gainers[].symbol          -> ticker
//   movers.gainers[].price           -> price
//   movers.gainers[].changePercent   -> changePercent (also exposed as `change` for legacy UI)
//   movers.gainers[].change          -> changeDollar
//   movers.gainers[].volume          -> volume (string in API, parsed to int)
//   movers.gainers[].averageVolume   -> avgVolume
//   quote.marketCap                  -> mktCap
//   quote.sharesFloat                -> float
//
// Auth: Benzinga uses ?token=<key> query param. The key lives in the Cloudflare
// secret BENZINGA_API_KEY -- never hardcoded.
// =============================================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ---- Default screener filters (match the reference screener in image 1) ----
const DEFAULT_FILTERS = {
  priceMin: 1,
  priceMax: 20,
  changePctMin: 10,         // >= 10% intraday change
  volumeMin: 500_000,       // >= 500K shares
  relVolMin: 2,             // >= 2x average volume
  floatMax: 20_000_000,     // <= 20M float
  mktCapMax: 2_000_000_000, // <= $2B
};

const SCAN_CACHE_TTL_SEC = 60;   // result cache lifetime
const MAX_MOVERS = 200;          // Benzinga max gainers per call
const QUOTE_BATCH_SIZE = 100;    // Benzinga quoteDelayed accepts comma-separated symbols
const STALE_CACHE_TTL_SEC = 600; // keep stale copy for fallback

// =============================================================================
// Router
// =============================================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      // Public scanner endpoints
      if (url.pathname === "/scan")        return handleScan(url, env);
      if (url.pathname === "/scan/latest") return getScanLatest(env);
      if (url.pathname === "/news")        return handleNews(url, env);
      if (url.pathname === "/health")      return jsonResponse({ ok: true, time: new Date().toISOString() });

      // Authenticated endpoints (trade journal)
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
// /scan -- main screener
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

  // Cache hit only when using default filters
  if (usingDefaults) {
    const cached = await env.TRADEOS_USERS.get("scan:latest");
    if (cached) {
      const parsed = JSON.parse(cached);
      const ageSec = (Date.now() - new Date(parsed.timestamp).getTime()) / 1000;
      if (ageSec < SCAN_CACHE_TTL_SEC) {
        return jsonResponse({ ...parsed, cached: true, ageSec: Math.round(ageSec) });
      }
    }
  }

  // Optional override: ?session=PRE_MARKET|REGULAR|AFTER_MARKET (default: REGULAR)
  const session = (url.searchParams.get("session") || "REGULAR").toUpperCase();

  // ---- Step 1: pull top movers from Benzinga ----
  let movers;
  try {
    movers = await fetchMovers(env.BENZINGA_API_KEY, session, MAX_MOVERS);
  } catch (e) {
    console.error("fetchMovers error:", e.message);
    return fallbackToCachedScan(env, `movers fetch failed: ${e.message}`);
  }

  const gainers = movers.gainers || [];
  console.log(`Benzinga returned ${gainers.length} gainers`);

  // ---- Step 2: pre-filter on fields we already have ----
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
    if (usingDefaults) await safeKvPut(env, "scan:latest", empty, STALE_CACHE_TTL_SEC);
    return jsonResponse(empty);
  }

  // ---- Step 3: enrich survivors with marketCap + float ----
  let quotes = {};
  try {
    quotes = await fetchQuotes(
      env.BENZINGA_API_KEY,
      preSurvivors.map((s) => s.ticker),
    );
  } catch (e) {
    console.error("fetchQuotes error:", e.message);
    // Continue with no enrichment -- we'll just skip the float filter for these
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

  // ---- Step 4: final filter (float + market cap) ----
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

  if (usingDefaults) await safeKvPut(env, "scan:latest", payload, STALE_CACHE_TTL_SEC);

  return jsonResponse(payload);
}

// =============================================================================
// Benzinga API client
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
  // Benzinga accepts comma-separated symbols. Batch in case the survivor list
  // is unusually large (rare, but defensive).
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
// Filter logic
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
  // Benzinga returns volume as a string -- parse it.
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
    change: round(changePercent, 2),       // legacy alias for frontend (it renders with %)
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
  // Float filter: skip when float is unknown rather than reject silently.
  // Tradeoff -- some users want to be strict; this preserves recall.
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
// Cache helpers
// =============================================================================
async function safeKvPut(env, key, value, ttlSec) {
  try {
    await env.TRADEOS_USERS.put(key, JSON.stringify(value), { expirationTtl: ttlSec });
  } catch (e) {
    console.error(`KV put error (${key}):`, e.message);
  }
}

async function fallbackToCachedScan(env, reason) {
  try {
    const cached = await env.TRADEOS_USERS.get("scan:latest");
    if (cached) {
      const parsed = JSON.parse(cached);
      return jsonResponse({ ...parsed, fallback: true, reason });
    }
  } catch (e) {
    console.error("fallback cache read error:", e.message);
  }
  return jsonResponse({ results: [], error: reason }, 502);
}

async function getScanLatest(env) {
  try {
    const data = await env.TRADEOS_USERS.get("scan:latest");
    return jsonResponse(data ? JSON.parse(data) : { results: [] });
  } catch (e) {
    return jsonResponse({ error: e.message, results: [] }, 500);
  }
}

// =============================================================================
// /news -- ticker news (Benzinga-powered)
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
// Auth (Google ID token verification) -- unchanged
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
// Trade journal (unchanged)
// =============================================================================
async function getStats(userId, env) {
  try {
    const data = await env.TRADEOS_USERS.get(`trades:${userId}`);
    if (!data) return jsonResponse({ total: 0, winRate: 0, totalPnl: 0 });
    const trades = JSON.parse(data);
    const wins = trades.filter((t) => t.pnl > 0).length;
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
      date: body.date || new Date().toISOString().split("T")[0],
      ticker: body.ticker,
      entry: parseFloat(body.entry) || 0,
      exit: parseFloat(body.exit) || 0,
      qty: parseInt(body.qty) || 0,
      pnl: parseFloat(body.pnl) || 0,
      createdAt: new Date().toISOString(),
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
    if (!data) return jsonResponse({ error: "No trades found" }, 404);
    const trades = JSON.parse(data);
    const idx = trades.findIndex((t) => t.id === body.id);
    if (idx === -1) return jsonResponse({ error: "Trade not found" }, 404);
    trades[idx] = { ...trades[idx], ...body, updatedAt: new Date().toISOString() };
    await env.TRADEOS_USERS.put(key, JSON.stringify(trades));
    return jsonResponse({ success: true, trade: trades[idx] });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// =============================================================================
// Helpers
// =============================================================================
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
