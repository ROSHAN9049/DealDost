const $ = (id) => document.getElementById(id);

let currentMode = ["PAPER", "TESTNET", "LIVE"].includes(localStorage.getItem("dealdost.mode"))
  ? localStorage.getItem("dealdost.mode")
  : "PAPER";
let testnetAuto = localStorage.getItem("dealdost.testnetAuto") === "true";
let liveAuto = localStorage.getItem("dealdost.liveAuto") === "true";
let paperAuto = localStorage.getItem("dealdost.paperAuto") === "true";
let emergencyStop = localStorage.getItem("dealdost.emergencyStop") === "true";
let analyticsLoading = false;
let lastAnalyticsLoadedAt = 0;

const fmt = (n) =>
  Number.isFinite(Number(n))
    ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 })
    : "—";

const money = (n) => "$" + fmt(Number(n));

function savePaperRuntime(state) {
  try {
    localStorage.setItem("dealdost.paperState", JSON.stringify(state.paper ?? null));
    localStorage.setItem("dealdost.rotationState", JSON.stringify(state.rotation ?? null));
  } catch {}
}

function loadPaperRuntime() {
  try {
    return {
      paperState: JSON.parse(localStorage.getItem("dealdost.paperState") || "null"),
      rotationState: JSON.parse(localStorage.getItem("dealdost.rotationState") || "null")
    };
  } catch {
    return { paperState: null, rotationState: null };
  }
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));

let directBinanceBlockedUntil = 0;
let browserIngestInFlight = false;

async function fetchDirectBinance(path) {
  const now = Date.now();
  if (now < directBinanceBlockedUntil) {
    throw new Error("Binance REST backoff active");
  }

  const bases = [
    "https://fapi.binance.com",
    "https://fapi1.binance.com",
    "https://fapi2.binance.com",
    "https://fapi3.binance.com"
  ];
  let lastError = null;
  for (const base of bases) {
    try {
      const response = await fetch(base + path, { cache: "no-store" });
      if (!response.ok) {
        const retryAfter = Number(response.headers.get("retry-after") || 0);
        if (response.status === 429 || response.status === 418) {
          directBinanceBlockedUntil = Date.now() + Math.max(15000, (retryAfter || 30) * 1000);
          throw new Error(base + " HTTP " + response.status + " • backoff active");
        }
        throw new Error(base + " HTTP " + response.status);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (String(error?.message || "").includes("backoff active")) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Binance market API unavailable");
}

async function directScannerFallback() {
  if (browserIngestInFlight) return;
  browserIngestInFlight = true;
  const requestMode = currentMode;
  const requestToken = modeChangeToken;
  const ticker = await fetchDirectTicker();
  const top = ticker
    .filter((t) => t.symbol.endsWith("USDT") && !/_\d{6}$/.test(t.symbol) && Number(t.quoteVolume) >= 10000000)
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, 50);

  const cursor = Number(localStorage.getItem("dealdost.scannerCursor") || "0");
  const btcIndex = top.findIndex((t) => t.symbol === "BTCUSDT");
  const index = cursor === 0 && btcIndex >= 0 ? btcIndex : cursor % Math.max(top.length, 1);
  const selected = top[index];
  if (!selected) throw new Error("No eligible Binance futures symbols");

  const marketSymbol = "BTCUSDT";
  const [m1, m5, m15] = await Promise.all([
    fetchDirectBinance("/fapi/v1/klines?symbol=" + selected.symbol + "&interval=1m&limit=120"),
    fetchDirectBinance("/fapi/v1/klines?symbol=" + selected.symbol + "&interval=5m&limit=120"),
    fetchDirectBinance("/fapi/v1/klines?symbol=" + selected.symbol + "&interval=15m&limit=120")
  ]);

  // BTC context is useful for the global regime but must never prevent the
  // selected-symbol scanner from updating when this extra request fails.
  let btc15 = m15;
  if (selected.symbol !== marketSymbol) {
    try {
      btc15 = await fetchDirectBinance(
        "/fapi/v1/klines?symbol=" + marketSymbol + "&interval=15m&limit=120"
      );
    } catch {
      btc15 = [];
    }
  }

  localStorage.setItem("dealdost.scannerCursor", String((index + 1) % top.length));

  const toCandle = (row) => ({
    openTime: Number(row[0]),
    closeTime: Number(row[6]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    quoteVolume: Number(row[7]),
    trades: Number(row[8])
  });

  if (requestToken !== modeChangeToken || requestMode !== currentMode) return;

  const response = await fetch("/api/market/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      mode: requestMode,
      auto: requestMode === "PAPER" ? paperAuto : requestMode === "TESTNET" ? testnetAuto : liveAuto,
      paperAuto,
      testnetAuto,
      liveAuto,
      emergencyStop,
      ...loadPaperRuntime(),
      universe: top.map((t) => ({
        symbol: t.symbol,
        quoteVolume: Number(t.quoteVolume),
        lastPrice: Number(t.lastPrice)
      })),
      symbol: selected.symbol,
      candles: {
        "1m": m1.map(toCandle),
        "5m": m5.map(toCandle),
        "15m": m15.map(toCandle)
      },
      btc15m: btc15.map(toCandle)
    })
  });

  if (!response.ok) throw new Error("Signal ingest HTTP " + response.status);
  const state = await response.json();
  if (requestMode !== currentMode) return; // newer mode selection wins
  render(state);
  } finally {
    browserIngestInFlight = false;
  }
}

async function directBinanceFallback() {
  const ticker = await fetchDirectTicker();
  const top = ticker
    .filter((t) => t.symbol.endsWith("USDT") && !/_\d{6}$/.test(t.symbol) && Number(t.quoteVolume) >= 10000000)
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, 50);
  const btc = top.find((t) => t.symbol === "BTCUSDT");
  $("regime").textContent = "WAITING";
  $("btc").textContent = btc ? fmt(Number(btc.lastPrice)) : "—";
  $("ws").textContent = "REST ONLINE";
  $("ws").className = "status ok";
  $("data").textContent = "FRESH • direct Binance fallback";
  $("data").className = "muted";
  $("universe").textContent = top.length;
}

function friendlyBinanceError(message) {
  const value = String(message || "");
  if (value.includes("-2015") || value.includes("Invalid API-key")) {
    return "BINANCE AUTH ERROR (-2015): TESTNET key, IP restriction, or permissions are invalid.";
  }
  if (value.includes("429") || value.includes("-1003")) {
    return "BINANCE RATE LIMIT (429): REST backoff active; scanner uses cached/low-frequency market requests.";
  }
  if (value.includes("-4120")) {
    return "BINANCE CONDITIONAL ORDER API ERROR (-4120): outdated conditional-order endpoint.";
  }
  return value;
}

function showApiError(message) {
  const isTestnet = currentMode === "TESTNET";
  const target = isTestnet ? $("testnetError") : $("data");
  if (target) {
    target.textContent = friendlyBinanceError(message);
    target.className = "muted error";
    if (isTestnet) target.hidden = false;
  }
}

async function setMode(mode) {
  const auto = mode === "PAPER" ? paperAuto : mode === "TESTNET" ? testnetAuto : liveAuto;
  const token = ++modeChangeToken;
  const previousMode = currentMode;

  ["paperMode", "testnetMode", "liveMode"].forEach((id) => {
    const button = $(id);
    if (button) button.disabled = true;
  });

  // Set the requested mode immediately so newly-started polling/ingestion
  // requests cannot carry the old mode while the POST is in flight.
  currentMode = mode;
  localStorage.setItem("dealdost.mode", currentMode);

  try {
    const response = await fetch("/api/mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ mode, auto, paperAuto, testnetAuto, liveAuto, emergencyStop })
    });
    if (!response.ok) {
      let detail = "HTTP " + response.status;
      try { const body = await response.json(); if (body?.error) detail += " • " + body.error; } catch {}
      throw new Error(detail);
    }

    if (token !== modeChangeToken || currentMode !== mode) return;
    render(await response.json());
  } catch (error) {
    if (token === modeChangeToken) {
      currentMode = previousMode;
      localStorage.setItem("dealdost.mode", currentMode);
      showApiError("Mode change failed: " + (error instanceof Error ? error.message : String(error)));
    }
  } finally {
    ["paperMode", "testnetMode", "liveMode"].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = false;
    });
  }
}

async function togglePaperAuto() {
  const enabled = !paperAuto;
  paperAuto = enabled;
  localStorage.setItem("dealdost.paperAuto", String(enabled));

  $("paperAuto").disabled = true;
  try {
    const response = await fetch("/api/mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: currentMode,
        auto: enabled,
        paperAuto,
        testnetAuto,
        emergencyStop
      })
    });
    if (response.ok) render(await response.json());
    else showApiError("API error: HTTP " + response.status);
  } catch (error) {
    showApiError("API error: " + (error instanceof Error ? error.message : String(error)));
  } finally {
    $("paperAuto").disabled = false;
  }
}

async function toggleTestnetAuto() {
  if ($("testnetAuto").dataset.executionEnabled !== "true") {
    showApiError("TESTNET execution is READ ONLY. Enable BINANCE_TESTNET_EXECUTION_ENABLED first.");
    return;
  }

  const enabled = !testnetAuto;
  testnetAuto = enabled;
  localStorage.setItem("dealdost.testnetAuto", String(enabled));

  $("testnetAuto").disabled = true;
  try {
    const response = await fetch("/api/mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "TESTNET",
        auto: enabled,
        paperAuto,
        testnetAuto,
        emergencyStop
      })
    });
    if (response.ok) render(await response.json());
    else showApiError("API error: HTTP " + response.status);
  } catch (error) {
    showApiError("API error: " + (error instanceof Error ? error.message : String(error)));
  } finally {
    $("testnetAuto").disabled = false;
  }
}

async function toggleLiveAuto() {
  if ($("liveAuto").dataset.executionEnabled !== "true") {
    showApiError("LIVE execution is locked. Enable BINANCE_LIVE_EXECUTION_ENABLED only after reviewing the 16-gate safety path.");
    return;
  }

  const enabled = !liveAuto;
  liveAuto = enabled;
  localStorage.setItem("dealdost.liveAuto", String(enabled));

  $("liveAuto").disabled = true;
  try {
    const response = await fetch("/api/mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "LIVE",
        auto: enabled,
        paperAuto,
        liveAuto,
        emergencyStop
      })
    });
    if (response.ok) render(await response.json());
    else showApiError("API error: HTTP " + response.status);
  } catch (error) {
    showApiError("API error: " + (error instanceof Error ? error.message : String(error)));
  } finally {
    $("liveAuto").disabled = false;
  }
}


async function toggleEmergencyStop() {
  const enabled = !emergencyStop;
  $("emergencyStop").disabled = true;
  try {
    const response = await fetch("/api/risk/emergency-stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || ("HTTP " + response.status));
    emergencyStop = Boolean(body?.risk?.emergencyStop ?? enabled);
    localStorage.setItem("dealdost.emergencyStop", String(emergencyStop));
    render(body);
  } catch (error) {
    showApiError("Entry stop failed: " + (error instanceof Error ? error.message : String(error)));
  } finally {
    $("emergencyStop").disabled = false;
  }
}

async function loadAccountAnalytics(force = false) {
  if (analyticsLoading) return;
  if (currentMode === "PAPER") return;
  if (!force && Date.now() - lastAnalyticsLoadedAt < 60000) return;

  analyticsLoading = true;
  try {
    const response = await fetch("/api/analytics?mode=" + encodeURIComponent(currentMode) + "&days=30", {
      cache: "no-store"
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || ("HTTP " + response.status));
    lastAnalyticsLoadedAt = Date.now();
    renderAccountAnalytics(body);
  } catch (error) {
    const note = $("analyticsNote");
    if (note) note.textContent = "Account analytics unavailable: " + (error instanceof Error ? error.message : String(error));
  } finally {
    analyticsLoading = false;
  }
}

function paperAnalytics(state) {
  const history = Array.isArray(state?.paper?.history) ? [...state.paper.history].reverse() : [];
  const dailyMap = new Map();

  for (const trade of history) {
    const ts = Number(trade.closedAt || 0);
    if (!Number.isFinite(ts) || !ts) continue;
    const date = new Date(ts + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const row = dailyMap.get(date) || { date, realizedPnlUsd: 0, feesUsd: 0, netPnlUsd: 0 };
    row.realizedPnlUsd += Number(trade.grossPnlUsd || 0);
    row.feesUsd += Math.max(0, Number(trade.feesUsd || 0));
    row.netPnlUsd += Number(trade.netPnlUsd || 0);
    dailyMap.set(date, row);
  }

  const wins = history.filter(t => Number(t.netPnlUsd) > 0).length;
  const losses = history.filter(t => Number(t.netPnlUsd) <= 0).length;
  const grossProfit = history.filter(t => Number(t.netPnlUsd) > 0).reduce((s,t)=>s+Number(t.netPnlUsd),0);
  const grossLoss = history.filter(t => Number(t.netPnlUsd) < 0).reduce((s,t)=>s+Number(t.netPnlUsd),0);
  const momentumEntries = history.filter(t => t.engine === "MOMENTUM").length;
  const scalpingEntries = history.filter(t => t.engine === "SCALPING").length;

  let equity = Number(state?.paper?.startingBalanceUsd || 0);
  let peak = equity;
  let maxDrawdown = 0;
  for (const trade of history) {
    equity += Number(trade.netPnlUsd || 0);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return {
    profile: "PAPER",
    generatedAt: Date.now(),
    windowDays: 30,
    totals: {
      realizedPnlUsd: history.reduce((s,t)=>s+Number(t.grossPnlUsd || 0),0),
      feesUsd: history.reduce((s,t)=>s+Math.max(0,Number(t.feesUsd || 0)),0),
      netPnlUsd: history.reduce((s,t)=>s+Number(t.netPnlUsd || 0),0)
    },
    ddt: {
      filledEntries: history.length,
      momentumEntries,
      scalpingEntries,
      protectionOrders: 0
    },
    stats: {
      wins,
      losses,
      winRate: history.length ? wins / history.length * 100 : 0,
      profitFactor: grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? Infinity : 0,
      averageWinUsd: wins ? grossProfit / wins : 0,
      averageLossUsd: losses ? grossLoss / losses : 0,
      maxDrawdownUsd: maxDrawdown
    },
    trades: history.slice(0, 50).map(t => ({
      time: Number(t.closedAt || 0),
      symbol: t.symbol,
      engine: t.engine,
      side: t.side,
      stage: t.signalStage || "CONFIRMED",
      quality: Number(t.qualityScore || 0),
      exit: Number(t.exit || 0),
      reason: t.reason,
      netPnlUsd: Number(t.netPnlUsd || 0),
      rotationId: t.rotationId || null
    })),
    daily: [...dailyMap.values()].sort((a,b)=>b.date.localeCompare(a.date)),
    coverage: { incomeRows: 0, orderRows: history.length, orderRowsLimit: history.length, note: "PAPER analytics use the locally stored DealDost trade history on this browser." }
  };
}

function renderAnalytics(data) {
  if (!data) return;
  const totals = data.totals || {};
  const ddt = data.ddt || {};
  $("analyticsRealized").textContent = money(totals.realizedPnlUsd);
  $("analyticsFees").textContent = money(totals.feesUsd);
  $("analyticsNet").textContent = money(totals.netPnlUsd);
  $("analyticsEntries").textContent = String(ddt.filledEntries || 0);

  const stats = data.stats;
  const engine = $("engineAnalytics");
  if (engine) {
    if (stats) {
      engine.textContent =
        "Win rate " + Number(stats.winRate || 0).toFixed(1) + "% • " +
        "Profit factor " + (Number.isFinite(Number(stats.profitFactor)) ? Number(stats.profitFactor).toFixed(2) : "∞") + " • " +
        "Avg win " + money(stats.averageWinUsd) + " • Avg loss " + money(stats.averageLossUsd) + " • " +
        "Max drawdown " + money(stats.maxDrawdownUsd);
    } else {
      engine.textContent =
        "Momentum entries " + String(ddt.momentumEntries || 0) + " • " +
        "Scalping entries " + String(ddt.scalpingEntries || 0) + " • " +
        "DDT entries " + String(ddt.filledEntries || 0);
    }
  }

  const rows = Array.isArray(data.daily) ? data.daily : [];
  const tbody = $("analyticsDaily");
  if (tbody) {
    tbody.innerHTML = rows.length
      ? rows.map(row =>
          "<tr><td>" + esc(row.date) + "</td>" +
          "<td>" + money(row.realizedPnlUsd) + "</td>" +
          "<td>" + money(row.feesUsd) + "</td>" +
          "<td>" + money(row.netPnlUsd) + "</td></tr>"
        ).join("")
      : '<tr><td colspan="4" class="empty">No account history in the selected window.</td></tr>';
  }
  const tradeRows = Array.isArray(data.trades) ? data.trades : [];
  const tradeBody = $("tradeHistory");
  if (tradeBody) {
    tradeBody.innerHTML = tradeRows.length
      ? tradeRows.map(t =>
          "<tr><td>" + esc(t.time ? new Date(Number(t.time)).toLocaleString() : "—") + "</td>" +
          "<td>" + esc(t.symbol || "—") + "</td>" +
          "<td>" + esc(t.engine || "—") + "</td>" +
          "<td>" + esc(t.side || "—") + "</td>" +
          "<td>" + esc(t.stage || "—") + "</td>" +
          "<td>" + (t.quality ? esc(String(t.quality)) : "—") + "</td>" +
          "<td>" + (t.exit ? fmt(t.exit) : "—") + "</td>" +
          "<td>" + esc(t.reason || t.type || t.status || "—") + "</td>" +
          "<td>" + (t.netPnlUsd == null ? "—" : money(t.netPnlUsd)) + "</td>" +
          "<td>" + esc(t.rotationId || t.clientOrderId || "—") + "</td></tr>"
        ).join("")
      : '<tr><td colspan="10" class="empty">No trade history in the selected window.</td></tr>';
  }

  const note = $("analyticsNote");
  if (note) {
    const coverage = data.coverage?.note || "";
    note.textContent = String(coverage) + " • 30-day view";
  }
}

function renderAccountAnalytics(data) {
  renderAnalytics(data);
}

async function syncTestnetProtection(symbol) {
  try {
    const response = await fetch("/api/testnet/protection-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ symbol })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || ("HTTP " + response.status));
    render(body);
  } catch (error) {
    showApiError("Protection sync failed: " + (error instanceof Error ? error.message : String(error)));
  }
}

async function syncLiveProtection(symbol) {
  try {
    const response = await fetch("/api/live/protection-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ symbol })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || ("HTTP " + response.status));
    render(body);
  } catch (error) {
    showApiError("Protection sync failed: " + (error instanceof Error ? error.message : String(error)));
  }
}


async function closePaper(symbol) {
  try {
    const response = await fetch("/api/paper/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol })
    });
    if (response.ok) render(await response.json());
    else showApiError("Close failed: HTTP " + response.status);
  } catch (error) {
    showApiError("Close failed: " + (error instanceof Error ? error.message : String(error)));
  }
}

async function closeTestnet(symbol) {
  if (!window.confirm("Close managed TESTNET position " + symbol + " at market?")) return;
  try {
    const response = await fetch("/api/testnet/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ symbol })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || ("HTTP " + response.status));
    render(body);
  } catch (error) {
    showApiError("TESTNET close failed: " + (error instanceof Error ? error.message : String(error)));
  }
}

async function closeLive(symbol) {
  if (!window.confirm("Close managed LIVE position " + symbol + " at market?")) return;
  try {
    const response = await fetch("/api/live/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ symbol })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || ("HTTP " + response.status));
    render(body);
  } catch (error) {
    showApiError("LIVE close failed: " + (error instanceof Error ? error.message : String(error)));
  }
}


function render(state) {
  savePaperRuntime(state);
  emergencyStop = Boolean(state?.risk?.emergencyStop);
  localStorage.setItem("dealdost.emergencyStop", String(emergencyStop));
  $("regime").textContent = state.market.regime.replaceAll("_", " ");
  $("btc").textContent = fmt(state.market.btcPrice);
  $("ws").textContent = state.feed.websocket;
  $("ws").className = "status " + (state.feed.websocket === "ONLINE" ? "ok" : "warn");
  $("data").textContent = state.feed.data + " • reconnects " + state.feed.reconnects;
  if (state.feed.error) $("data").title = state.feed.error; else $("data").removeAttribute("title");
  $("data").className = "muted";
  $("universe").textContent = state.market.universeSize;

  currentMode = ["PAPER", "TESTNET", "LIVE"].includes(state.mode) ? state.mode : "PAPER";
  paperAuto = Boolean(state.paper?.auto);
  testnetAuto = Boolean(state.testnet?.auto);
  liveAuto = Boolean(state.live?.auto);
  localStorage.setItem("dealdost.mode", currentMode);
  localStorage.setItem("dealdost.paperAuto", String(paperAuto));
  localStorage.setItem("dealdost.testnetAuto", String(testnetAuto));
  localStorage.setItem("dealdost.liveAuto", String(liveAuto));

  ["paperMode", "testnetMode", "liveMode"].forEach((id) => $(id)?.classList.remove("active"));
  $(
    currentMode === "PAPER"
      ? "paperMode"
      : currentMode === "TESTNET"
        ? "testnetMode"
        : "liveMode"
  )?.classList.add("active");

  $("paperAuto").textContent = "PAPER AUTO " + (paperAuto ? "ON" : "OFF");
  $("paperAuto").dataset.enabled = String(paperAuto);
  $("paperAuto").className = paperAuto ? "auto on" : "auto";

  $("equity").textContent = money(state.paper.balanceUsd);
  $("available").textContent = money(state.paper.availableBalanceUsd);
  $("fees").textContent = money(state.paper.feesUsd);

  const tn = state.testnet;
  const testnetAutoButton = $("testnetAuto");
  if (testnetAutoButton) {
    testnetAutoButton.textContent = "TESTNET AUTO " + (testnetAuto ? "ON" : "OFF");
    testnetAutoButton.dataset.enabled = String(testnetAuto);
    testnetAutoButton.className = testnetAuto ? "auto on" : "auto";
    testnetAutoButton.dataset.executionEnabled = String(Boolean(tn.executionEnabled));
  }
  $("testnetStatus").textContent = tn.error
    ? (String(tn.error).includes(" 451:") ? "REGION RESTRICTED" : "ERROR")
    : tn.connected
      ? (tn.executionEnabled ? "CONNECTED • ARMED" : "CONNECTED • READ ONLY")
      : tn.configured
        ? "CONFIGURED • OFFLINE"
        : "CREDENTIALS REQUIRED";
  $("testnetStatus").className = "status " + (
    tn.error ? "warn" : (tn.connected && tn.executionEnabled ? "ok" : "warn")
  );
  $("paperAuto").dataset.executionEnabled = "false";
  $("testnetBalance").textContent = money(tn.accountBalanceUsd);
  $("testnetOpen").textContent = String(tn.openPositions);
  $("testnetPnl").textContent = money(tn.realizedPnlTodayUsd);
  $("testnetFees").textContent = money(tn.feesTodayUsd);
  $("testnetNet").textContent = money(tn.netPnlTodayUsd);
  const tnError = $("testnetError");
  const tnHint = $("testnetExecutionHint");
  if (tnError) {
    tnError.textContent = tn.error ? friendlyBinanceError(String(tn.error).slice(0, 160)) : "";
    tnError.title = tn.error || "";
    tnError.hidden = !tn.error;
  }
  if (tnHint) {
    if (currentMode === "TESTNET" && !tn.configured) {
      tnHint.textContent = "TESTNET Demo/Futures key + secret required in the running deployment environment • execution stays OFF";
      tnHint.hidden = false;
    } else if (currentMode === "TESTNET" && !tn.executionEnabled) {
      tnHint.textContent = tn.connected
        ? "TESTNET connected in READ ONLY mode • execution flag is OFF"
        : "TESTNET configured • waiting for account connection";
      tnHint.hidden = false;
    } else if (
      currentMode === "TESTNET" &&
      state.auto &&
      (
        Number(tn.momentumOpen) > Number(state.risk.maxMomentumPositions) ||
        Number(tn.scalpingOpen) > Number(state.risk.maxScalpingPositions) ||
        Number(tn.openPositions) > Number(state.risk.maxTotalPositions)
      )
    ) {
      tnHint.textContent = "TESTNET AUTO ON • POSITION GATE BLOCKED • close excess managed position(s)";
      tnHint.hidden = false;
    } else if (currentMode === "TESTNET" && state.auto) {
      tnHint.textContent = "TESTNET execution ARMED • AUTO is ON";
      tnHint.hidden = false;
    } else if (currentMode === "TESTNET") {
      tnHint.textContent = "TESTNET execution ARMED • AUTO is OFF";
      tnHint.hidden = false;
    } else {
      tnHint.textContent = "";
      tnHint.hidden = true;
    }
  }

  const lv = state.live || {};
  const liveAutoButton = $("liveAuto");
  if (liveAutoButton) {
    liveAutoButton.textContent = "LIVE AUTO " + (liveAuto ? "ON" : "OFF");
    liveAutoButton.dataset.enabled = String(liveAuto);
    liveAutoButton.className = liveAuto ? "auto on" : "auto";
    liveAutoButton.dataset.executionEnabled = String(Boolean(lv.executionEnabled));
  }

  const liveButton = $("liveMode");
  if (liveButton) {
    const locked = !Boolean(lv.executionEnabled);
    liveButton.classList.toggle("disabled", locked);
    liveButton.title = locked
      ? "LIVE is locked until LIVE credentials and BINANCE_LIVE_EXECUTION_ENABLED=true are configured"
      : "LIVE execution enabled • 16-gate preflight required";
  }

  $("liveStatus").textContent = lv.error
    ? "ERROR"
    : lv.connected
      ? (lv.executionEnabled ? "CONNECTED • ARMED" : "CONNECTED • READ ONLY")
      : lv.configured
        ? "CONFIGURED • OFFLINE"
        : "CREDENTIALS REQUIRED";
  $("liveStatus").className = "status " + (
    lv.error ? "warn" : (lv.connected && lv.executionEnabled ? "ok" : "warn")
  );
  $("liveBalance").textContent = money(lv.accountBalanceUsd);
  $("liveOpen").textContent = String(lv.openPositions ?? 0);
  $("livePnl").textContent = money(lv.realizedPnlTodayUsd);
  $("liveFees").textContent = money(lv.feesTodayUsd);
  $("liveNet").textContent = money(lv.netPnlTodayUsd);

  const lvError = $("liveError");
  const lvHint = $("liveExecutionHint");
  if (lvError) {
    lvError.textContent = lv.error ? String(lv.error).slice(0, 140) : "";
    lvError.title = lv.error || "";
    lvError.hidden = !lv.error;
  }
  if (lvHint) {
    if (!lv.configured) {
      lvHint.textContent = "LIVE credentials required • execution remains OFF";
      lvHint.hidden = false;
    } else if (!lv.executionEnabled) {
      lvHint.textContent = lv.connected
        ? "LIVE connected in READ ONLY mode • execution flag is OFF"
        : "LIVE configured • waiting for account connection";
      lvHint.hidden = false;
    } else if (currentMode === "LIVE" && liveAuto) {
      lvHint.textContent = "LIVE execution ARMED • AUTO ON • 16-gate preflight on every entry";
      lvHint.hidden = false;
    } else if (currentMode === "LIVE") {
      lvHint.textContent = "LIVE execution ARMED • AUTO OFF";
      lvHint.hidden = false;
    } else {
      lvHint.textContent = "";
      lvHint.hidden = true;
    }
  }

  const lvGate = $("livePositionGate");
  if (lvGate) {
    lvGate.textContent = lv.positions?.length
      ? lv.positions.length + " open" +
        (lv.unclassifiedOpenPositions ? " • " + lv.unclassifiedOpenPositions + " unclassified" : "")
      : "0 open";
  }

  const lvPositions = $("livePositions");
  if (lvPositions) {
    if (!lv.positions?.length) {
      lvPositions.innerHTML = '<tr><td colspan="10" class="empty">No LIVE positions.</td></tr>';
    } else {
      lvPositions.innerHTML = lv.positions.map((p) =>
        "<tr>" +
        "<td><strong>" + esc(p.symbol) + "</strong></td>" +
        "<td>" + esc(p.engine || "UNCLASSIFIED") + "</td>" +
        '<td class="' + (p.side === "LONG" ? "long" : "short") + '">' + esc(p.side) + "</td>" +
        "<td>" + fmt(p.quantity) + "</td>" +
        "<td>" + fmt(p.entryPrice) + "</td>" +
        "<td>" + fmt(p.markPrice) + "</td>" +
        "<td>" + money(p.unrealizedPnlUsd) + "</td>" +
        "<td>" + (p.leverage == null ? "—" : fmt(p.leverage) + "x") + "</td>" +
        "<td>" +
          '<span class="stage ' + String(p.protection || "MISSING").toLowerCase() + '">' + esc(p.protection || "MISSING") + "</span>" +
          (p.tpManagedByEngine && p.takeProfitPrice ? " TP@" + fmt(p.takeProfitPrice) : "") +
          ((p.protection || "MISSING") !== "OK" && p.engine
            ? ' <button class="protect-btn" data-live-symbol="' + esc(p.symbol) + '">SYNC</button>'
            : "") +
        "</td>" +
        "<td>" +
          (p.engine
            ? '<button class="live-close-btn" data-symbol="' + esc(p.symbol) + '">Close</button>'
            : "—") +
        "</td>" +
        "</tr>"
      ).join("");
    }
  }

  document.querySelectorAll("[data-live-symbol]").forEach((button) => {
    button.onclick = () => syncLiveProtection(button.dataset.liveSymbol);
  });
  document.querySelectorAll(".live-close-btn").forEach((button) => {
    button.onclick = () => closeLive(button.dataset.symbol);
  });

  const momentumLabel = $("momentumLabel");
  const scalpingLabel = $("scalpingLabel");
  const totalLabel = $("totalLabel");
  const gateMode = currentMode;
  if (momentumLabel) momentumLabel.textContent = "MOMENTUM • " + gateMode;
  if (scalpingLabel) scalpingLabel.textContent = "SCALPING • " + gateMode;
  if (totalLabel) totalLabel.textContent = "TOTAL • " + gateMode;

  $("momentum").textContent = state.engines.momentum.open + "/" + state.engines.momentum.max;
  $("scalping").textContent = state.engines.scalping.open + "/" + state.engines.scalping.max;
  $("total").textContent = state.engines.totalOpen + "/" + state.engines.totalMax;
  $("momentumStatus").textContent = state.engines.momentum.status;
  $("scalpingStatus").textContent = state.engines.scalping.status;

  $("riskTrade").textContent = state.risk.riskPerTradePct + "%";
  $("riskDaily").textContent = state.risk.dailyRiskUsedPct.toFixed(2) + "% / " + state.risk.maxDailyRiskPct + "%";
  $("emergency").textContent = state.risk.emergencyStop ? "ON" : "OFF";
  const emergencyButton = $("emergencyStop");
  if (emergencyButton) {
    emergencyButton.textContent = state.risk.emergencyStop ? "ENTRY STOP ON" : "ENTRY STOP OFF";
    emergencyButton.className = state.risk.emergencyStop ? "auto danger on" : "auto danger";
  }
  const tnGate = $("testnetPositionGate");
  if (tnGate) {
    tnGate.textContent = tn.positions?.length
      ? tn.positions.length + " open" +
        (tn.unclassifiedOpenPositions ? " • " + tn.unclassifiedOpenPositions + " unclassified" : "") +
        (Number(tn.momentumOpen) > Number(state.risk.maxMomentumPositions)
          ? " • MOMENTUM OVER LIMIT"
          : Number(tn.scalpingOpen) > Number(state.risk.maxScalpingPositions)
            ? " • SCALPING OVER LIMIT"
            : "")
      : "0 open";
  }

  const tnPositions = $("testnetPositions");
  if (tnPositions) {
    if (!tn.positions?.length) {
      tnPositions.innerHTML = '<tr><td colspan="10" class="empty">No TESTNET positions.</td></tr>';
    } else {
      tnPositions.innerHTML = tn.positions.map((p) =>
        "<tr>" +
        "<td><strong>" + esc(p.symbol) + "</strong></td>" +
        "<td>" + esc(p.engine || "UNCLASSIFIED") + "</td>" +
        '<td class="' + (p.side === "LONG" ? "long" : "short") + '">' + esc(p.side) + "</td>" +
        "<td>" + fmt(p.quantity) + "</td>" +
        "<td>" + fmt(p.entryPrice) + "</td>" +
        "<td>" + fmt(p.markPrice) + "</td>" +
        "<td>" + money(p.unrealizedPnlUsd) + "</td>" +
        "<td>" + (p.leverage == null ? "—" : fmt(p.leverage) + "x") + "</td>" +
        "<td>" +
          "<span class=\"stage " + String(p.protection || "MISSING").toLowerCase() + "\">" + esc(p.protection || "MISSING") + "</span>" +
          (p.tpManagedByEngine && p.takeProfitPrice ? " TP@" + fmt(p.takeProfitPrice) : "") +
          ((p.protection || "MISSING") !== "OK" && p.engine
            ? ' <button class="protect-btn" data-symbol="' + esc(p.symbol) + '">SYNC</button>'
            : "") +
        "</td>" +
        "<td>" +
          (p.engine
            ? '<button class="testnet-close-btn" data-symbol="' + esc(p.symbol) + '">Close</button>'
            : "—") +
        "</td>" +
        "</tr>"
      ).join("");
    }
  }

  document.querySelectorAll(".protect-btn").forEach((button) => {
    button.onclick = () => syncTestnetProtection(button.dataset.symbol);
  });
  document.querySelectorAll(".testnet-close-btn").forEach((button) => {
    button.onclick = () => closeTestnet(button.dataset.symbol);
  });

  $("paperStats").textContent =
    state.paper.positions.length + " open • " +
    state.paper.tradeCount + " closed • " +
    state.paper.winRate.toFixed(1) + "% WR";

  const pbody = $("positions");
  if (!state.paper.positions.length) {
    pbody.innerHTML = '<tr><td colspan="9" class="empty">No paper positions.</td></tr>';
  } else {
    pbody.innerHTML = state.paper.positions.map((p) =>
      "<tr>" +
      "<td><strong>" + esc(p.symbol) + "</strong></td>" +
      "<td>" + esc(p.engine) + "</td>" +
      '<td class="' + (p.side === "LONG" ? "long" : "short") + '">' + esc(p.side) + "</td>" +
      "<td>" + fmt(p.entry) + "</td>" +
      "<td>" + fmt(p.markPrice) + "</td>" +
      "<td>" + fmt(p.stop) + "</td>" +
      "<td>" + fmt(p.takeProfit1) + "</td>" +
      "<td>" + money(p.netPnlUsd) + "</td>" +
      '<td><button class="close-btn" data-symbol="' + esc(p.symbol) + '">Close</button></td>' +
      "</tr>"
    ).join("");

    document.querySelectorAll(".close-btn").forEach((button) => {
      button.onclick = () => closePaper(button.dataset.symbol);
    });
  }

  $("signalCount").textContent = state.signals.length;
  const tbody = $("signals");
  const signalWrap = $("signalsWrap");
  const signalScrollTop = signalWrap?.scrollTop ?? 0;
  const signalScrollLeft = signalWrap?.scrollLeft ?? 0;
  let signalHtml;
  if (!state.signals.length) {
    signalHtml = '<tr><td colspan="10" class="empty">Waiting for scored market data…</td></tr>';
  } else {
    signalHtml = state.signals.map((s) => {
      const sideClass = s.side === "LONG" ? "long" : "short";
      return (
        "<tr>" +
        "<td><strong>" + esc(s.symbol) + "</strong></td>" +
        "<td>" + esc(s.engine) + "</td>" +
        '<td class="' + sideClass + '">' + esc(s.side) + "</td>" +
        '<td><span class="stage ' + s.stage.toLowerCase() + '">' + esc(s.stage) + "</span></td>" +
        "<td><strong>" + s.quality.total + "</strong></td>" +
        "<td>" + esc(s.regime.replaceAll("_", " ")) + "</td>" +
        "<td>" + fmt(s.entry) + "</td>" +
        "<td>" + fmt(s.stop) + "</td>" +
        "<td>" + fmt(s.takeProfit1) + "</td>" +
        '<td title="' + esc(s.risk.reason || "") + '">' + (s.risk.eligible ? "PASS" : "BLOCKED") + "</td>" +
        "</tr>"
      );
    }).join("");
  }

  // The scanner polls every few seconds. Reuse the existing DOM when rows are
  // unchanged and always restore the user's exact scroll position after an
  // update so the coin list never jumps back to the top.
  if (tbody && tbody.innerHTML !== signalHtml) {
    tbody.innerHTML = signalHtml;
    if (signalWrap) {
      signalWrap.scrollTop = signalScrollTop;
      signalWrap.scrollLeft = signalScrollLeft;
      requestAnimationFrame(() => {
        signalWrap.scrollTop = signalScrollTop;
        signalWrap.scrollLeft = signalScrollLeft;
      });
    }
  }

  $("rotEvents").textContent = state.rotation.eventsToday;
  $("rotReleased").textContent = money(state.rotation.totalReleasedUsd);
  $("rotAllocated").textContent = money(state.rotation.totalAllocatedUsd);
  $("rotLast").textContent = state.rotation.last
    ? "Last: " + state.rotation.last.rotationId + " • " + money(state.rotation.last.allocatedUsd) + " allocated"
    : "No profitable rotation yet.";

  if (currentMode === "PAPER") {
    renderAnalytics(paperAnalytics(state));
  }
  void loadAccountAnalytics(false);
}

let polling = false;
let lastBrowserIngestAt = 0;
let modeChangeToken = 0;
let directTickerCache = null;
let directTickerCachedAt = 0;
const DIRECT_TICKER_CACHE_MS = 60000;

async function fetchDirectTicker() {
  if (directTickerCache && Date.now() - directTickerCachedAt < DIRECT_TICKER_CACHE_MS) {
    return directTickerCache;
  }
  const ticker = await fetchDirectBinance("/fapi/v1/ticker/24hr");
  directTickerCache = ticker;
  directTickerCachedAt = Date.now();
  return ticker;
}
async function load() {
  if (polling) return;
  polling = true;
  const requestMode = currentMode;
  const requestToken = modeChangeToken;
  try {
    const response = await fetch("/api/state", {
      cache: "no-store",
      headers: {
        "x-dealdost-mode": currentMode,
        "x-dealdost-auto": String(currentMode === "PAPER" ? paperAuto : testnetAuto),
        "x-dealdost-paper-auto": String(paperAuto),
        "x-dealdost-testnet-auto": String(testnetAuto),
        "x-dealdost-live-auto": String(liveAuto),
        "x-dealdost-emergency-stop": String(emergencyStop)
      }
    });
    if (response.ok) {
      const state = await response.json();
      if (requestToken !== modeChangeToken || requestMode !== currentMode) return; // discard stale mode response
      if (
        state?.market?.universeSize > 0 &&
        state?.feed?.websocket === "ONLINE"
      ) {
        render(state);
        // Keep server-owned paper positions marked in serverless/Vercel mode.
        // The API state itself is not a market-data stream, so refresh the
        // browser market snapshot regularly even when /api/state is healthy.
        if (Date.now() - lastBrowserIngestAt >= 5000) {
          lastBrowserIngestAt = Date.now();
          void directScannerFallback().catch(() => {});
        }
      } else {
        try {
          await directScannerFallback();
          lastBrowserIngestAt = Date.now();
        } catch (fallbackError) {
          if (requestToken === modeChangeToken && requestMode === currentMode) render(state);
        }
      }
    } else {
      try {
        await directScannerFallback();
        return;
      } catch (fallbackError) {
        try {
          await directBinanceFallback();
          return;
        } catch {}
        let detail = "HTTP " + response.status;
        try {
          const body = await response.json();
          if (body?.error) detail += " • " + body.error;
        } catch {}
        showApiError("Scanner API failed: " + detail);
      }
    }
  } catch (error) {
    try {
      await directScannerFallback();
    } catch (fallbackError) {
      try {
        await directBinanceFallback();
      } catch {
        showApiError("Scanner API failed: " + (error instanceof Error ? error.message : String(error)));
      }
    }
  } finally {
    polling = false;
  }
}

$("paperAuto").onclick = togglePaperAuto;
$("testnetAuto")?.addEventListener("click", toggleTestnetAuto);
$("liveAuto")?.addEventListener("click", toggleLiveAuto);
$("emergencyStop")?.addEventListener("click", toggleEmergencyStop);
$("analyticsRefresh")?.addEventListener("click", () => {
  if (currentMode === "PAPER") return;
  lastAnalyticsLoadedAt = 0;
  void loadAccountAnalytics(true);
});
$("paperMode")?.addEventListener("click", () => setMode("PAPER"));
$("testnetMode")?.addEventListener("click", () => setMode("TESTNET"));
$("liveMode")?.addEventListener("click", () => setMode("LIVE"));
// Prime market cards and server-owned scoring immediately.
void directScannerFallback().catch(() => directBinanceFallback().catch(() => {}));
load();
setInterval(load, 3000);
