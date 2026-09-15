# DealDost Binance Live Trading Setup

DealDost is Binance-only. The dashboard can scan live Binance Futures market data in PAPER mode and can sync a real Binance Futures account in LIVE mode.

## Vercel environment variables

Required only for real account sync / live orders:

- `BINANCE_API_KEY` — server-side Binance API key
- `BINANCE_API_SECRET` — server-side Binance API secret
- `LIVE_UNLOCKED=true` — explicit server-side live execution gate

Recommended safety controls:

- `LIVE_MAX_NOTIONAL_USDT=100` — maximum notional value accepted by one live order
- `LIVE_PROTECT_ORDERS=true` — place protective stop/TP after a market entry
- `LIVE_STOP_PCT=0.006` — default 0.6% stop distance
- `LIVE_TP_RR=2` — default 1:2 risk/reward target

## Binance API-key safety

Use a dedicated Binance API key. Enable only Futures trading permission required by the bot. Do not enable withdrawals. Restrict the key by IP when practical. Never put the secret in `index.html`, browser JavaScript, GitHub source, or localStorage.

## Operating modes

- PAPER: simulated entries, live public market data, paper fees, paper P&L.
- LIVE: real Binance Futures account balance/positions are synchronized through the server.
- AUTO LIVE: requires the user to switch to LIVE and explicitly confirm automatic real orders. The server still refuses all live orders unless `LIVE_UNLOCKED=true`.

## Strategy

Momentum: 5m + 15m confirmation, EMA 9/21, RSI, volume expansion, 24h direction and ATR risk sizing.

Scalping: 1m trigger + 5m trend, EMA 9, RSI, volume and ATR risk sizing.

The scanner ranks the liquid USDT perpetual universe first, then computes heavier indicators for the top symbols to avoid unnecessary Binance API load.

## Options

The Options page is a market radar. Naked option selling is disabled. Defined-risk spreads should be validated in paper mode before any future options execution work is enabled.

## Important

Live trading is not a guarantee of profit. Run PAPER mode first and verify signals, quantities, fees, fills, stop orders and account synchronization before enabling live execution.