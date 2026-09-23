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
- LIVE execution intentionally not wired yet

Paper configuration:
- PAPER_BALANCE_USDT
- PAPER_FEE_BPS
- PAPER_SLIPPAGE_BPS
- PAPER_AUTO

Current execution boundary:
- PAPER is local simulation only.
- TESTNET and LIVE adapters are not enabled in this phase.
- Never put real Binance API keys in the repository.

Binance WebSocket market connections are treated as reconnectable streams, with heartbeat/reconnect handling and stale-data gating.


Testnet phase 1:
- Dedicated Binance Futures Demo/Testnet credentials are read only from environment variables.
- Dashboard can sync testnet USDT balance and open positions without touching PAPER state.
- Testnet execution remains disabled until explicitly enabled and is not wired into PAPER auto-trading.
