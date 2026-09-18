/* DealDost dashboard stability guard
 * The terminal's 3-second timer performs trade/SL/TP management as well as
 * throttled rendering. Never block that timer globally: doing so can freeze
 * PAPER position management and stop automatic SL/TP exits.
 * Render throttling is handled inside app-terminal.js.
 */
(()=>{'use strict';
  window.__DD_DASHBOARD_STABILITY_GUARD_V2=true;
})();
