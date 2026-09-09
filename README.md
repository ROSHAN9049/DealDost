# DealDost — Binance Futures Scanner

Clean Binance-only market scanner based on the stronger dual-engine setup developed in `deltascanner`.

## Included
- Binance USDⓈ-M perpetual futures public market feed
- Stable Top 50 coin universe persisted in browser storage
- Live price, 24H change and volume updates without reshuffling tracked coins
- Momentum engine: 5m → 15m confirmation, EMA 5/13, RSI, volume spike, score ≥75
- Scalping engine: 1m → 5m confirmation, EMA 5/13, RSI, volume spike, score ≥80
- Paper entries, virtual capital, SL, TP1, profit lock, ATR trailing and final TP
- Market Radar: Top Pump, Top Dump and Volume Spike
- Search, minimum volume, minimum 24H change and minimum score filters
- Paper analytics and position/history panels
- Reset Stable Coins control for intentionally creating a new Top 50

## Binance-only rule
This repository contains no Delta Exchange API integration. The runtime market source is Binance Futures only.

## Safety
- Paper trading only.
- No Binance API keys are requested, stored or used.
- No real Binance order endpoint is called.
- Any future live-trading work must be a separate server-side stage with explicit approval, testnet validation and risk controls.
