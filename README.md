# Binance Command Center

Fresh single-app rebuild for Binance only.

Features: all active USDT perpetual universe, rotating deep scan, Momentum, Scalping, green/red signals, paper P&L, SL/TP, equity, positions, history, Binance Options chain, PAPER/LIVE architecture.

PAPER is the default. LIVE execution is server-side and locked unless `LIVE_UNLOCKED=true` plus Binance credentials are configured. Never put API secrets in browser code or Git.

Binance market data uses the Futures and Options public APIs. Live orders are signed server-side.