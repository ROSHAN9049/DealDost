# DealDost — Binance Trading Command Center

DealDost is a Binance-only scanner and trading dashboard. It uses Binance public market data for analysis and keeps API secrets server-side.

## 1. Paper mode first

Paper mode is the default. It scans Binance USDT-M perpetuals and maintains simulated positions, fees, P&L and history.

Strategies:
- **Momentum:** closed 5m + 15m candles, EMA trend, RSI, volume expansion, 24h direction and ATR-based risk.
- **Scalping:** closed 1m trigger + 5m trend, EMA9/21, RSI, volume and ATR-based risk.
- **Options:** Binance Options exchangeInfo + mark/Greeks radar, with defined-risk spread candidates. Naked selling is OFF.

The engine uses closed candles for signals so the still-forming candle is not used for an entry decision.

## 2. Vercel environment variables for real Futures trading

Required:

- `BINANCE_API_KEY`
- `BINANCE_API_SECRET`
- `LIVE_UNLOCKED=true`

Recommended:

- `LIVE_MAX_NOTIONAL_USDT=100`
- `LIVE_PROTECT_ORDERS=true`
- `LIVE_STOP_PCT=0.006`
- `LIVE_TP_RR=2`

The server validates the Binance symbol, reads the server-side mark price, applies Binance quantity filters, enforces the notional cap, and creates protective conditional orders. If protection cannot be created after entry, the server attempts an emergency market close and reports the failure.

## 3. Binance API-key safety

Use a dedicated API key. Enable only the permissions required for Futures trading. **Never enable withdrawals.** Restrict by IP when practical. Never put the secret in browser JavaScript, HTML, GitHub source, or localStorage.

## 4. Operating modes

- **PAPER:** simulated trades only.
- **LIVE:** reads the real Binance Futures account and open positions.
- **AUTO LIVE:** explicit browser confirmation is required, and the server still refuses orders unless `LIVE_UNLOCKED=true`.

Daily loss blocking is intentionally not used by the current scanner; the hard server-side order/notional controls remain active.

## 5. Important Binance notes

Binance recommends using user data WebSocket streams for continuously monitoring account/order status because REST polling can lag during volatile markets. The current dashboard therefore treats REST account sync as the authoritative fallback; a future hardening step can add the authenticated user stream for event-level reconciliation.

## 6. Options

Binance Options exposes contract rules, expiry, strike, Greeks and mark prices through its Options API. The current Options page is intentionally a radar/defined-risk analysis module. Real Options order execution is **not** enabled by this scanner yet; do not treat an Options signal as a live order.

## 7. Before turning on real trading

Run Paper mode long enough to verify:
1. signals and reasons;
2. open-position counts;
3. quantity and notional calculations;
4. fees and P&L;
5. stop/TP protection;
6. Binance account synchronization;
7. manual close;
8. network/API error handling.

Live trading can lose money and no signal or strategy guarantees profit.