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

function toYahoo(sym: string): string {
  return SYMBOL_MAP[sym.toUpperCase()] ?? sym;
}

async function fetchChart(yahooSym: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=3y`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "application/json",
    },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`${yahooSym}: HTTP ${res.status}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`No data: ${yahooSym}`);

  const rawTimestamps: number[] = result.timestamp ?? [];
  const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

  // null 제거하면서 timestamp와 close를 함께 처리
  const paired = rawTimestamps
    .map((t, i) => ({ t, c: rawCloses[i] }))
    .filter((p): p is { t: number; c: number } => p.c !== null && isFinite(p.c));

  const prices = paired.map(p => p.c);
  const timestamps = paired.map(p => p.t * 1000); // ms로 변환
  const current = prices[prices.length - 1] ?? 0;
  const name: string = DISPLAY_NAMES[yahooSym] ?? result.meta?.shortName ?? yahooSym;

  return { prices, timestamps, current, name };
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
    /* 워치리스트 심볼 병렬 조회 */
    const symbolResults: Record<string, { current: number; prices: number[]; timestamps: number[]; name: string }> = {};
    await Promise.allSettled(
      (symbols as string[]).map(async (sym) => {
        try {
          const d = await fetchChart(toYahoo(sym));
          symbolResults[sym] = { current: d.current, prices: d.prices, timestamps: d.timestamps, name: d.name };
        } catch (e) {
          console.warn("symbol fetch failed:", sym, e);
        }
      })
    );

    /* 매크로 지표 병렬 조회 */
    const macroMap = {
      spx:    "^GSPC",
      vix:    "^VIX",
      dxy:    "DX-Y.NYB",
      us10y:  "^TNX",
      kospi:  "^KS11",
      usdkrw: "KRW=X",
    };
    const macro: Record<string, { prices: number[]; current: number }> = {};
    await Promise.allSettled(
      Object.entries(macroMap).map(async ([key, ySym]) => {
        try {
          const d = await fetchChart(ySym);
          macro[key] = d;
        } catch (e) {
          console.warn("macro fetch failed:", key, e);
        }
      })
    );

    const spxRatio  = macro.spx   ? macro.spx.current   / sma(macro.spx.prices,   200) : 1;
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
