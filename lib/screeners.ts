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

function calcMacd(closes: number[]): { macd: number; signal: number; histogram: number } {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine, 9);
  const last = macdLine.length - 1;
  const macd = macdLine[last];
  const signal = signalLine[last];
  return { macd, signal, histogram: macd - signal };
}

function calcBollingerBands(closes: number[], period: number = 20): {
  upper: number; middle: number; lower: number; percentB: number;
} {
  if (closes.length < period) {
    return { upper: 0, middle: 0, lower: 0, percentB: 0.5 };
  }
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = middle + 2 * stdDev;
  const lower = middle - 2 * stdDev;
  const last = closes[closes.length - 1];
  const percentB = upper !== lower ? (last - lower) / (upper - lower) : 0.5;
  return { upper, middle, lower, percentB };
}

function calcStochastic(closes: number[], period: number = 14): { k: number; d: number } {
  if (closes.length < period) return { k: 50, d: 50 };
  const kValues: number[] = [];
  for (let i = Math.max(0, closes.length - 3 - period); i <= closes.length - period; i++) {
    const slice = closes.slice(i, i + period);
    const high = Math.max(...slice);
    const low = Math.min(...slice);
    const last = slice[slice.length - 1];
    kValues.push(high !== low ? ((last - low) / (high - low)) * 100 : 50);
  }
  const k = kValues[kValues.length - 1] ?? 50;
  const d = kValues.length >= 3
    ? kValues.slice(-3).reduce((a, b) => a + b, 0) / 3
    : k;
  return { k, d };
}

/* ─── Normalization helper ─── */

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function normalize(val: number, min: number, max: number): number {
  if (max === min) return 50;
  return clamp(((val - min) / (max - min)) * 100, 0, 100);
}

/* ─── Short-term screener ─── */

export interface ShortTermResult {
  rsi14: number;
  roc5: number;
  roc20: number;
  volumeRatio: number;
  aboveEma20: boolean;
  aboveEma60: boolean;
  macdHistogram: number;
  bollingerPctB: number;
  stochasticK: number;
  score: number;
  horizon: "1~2주" | "1달";
}

export function calcShortTermScore(
  prices: { close: number; volume: number }[]
): ShortTermResult | null {
  if (prices.length < 20) return null;

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
      ? ((last - closes[closes.length - 21]) / closes[closes.length - 21]) * 100
      : 0;

  // RSI
  const rsi14 = calcRsi(closes, 14);

  // EMA
  const ema20 = ema(closes, 20);
  const ema60 = closes.length >= 60 ? ema(closes, 60) : null;
  const aboveEma20 = last > ema20[ema20.length - 1];
  const aboveEma60 = ema60 ? last > ema60[ema60.length - 1] : false;

  // MACD
  const { histogram: macdHistogram } = calcMacd(closes);

  // Bollinger Bands
  const { percentB: bollingerPctB } = calcBollingerBands(closes, 20);

  // Stochastic
  const { k: stochasticK } = calcStochastic(closes, 14);

  // Volume ratio (recent 5-day avg vs 20-day avg)
  const recentVol = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const baseVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volumeRatio = baseVol > 0 ? recentVol / baseVol : 1;

  // === Normalized scoring (0~100 scale per indicator, then weighted average) ===
  const components: { value: number; weight: number }[] = [];

  // RSI: 50~65 optimal zone for momentum, >70 overbought penalty, <30 oversold
  let rsiScore: number;
  if (rsi14 >= 50 && rsi14 <= 65) rsiScore = 90;
  else if (rsi14 > 65 && rsi14 <= 70) rsiScore = 60;
  else if (rsi14 >= 40 && rsi14 < 50) rsiScore = 50;
  else if (rsi14 > 70 && rsi14 <= 80) rsiScore = 20;
  else if (rsi14 > 80) rsiScore = 0;
  else if (rsi14 >= 30 && rsi14 < 40) rsiScore = 30;
  else rsiScore = 10;
  components.push({ value: rsiScore, weight: 20 });

  // ROC5: momentum strength (threshold raised)
  let roc5Score: number;
  if (roc5 > 10) roc5Score = 100;
  else if (roc5 > 5) roc5Score = 85;
  else if (roc5 > 2) roc5Score = 65;
  else if (roc5 > 0) roc5Score = 45;
  else if (roc5 > -3) roc5Score = 25;
  else roc5Score = 10;
  components.push({ value: roc5Score, weight: 15 });

  // ROC20: medium-term trend (threshold raised)
  let roc20Score: number;
  if (roc20 > 15) roc20Score = 100;
  else if (roc20 > 10) roc20Score = 85;
  else if (roc20 > 5) roc20Score = 65;
  else if (roc20 > 0) roc20Score = 45;
  else if (roc20 > -5) roc20Score = 25;
  else roc20Score = 10;
  components.push({ value: roc20Score, weight: 10 });

  // EMA trend: above both = strong, above 20 only = moderate
  let emaScore = 0;
  if (aboveEma20 && aboveEma60) emaScore = 100;
  else if (aboveEma20) emaScore = 65;
  else if (aboveEma60) emaScore = 40;
  else emaScore = 10;
  components.push({ value: emaScore, weight: 10 });

  // Volume: doubled weight, higher thresholds
  let volScore: number;
  if (volumeRatio > 3.0) volScore = 100;
  else if (volumeRatio > 2.0) volScore = 85;
  else if (volumeRatio > 1.5) volScore = 70;
  else if (volumeRatio > 1.2) volScore = 50;
  else if (volumeRatio > 0.8) volScore = 30;
  else volScore = 10;
  components.push({ value: volScore, weight: 20 });

  // MACD histogram: positive = bullish momentum
  let macdScore: number;
  if (macdHistogram > 0 && last > 0) {
    const macdRatio = (macdHistogram / last) * 100;
    if (macdRatio > 1) macdScore = 100;
    else if (macdRatio > 0.3) macdScore = 80;
    else macdScore = 60;
  } else if (macdHistogram > 0) {
    macdScore = 60;
  } else {
    macdScore = 20;
  }
  components.push({ value: macdScore, weight: 10 });

  // Bollinger %B: 0.5~0.8 optimal (above middle, not at upper)
  let bbScore: number;
  if (bollingerPctB >= 0.5 && bollingerPctB <= 0.8) bbScore = 90;
  else if (bollingerPctB > 0.8 && bollingerPctB <= 1.0) bbScore = 50;
  else if (bollingerPctB > 1.0) bbScore = 20;
  else if (bollingerPctB >= 0.2 && bollingerPctB < 0.5) bbScore = 60;
  else bbScore = 30;
  components.push({ value: bbScore, weight: 8 });

  // Stochastic: 20~80 zone, avoid extremes
  let stochScore: number;
  if (stochasticK >= 50 && stochasticK <= 80) stochScore = 85;
  else if (stochasticK >= 30 && stochasticK < 50) stochScore = 60;
  else if (stochasticK > 80) stochScore = 25;
  else stochScore = 30;
  components.push({ value: stochScore, weight: 7 });

  // Weighted average → final score (0~100)
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const score = Math.round(
    components.reduce((sum, c) => sum + c.value * c.weight, 0) / totalWeight
  );

  const horizon: "1~2주" | "1달" =
    rsi14 >= 55 && roc5 > 5 && volumeRatio > 1.5 ? "1~2주" : "1달";

  return {
    rsi14, roc5, roc20, volumeRatio, aboveEma20, aboveEma60,
    macdHistogram, bollingerPctB, stochasticK,
    score, horizon,
  };
}

/* ─── Long-term screener ─── */

export interface LongTermResult {
  momentum6m: number;
  belowSma200: boolean;
  rsi14: number;
  per: number | null;
  pbr: number | null;
  dividendYield: number | null;
  cnsPer: number | null;
  epsGrowth: number | null;
  opsGrowthYoY: number | null;
  effectivePer: number | null;
  score: number;
}

export function calcLongTermScore(
  prices: { close: number; volume: number }[],
  fundamentals: {
    per: number | null;
    pbr: number | null;
    dividendYield: number | null;
    cnsPer?: number | null;
    cnsEps?: number | null;
    eps?: number | null;
    opsGrowthYoY?: number | null;
  }
): LongTermResult | null {
  if (prices.length < 20) return null;

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
  const cnsPer = fundamentals.cnsPer ?? null;
  const cnsEps = fundamentals.cnsEps ?? null;
  const eps = fundamentals.eps ?? null;
  const opsGrowthYoY = fundamentals.opsGrowthYoY ?? null;

  // EPS growth rate (improved: handle negative→positive turnaround separately)
  let epsGrowth: number | null = null;
  if (cnsEps !== null && eps !== null) {
    if (eps > 0) {
      epsGrowth = ((cnsEps - eps) / eps) * 100;
    } else if (eps < 0 && cnsEps > 0) {
      epsGrowth = 200;
    } else if (eps < 0 && cnsEps < 0) {
      epsGrowth = eps !== 0 ? ((Math.abs(eps) - Math.abs(cnsEps)) / Math.abs(eps)) * 100 : null;
    } else if (eps === 0) {
      epsGrowth = cnsEps > 0 ? 100 : cnsEps < 0 ? -100 : 0;
    }
  }

  // Effective PER: blend trailing PER (30%) + forward PER (70%)
  let effectivePer: number | null = null;
  if (cnsPer !== null && cnsPer > 0) {
    if (per !== null && per > 0) {
      effectivePer = per * 0.3 + cnsPer * 0.7;
    } else {
      effectivePer = cnsPer;
    }
  } else if (per !== null && per > 0) {
    effectivePer = per;
  }

  // === Normalized scoring (0~100 scale per indicator, then weighted average) ===
  const components: { value: number; weight: number }[] = [];

  // Effective PER scoring
  let perScore = 50;
  if (effectivePer !== null) {
    if (effectivePer <= 5) perScore = 100;
    else if (effectivePer <= 8) perScore = 90;
    else if (effectivePer <= 12) perScore = 80;
    else if (effectivePer <= 18) perScore = 60;
    else if (effectivePer <= 25) perScore = 40;
    else if (effectivePer <= 40) perScore = 25;
    else if (effectivePer <= 50) perScore = 15;
    else perScore = 5;
  }
  if (per !== null && per < 0) perScore = Math.max(0, perScore - 30);
  components.push({ value: perScore, weight: 20 });

  // EPS growth scoring
  let epsScore = 50;
  if (epsGrowth !== null) {
    if (epsGrowth >= 200) epsScore = 100;
    else if (epsGrowth > 100) epsScore = 90;
    else if (epsGrowth > 50) epsScore = 80;
    else if (epsGrowth > 20) epsScore = 65;
    else if (epsGrowth > 0) epsScore = 55;
    else if (epsGrowth > -10) epsScore = 40;
    else if (epsGrowth > -30) epsScore = 25;
    else epsScore = 10;
  }
  if (eps !== null && eps < 0 && cnsEps !== null && cnsEps > 0) {
    epsScore = Math.min(100, epsScore + 15);
  }
  components.push({ value: epsScore, weight: 18 });

  // Operating profit growth scoring
  let opsScore = 50;
  if (opsGrowthYoY !== null) {
    if (opsGrowthYoY > 100) opsScore = 100;
    else if (opsGrowthYoY > 50) opsScore = 85;
    else if (opsGrowthYoY > 20) opsScore = 70;
    else if (opsGrowthYoY > 0) opsScore = 55;
    else if (opsGrowthYoY > -10) opsScore = 40;
    else if (opsGrowthYoY > -30) opsScore = 25;
    else opsScore = 10;
  }
  components.push({ value: opsScore, weight: 12 });

  // PBR scoring
  let pbrScore = 50;
  if (pbr !== null) {
    if (pbr > 0 && pbr <= 0.5) pbrScore = 100;
    else if (pbr <= 1) pbrScore = 85;
    else if (pbr <= 1.5) pbrScore = 65;
    else if (pbr <= 2) pbrScore = 50;
    else if (pbr <= 3) pbrScore = 35;
    else if (pbr <= 5) pbrScore = 20;
    else if (pbr <= 8) pbrScore = 10;
    else pbrScore = 5;
  }
  components.push({ value: pbrScore, weight: 15 });

  // Dividend yield scoring
  let divScore = 30;
  if (dividendYield !== null) {
    if (dividendYield > 6) divScore = 100;
    else if (dividendYield > 4) divScore = 85;
    else if (dividendYield > 3) divScore = 70;
    else if (dividendYield > 2) divScore = 55;
    else if (dividendYield > 1) divScore = 40;
    else divScore = 20;
  }
  components.push({ value: divScore, weight: 10 });

  // RSI scoring (oversold = opportunity)
  let rsiScore: number;
  if (rsi14 < 30) rsiScore = 90;
  else if (rsi14 < 40) rsiScore = 75;
  else if (rsi14 < 50) rsiScore = 60;
  else if (rsi14 < 60) rsiScore = 45;
  else if (rsi14 < 70) rsiScore = 30;
  else rsiScore = 15;
  components.push({ value: rsiScore, weight: 5 });

  // Price vs SMA200
  let smaScore: number;
  if (priceVsSma200 < 0.85) smaScore = 95;
  else if (priceVsSma200 < 0.9) smaScore = 80;
  else if (priceVsSma200 < 1.0) smaScore = 65;
  else if (priceVsSma200 < 1.05) smaScore = 50;
  else if (priceVsSma200 < 1.15) smaScore = 35;
  else smaScore = 20;
  components.push({ value: smaScore, weight: 10 });

  // Momentum 6m scoring
  let momScore: number;
  if (momentum6m >= 0 && momentum6m <= 15) momScore = 85;
  else if (momentum6m > 15 && momentum6m <= 30) momScore = 70;
  else if (momentum6m >= -10 && momentum6m < 0) momScore = 65;
  else if (momentum6m >= -20 && momentum6m < -10) momScore = 50;
  else if (momentum6m > 30 && momentum6m <= 50) momScore = 45;
  else if (momentum6m < -20) momScore = 30;
  else momScore = 20;
  components.push({ value: momScore, weight: 10 });

  // Weighted average → final score (0~100)
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const score = Math.round(
    components.reduce((sum, c) => sum + c.value * c.weight, 0) / totalWeight
  );

  return {
    momentum6m, belowSma200, rsi14,
    per, pbr, dividendYield,
    cnsPer, epsGrowth, opsGrowthYoY, effectivePer,
    score,
  };
}
