import { NextRequest, NextResponse } from "next/server";

/* ─── 심볼 매핑 ─── */
const SYMBOL_MAP: Record<string, string> = {
  KOSPI200: "^KS200",
  KOSPI:    "^KS11",
  SPX:      "^GSPC",
  SP500:    "^GSPC",
  NASDAQ:   "^IXIC",
  DOW:      "^DJI",
  NIKKEI:   "^N225",
  HSI:      "^HSI",
  GOLD:     "GC=F",
  OIL:      "CL=F",
  BTC:      "BTC-USD",
};

const DISPLAY_NAMES: Record<string, string> = {
  "^KS200":   "코스피200",
  "^KS11":    "코스피",
  "^GSPC":    "S&P 500",
  "^IXIC":    "나스닥",
  "^DJI":     "다우존스",
  "^N225":    "니케이225",
  "^HSI":     "항셍",
  "GC=F":     "금",
  "CL=F":     "원유 WTI",
  "BTC-USD":  "비트코인",
};

const UA = "Mozilla/5.0";

function toYahoo(sym: string): string {
  return SYMBOL_MAP[sym.toUpperCase()] ?? sym;
}

/* ─── 여러 심볼을 한 번에 조회 (spark 배치 요청) ─── */
async function fetchSparkBatch(yahooSymbols: string[]): Promise<Record<string, { prices: number[]; timestamps: number[]; current: number; name: string }>> {
  const symbolsParam = yahooSymbols.map(encodeURIComponent).join(",");
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${symbolsParam}&range=3y&interval=1d`;

  const fetchHeaders = {
    "User-Agent": UA,
    "Accept": "*/*",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
  };

  let res = await fetch(url, { headers: fetchHeaders, cache: "no-store" });

  if (!res.ok) {
    res = await fetch(url.replace("query1", "query2"), { headers: fetchHeaders, cache: "no-store" });
    if (!res.ok) throw new Error(`Spark batch HTTP ${res.status}`);
  }

  const json = await res.json();
  const results: Record<string, { prices: number[]; timestamps: number[]; current: number; name: string }> = {};

  for (const item of json.spark?.result ?? []) {
    const yahooSym: string = item.symbol;
    const result = item.response?.[0];
    if (!result) continue;

    const rawTimestamps: number[] = result.timestamp ?? [];
    const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

    const paired = rawTimestamps
      .map((t: number, i: number) => ({ t, c: rawCloses[i] }))
      .filter((p): p is { t: number; c: number } => p.c != null && isFinite(p.c));

    const prices = paired.map(p => p.c);
    const timestamps = paired.map(p => p.t * 1000);
    const current: number = result.meta?.regularMarketPrice ?? prices.at(-1) ?? 0;
    const name: string = DISPLAY_NAMES[yahooSym] ?? result.meta?.shortName ?? yahooSym;

    // 일봉 배열 마지막이 오래되었으면 regularMarketPrice를 끝에 보충
    const regularMarketTime: number | undefined = result.meta?.regularMarketTime;
    const lastTs = paired.at(-1)?.t ?? 0;
    if (current > 0 && regularMarketTime && regularMarketTime - lastTs > 86400) {
      prices.push(current);
      timestamps.push(regularMarketTime * 1000);
    }

    results[yahooSym] = { prices, timestamps, current, name };
  }

  return results;
}

function sma(prices: number[], len: number): number {
  const slice = prices.slice(-Math.min(len, prices.length));
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export async function POST(req: NextRequest) {
  const { symbols } = await req.json();

  if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
    return NextResponse.json({ error: "symbols required" }, { status: 400 });
  }

  try {
    /* ── 1차 배치: 워치리스트 심볼 ── */
    const watchlistYahoo = (symbols as string[]).map(toYahoo);
    const watchlistData = await fetchSparkBatch(watchlistYahoo);

    const symbolResults: Record<string, { current: number; prices: number[]; timestamps: number[]; name: string }> = {};
    (symbols as string[]).forEach(sym => {
      const d = watchlistData[toYahoo(sym)];
      if (d) symbolResults[sym] = d;
    });

    /* ── 2차 배치: 매크로 지표 ── */
    const macroYahooSymbols = ["^GSPC", "^VIX", "DX-Y.NYB", "^TNX", "^KS11", "KRW=X"];
    const macroData = await fetchSparkBatch(macroYahooSymbols);

    const macro = {
      spx:    macroData["^GSPC"],
      vix:    macroData["^VIX"],
      dxy:    macroData["DX-Y.NYB"],
      us10y:  macroData["^TNX"],
      kospi:  macroData["^KS11"],
      usdkrw: macroData["KRW=X"],
    };

    const spxRatio   = macro.spx   ? macro.spx.current   / sma(macro.spx.prices,   200) : 1;
    const kospiRatio = macro.kospi ? macro.kospi.current / sma(macro.kospi.prices, 200) : 1;

    return NextResponse.json({
      symbols: symbolResults,
      macro: {
        spx_ratio:   spxRatio,
        vix:         macro.vix?.current   ?? 20,
        dxy:         macro.dxy?.current   ?? 100,
        us10y:       macro.us10y?.current ?? 4.2,
        kospi_ratio: kospiRatio,
        usdkrw:      macro.usdkrw?.current ?? 1380,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
