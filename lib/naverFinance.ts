const NAVER_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  "Referer": "https://finance.naver.com",
  "Cache-Control": "no-cache",
};

export interface PricePoint {
  date: string;
  close: number;
  volume: number;
}

export interface Fundamentals {
  price: number;
  changeRate: number;
  per: number | null;
  pbr: number | null;
  dividendYield: number | null;
}

/**
 * Fetch daily price history from Naver Finance.
 * Returns array of {date, close, volume} sorted oldest-first.
 */
export async function fetchNaverPriceHistory(
  code: string,
  days: number = 120
): Promise<PricePoint[]> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days - 30); // extra buffer for weekends/holidays

  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

  const url =
    `https://api.finance.naver.com/siseJson.naver?symbol=${code}` +
    `&requestType=1&startTime=${fmt(start)}&endTime=${fmt(end)}&timeframe=day`;

  try {
    const res = await fetch(url, {
      headers: NAVER_HEADERS,
      cache: "no-store",
    });
    if (!res.ok) return [];

    const text = await res.text();
    // Parse the unusual format: [['날짜','시가','고가','저가','종가','거래량','외국인소진율'], [...], ...]
    // Strip any outer whitespace/parens
    const cleaned = text.trim().replace(/^\(/, "").replace(/\)$/, "");
    const rows: (string | number)[][] = JSON.parse(cleaned);

    // Skip header row
    const result: PricePoint[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 6) continue;
      const date = String(row[0]).trim();
      const close = Number(row[4]);
      const volume = Number(row[5]);
      if (!date || isNaN(close) || close <= 0) continue;
      result.push({ date, close, volume });
    }

    // Sort oldest first
    result.sort((a, b) => a.date.localeCompare(b.date));
    return result;
  } catch {
    return [];
  }
}

/**
 * Fetch current price + fundamentals from Naver mobile API.
 */
export async function fetchNaverFundamentals(
  code: string
): Promise<Fundamentals> {
  const fallback: Fundamentals = {
    price: 0,
    changeRate: 0,
    per: null,
    pbr: null,
    dividendYield: null,
  };

  try {
    const basicUrl = `https://m.stock.naver.com/api/stock/${code}/basic`;
    const basicRes = await fetch(basicUrl, {
      headers: NAVER_HEADERS,
      cache: "no-store",
    });

    if (!basicRes.ok) return fallback;
    const basicData = await basicRes.json();

    const priceStr: string = basicData?.closePrice ?? "0";
    const price = Number(priceStr.replace(/,/g, ""));
    const changeRate = Number(basicData?.fluctuationsRatio ?? 0);

    let per: number | null = null;
    let pbr: number | null = null;
    let dividendYield: number | null = null;

    try {
      const summaryUrl = `https://m.stock.naver.com/api/stock/${code}/finance/summary`;
      const summaryRes = await fetch(summaryUrl, {
        headers: NAVER_HEADERS,
        cache: "no-store",
      });

      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        // Summary data structure varies; try common fields
        const finData =
          summaryData?.financeInfo ??
          summaryData?.summary ??
          summaryData ??
          {};

        const perVal = Number(finData?.per ?? finData?.PER ?? NaN);
        const pbrVal = Number(finData?.pbr ?? finData?.PBR ?? NaN);
        const divVal = Number(
          finData?.dividendYield ??
          finData?.dividend_yield ??
          finData?.yieldOfDividend ??
          NaN
        );

        per = isNaN(perVal) || perVal <= 0 ? null : perVal;
        pbr = isNaN(pbrVal) || pbrVal <= 0 ? null : pbrVal;
        dividendYield = isNaN(divVal) || divVal <= 0 ? null : divVal;
      }
    } catch {
      // fundamentals optional; keep nulls
    }

    return { price, changeRate, per, pbr, dividendYield };
  } catch {
    return fallback;
  }
}
