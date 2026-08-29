# Pump.fun event adapter

The scanner subscribes to the configured Solana program with `onLogs` and then fetches confirmed transactions. Keep program-specific decoding in this directory.

Before production use, set `PUMPFUN_PROGRAM_ID` to the current official program ID and implement instruction/account decoding for the current Pump.fun/PumpSwap format. Do not classify a token as a buy/sell from token-balance presence alone.

Recommended normalized event contract:

- `eventType`: `launch | trade | graduation | unknown`
- `side`: `buy | sell | unknown`
- `mint`
- `trader`
- `solAmount`
- `tokenAmount`
- `priceSol`
- `signature`
- `slot`
