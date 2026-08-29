export type AlertState = { lastSent: number };

export function shouldAlert(state: Map<string, AlertState>, mint: string, score: number, minScore: number, cooldownMs: number, now = Date.now()) {
  if (score < minScore) return false;
  const previous = state.get(mint);
  if (previous && now - previous.lastSent < cooldownMs) return false;
  state.set(mint, { lastSent: now });
  return true;
}

export function formatAlert(input: { name?: string; symbol?: string; mint: string; score: number; volume5m: number; buys5m: number; sells5m: number; flags: string[] }) {
  return [
    '🚨 NOVA Pulse Alert',
    `${input.name ?? 'Unknown'} ${input.symbol ? `$${input.symbol}` : ''}`.trim(),
    `Mint: ${input.mint}`,
    `Score: ${input.score}/100`,
    `5m volume: ${input.volume5m.toFixed(2)} SOL`,
    `Buys/Sells: ${input.buys5m}/${input.sells5m}`,
    `Risk: ${input.flags.join(', ') || 'none'}`,
    '',
    'Research alert only — not financial advice.'
  ].join('\n');
}
