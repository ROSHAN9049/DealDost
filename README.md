# Binance Scanner · DealDost

Clean rebuild of the DeltaScanner dashboard architecture, converted to Binance USDⓈ-M perpetual futures market data.

- Live Binance Futures 24H price/change/volume
- Top 50 eligible USDT perpetuals by absolute 24H change
- Momentum engine: 5m + 15m confirmation
- Scalping engine: 1m + 5m confirmation
- Paper trading only
- Virtual capital, risk %, SL, TP, profit lock and ATR trailing
- No Binance API keys and no real orders

The scanner source is based on the existing `ROSHAN9049/deltascanner` UI/logic and is converted to Binance during the Vercel build.
