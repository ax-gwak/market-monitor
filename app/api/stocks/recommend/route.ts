import { NextRequest, NextResponse } from "next/server";
import { getStockUniverse, Stock } from "@/lib/stockUniverse";
import { calcShortTermScore, calcLongTermScore } from "@/lib/screeners";
import { fetchNaverFundamentals } from "@/lib/naverFinance";
import {
  generateShortTermRecommendations,
  generateLongTermRecommendations,
  StockRecommendation,
} from "@/lib/stockAI";

// SSL proxy bypass (same as next.config.ts)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const UA = "Mozilla/5.0";
const SPARK_HEADERS = {
  "User-Agent": UA,
  Accept: "*/*",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const MAX_PER_BUCKET = 20; // max stocks per category to screen

interface SparkResult {
  prices: number[];
  volumes: number[];
  timestamps: number[];
  current: number;
}

async function fetchSparkBatch(
  yahooSymbols: string[]
): Promise<Record<string, SparkResult>> {
  if (yahooSymbols.length === 0) return {};

  const symbolsParam = yahooSymbols.map(encodeURIComponent).join(",");
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${symbolsParam}&range=6mo&interval=1d`;

  let res = await fetch(url, { headers: SPARK_HEADERS, cache: "no-store" });
  if (!res.ok) {
    res = await fetch(url.replace("query1", "query2"), {
      headers: SPARK_HEADERS,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Spark HTTP ${res.status}`);
  }

  const json = await res.json();
  const results: Record<string, SparkResult> = {};

  for (const item of json.spark?.result ?? []) {
    const sym: string = item.symbol;
    const result = item.response?.[0];
    if (!result) continue;

    const rawTs: number[] = result.timestamp ?? [];
    const rawClose: (number | null)[] =
      result.indicators?.quote?.[0]?.close ?? [];
    const rawVol: (number | null)[] =
      result.indicators?.quote?.[0]?.volume ?? [];

    const paired = rawTs
      .map((t: number, i: number) => ({ t, c: rawClose[i], v: rawVol[i] }))
      .filter(
        (p): p is { t: number; c: number; v: number } =>
          p.c != null && isFinite(p.c)
      );

    results[sym] = {
      prices: paired.map((p) => p.c),
      volumes: paired.map((p) => p.v ?? 0),
      timestamps: paired.map((p) => p.t * 1000),
      current: result.meta?.regularMarketPrice ?? paired.at(-1)?.c ?? 0,
    };
  }

  return results;
}

function toYahooTicker(stock: Stock): string {
  return `${stock.code}.${stock.market === "KOSPI" ? "KS" : "KQ"}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  if (type !== "short" && type !== "long") {
    return NextResponse.json(
      { error: "type must be 'short' or 'long'" },
      { status: 400 }
    );
  }

  const universe = getStockUniverse();

  // Separate into 4 buckets, shuffle and limit for performance
  const kospiLarge = shuffle(
    universe.filter((s) => s.market === "KOSPI" && s.isLargeCap)
  ).slice(0, MAX_PER_BUCKET);
  const kospiSmall = shuffle(
    universe.filter((s) => s.market === "KOSPI" && !s.isLargeCap)
  ).slice(0, MAX_PER_BUCKET);
  const kosdaqLarge = shuffle(
    universe.filter((s) => s.market === "KOSDAQ" && s.isLargeCap)
  ).slice(0, MAX_PER_BUCKET);
  const kosdaqSmall = shuffle(
    universe.filter((s) => s.market === "KOSDAQ" && !s.isLargeCap)
  ).slice(0, MAX_PER_BUCKET);

  const allStocks = [...kospiLarge, ...kospiSmall, ...kosdaqLarge, ...kosdaqSmall];

  // Build Yahoo Finance tickers
  const tickers = allStocks.map(toYahooTicker);

  // Batch fetch in chunks of 20
  const CHUNK = 20;
  const sparkMap: Record<string, SparkResult> = {};

  for (let i = 0; i < tickers.length; i += CHUNK) {
    const chunk = tickers.slice(i, i + CHUNK);
    try {
      const batchResult = await fetchSparkBatch(chunk);
      Object.assign(sparkMap, batchResult);
    } catch (err) {
      console.error(`Spark batch error for chunk ${i}:`, err);
      // Continue with other chunks
    }
  }

  // Map stock code -> spark data
  const stockDataMap: Record<
    string,
    { prices: { close: number; volume: number }[]; current: number }
  > = {};
  for (const stock of allStocks) {
    const ticker = toYahooTicker(stock);
    const sparkData = sparkMap[ticker];
    if (!sparkData || sparkData.prices.length < 60) continue;

    stockDataMap[stock.code] = {
      prices: sparkData.prices.map((c, i) => ({ close: c, volume: sparkData.volumes[i] ?? 0 })),
      current: sparkData.current,
    };
  }

  if (type === "short") {
    // Screen and collect candidates per bucket
    const screenBucket = (
      stocks: Stock[]
    ): Array<{
      code: string;
      name: string;
      market: string;
      isLargeCap: boolean;
      currentPrice: number;
      changeRate: number;
      score: number;
      horizon: "1~2주" | "1달";
      rsi14: number;
      roc5: number;
      roc20: number;
      volumeRatio: number;
    }> => {
      const candidates = [];
      for (const stock of stocks) {
        const data = stockDataMap[stock.code];
        if (!data) continue;
        const result = calcShortTermScore(data.prices);
        if (!result) continue;

        const prices = data.prices.map((p) => p.close);
        const prev = prices[prices.length - 2] ?? data.current;
        const changeRate =
          prev > 0 ? ((data.current - prev) / prev) * 100 : 0;

        candidates.push({
          code: stock.code,
          name: stock.name,
          market: stock.market,
          isLargeCap: stock.isLargeCap,
          currentPrice: data.current,
          changeRate,
          score: result.score,
          horizon: result.horizon,
          rsi14: result.rsi14,
          roc5: result.roc5,
          roc20: result.roc20,
          volumeRatio: result.volumeRatio,
        });
      }
      return candidates.sort((a, b) => b.score - a.score).slice(0, 10);
    };

    const kospiLargeCands = screenBucket(kospiLarge);
    const kospiSmallCands = screenBucket(kospiSmall);
    const kosdaqLargeCands = screenBucket(kosdaqLarge);
    const kosdaqSmallCands = screenBucket(kosdaqSmall);

    const allCands = [
      ...kospiLargeCands,
      ...kospiSmallCands,
      ...kosdaqLargeCands,
      ...kosdaqSmallCands,
    ];

    const aiRecs = await generateShortTermRecommendations(allCands);

    const byCode: Record<string, StockRecommendation> = {};
    for (const r of aiRecs) byCode[r.code] = r;

    const toRecs = (cands: typeof kospiLargeCands) =>
      cands.map((c) => byCode[c.code]).filter(Boolean);

    return NextResponse.json({
      kospi: {
        large: toRecs(kospiLargeCands),
        small: toRecs(kospiSmallCands),
      },
      kosdaq: {
        large: toRecs(kosdaqLargeCands),
        small: toRecs(kosdaqSmallCands),
      },
      generatedAt: new Date().toISOString(),
    });
  } else {
    // Long-term: fetch fundamentals for top candidates
    const screenBucketLong = async (
      stocks: Stock[]
    ): Promise<
      Array<{
        code: string;
        name: string;
        market: string;
        isLargeCap: boolean;
        currentPrice: number;
        changeRate: number;
        score: number;
        momentum6m: number;
        belowSma200: boolean;
        per: number | null;
        pbr: number | null;
        dividendYield: number | null;
        cnsPer: number | null;
        epsGrowth: number | null;
        opsGrowthYoY: number | null;
        effectivePer: number | null;
      }>
    > => {
      // First pass: screen without fundamentals to get top candidates
      const preCandidates = [];
      for (const stock of stocks) {
        const data = stockDataMap[stock.code];
        if (!data) continue;
        const result = calcLongTermScore(data.prices, {
          per: null, pbr: null, dividendYield: null,
        });
        if (!result) continue;

        const prices = data.prices.map((p) => p.close);
        const prev = prices[prices.length - 2] ?? data.current;
        const changeRate =
          prev > 0 ? ((data.current - prev) / prev) * 100 : 0;

        preCandidates.push({ stock, data, result, changeRate });
      }

      // Take top 20 by pre-score, then fetch fundamentals
      preCandidates.sort((a, b) => b.result.score - a.result.score);
      const top20 = preCandidates.slice(0, 20);

      const fundResults = await Promise.all(
        top20.map(async ({ stock }) => {
          try {
            return await fetchNaverFundamentals(stock.code);
          } catch {
            return {
              price: 0, changeRate: 0,
              per: null, pbr: null, dividendYield: null,
              cnsPer: null, cnsEps: null, eps: null, opsGrowthYoY: null,
            };
          }
        })
      );

      // Re-score with full fundamentals
      const candidates = [];
      for (let i = 0; i < top20.length; i++) {
        const { stock, data, changeRate } = top20[i];
        const fund = fundResults[i];
        const result = calcLongTermScore(data.prices, {
          per: fund.per,
          pbr: fund.pbr,
          dividendYield: fund.dividendYield,
          cnsPer: fund.cnsPer,
          cnsEps: fund.cnsEps,
          eps: fund.eps,
          opsGrowthYoY: fund.opsGrowthYoY,
        });
        if (!result) continue;

        candidates.push({
          code: stock.code,
          name: stock.name,
          market: stock.market,
          isLargeCap: stock.isLargeCap,
          currentPrice: data.current,
          changeRate,
          score: result.score,
          momentum6m: result.momentum6m,
          belowSma200: result.belowSma200,
          per: fund.per,
          pbr: fund.pbr,
          dividendYield: fund.dividendYield,
          cnsPer: fund.cnsPer,
          epsGrowth: result.epsGrowth,
          opsGrowthYoY: fund.opsGrowthYoY,
          effectivePer: result.effectivePer,
        });
      }

      return candidates.sort((a, b) => b.score - a.score).slice(0, 10);
    };

    const [
      kospiLargeCands,
      kospiSmallCands,
      kosdaqLargeCands,
      kosdaqSmallCands,
    ] = await Promise.all([
      screenBucketLong(kospiLarge),
      screenBucketLong(kospiSmall),
      screenBucketLong(kosdaqLarge),
      screenBucketLong(kosdaqSmall),
    ]);

    const allCands = [
      ...kospiLargeCands,
      ...kospiSmallCands,
      ...kosdaqLargeCands,
      ...kosdaqSmallCands,
    ];

    const aiRecs = await generateLongTermRecommendations(allCands);

    const byCode: Record<string, StockRecommendation> = {};
    for (const r of aiRecs) byCode[r.code] = r;

    const toRecs = (
      cands: Awaited<ReturnType<typeof screenBucketLong>>
    ) => cands.map((c) => byCode[c.code]).filter(Boolean);

    return NextResponse.json({
      kospi: {
        large: toRecs(kospiLargeCands),
        small: toRecs(kospiSmallCands),
      },
      kosdaq: {
        large: toRecs(kosdaqLargeCands),
        small: toRecs(kosdaqSmallCands),
      },
      generatedAt: new Date().toISOString(),
    });
  }
}
