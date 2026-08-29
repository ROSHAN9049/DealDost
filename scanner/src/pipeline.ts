import { createClient } from '@supabase/supabase-js';
import { scoreTrades, type Trade } from './scoring.js';
import { sendTelegram } from './telegram.js';

const env = process.env as Record<string,string|undefined>;
const db = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
const trades = new Map<string, Trade[]>();
const lastAlert = new Map<string, number>();

export async function processTrade(input: { mint:string; side:'buy'|'sell'; solAmount:number; priceSol?:number; signature?:string; slot?:number }) {
  const now = Date.now();
  const list = trades.get(input.mint) ?? [];
  list.push({ side: input.side, solAmount: input.solAmount, at: now });
  const recent = list.filter(t => t.at >= now - 5*60_000);
  trades.set(input.mint, recent);
  const s = scoreTrades(recent, now);

  await db.from('token_events').insert({ mint:input.mint, signature:input.signature ?? null, slot:input.slot ?? null, event_type:'trade', side:input.side, sol_amount:input.solAmount, price_sol:input.priceSol ?? null, event_at:new Date(now).toISOString() });
  await db.from('tokens').upsert({ mint:input.mint, last_seen_at:new Date(now).toISOString(), volume_5m_sol:s.volume5m, buys_5m:s.buys5m, sells_5m:s.sells5m, score:s.score, risk_flags:s.flags, updated_at:new Date(now).toISOString() }, {onConflict:'mint'});

  const minScore = Number(env.TELEGRAM_MIN_SCORE ?? 75);
  const cooldown = Number(env.ALERT_COOLDOWN_SECONDS ?? 900) * 1000;
  if (s.score >= minScore && now - (lastAlert.get(input.mint) ?? 0) >= cooldown) {
    lastAlert.set(input.mint, now);
    const message = `🚨 NOVA Pulse Alert\nMint: ${input.mint}\nScore: ${s.score}/100\n5m volume: ${s.volume5m.toFixed(2)} SOL\nBuys/Sells: ${s.buys5m}/${s.sells5m}\nRisk: ${s.flags.join(', ') || 'none'}\n\nResearch alert only.`;
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, message);
    await db.from('alerts').insert({mint:input.mint,alert_type:'high_score',score:s.score,message,sent_to:env.TELEGRAM_CHAT_ID ?? null});
  }
}
