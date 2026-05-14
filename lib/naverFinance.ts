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
  cnsPer: number | null;
  cnsEps: number | null;
  eps: number | null;
  opsGrowthYoY: number | null;
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

function parseNaverNum(val: string | undefined | null): number | null {
  if (!val) return null;
  const n = Number(String(val).replace(/[,배원%]/g, ""));
  return isNaN(n) ? null : n;
}

/**
 * Fetch current price + fundamentals from Naver mobile API.
 * Uses /integration for PER/PBR/cnsPer/cnsEps and /finance/summary for profit growth.
 */
export async function fetchNaverFundamentals(
  code: string
): Promise<Fundamentals> {
  const fallback: Fundamentals = {
    price: 0, changeRate: 0,
    per: null, pbr: null, dividendYield: null,
    cnsPer: null, cnsEps: null, eps: null, opsGrowthYoY: null,
  };

  try {
    const [integrationRes, summaryRes] = await Promise.all([
      fetch(`https://m.stock.naver.com/api/stock/${code}/integration`, {
        headers: NAVER_HEADERS, cache: "no-store",
      }),
      fetch(`https://m.stock.naver.com/api/stock/${code}/finance/summary`, {
        headers: NAVER_HEADERS, cache: "no-store",
      }),
    ]);

    if (!integrationRes.ok) {
      console.warn(`[NaverFinance] Integration API failed for ${code}: HTTP ${integrationRes.status}`);
      return fallback;
    }
    const intData = await integrationRes.json();

    const infos: Array<{ code: string; value: string }> = intData?.totalInfos ?? [];
    const getField = (fieldCode: string) => infos.find(i => i.code === fieldCode)?.value;

    const price = parseNaverNum(intData?.closePrice ?? getField("lastClosePrice")) ?? 0;
    const changeRate = Number(intData?.fluctuationsRatio ?? 0);

    const per = parseNaverNum(getField("per"));
    const pbr = parseNaverNum(getField("pbr"));
    const dividendYield = parseNaverNum(getField("dividendYieldRatio"));
    const cnsPer = parseNaverNum(getField("cnsPer"));
    const cnsEps = parseNaverNum(getField("cnsEps"));
    const eps = parseNaverNum(getField("eps"));

    let opsGrowthYoY: number | null = null;
    try {
      if (summaryRes.ok) {
        const sumData = await summaryRes.json();
        const annual = sumData?.chartIncomeStatement?.annual;
        if (annual) {
          const opsCols: string[] = annual.columns?.find((c: string[]) => c[0] === "영업이익") ?? [];
          const titles: Array<{ isConsensus: string }> = annual.trTitleList ?? [];

          const actualOps: number[] = [];
          for (let i = 1; i < opsCols.length && i <= titles.length; i++) {
            if (titles[i - 1]?.isConsensus === "N") {
              actualOps.push(Number(opsCols[i]));
            }
          }
          if (actualOps.length >= 2) {
            const prev = actualOps[actualOps.length - 2];
            const curr = actualOps[actualOps.length - 1];
            if (prev !== 0) {
              opsGrowthYoY = ((curr - prev) / Math.abs(prev)) * 100;
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[NaverFinance] Summary parsing failed for ${code}:`, err instanceof Error ? err.message : err);
    }

    return { price, changeRate, per, pbr, dividendYield, cnsPer, cnsEps, eps, opsGrowthYoY };
  } catch (err) {
    console.error(`[NaverFinance] Fundamentals fetch failed for ${code}:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}
