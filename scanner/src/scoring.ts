export type Trade = { side: 'buy'|'sell'; solAmount: number; at: number };
export type Snapshot = { volume5m: number; buys5m: number; sells5m: number; score: number; flags: string[] };

export function scoreTrades(trades: Trade[], now = Date.now()): Snapshot {
  const recent = trades.filter(t => t.at >= now - 5 * 60_000);
  const volume5m = recent.reduce((sum, t) => sum + Math.max(0, t.solAmount), 0);
  const buys5m = recent.filter(t => t.side === 'buy').length;
  const sells5m = recent.filter(t => t.side === 'sell').length;
  const total = buys5m + sells5m;
  const buyRatio = total ? buys5m / total : 0;
  let score = 20 + Math.min(30, volume5m * 1.5) + Math.min(25, buys5m * 1.5);
  if (buyRatio >= .65) score += 15; else if (buyRatio >= .55) score += 7;
  const flags: string[] = [];
  if (sells5m > buys5m * 1.5) flags.push('sell_pressure');
  if (volume5m < 5) flags.push('low_volume');
  if (total < 5) flags.push('thin_activity');
  return { volume5m, buys5m, sells5m, score: Math.max(0, Math.min(100, Math.round(score))), flags };
}
