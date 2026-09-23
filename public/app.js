const $ = (id) => document.getElementById(id);

const fmtPrice = (n) =>
  Number.isFinite(n) ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[c]));

function render(state) {
  $("regime").textContent = state.market.regime.replaceAll("_", " ");
  $("btc").textContent = fmtPrice(state.market.btcPrice);
  $("ws").textContent = state.feed.websocket;
  $("ws").className = "status " + (state.feed.websocket === "ONLINE" ? "ok" : "warn");
  $("data").textContent = state.feed.data;
  $("universe").textContent = state.market.universeSize;
  $("reconnects").textContent = "Reconnects: " + state.feed.reconnects;

  $("momentum").textContent = state.engines.momentum.open + "/" + state.engines.momentum.max;
  $("scalping").textContent = state.engines.scalping.open + "/" + state.engines.scalping.max;
  $("total").textContent = state.engines.totalOpen + "/" + state.engines.totalMax;
  $("momentumStatus").textContent = state.engines.momentum.status;
  $("scalpingStatus").textContent = state.engines.scalping.status;

  $("riskTrade").textContent = state.risk.riskPerTradePct + "%";
  $("riskDaily").textContent =
    state.risk.dailyRiskUsedPct.toFixed(2) + "% / " + state.risk.maxDailyRiskPct + "%";
  $("account").textContent = "$" + state.risk.accountBalanceUsd.toLocaleString();
  $("emergency").textContent = state.risk.emergencyStop ? "ON" : "OFF";

  $("updated").textContent = new Date(state.updatedAt).toLocaleTimeString();
  $("signalCount").textContent = state.signals.length;

  const tbody = $("signals");
  if (!state.signals.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">No scored signals yet.</td></tr>';
    return;
  }

  tbody.innerHTML = state.signals.map((s) => {
    const sideClass = s.side === "LONG" ? "long" : "short";
    const stageClass = s.stage.toLowerCase();
    return (
      "<tr>" +
      "<td><strong>" + esc(s.symbol) + "</strong></td>" +
      "<td>" + esc(s.engine) + "</td>" +
      "<td class=\"" + sideClass + "\">" + s.side + "</td>" +
      "<td><span class=\"stage " + stageClass + "\">" + s.stage + "</span></td>" +
      "<td><strong>" + s.quality.total + "</strong></td>" +
      "<td>" + esc(s.regime.replaceAll("_", " ")) + "</td>" +
      "<td>" + fmtPrice(s.entry) + "</td>" +
      "<td>" + fmtPrice(s.stop) + "</td>" +
      "<td>" + fmtPrice(s.takeProfit1) + "</td>" +
      "<td>" + (s.risk.eligible ? "PASS" : "BLOCKED") + "</td>" +
      "</tr>"
    );
  }).join("");
}

async function load() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    render(await response.json());
  } catch {}
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(protocol + "://" + location.host);
  socket.onmessage = (event) => {
    try { render(JSON.parse(event.data)); } catch {}
  };
  socket.onclose = () => setTimeout(connect, 1500);
}

load();
connect();
