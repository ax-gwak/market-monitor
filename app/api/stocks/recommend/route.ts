import { NextRequest, NextResponse } from "next/server";
import { getStockUniverse, Stock } from "@/lib/stockUniverse";
import { calcShortTermScore, calcLongTermScore } from "@/lib/screeners";
import { fetchNaverFundamentals } from "@/lib/naverFinance";
import {
  generateShortTermRecommendations,
  generateLongTermRecommendations,
  StockRecommendation,
} from "@/lib/stockAI";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const UA = "Mozilla/5.0";
const SPARK_HEADERS = {
  "User-Agent": UA,
  Accept: "*/*",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const MIN_DATA_POINTS = 20;

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
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${symbolsParam}&range=1y&interval=1d`;

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

  const kospiLarge = universe.filter((s) => s.market === "KOSPI" && s.isLargeCap);
  const kospiSmall = universe.filter((s) => s.market === "KOSPI" && !s.isLargeCap);
  const kosdaqLarge = universe.filter((s) => s.market === "KOSDAQ" && s.isLargeCap);
  const kosdaqSmall = universe.filter((s) => s.market === "KOSDAQ" && !s.isLargeCap);

  const allStocks = [...kospiLarge, ...kospiSmall, ...kosdaqLarge, ...kosdaqSmall];
  console.log(`[Recommend] Screening ${allStocks.length} stocks (type=${type})`);

  const tickers = allStocks.map(toYahooTicker);

  const CHUNK = 20;
  const sparkMap: Record<string, SparkResult> = {};
  let sparkErrors = 0;

  for (let i = 0; i < tickers.length; i += CHUNK) {
    const chunk = tickers.slice(i, i + CHUNK);
    try {
      const batchResult = await fetchSparkBatch(chunk);
      Object.assign(sparkMap, batchResult);
    } catch (err) {
      sparkErrors++;
      console.error(`[Recommend] Spark batch error (chunk ${i / CHUNK + 1}):`, err instanceof Error ? err.message : err);
    }
  }

  const stockDataMap: Record<
    string,
    { prices: { close: number; volume: number }[]; current: number }
  > = {};
  let skippedCount = 0;
  for (const stock of allStocks) {
    const ticker = toYahooTicker(stock);
    const sparkData = sparkMap[ticker];
    if (!sparkData || sparkData.prices.length < MIN_DATA_POINTS) {
      if (sparkData) skippedCount++;
      continue;
    }

    stockDataMap[stock.code] = {
      prices: sparkData.prices.map((c, i) => ({ close: c, volume: sparkData.volumes[i] ?? 0 })),
      current: sparkData.current,
    };
  }

  console.log(`[Recommend] Data loaded: ${Object.keys(stockDataMap).length} stocks (${skippedCount} skipped for insufficient data, ${sparkErrors} batch errors)`);

  if (type === "short") {
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
      macdHistogram: number;
      bollingerPctB: number;
      stochasticK: number;
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
          macdHistogram: result.macdHistogram,
          bollingerPctB: result.bollingerPctB,
          stochasticK: result.stochasticK,
        });
      }
      return candidates.sort((a, b) => b.score - a.score).slice(0, 10);
    };

    const kospiLargeCands = screenBucket(kospiLarge);
    const kospiSmallCands = screenBucket(kospiSmall);
    const kosdaqLargeCands = screenBucket(kosdaqLarge);
    const kosdaqSmallCands = screenBucket(kosdaqSmall);

    console.log(`[Recommend:Short] Candidates: KOSPI(${kospiLargeCands.length}L/${kospiSmallCands.length}S) KOSDAQ(${kosdaqLargeCands.length}L/${kosdaqSmallCands.length}S)`);

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

      preCandidates.sort((a, b) => b.result.score - a.result.score);
      const top20 = preCandidates.slice(0, 20);

      const fundResults = await Promise.all(
        top20.map(async ({ stock }) => {
          try {
            return await fetchNaverFundamentals(stock.code);
          } catch (err) {
            console.warn(`[Recommend] Naver fundamentals failed for ${stock.code} (${stock.name}):`, err instanceof Error ? err.message : err);
            return {
              price: 0, changeRate: 0,
              per: null, pbr: null, dividendYield: null,
              cnsPer: null, cnsEps: null, eps: null, opsGrowthYoY: null,
            };
          }
        })
      );

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

    console.log(`[Recommend:Long] Candidates: KOSPI(${kospiLargeCands.length}L/${kospiSmallCands.length}S) KOSDAQ(${kosdaqLargeCands.length}L/${kosdaqSmallCands.length}S)`);

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
