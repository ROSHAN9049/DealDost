const $ = (id) => document.getElementById(id);

const fmt = (n) =>
  Number.isFinite(Number(n))
    ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 })
    : "—";

const money = (n) => "$" + fmt(Number(n));

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[c]));

async function toggleAuto() {
  const enabled = $("paperAuto").dataset.enabled !== "true";
  $("paperAuto").disabled = true;
  try {
    await fetch("/api/paper/auto", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled })
    });
  } finally {
    $("paperAuto").disabled = false;
  }
}

async function closePaper(symbol) {
  await fetch("/api/paper/close", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbol })
  });
}

function render(state) {
  $("regime").textContent = state.market.regime.replaceAll("_", " ");
  $("btc").textContent = fmt(state.market.btcPrice);
  $("ws").textContent = state.feed.websocket;
  $("ws").className = "status " + (state.feed.websocket === "ONLINE" ? "ok" : "warn");
  $("data").textContent = state.feed.data + " • reconnects " + state.feed.reconnects;
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
    pbody.innerHTML = state.paper.positions.map((p) => (
      "<tr>" +
      "<td><strong>" + esc(p.symbol) + "</strong></td>" +
      "<td>" + p.engine + "</td>" +
      "<td class=\"" + (p.side === "LONG" ? "long" : "short") + "\">" + p.side + "</td>" +
      "<td>" + fmt(p.entry) + "</td>" +
      "<td>" + fmt(p.markPrice) + "</td>" +
      "<td>" + fmt(p.stop) + "</td>" +
      "<td>" + fmt(p.takeProfit1) + "</td>" +
      "<td>" + money(p.netPnlUsd) + "</td>" +
      "<td><button class=\"close-btn\" data-symbol=\"" + esc(p.symbol) + "\">Close</button></td>" +
      "</tr>"
    )).join("");

    document.querySelectorAll(".close-btn").forEach((button) => {
      button.onclick = () => closePaper(button.dataset.symbol);
    });
  }

  $("signalCount").textContent = state.signals.length;
  const tbody = $("signals");
  if (!state.signals.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">No scored signals yet.</td></tr>';
  } else {
    tbody.innerHTML = state.signals.map((s) => {
      const sideClass = s.side === "LONG" ? "long" : "short";
      return (
        "<tr>" +
        "<td><strong>" + esc(s.symbol) + "</strong></td>" +
        "<td>" + esc(s.engine) + "</td>" +
        "<td class=\"" + sideClass + "\">" + s.side + "</td>" +
        "<td><span class=\"stage " + s.stage.toLowerCase() + "\">" + s.stage + "</span></td>" +
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

$("paperAuto").onclick = toggleAuto;
load();
connect();
