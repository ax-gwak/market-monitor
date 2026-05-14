import { NextRequest, NextResponse } from "next/server";
import { getStockUniverse } from "@/lib/stockUniverse";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const UA = "Mozilla/5.0";

interface SearchResultItem {
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ";
  currentPrice?: number;
}

async function fetchNaverPrice(code: string): Promise<number | undefined> {
  try {
    const res = await fetch(
      `https://m.stock.naver.com/api/stock/${code}/basic`,
      {
        headers: {
          "User-Agent": UA,
          Referer: "https://finance.naver.com",
          "Cache-Control": "no-cache",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return undefined;
    const data = await res.json();
    const priceStr: string = data?.closePrice ?? "";
    const price = Number(priceStr.replace(/,/g, ""));
    return isNaN(price) || price <= 0 ? undefined : price;
  } catch {
    return undefined;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");

  if (!q || !q.trim()) {
    return NextResponse.json([], { status: 200 });
  }

  try {
    const qLower = q.trim().toLowerCase();

    // 1) Search curated universe first (supports Korean name search)
    const universe = getStockUniverse();
    const universeMatches = universe
      .filter(s =>
        s.name.includes(q.trim()) ||
        s.code.includes(q.trim()) ||
        s.name.toLowerCase().includes(qLower)
      )
      .slice(0, 10);

    // 2) Also search Yahoo Finance (works well for English/code search)
    const searchUrl =
      `https://query2.finance.yahoo.com/v1/finance/search` +
      `?q=${encodeURIComponent(q.trim())}` +
      `&lang=ko-KR&region=KR&quotesCount=10&newsCount=0` +
      `&enableFuzzyQuery=false&enableEnhancedTrivialQuery=true`;

    const yahooRes = await fetch(searchUrl, {
      headers: { "User-Agent": UA, Accept: "*/*", "Cache-Control": "no-cache" },
      cache: "no-store",
    }).catch(() => null);

    const yahooMatches: Array<{ code: string; name: string; market: "KOSPI" | "KOSDAQ" }> = [];
    if (yahooRes?.ok) {
      const json = await yahooRes.json();
      const quotes: Array<{ symbol: string; shortname?: string; longname?: string; exchange?: string }> = json.quotes ?? [];
      quotes
        .filter(q => q.exchange === "KSC" || q.exchange === "KOE")
        .forEach(q => {
          const code = q.symbol.replace(/\.(KS|KQ)$/, "");
          if (!universeMatches.find(m => m.code === code)) {
            yahooMatches.push({
              code,
              name: q.shortname ?? q.longname ?? code,
              market: q.exchange === "KSC" ? "KOSPI" : "KOSDAQ",
            });
          }
        });
    }

    // Merge and deduplicate
    const merged = [
      ...universeMatches.map(s => ({ code: s.code, name: s.name, market: s.market as "KOSPI" | "KOSDAQ" })),
      ...yahooMatches,
    ].slice(0, 10);

    // Fetch current prices in parallel
    const withPrices: SearchResultItem[] = await Promise.all(
      merged.map(async ({ code, name, market }) => {
        const currentPrice = await fetchNaverPrice(code);
        return { code, name, market, currentPrice };
      })
    );

    return NextResponse.json(withPrices);
  } catch (err) {
    console.error("Stock search error:", err);
    return NextResponse.json([], { status: 200 });
  }
}
