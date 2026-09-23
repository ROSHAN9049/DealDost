export const sma = (values: number[], period: number): number => {
  if (values.length < period) return Number.NaN;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
};

export const emaSeries = (values: number[], period: number): number[] => {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i += 1) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
};

export const ema = (values: number[], period: number): number => {
  const series = emaSeries(values, period);
  return series.length ? series[series.length - 1] : Number.NaN;
};

export const rsi = (values: number[], period = 14): number => {
  if (values.length <= period) return Number.NaN;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
};

export const atr = (highs: number[], lows: number[], closes: number[], period = 14): number => {
  if (closes.length <= period) return Number.NaN;
  const trs: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    trs.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ),
    );
  }
  return sma(trs, period);
};

export const vwap = (
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  period = 30,
): number => {
  const start = Math.max(0, closes.length - period);
  let pv = 0;
  let volume = 0;
  for (let i = start; i < closes.length; i += 1) {
    const typical = (highs[i] + lows[i] + closes[i]) / 3;
    pv += typical * volumes[i];
    volume += volumes[i];
  }
  return volume > 0 ? pv / volume : Number.NaN;
};

export const macdHistogram = (
  values: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): number => {
  if (values.length < slow + signal) return Number.NaN;
  const fastSeries = emaSeries(values, fast);
  const slowSeries = emaSeries(values, slow);
  const macdSeries = values.map((_, i) => fastSeries[i] - slowSeries[i]);
  const signalSeries = emaSeries(macdSeries, signal);
  return macdSeries[macdSeries.length - 1] - signalSeries[signalSeries.length - 1];
};

export const percentChange = (current: number, previous: number): number =>
  previous === 0 ? 0 : ((current - previous) / previous) * 100;
