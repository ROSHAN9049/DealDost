(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));

  function ensureHealthRail() {
    if (byId("dd-health-rail")) return byId("dd-health-rail");

    const rail = document.createElement("section");
    rail.id = "dd-health-rail";
    rail.className = "dd-health-rail";
    rail.innerHTML =
      '<div class="dd-brandline">' +
        '<div><span class="dd-eyebrow">DEALDOST GLOBAL EXECUTION TERMINAL</span><strong id="dd-connection-summary">INITIALIZING</strong></div>' +
        '<span id="dd-clock" class="dd-clock">—</span>' +
      '</div>' +
      '<div class="dd-health-grid">' +
        '<div class="dd-health-item"><span>MARKET</span><strong id="dd-market-health">—</strong><small id="dd-market-detail">—</small></div>' +
        '<div class="dd-health-item"><span>TESTNET</span><strong id="dd-testnet-health">—</strong><small id="dd-testnet-detail">—</small></div>' +
        '<div class="dd-health-item"><span>LIVE</span><strong id="dd-live-health">—</strong><small id="dd-live-detail">—</small></div>' +
        '<div class="dd-health-item"><span>RISK GATE</span><strong id="dd-risk-health">—</strong><small id="dd-risk-detail">—</small></div>' +
      '</div>';

    const main = document.querySelector("main.container");
    if (main) main.prepend(rail);
    else document.body.prepend(rail);
    return rail;
  }

  function setHealth(id, status, detail) {
    const node = byId(id);
    if (!node) return;
    node.textContent = status;
    node.className = "dd-health-value " + String(status || "").toLowerCase().replace(/[^a-z]/g, "");
    const detailNode = byId(id.replace("-health", "-detail"));
    if (detailNode) detailNode.textContent = detail || "—";
  }

  function renderState(state) {
    if (!state) return;
    ensureHealthRail();

    const feed = state.feed || {};
    const risk = state.risk || {};
    const tn = state.testnet || {};
    const live = state.live || {};

    const marketStatus = feed.data === "FRESH" && feed.websocket === "ONLINE" ? "ONLINE" :
      feed.data === "STALE" ? "DEGRADED" : "OFFLINE";
    setHealth(
      "dd-market-health",
      marketStatus,
      marketStatus === "ONLINE"
        ? "WebSocket fresh • Universe " + Number(state.market?.universeSize || 0)
        : String(feed.error || feed.data || "No fresh market data")
    );

    const tnError = String(tn.error || "");
    const tnRegionRestricted =
      tnError.includes("451") ||
      tnError.toLowerCase().includes("restricted location");
    const tnHealth = tnRegionRestricted
      ? "REGION BLOCKED"
      : (tn.health || (tn.connected ? "ONLINE" : "OFFLINE"));
    const tnDetail = tnRegionRestricted
      ? "Binance Demo API denied Railway/Vercel execution region • entries blocked"
      : (
          tn.healthDetail ||
          (tn.executionEnabled
            ? (tn.auto ? "Demo execution armed" : "Demo execution ready")
            : "Read-only / execution locked")
        );
    setHealth("dd-testnet-health", tnHealth, tnDetail);

    const liveHealth = live.health || (live.connected ? "ONLINE" : "OFFLINE");
    setHealth(
      "dd-live-health",
      liveHealth,
      live.executionEnabled ? (live.auto ? "Real execution armed" : "Real execution ready") : "Real execution locked"
    );

    const blocked =
      Boolean(risk.emergencyStop) ||
      Number(risk.dailyRiskUsedPct || 0) >= Number(risk.maxDailyRiskPct || 6) ||
      Number(state.engines?.totalOpen || 0) >= Number(state.engines?.totalMax || 6);

    setHealth(
      "dd-risk-health",
      blocked ? "BLOCKED" : "PASS",
      risk.emergencyStop
        ? "Entry stop active"
        : Number(risk.dailyRiskUsedPct || 0).toFixed(2) + "% daily risk • " +
          Number(risk.maxDailyRiskPct || 6) + "% ceiling"
    );

    const summary = byId("dd-connection-summary");
    if (summary) {
      const mode = String(state.mode || "PAPER");
      const auto = Boolean(state.auto);
      summary.textContent = mode + (auto ? " • AUTO ACTIVE" : " • MANUAL / ARMED");
    }

    const clock = byId("dd-clock");
    if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour12: false });
  }

  async function pollHealth() {
    try {
      const mode = localStorage.getItem("dealdost.mode") || "PAPER";
      const response = await fetch("/api/state", {
        cache: "no-store",
        headers: { "x-dealdost-mode": mode }
      });
      if (!response.ok) return;
      renderState(await response.json());
    } catch {}
  }

  function boot() {
    ensureHealthRail();
    document.title = "DealDost • Global Execution Terminal";
    void pollHealth();
    window.setInterval(pollHealth, 10000);
    window.setInterval(() => {
      const clock = byId("dd-clock");
      if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour12: false });
    }, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
