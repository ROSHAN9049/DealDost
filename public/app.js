const $ = (id) => document.getElementById(id);

const fmt = (n) =>
  Number.isFinite(Number(n))
    ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 })
    : "—";

const money = (n) => "$" + fmt(Number(n));

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", """: "&quot;", "'": "&#039;"
  }[c]));

async function directBinanceFallback() {
  const [infoResponse, tickerResponse] = await Promise.all([
    fetch("https://fapi.binance.com/fapi/v1/exchangeInfo", { cache: "no-store" }),
    fetch("https://fapi.binance.com/fapi/v1/ticker/24hr", { cache: "no-store" })
  ]);
  if (!infoResponse.ok || !tickerResponse.ok) throw new Error("Binance market API unavailable");
  const info = await infoResponse.json();
  const ticker = await tickerResponse.json();
  const eligible = new Set(
    info.symbols
      .filter((s) => s.status === "TRADING" && s.quoteAsset === "USDT" && s.contractType === "PERPETUAL")
      .map((s) => s.symbol)
  );
  const top = ticker
    .filter((t) => eligible.has(t.symbol) && Number(t.quoteVolume) >= 10000000)
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, 50);
  const btc = top.find((t) => t.symbol === "BTCUSDT");
  $("regime").textContent = "WAITING";
  $("btc").textContent = btc ? fmt(Number(btc.lastPrice)) : "—";
  $("ws").textContent = "REST ONLINE";
  $("ws").className = "status ok";
  $("data").textContent = "FRESH • direct Binance market fallback";
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

async function toggleAuto() {
  const enabled = $("paperAuto").dataset.enabled !== "true";
  $("paperAuto").disabled = true;
  try {
    const response = await fetch("/api/paper/auto", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled })
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
  $("data").className = "muted";
  $("universe").textContent = state.market.universeSize;

  $("paperAuto").textContent = state.paper.auto ? "PAPER AUTO ON" : "PAPER AUTO OFF";
  $("paperAuto").dataset.enabled = String(state.paper.auto);
  $("paperAuto").className = state.paper.auto ? "auto on" : "auto";

  $("equity").textContent = money(state.paper.balanceUsd);
  $("available").textContent = money(state.paper.availableBalanceUsd);
  $("fees").textContent = money(state.paper.feesUsd);

  const tn = state.testnet;
  $("testnetStatus").textContent = tn.error
    ? "ERROR"
    : tn.connected
      ? (tn.executionEnabled ? "CONNECTED • ARMED" : "CONNECTED • READ ONLY")
      : tn.configured
        ? "CONFIGURED • OFFLINE"
        : "NOT CONFIGURED";
  $("testnetStatus").className = "status " + (tn.connected ? "ok" : "warn");
  $("testnetBalance").textContent = money(tn.accountBalanceUsd);
  $("testnetOpen").textContent = String(tn.openPositions);

  $("momentum").textContent = state.engines.momentum.open + "/" + state.engines.momentum.max;
  $("scalping").textContent = state.engines.scalping.open + "/" + state.engines.scalping.max;
  $("total").textContent = state.engines.totalOpen + "/" + state.engines.totalMax;
  $("momentumStatus").textContent = state.engines.momentum.status;
  $("scalpingStatus").textContent = state.engines.scalping.status;

  $("riskTrade").textContent = state.risk.riskPerTradePct + "%";
  $("riskDaily").textContent = state.risk.dailyRiskUsedPct.toFixed(2) + "% / " + state.risk.maxDailyRiskPct + "%";
  $("emergency").textContent = state.risk.emergencyStop ? "ON" : "OFF";

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
async function load() {
  if (polling) return;
  polling = true;
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.ok) {
      render(await response.json());
    } else {
      try {
        await directBinanceFallback();
      } catch (fallbackError) {
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
      await directBinanceFallback();
    } catch (fallbackError) {
      showApiError("Scanner API failed: " + (error instanceof Error ? error.message : String(error)));
    }
  } finally {
    polling = false;
  }
}

$("paperAuto").onclick = toggleAuto;
load();
setInterval(load, 3000);
