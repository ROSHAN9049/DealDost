# Binance All-Coins Auto Engine

Fresh rebuild for Binance USDⓈ-M Futures.

## What it does
- Loads every active USDT perpetual contract from Binance `exchangeInfo`.
- Updates the complete universe from Binance 24h ticker data.
- Deep-confirms the highest-volume candidates with 1m + 5m + 15m candles.
- Generates BUY/SELL momentum signals using multi-timeframe trend and volume expansion.
- Runs a separate continuous Node.js execution worker.
- PAPER mode is the default; LIVE mode is explicit and server-side.
- Risk controls: position cap, per-trade risk, daily loss cap, cooldown, stop loss and 2R target.
- Quantity is normalised from Binance symbol filters before an order is sent.

## Important
The web dashboard is a monitor. The continuous worker must run on a VPS/container or another always-on server. A browser tab or ordinary Vercel page is not a 24/7 trading engine.

## Start dashboard
```bash
npm install
npm run dev
```

## Start worker
```bash
cp .env.example .env
npm run engine
```

Keep `TRADING_MODE=PAPER` until the strategy has been tested. For LIVE execution, store the Binance API key/secret only in the server environment and use the smallest permissions possible. Never commit `.env` or API secrets.

Binance market data and execution behaviour should be checked against the current official API documentation before enabling live trading.
