const $ = (id) => document.getElementById(id);

let currentMode = localStorage.getItem("dealdost.mode") === "TESTNET" ? "TESTNET" : "PAPER";
let testnetAuto = false;
let paperAuto = localStorage.getItem("dealdost.paperAuto") === "true";

const fmt = (n) =>
  Number.isFinite(Number(n))
    ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 })
    : "—";

const money = (n) => "$" + fmt(Number(n));

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));

async function fetchDirectBinance(path) {
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
      if (!response.ok) throw new Error(base + " HTTP " + response.status);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Binance market API unavailable");
}

async function directScannerFallback() {
  const ticker = await fetchDirectBinance("/fapi/v1/ticker/24hr");
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

  const response = await fetch("/api/market/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      mode: currentMode,
      auto: currentMode === "PAPER" ? paperAuto : testnetAuto,
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
  render(await response.json());
}

async function directBinanceFallback() {
  const ticker = await fetchDirectBinance("/fapi/v1/ticker/24hr");
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

function showApiError(message) {
  const el = $("data");
  if (el) {
    el.textContent = message;
    el.className = "muted error";
  }
}

async function setMode(mode) {
  if (mode === "LIVE") {
    showApiError("LIVE trading is locked in V2.");
    return;
  }
  const auto = mode === "PAPER" ? paperAuto : testnetAuto;
  $("paperAuto").disabled = true;
  try {
    const response = await fetch("/api/mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, auto })
    });
    if (!response.ok) {
      let detail = "HTTP " + response.status;
      try { const body = await response.json(); if (body?.error) detail += " • " + body.error; } catch {}
      throw new Error(detail);
    }
    currentMode = mode;
    localStorage.setItem("dealdost.mode", currentMode);
    render(await response.json());
  } catch (error) {
    showApiError("Mode change failed: " + (error instanceof Error ? error.message : String(error)));
  } finally {
    $("paperAuto").disabled = false;
  }
}

async function toggleAuto() {
  if (currentMode === "TESTNET" && $("paperAuto").dataset.executionEnabled !== "true") {
    showApiError("TESTNET execution is READ ONLY. Enable BINANCE_TESTNET_EXECUTION_ENABLED first.");
    return;
  }
  const enabled = currentMode === "PAPER" ? !paperAuto : !testnetAuto;
  if (currentMode === "PAPER") {
    paperAuto = enabled;
    localStorage.setItem("dealdost.paperAuto", String(enabled));
  } else {
    testnetAuto = enabled;
    localStorage.setItem("dealdost.testnetAuto", String(enabled));
  }

  $("paperAuto").disabled = true;
  try {
    const response = await fetch("/api/mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: currentMode,
        auto: enabled,
        testnetAuto: currentMode === "TESTNET" ? enabled : false
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

function render(state) {
  $("regime").textContent = state.market.regime.replaceAll("_", " ");
  $("btc").textContent = fmt(state.market.btcPrice);
  $("ws").textContent = state.feed.websocket;
  $("ws").className = "status " + (state.feed.websocket === "ONLINE" ? "ok" : "warn");
  $("data").textContent = state.feed.data + " • reconnects " + state.feed.reconnects;
  if (state.feed.error) $("data").title = state.feed.error; else $("data").removeAttribute("title");
  $("data").className = "muted";
  $("universe").textContent = state.market.universeSize;

  currentMode = state.mode === "TESTNET" ? "TESTNET" : "PAPER";
  if (currentMode === "PAPER") paperAuto = Boolean(state.auto);
  else testnetAuto = Boolean(state.auto);
  localStorage.setItem("dealdost.mode", currentMode);
  localStorage.setItem("dealdost.paperAuto", String(paperAuto));
  // TESTNET AUTO is intentionally session-only; it never re-arms on refresh.

  ["paperMode", "testnetMode", "liveMode"].forEach((id) => $(id)?.classList.remove("active"));
  $(currentMode === "PAPER" ? "paperMode" : "testnetMode")?.classList.add("active");

  $("paperAuto").textContent = currentMode + " AUTO " + (state.auto ? "ON" : "OFF");
  $("paperAuto").dataset.enabled = String(state.auto);
  $("paperAuto").className = state.auto ? "auto on" : "auto";

  $("equity").textContent = money(state.paper.balanceUsd);
  $("available").textContent = money(state.paper.availableBalanceUsd);
  $("fees").textContent = money(state.paper.feesUsd);

  const tn = state.testnet;
  $("testnetStatus").textContent = tn.error
    ? (String(tn.error).includes(" 451:") ? "REGION RESTRICTED" : "ERROR")
    : tn.connected
      ? (tn.executionEnabled ? "CONNECTED • ARMED" : "CONNECTED • READ ONLY")
      : tn.configured
        ? "CONFIGURED • OFFLINE"
        : "NOT CONFIGURED";
  $("testnetStatus").className = "status " + (tn.connected ? "ok" : "warn");
  $("paperAuto").dataset.executionEnabled = String(Boolean(tn.executionEnabled));
  $("testnetBalance").textContent = money(tn.accountBalanceUsd);
  $("testnetOpen").textContent = String(tn.openPositions);
  $("testnetPnl").textContent = money(tn.realizedPnlTodayUsd);
  $("testnetFees").textContent = money(tn.feesTodayUsd);
  const tnError = $("testnetError");
  if (tnError) {
    tnError.textContent = tn.error ? String(tn.error).slice(0, 120) : "";
    tnError.title = tn.error || "";
    tnError.hidden = !tn.error;
  }

  $("momentum").textContent = state.engines.momentum.open + "/" + state.engines.momentum.max;
  $("scalping").textContent = state.engines.scalping.open + "/" + state.engines.scalping.max;
  $("total").textContent = state.engines.totalOpen + "/" + state.engines.totalMax;
  $("momentumStatus").textContent = state.engines.momentum.status;
  $("scalpingStatus").textContent = state.engines.scalping.status;

  $("riskTrade").textContent = state.risk.riskPerTradePct + "%";
  $("riskDaily").textContent = state.risk.dailyRiskUsedPct.toFixed(2) + "% / " + state.risk.maxDailyRiskPct + "%";
  $("emergency").textContent = state.risk.emergencyStop ? "ON" : "OFF";
  const tnGate = $("testnetPositionGate");
  if (tnGate) {
    tnGate.textContent = tn.positions?.length
      ? tn.positions.length + " open" + (tn.unclassifiedOpenPositions ? " • " + tn.unclassifiedOpenPositions + " unclassified" : "")
      : "0 open";
  }

  const tnPositions = $("testnetPositions");
  if (tnPositions) {
    if (!tn.positions?.length) {
      tnPositions.innerHTML = '<tr><td colspan="9" class="empty">No TESTNET positions.</td></tr>';
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
        "<td>" + esc(p.protection || "MISSING") + "</td>" +
        "</tr>"
      ).join("");
    }
  }

  $("paperStats").textContent = state.paper.tradeCount + " trades • " + state.paper.winRate.toFixed(1) + "% WR";

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
  if (!state.signals.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">Waiting for scored market data…</td></tr>';
  } else {
    tbody.innerHTML = state.signals.map((s) => {
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
        "<td>" + (s.risk.eligible ? "PASS" : "BLOCKED") + "</td>" +
        "</tr>"
      );
    }).join("");
  }

  $("rotEvents").textContent = state.rotation.eventsToday;
  $("rotReleased").textContent = money(state.rotation.totalReleasedUsd);
  $("rotAllocated").textContent = money(state.rotation.totalAllocatedUsd);
  $("rotLast").textContent = state.rotation.last
    ? "Last: " + state.rotation.last.rotationId + " • " + money(state.rotation.last.allocatedUsd) + " allocated"
    : "No profitable rotation yet.";
}

let polling = false;
let lastBrowserIngestAt = 0;
async function load() {
  if (polling) return;
  polling = true;
  try {
    const response = await fetch("/api/state", {
      cache: "no-store",
      headers: {
        "x-dealdost-mode": currentMode,
        "x-dealdost-auto": String(currentMode === "PAPER" ? paperAuto : testnetAuto),
        "x-dealdost-testnet-auto": String(testnetAuto)
      }
    });
    if (response.ok) {
      const state = await response.json();
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
          render(state);
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

$("paperAuto").onclick = toggleAuto;
$("paperMode")?.addEventListener("click", () => setMode("PAPER"));
$("testnetMode")?.addEventListener("click", () => setMode("TESTNET"));
$("liveMode")?.addEventListener("click", () => setMode("LIVE"));
// Prime market cards and server-owned scoring immediately.
void directScannerFallback().catch(() => directBinanceFallback().catch(() => {}));
load();
setInterval(load, 3000);
