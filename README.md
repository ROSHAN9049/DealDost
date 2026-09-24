# DealDost Binance Scanner V2

Fresh scanner-first architecture for Binance USDⓈ-M Futures.

Implemented:
- Liquid USDT perpetual universe selection
- Top 50 universe by 24h quote volume after filters
- REST history bootstrap for 1m, 5m and 15m candles
- Live combined WebSocket market feed
- Automatic reconnect and stale-data detection
- Market regime classification
- Momentum and Scalping engines
- WATCH / SETUP / CONFIRMED / BLOCKED stages
- Transparent 0-100 quality score
- Central risk governor
- Maximum 3 Momentum + 3 Scalping + 6 total position slots
- Global symbol lock and cooldown rules
- ATR-aware entry, stop and take-profit preview
- Server-owned scanner state; UI is read-only
- Paper broker with simulated slippage and configurable fees
- Paper position lifecycle with SL/TP/manual close
- Paper P&L, trade history, win rate and fee tracking
- Profit Rotation V3 event ledger
- PAPER / TESTNET / LIVE mode labels
- TESTNET execution adapter with 1x leverage enforcement, exchange filters, minimum-notional checks, protected SL/TP and emergency close
- Exchange-reconciled TESTNET position/engine counting and same-day loss risk gate
- Isolated LIVE execution adapter using the same execution contract without sharing TESTNET credentials/state
- LIVE 16-gate preflight, 1x leverage enforcement, protected SL/TP and emergency-close fallback
- PAPER / TESTNET / LIVE request-mode routing with LIVE fail-closed locking

Paper configuration:
- PAPER_BALANCE_USDT
- PAPER_FEE_BPS
- PAPER_SLIPPAGE_BPS
- PAPER_AUTO

Current execution boundary:
- PAPER is local simulation only and uses its own AUTO switch.
- TESTNET uses the dedicated Binance Futures Demo/Testnet account only when credentials and BINANCE_TESTNET_EXECUTION_ENABLED=true are present; TESTNET AUTO is independently controlled from PAPER AUTO.
- LIVE execution is disabled by default. It requires separate LIVE credentials plus BINANCE_LIVE_EXECUTION_ENABLED=true; without both, LIVE selection and AUTO remain fail-closed.
- Never put Binance API keys or secrets in the repository.

Binance WebSocket market connections are treated as reconnectable streams, with heartbeat/reconnect handling and stale-data gating.

## Railway deployment
- The primary Node runtime is `src/index.ts` -> `dist/index.js`; `npm run build` compiles it and `npm start` runs the persistent server.
- The persistent server binds to `0.0.0.0` and reads Railway's injected `PORT` environment variable automatically.
- The same server serves `public/`, REST API routes, and the WebSocket endpoint, so Railway can host the scanner as one service without the Vercel serverless adapter.
- Railway deployment should use the repository root with Build Command `npm run build` and Start Command `npm start` (Railway can also auto-detect the `start` script).
- Required secrets stay in Railway service variables; never commit Binance API keys or secrets.


Testnet phase 1:
- Dedicated Binance Futures Demo/Testnet credentials are read only from environment variables.
- Dashboard can sync testnet USDT balance and open positions without touching PAPER state.
- Testnet execution remains disabled until explicitly enabled and is not wired into PAPER auto-trading.


TESTNET execution phase 2:
- Dashboard can switch between PAPER and TESTNET without connecting LIVE.
- PAPER AUTO and TESTNET AUTO are independent switches; selecting one mode never disables the other automation state.
- TESTNET AUTO only attempts orders when BINANCE_TESTNET_EXECUTION_ENABLED=true and credentials are configured server-side.
- Before an auto-entry, the scanner reconciles Binance Demo balance, open positions, engine tags, recent exits/cooldowns and same-day realized-loss/commission usage.
- Auto-entry is blocked when any open position is unclassified, total positions reach 6, Momentum reaches 3, Scalping reaches 3, or daily risk reaches 6%.
- Orders are forced to 1x leverage, sized from 1% account risk and available balance, and use exchange-valid quantity/price filters.
- Market entries require protected STOP_MARKET and TAKE_PROFIT_MARKET orders; if protection cannot be installed, the entry is immediately emergency-closed.
- LIVE uses a separate account client and state. It never reuses TESTNET credentials or position state.
- Because Vercel is serverless, this reconciliation is exchange-authoritative but is not a distributed transactional lock; the system therefore fails closed on missing reconciliation data and should not be treated as an atomic multi-instance position lock.

- TESTNET AUTO accepts only fresh CONFIRMED signals (Scalping <= 90s, Momentum <= 10m) and places at most one new entry per execution cycle.
- Dashboard exposes TESTNET and LIVE realized PNL and fees for the current IST trading day.
- LIVE AUTO never turns on implicitly; it remains OFF until the operator explicitly enables it after the separate LIVE account has been configured.
