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
- Global symbol lock and cooldown preview
- ATR/structure-aware entry, stop and take-profit preview
- Server-owned state; UI is read-only
- PAPER / TESTNET / LIVE mode labels
- No real orders in this first scanner phase

Run:
1. Node.js 20+
2. npm install
3. Copy .env.example to .env
4. npm run dev
5. Open http://localhost:3000

Production:
- npm run build
- npm start

Safety boundary:
This phase is market-data and signal infrastructure only. It does not submit Binance orders. Real execution should be implemented later behind separate adapters and explicit gates.
