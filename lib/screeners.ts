/* ─── Technical indicator helpers ─── */

function ema(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    result.push(prices[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function sma(prices: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

function calcRsi(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

/* ─── Short-term screener ─── */

export interface ShortTermResult {
  rsi14: number;
  roc5: number;
  roc20: number;
  volumeRatio: number;
  aboveEma20: boolean;
  aboveEma60: boolean;
  score: number;
  horizon: "1~2주" | "1달";
}

export function calcShortTermScore(
  prices: { close: number; volume: number }[]
): ShortTermResult | null {
  if (prices.length < 60) return null;

  const closes = prices.map((p) => p.close);
  const volumes = prices.map((p) => p.volume);

  const last = closes[closes.length - 1];

  // ROC (Rate of Change)
  const roc5 =
    closes.length >= 6
      ? ((last - closes[closes.length - 6]) / closes[closes.length - 6]) * 100
      : 0;
  const roc20 =
    closes.length >= 21
      ? ((last - closes[closes.length - 21]) / closes[closes.length - 21]) *
        100
      : 0;

  // RSI
  const rsi14 = calcRsi(closes, 14);

  // EMA
  const ema20 = ema(closes, 20);
  const ema60 = ema(closes, 60);
  const aboveEma20 = last > ema20[ema20.length - 1];
  const aboveEma60 = last > ema60[ema60.length - 1];

  // Volume ratio (recent 5-day avg vs 20-day avg)
  const recentVol =
    volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const baseVol =
    volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volumeRatio = baseVol > 0 ? recentVol / baseVol : 1;

  // Scoring
  let score = 0;

  // RSI scoring
  if (rsi14 >= 50 && rsi14 <= 70) score += 30;
  else if (rsi14 >= 40 && rsi14 < 50) score += 15;
  else if (rsi14 > 70) score += 10;

  // ROC5 scoring
  if (roc5 > 2) score += 25;
  else if (roc5 > 0) score += 15;

  // ROC20 scoring
  if (roc20 > 5) score += 20;
  else if (roc20 > 0) score += 10;

  // EMA scoring
  if (aboveEma20) score += 15;
  if (aboveEma60) score += 10;

  // Volume scoring
  if (volumeRatio > 1.5) score += 10;
  else if (volumeRatio > 1.2) score += 5;

  const horizon: "1~2주" | "1달" =
    rsi14 >= 55 && roc5 > 3 && volumeRatio > 1.3 ? "1~2주" : "1달";

  return { rsi14, roc5, roc20, volumeRatio, aboveEma20, aboveEma60, score, horizon };
}

/* ─── Long-term screener ─── */

export interface LongTermResult {
  momentum6m: number;
  belowSma200: boolean;
  rsi14: number;
  per: number | null;
  pbr: number | null;
  dividendYield: number | null;
  score: number;
}

export function calcLongTermScore(
  prices: { close: number; volume: number }[],
  fundamentals: {
    per: number | null;
    pbr: number | null;
    dividendYield: number | null;
  }
): LongTermResult | null {
  if (prices.length < 60) return null;

  const closes = prices.map((p) => p.close);
  const last = closes[closes.length - 1];

  // Momentum 6m (~126 trading days)
  const idx6m = Math.max(0, closes.length - 126);
  const price6mAgo = closes[idx6m];
  const momentum6m =
    price6mAgo > 0 ? ((last - price6mAgo) / price6mAgo) * 100 : 0;

  // SMA200
  const sma200arr = sma(closes, Math.min(200, closes.length));
  const lastSma200 = sma200arr[sma200arr.length - 1];
  const belowSma200 = !isNaN(lastSma200) && last < lastSma200;
  const priceVsSma200 =
    !isNaN(lastSma200) && lastSma200 > 0 ? last / lastSma200 : 1;

  // RSI
  const rsi14 = calcRsi(closes, 14);

  const { per, pbr, dividendYield } = fundamentals;

  // Scoring
  let score = 0;

  // PER scoring
  if (per !== null) {
    if (per > 0 && per <= 10) score += 25;
    else if (per <= 15) score += 20;
    else if (per <= 20) score += 10;
    else if (per <= 25) score += 5;
  }

  // PBR scoring
  if (pbr !== null) {
    if (pbr > 0 && pbr <= 1) score += 20;
    else if (pbr <= 1.5) score += 15;
    else if (pbr <= 2) score += 8;
    else if (pbr <= 3) score += 3;
  }

  // Dividend yield scoring
  if (dividendYield !== null) {
    if (dividendYield > 4) score += 15;
    else if (dividendYield > 2) score += 10;
    else if (dividendYield > 1) score += 5;
  }

  // RSI scoring (oversold = opportunity for long-term)
  if (rsi14 < 40) score += 10;
  else if (rsi14 < 50) score += 5;

  // Price vs SMA200 scoring
  if (priceVsSma200 < 0.9) score += 15;
  else if (priceVsSma200 < 1.0) score += 10;
  else if (priceVsSma200 < 1.05) score += 5;

  // Momentum 6m scoring
  if (momentum6m >= 0 && momentum6m <= 30) score += 10;
  else if (momentum6m >= -20 && momentum6m < 0) score += 5;

  return { momentum6m, belowSma200, rsi14, per, pbr, dividendYield, score };
}
