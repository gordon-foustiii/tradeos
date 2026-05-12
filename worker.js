var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
var POLYGON_API_KEY = "PlRZwYUIEzNyxe3uqN7H88yrJlUGPxNL";
var DEFAULT_FILTERS = {
  priceMin: 1,
  priceMax: 20,
  changePctMin: 10,
  volumeMin: 5e5,
  relVolMin: 2,
  floatMax: 2e7,
  mktCapMax: 2e9
};
var SCAN_CACHE_TTL_SEC = 60;
var MAX_MOVERS = 200;
var QUOTE_BATCH_SIZE = 100;
var STALE_CACHE_TTL_SEC = 600;
var CACHE_TTL = 60;
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    try {
      if (url.pathname === "/scan") return handleScan(url, env);
      if (url.pathname === "/scan/latest") return getScanLatest(env);
      if (url.pathname === "/scan-and-alert") return handleScanAndAlert(url, env);
      if (url.pathname === "/tv-scanner") return handleTVScanner(request, env);
      if (url.pathname === "/discord") return handleDiscordRelay(request, env);
      if (url.pathname === "/auth/callback") return handleAuthCallback(request, env);
      if (url.pathname === "/news") return handleNews(url, env);
      if (url.pathname.startsWith("/quote/")) return handleQuoteRoute(url, env);
      if (url.pathname.startsWith("/bars/")) return handleBarsRoute(url, env);
      if (url.pathname === "/health") return jsonResponse({ ok: true, time: (/* @__PURE__ */ new Date()).toISOString() });
      if (url.pathname === "/") {
        const userId = await verifyAuth(request, env);
        if (!userId) return jsonResponse({ error: "Unauthorized" }, 401);
        if (request.method === "GET") {
          const action = url.searchParams.get("action");
          if (action === "stats") return getStats(userId, env);
          if (action === "trades") return getTrades(userId, env);
          if (action === "getHabits") return getHabits(userId, env);
        }
        if (request.method === "POST") {
          const body = await request.json();
          if (body.action === "submit") return submitTrade(userId, body, env);
          if (body.action === "updateTrade") return updateTrade(userId, body, env);
          if (body.action === "saveHabits") return saveHabits(userId, body, env);
        }
        return jsonResponse({ error: "Unknown action" }, 400);
      }
      return jsonResponse({ error: "Not found" }, 404);
    } catch (err) {
      console.error("Top-level error:", err.stack || err.message);
      return jsonResponse({ error: err.message }, 500);
    }
  }
};
async function handleAuthCallback(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "POST only" }, 405);
  }
  try {
    const body = await request.json();
    const { code, redirect_uri } = body;
    if (!code) {
      return jsonResponse({ error: "Authorization code required" }, 400);
    }
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return jsonResponse({ error: "Server misconfigured: Google secrets missing" }, 500);
    }
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirect_uri || "https://gordon-foustiii.github.io/tradeos/auth.html"
      }).toString()
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.id_token) {
      console.error("Google token error:", data);
      return jsonResponse({ error: data.error_description || data.error || "Token exchange failed" }, 400);
    }
    return jsonResponse({
      id_token: data.id_token,
      access_token: data.access_token || null,
      expires_in: data.expires_in || 3600,
      token_type: data.token_type || "Bearer"
    });
  } catch (err) {
    console.error("Auth callback error:", err.message);
    return jsonResponse({ error: err.message }, 500);
  }
}
__name(handleAuthCallback, "handleAuthCallback");
async function handleScanAndAlert(url, env) {
  if (!env.BENZINGA_API_KEY) {
    return jsonResponse({
      error: "Server misconfigured: BENZINGA_API_KEY secret is not set",
      results: []
    }, 500);
  }
  try {
    const filters = DEFAULT_FILTERS;
    let movers;
    try {
      movers = await fetchMovers(env.BENZINGA_API_KEY, "REGULAR", MAX_MOVERS);
    } catch (e) {
      console.error("fetchMovers error:", e.message);
      return jsonResponse({ error: `Scan failed: ${e.message}` }, 500);
    }
    const gainers = movers.gainers || [];
    const preSurvivors = gainers.map(normalizeMover).filter((m) => prePassesFilters(m, filters));
    if (preSurvivors.length === 0) {
      return jsonResponse({ success: true, count: 0, message: "No results found" });
    }
    let quotes = {};
    try {
      quotes = await fetchQuotes(env.BENZINGA_API_KEY, preSurvivors.map((s) => s.ticker));
    } catch (e) {
      console.error("fetchQuotes error:", e.message);
    }
    const enriched = preSurvivors.map((s) => {
      const q = quotes[s.ticker] || {};
      return {
        ...s,
        float: q.sharesFloat ?? null,
        mktCap: q.marketCap ?? null,
        name: q.companyStandardName || q.name || s.name
      };
    });
    const finalResults = enriched.filter((r) => postPassesFilters(r, filters)).sort((a, b) => b.changePercent - a.changePercent);
    const topTickers = finalResults.slice(0, 15);
    const discordPayload = {
      content: "\u{1F50D} **LIVE SCANNER RESULTS**",
      embeds: [{
        title: `Pre-Market Scan - ${(/* @__PURE__ */ new Date()).toLocaleTimeString("en-US")}`,
        color: 3066993,
        fields: topTickers.map((t) => ({
          name: `${t.ticker} \u2022 $${t.price}`,
          value: `Change: ${t.changePercent}% | Vol: ${formatNumber(t.volume)} | Float: ${formatNumber(t.float)} | Cap: $${formatNumber(t.mktCap)}`,
          inline: false
        })),
        footer: { text: `Total matches: ${finalResults.length} | Source: Benzinga` }
      }]
    };
    const discordWebhook = env.DISCORD_WEBHOOK;
    if (!discordWebhook) {
      return jsonResponse({ error: "DISCORD_WEBHOOK not configured" }, 500);
    }
    const discordRes = await fetch(discordWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload)
    });
    if (!discordRes.ok) {
      console.error("Discord send failed:", discordRes.status);
      return jsonResponse({ error: `Discord error: ${discordRes.status}` }, 500);
    }
    return jsonResponse({
      success: true,
      tickersPosted: topTickers.length,
      totalMatches: finalResults.length
    });
  } catch (err) {
    console.error("Scan and alert error:", err);
    return jsonResponse({ error: err.message }, 500);
  }
}
__name(handleScanAndAlert, "handleScanAndAlert");
__name2(handleScanAndAlert, "handleScanAndAlert");
async function handleTVScanner(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "POST only" }, 405);
  }
  try {
    const body = await request.json();
    const message = body.message || "";
    const lines = message.split("\n").filter((line) => line.trim());
    const tickers = lines.map((line) => {
      const parts = line.split("|").map((p) => p.trim());
      return {
        ticker: parts[0] || "?",
        price: parts[1] || "?",
        change: parts[2] || "?",
        float: parts[3] || "?",
        volume: parts[4] || "?"
      };
    });
    const discordPayload = {
      content: "\u{1F50D} **SCANNER HITS**",
      embeds: [{
        title: `TradingView Alert - ${(/* @__PURE__ */ new Date()).toLocaleTimeString("en-US")}`,
        color: 3066993,
        fields: tickers.map((t) => ({
          name: t.ticker,
          value: `${t.price} | ${t.change} | ${t.float} | ${t.volume}`,
          inline: false
        })),
        footer: { text: "TradingView Premium Webhook" }
      }]
    };
    const discordWebhook = env.DISCORD_WEBHOOK;
    if (!discordWebhook) {
      return jsonResponse({ error: "DISCORD_WEBHOOK not configured" }, 500);
    }
    await fetch(discordWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload)
    });
    return jsonResponse({ success: true, tickersProcessed: tickers.length });
  } catch (err) {
    console.error("TV Scanner error:", err);
    return jsonResponse({ error: err.message }, 500);
  }
}
__name(handleTVScanner, "handleTVScanner");
__name2(handleTVScanner, "handleTVScanner");
async function handleDiscordRelay(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "POST only" }, 405);
  }
  try {
    let body;
    try {
      body = await request.json();
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr.message);
      return jsonResponse({ error: `Invalid JSON: ${parseErr.message}` }, 400);
    }
    const { webhookUrl, payload } = body;
    if (!webhookUrl) {
      return jsonResponse({ error: "Missing webhookUrl" }, 400);
    }
    if (!payload) {
      return jsonResponse({ error: "Missing payload" }, 400);
    }
    console.log("Relaying to Discord:", webhookUrl.slice(0, 50) + "...");
    const discordRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    console.log("Discord response:", discordRes.status);
    if (!discordRes.ok) {
      const discordError = await discordRes.text();
      console.error("Discord error:", discordError);
      return jsonResponse({ error: `Discord error: ${discordRes.status} ${discordError}` }, discordRes.status);
    }
    return jsonResponse({ success: true });
  } catch (err) {
    console.error("Discord relay error:", err.message, err.stack);
    return jsonResponse({ error: err.message }, 500);
  }
}
__name(handleDiscordRelay, "handleDiscordRelay");
__name2(handleDiscordRelay, "handleDiscordRelay");
function formatNumber(n) {
  if (!n) return "N/A";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}
__name(formatNumber, "formatNumber");
__name2(formatNumber, "formatNumber");
async function scanFMP(filters, env) {
  const key = env.FMP_API_KEY;
  let gainers;
  for (const url of [
    `https://financialmodelingprep.com/stable/gainers?apikey=${key}`,
    `https://financialmodelingprep.com/api/v3/stock_market/gainers?apikey=${key}`
  ]) {
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) continue;
    const data = await res.json();
    if (Array.isArray(data)) {
      gainers = data;
      break;
    }
    if (data?.["Error Message"]) throw new Error(`FMP key error: ${data["Error Message"].slice(0, 80)}`);
  }
  if (!gainers) throw new Error("FMP gainers: no valid response from either endpoint");
  const candidates = gainers.filter(
    (g) => g.price >= filters.priceMin && g.price <= filters.priceMax && g.changesPercentage >= filters.changePctMin
  );
  if (candidates.length === 0) return [];
  const symbols = candidates.map((g) => g.symbol).join(",");
  const quoteRes = await fetch(`https://financialmodelingprep.com/api/v3/quote/${symbols}?apikey=${key}`, {
    headers: { "Accept": "application/json" }
  });
  if (!quoteRes.ok) throw new Error(`FMP quote ${quoteRes.status}`);
  const quotes = await quoteRes.json();
  if (!Array.isArray(quotes)) return [];
  return quotes.map((q) => {
    const vol = q.volume || 0;
    const avgVol = q.avgVolume || 0;
    return {
      ticker: q.symbol,
      name: q.name || q.symbol,
      price: round(q.price, 2),
      change: round(q.changesPercentage, 2),
      changePercent: round(q.changesPercentage, 2),
      changeDollar: round(q.change, 2),
      volume: vol,
      avgVolume: avgVol,
      relVol: avgVol > 0 ? round(vol / avgVol, 2) : null,
      float: null,
      mktCap: q.marketCap || null
    };
  });
}
__name(scanFMP, "scanFMP");
__name2(scanFMP, "scanFMP");
async function scanYahooPredefined(env) {
  const res = await fetch(
    "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=day_gainers&count=200&start=0",
    { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } }
  );
  if (!res.ok) throw new Error(`Yahoo predefined screener ${res.status}`);
  const data = await res.json();
  const quotes = data?.finance?.result?.[0]?.quotes || [];
  return quotes.map((q) => {
    const vol = q.regularMarketVolume || 0;
    const avgVol = q.averageDailyVolume3Month || q.averageDailyVolume10Day || 0;
    return {
      ticker: q.symbol,
      name: q.shortName || q.symbol,
      price: round(q.regularMarketPrice, 2),
      change: round(q.regularMarketChangePercent, 2),
      changePercent: round(q.regularMarketChangePercent, 2),
      changeDollar: round(q.regularMarketChange, 2),
      volume: vol,
      avgVolume: avgVol,
      relVol: avgVol > 0 ? round(vol / avgVol, 2) : null,
      float: null,
      mktCap: q.marketCap || null
    };
  });
}
__name(scanYahooPredefined, "scanYahooPredefined");
__name2(scanYahooPredefined, "scanYahooPredefined");
async function handleScan(url, env) {
  const filters = parseFilters(url.searchParams);
  const usingDefaults = JSON.stringify(filters) === JSON.stringify(DEFAULT_FILTERS);
  if (usingDefaults) {
    const cached = await kvGet(env, "scan:latest");
    if (cached) {
      const ageSec = (Date.now() - new Date(cached.timestamp).getTime()) / 1e3;
      if (ageSec < SCAN_CACHE_TTL_SEC) {
        return jsonResponse({ ...cached, cached: true, ageSec: Math.round(ageSec) });
      }
    }
  }
  let results = [];
  let source = "";
  let universeSize = 0;
  if (env.BENZINGA_API_KEY) {
    try {
      const session = (url.searchParams.get("session") || "REGULAR").toUpperCase();
      const movers = await fetchMovers(env.BENZINGA_API_KEY, session, MAX_MOVERS);
      const gainers = movers.gainers || [];
      universeSize = gainers.length;
      console.log(`Benzinga returned ${gainers.length} gainers`);
      const preSurvivors = gainers.map(normalizeMover).filter((m) => prePassesFilters(m, filters));
      let quotes = {};
      try {
        quotes = await fetchQuotes(env.BENZINGA_API_KEY, preSurvivors.map((s) => s.ticker));
      } catch (e) {
        console.error("fetchQuotes error:", e.message);
      }
      const enriched = preSurvivors.map((s) => {
        const q = quotes[s.ticker] || {};
        return { ...s, float: q.sharesFloat ?? null, mktCap: q.marketCap ?? null, name: q.companyStandardName || q.name || s.name, exchange: q.bzExchange || null };
      });
      results = enriched.filter((r) => postPassesFilters(r, filters)).sort((a, b) => b.changePercent - a.changePercent);
      source = "benzinga";
    } catch (e) {
      console.error("Benzinga scan failed, falling back to Yahoo:", e.message);
    }
  }
  if (!source && env.FMP_API_KEY) {
    try {
      const raw = await scanFMP(filters, env);
      universeSize = raw.length;
      results = raw.filter((r) => prePassesFilters(r, filters)).filter((r) => postPassesFilters(r, filters)).sort((a, b) => b.changePercent - a.changePercent);
      source = "fmp";
    } catch (e) {
      console.error("FMP scan failed:", e.message);
    }
  }
  if (!source) {
    try {
      const raw = await scanYahooPredefined(env);
      universeSize = raw.length;
      results = raw.filter((r) => prePassesFilters(r, filters)).sort((a, b) => b.changePercent - a.changePercent);
      source = "yahoo_limited";
    } catch (e) {
      console.error("Yahoo predefined scan failed:", e.message);
      return fallbackToCachedScan(env, `All sources failed: ${e.message}`);
    }
  }
  const payload = {
    results,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    count: results.length,
    universeSize,
    filters,
    source
  };
  if (usingDefaults) await kvPut(env, "scan:latest", payload, STALE_CACHE_TTL_SEC);
  return jsonResponse(payload);
}
__name(handleScan, "handleScan");
__name2(handleScan, "handleScan");
async function handleQuoteRoute(url, env) {
  const ticker = url.pathname.split("/")[2]?.toUpperCase();
  if (!ticker) return jsonResponse({ error: "Ticker required" }, 400);
  const data = await handleQuote(ticker, env);
  return jsonResponse(data);
}
__name(handleQuoteRoute, "handleQuoteRoute");
__name2(handleQuoteRoute, "handleQuoteRoute");
async function handleQuote(ticker, env) {
  const cacheKey = `quote-${ticker}`;
  const cached = await kvGet(env, cacheKey);
  if (cached) return cached;
  try {
    if (env.IEX_API_KEY && env.IEX_API_KEY.startsWith("pk_")) {
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
          marketStatus: iexData.isUSMarketOpen ? "OPEN" : getMarketStatus(),
          source: "IEX"
        };
        await kvPut(env, cacheKey, quote, CACHE_TTL);
        return quote;
      }
    }
    const polyRes = await fetch(
      `https://api.polygon.io/v1/last/quote/STOCKS/${ticker}?apiKey=${POLYGON_API_KEY}`
    );
    if (polyRes.ok) {
      const polyData = await polyRes.json();
      if (polyData.status === "OK" && polyData.result) {
        const quote = {
          ticker,
          price: polyData.result.last,
          bid: polyData.result.bid,
          bidSize: polyData.result.bid_size,
          ask: polyData.result.ask,
          askSize: polyData.result.ask_size,
          timestamp: polyData.result.timestamp,
          marketStatus: getMarketStatus(),
          source: "Polygon"
        };
        await kvPut(env, cacheKey, quote, CACHE_TTL);
        return quote;
      }
    }
    return { error: "No data available", ticker };
  } catch (e) {
    console.error(`Quote fetch failed for ${ticker}:`, e.message);
    return { error: e.message, ticker };
  }
}
__name(handleQuote, "handleQuote");
__name2(handleQuote, "handleQuote");
async function handleBarsRoute(url, env) {
  const ticker = url.pathname.split("/")[2]?.toUpperCase();
  if (!ticker) return jsonResponse({ error: "Ticker required" }, 400);
  const data = await handleBars(ticker, env);
  return jsonResponse(data);
}
__name(handleBarsRoute, "handleBarsRoute");
__name2(handleBarsRoute, "handleBarsRoute");
async function handleBars(ticker, env) {
  const cacheKey = `bars-${ticker}`;
  const cached = await kvGet(env, cacheKey);
  if (cached) return cached;
  try {
    const today = /* @__PURE__ */ new Date();
    const dateStr = today.toISOString().split("T")[0];
    if (env.IEX_API_KEY && env.IEX_API_KEY.startsWith("pk_")) {
      const iexRes = await fetch(
        `https://cloud.iexapis.com/stable/stock/${ticker}/intraday-prices?token=${env.IEX_API_KEY}`
      );
      if (iexRes.ok) {
        const iexBars = await iexRes.json();
        const bars = iexBars.filter((b) => b.date === dateStr || !b.date).map((b) => ({
          time: Math.floor(new Date(b.label).getTime() / 1e3),
          open: b.open || b.price,
          high: b.high || b.price,
          low: b.low || b.price,
          close: b.close || b.price,
          volume: b.volume || 0
        })).sort((a, b) => a.time - b.time);
        const result = { ticker, bars, source: "IEX", count: bars.length };
        await kvPut(env, cacheKey, result, CACHE_TTL);
        return result;
      }
    }
    const polyRes = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/minute/${dateStr}/${dateStr}?sort=asc&limit=960&apiKey=${POLYGON_API_KEY}`
    );
    if (polyRes.ok) {
      const polyData = await polyRes.json();
      const bars = (polyData.results || []).map((b) => ({
        time: Math.floor(b.t / 1e3),
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v
      })).sort((a, b) => a.time - b.time);
      const result = { ticker, bars, source: "Polygon", count: bars.length };
      await kvPut(env, cacheKey, result, CACHE_TTL);
      return result;
    }
    return { error: "No bar data available", ticker };
  } catch (e) {
    console.error(`Bars fetch failed for ${ticker}:`, e.message);
    return { error: e.message, ticker };
  }
}
__name(handleBars, "handleBars");
__name2(handleBars, "handleBars");
async function handleNews(url, env) {
  const ticker = url.searchParams.get("ticker");
  if (!ticker) return jsonResponse({ error: "ticker required" }, 400);
  if (env.BENZINGA_API_KEY) {
    try {
      const params = new URLSearchParams({
        token: env.BENZINGA_API_KEY,
        tickers: ticker,
        pageSize: "10",
        displayOutput: "headline"
      });
      const res = await fetch(`https://api.benzinga.com/api/v2/news?${params}`, {
        headers: { Accept: "application/json" }
      });
      if (res.ok) {
        const data = await res.json();
        const items = Array.isArray(data) ? data.map((n) => ({
          title: n.title,
          url: n.url,
          source: n.author || "Benzinga",
          publishedAt: n.created || n.updated || null
        })) : [];
        if (items.length) return jsonResponse({ ticker, items });
      }
    } catch (e) {
      console.warn("Benzinga news error:", e.message);
    }
  }
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=10`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!res.ok) return jsonResponse({ items: [] });
    const data = await res.json();
    const items = (data.news || []).map((item) => ({
      title: item.title,
      url: item.link,
      source: item.publisher,
      publishedAt: item.providerPublishTime ? new Date(item.providerPublishTime * 1e3).toISOString() : null
    }));
    return jsonResponse({ ticker, items });
  } catch (e) {
    return jsonResponse({ ticker, items: [], error: e.message }, 500);
  }
}
__name(handleNews, "handleNews");
__name2(handleNews, "handleNews");
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
__name(fetchMovers, "fetchMovers");
__name2(fetchMovers, "fetchMovers");
async function fetchQuotes(token, tickers) {
  const out = {};
  for (let i = 0; i < tickers.length; i += QUOTE_BATCH_SIZE) {
    const slice = tickers.slice(i, i + QUOTE_BATCH_SIZE);
    const params = new URLSearchParams({
      token,
      symbols: slice.join(",")
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
__name(fetchQuotes, "fetchQuotes");
__name2(fetchQuotes, "fetchQuotes");
function parseFilters(searchParams) {
  const numOr = /* @__PURE__ */ __name2((key, fallback) => {
    const v = searchParams.get(key);
    if (v == null || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }, "numOr");
  return {
    priceMin: numOr("priceMin", DEFAULT_FILTERS.priceMin),
    priceMax: numOr("priceMax", DEFAULT_FILTERS.priceMax),
    changePctMin: numOr("changePctMin", DEFAULT_FILTERS.changePctMin),
    volumeMin: numOr("volumeMin", DEFAULT_FILTERS.volumeMin),
    relVolMin: numOr("relVolMin", DEFAULT_FILTERS.relVolMin),
    floatMax: numOr("floatMax", DEFAULT_FILTERS.floatMax),
    mktCapMax: numOr("mktCapMax", DEFAULT_FILTERS.mktCapMax)
  };
}
__name(parseFilters, "parseFilters");
__name2(parseFilters, "parseFilters");
function normalizeMover(g) {
  const volume = typeof g.volume === "string" ? Number(g.volume) : g.volume;
  const avgVolume = typeof g.averageVolume === "string" ? Number(g.averageVolume) : g.averageVolume;
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
    sector: g.gicsSectorName || null
  };
}
__name(normalizeMover, "normalizeMover");
__name2(normalizeMover, "normalizeMover");
function prePassesFilters(m, f) {
  if (m.price == null || m.changePercent == null || m.volume == null) return false;
  if (m.price < f.priceMin || m.price > f.priceMax) return false;
  if (m.changePercent < f.changePctMin) return false;
  if (m.volume < f.volumeMin) return false;
  if (m.relVol != null && m.relVol < f.relVolMin) return false;
  return true;
}
__name(prePassesFilters, "prePassesFilters");
__name2(prePassesFilters, "prePassesFilters");
function postPassesFilters(r, f) {
  if (r.float != null && r.float > f.floatMax) return false;
  if (r.mktCap != null && r.mktCap > f.mktCapMax) return false;
  return true;
}
__name(postPassesFilters, "postPassesFilters");
__name2(postPassesFilters, "postPassesFilters");
function round(n, digits) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}
__name(round, "round");
__name2(round, "round");
function getMarketStatus() {
  const now = /* @__PURE__ */ new Date();
  const hour = now.getHours();
  const day = now.getDay();
  if (day === 0 || day === 6) return "CLOSED_WEEKEND";
  if (hour >= 4 && hour < 9) return "PRE_MARKET";
  if (hour === 9 && now.getMinutes() < 30) return "PRE_MARKET";
  if (hour >= 9 && hour < 16) {
    if (hour === 9 && now.getMinutes() >= 30) return "OPEN";
    if (hour > 9 && hour < 16) return "OPEN";
  }
  if (hour >= 16 && hour < 20) return "AFTER_HOURS";
  return "CLOSED";
}
__name(getMarketStatus, "getMarketStatus");
__name2(getMarketStatus, "getMarketStatus");
async function kvGet(env, key) {
  try {
    const data = await env.TRADEOS_USERS.get(key);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error(`KV get error (${key}):`, e.message);
    return null;
  }
}
__name(kvGet, "kvGet");
__name2(kvGet, "kvGet");
async function kvPut(env, key, value, ttlSec) {
  try {
    await env.TRADEOS_USERS.put(key, JSON.stringify(value), { expirationTtl: ttlSec });
  } catch (e) {
    console.error(`KV put error (${key}):`, e.message);
  }
}
__name(kvPut, "kvPut");
__name2(kvPut, "kvPut");
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
__name(fallbackToCachedScan, "fallbackToCachedScan");
__name2(fallbackToCachedScan, "fallbackToCachedScan");
async function getScanLatest(env) {
  try {
    const data = await kvGet(env, "scan:latest");
    return jsonResponse(data || { results: [] });
  } catch (e) {
    return jsonResponse({ error: e.message, results: [] }, 500);
  }
}
__name(getScanLatest, "getScanLatest");
__name2(getScanLatest, "getScanLatest");
async function verifyAuth(request, env) {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${auth.substring(7)}`);
    const data = await res.json();
    if (data.aud !== env.GOOGLE_CLIENT_ID) return null;
    if (data.exp && Date.now() / 1e3 > data.exp) return null;
    return data.sub;
  } catch {
    return null;
  }
}
__name(verifyAuth, "verifyAuth");
async function getStats(userId, env) {
  try {
    const data = await env.TRADEOS_USERS.get(`trades:${userId}`);
    if (!data) return jsonResponse({ total: 0, winRate: 0, totalPnl: 0 });
    const trades = JSON.parse(data);
    const wins = trades.filter((t) => t.pnl > 0).length;
    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const winRate = trades.length ? Math.round(wins / trades.length * 100) : 0;
    return jsonResponse({ total: trades.length, winRate, totalPnl });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}
__name(getStats, "getStats");
async function getTrades(userId, env) {
  try {
    const data = await env.TRADEOS_USERS.get(`trades:${userId}`);
    return jsonResponse({ trades: data ? JSON.parse(data) : [] });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}
__name(getTrades, "getTrades");
async function submitTrade(userId, body, env) {
  try {
    const key = `trades:${userId}`;
    const existing = await env.TRADEOS_USERS.get(key);
    const trades = existing ? JSON.parse(existing) : [];
    const trade = {
      id: Date.now().toString(),
      date: body.date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      ticker: body.ticker,
      entry: parseFloat(body.entry) || 0,
      exit: parseFloat(body.exit) || 0,
      qty: parseInt(body.qty) || 0,
      pnl: parseFloat(body.pnl) || 0,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    trades.push(trade);
    await env.TRADEOS_USERS.put(key, JSON.stringify(trades));
    return jsonResponse({ success: true, trade });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}
__name(submitTrade, "submitTrade");
async function updateTrade(userId, body, env) {
  try {
    const key = `trades:${userId}`;
    const data = await env.TRADEOS_USERS.get(key);
    if (!data) return jsonResponse({ error: "No trades found" }, 404);
    const trades = JSON.parse(data);
    const idx = trades.findIndex((t) => t.id === body.id);
    if (idx === -1) return jsonResponse({ error: "Trade not found" }, 404);
    trades[idx] = { ...trades[idx], ...body, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    await env.TRADEOS_USERS.put(key, JSON.stringify(trades));
    return jsonResponse({ success: true, trade: trades[idx] });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}
__name(updateTrade, "updateTrade");
async function getHabits(userId, env) {
  try {
    const data = await env.TRADEOS_USERS.get(`habits:${userId}`);
    return jsonResponse(data ? JSON.parse(data) : null);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}
__name(getHabits, "getHabits");
async function saveHabits(userId, body, env) {
  try {
    const { action: _action, ...habits } = body;
    await env.TRADEOS_USERS.put(`habits:${userId}`, JSON.stringify(habits));
    return jsonResponse({ success: true });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}
__name(saveHabits, "saveHabits");
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}
__name(jsonResponse, "jsonResponse");
__name2(jsonResponse, "jsonResponse");
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
