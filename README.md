# NOVA Pulse — Pump.fun Token Scanner

Real-time Solana/Pump.fun research scanner: RPC/WebSocket -> Node scanner -> scoring -> Supabase -> Next.js dashboard -> Telegram alerts.

## Token concept
- Name: NOVA Pulse
- Ticker: $NOVA
- Theme: futuristic energy/community meme
- Chain: Solana

## Safety
This project is an analytics/alerting tool. It does not guarantee profits and must not be used for wash trading, manipulation, or deceptive launches.

## Setup
1. Run `supabase/schema.sql` in Supabase SQL Editor.
2. Copy `.env.example` to `.env` for the scanner.
3. Copy `dashboard/.env.example` to `dashboard/.env.local`.
4. Install dependencies in `scanner` and `dashboard`.
5. Set the current Pump.fun program ID and an RPC provider with WebSocket support.
6. Run scanner with `npm run dev`; dashboard with `npm run dev`.

The parser is an adapter: Pump.fun instruction/event layouts can change, so `scanner/src/pumpfun/parser.ts` must be kept aligned with the current on-chain format/provider.
