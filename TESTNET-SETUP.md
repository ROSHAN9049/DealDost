# DealDost Binance Futures Demo setup

DealDost now supports three execution modes:

- PAPER — local simulated positions; no private Binance credentials needed.
- TESTNET — Binance Futures Demo orders with simulated funds.
- LIVE — real Binance Futures orders; server-side unlock required.

## Vercel environment variables for TESTNET

Set these on the Vercel project:

- `BINANCE_TESTNET_API_KEY` = Binance Futures Demo API key
- `BINANCE_TESTNET_API_SECRET` = Binance Futures Demo API secret
- `TESTNET_UNLOCKED` = `true`
- `BINANCE_FUTURES_DEMO_BASE_URL` = `https://demo-fapi.binance.com` (optional; this is the default)
- `TESTNET_MAX_NOTIONAL_USDT` = `100` (recommended initial cap)
- `TESTNET_STOP_PCT` = `0.006`
- `TESTNET_TP_RR` = `2`
- `TESTNET_PROTECT_ORDERS` = `true`

Never put the secret in frontend code, GitHub, or localStorage. The scanner calls only the Vercel server API; signing happens server-side.

## Important

TESTNET mode sends simulated orders to Binance Futures Demo, not the user's real Binance account. Binance documents Demo/Testnet as a non-real-funds environment. Keep LIVE locked until TESTNET has been observed for a sufficient period.

Options remain on the Binance Options public radar/paper engine in this build. Binance's current public Options API documentation exposes production Options endpoints, but this project does not assume an undocumented Options testnet. Real Options execution should be added only after a supported non-production Options environment and signed user-data flow are confirmed.
