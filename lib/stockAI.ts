import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AI_MODEL = "claude-sonnet-4-5-20250514";

export interface StockRecommendation {
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ";
  isLargeCap: boolean;
  currentPrice: number;
  changeRate: number;
  reason: string;
  targetPrice: number;
  stopLoss: number;
  horizon?: "1~2주" | "1달";
  score: number;
}

type ShortTermCandidate = {
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
};

type LongTermCandidate = {
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
};

async function callAI(prompt: string, retries: number = 1): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const message = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });
      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) return jsonMatch[0];
      if (attempt < retries) continue;
    } catch (err) {
      if (attempt < retries) {
        console.warn(`AI call attempt ${attempt + 1} failed, retrying...`, err);
        continue;
      }
      throw err;
    }
  }
  return "";
}

function describeShortTermSignal(c: ShortTermCandidate): string {
  const parts: string[] = [];

  // RSI description
  if (c.rsi14 >= 50 && c.rsi14 <= 65) parts.push("RSI 적정 구간에서 상승 모멘텀 유지");
  else if (c.rsi14 > 65 && c.rsi14 <= 70) parts.push("RSI 상단 근접, 단기 과열 주의");
  else if (c.rsi14 > 70) parts.push("RSI 과매수 구간 진입");
  else if (c.rsi14 >= 40) parts.push("RSI 중립 구간에서 반등 시도");
  else parts.push("RSI 과매도 구간, 기술적 반등 기대");

  // Momentum
  if (c.roc5 > 5) parts.push(`5일 수익률 +${c.roc5.toFixed(1)}%로 강한 단기 모멘텀`);
  else if (c.roc5 > 2) parts.push(`5일 수익률 +${c.roc5.toFixed(1)}%로 상승 흐름`);
  else if (c.roc5 > 0) parts.push("완만한 상승 추세 진행 중");

  // Volume
  if (c.volumeRatio > 2.0) parts.push(`거래량 ${c.volumeRatio.toFixed(1)}배 급증, 수급 유입 확인`);
  else if (c.volumeRatio > 1.5) parts.push(`거래량 ${c.volumeRatio.toFixed(1)}배 증가`);

  // MACD
  if (c.macdHistogram > 0) parts.push("MACD 골든크로스 구간");

  // Bollinger
  if (c.bollingerPctB >= 0.5 && c.bollingerPctB <= 0.8) parts.push("볼린저밴드 상단 확장 구간");
  else if (c.bollingerPctB < 0.2) parts.push("볼린저밴드 하단 접근, 반등 가능");

  return parts.slice(0, 3).join(". ") + ".";
}

function fallbackShortTerm(candidates: ShortTermCandidate[]): StockRecommendation[] {
  return candidates.map((c) => ({
    code: c.code,
    name: c.name,
    market: c.market as "KOSPI" | "KOSDAQ",
    isLargeCap: c.isLargeCap,
    currentPrice: c.currentPrice,
    changeRate: c.changeRate,
    reason: describeShortTermSignal(c),
    targetPrice: Math.round(c.currentPrice * (1 + Math.min(Math.max(c.roc5 / 100 * 2, 0.05), 0.15))),
    stopLoss: Math.round(c.currentPrice * (1 - Math.min(Math.max(Math.abs(c.roc5) / 100 * 1.5, 0.03), 0.07))),
    horizon: c.horizon,
    score: c.score,
  }));
}

function describeLongTermSignal(c: LongTermCandidate): string {
  const parts: string[] = [];

  if (c.effectivePer !== null) {
    if (c.effectivePer <= 10) parts.push(`실효PER ${c.effectivePer.toFixed(1)}배로 저평가 매력`);
    else if (c.effectivePer <= 20) parts.push(`실효PER ${c.effectivePer.toFixed(1)}배 적정 수준`);
    else parts.push(`실효PER ${c.effectivePer.toFixed(1)}배, 성장 프리미엄 반영`);
  }

  if (c.epsGrowth !== null) {
    if (c.epsGrowth > 50) parts.push(`EPS ${c.epsGrowth > 0 ? "+" : ""}${c.epsGrowth.toFixed(0)}% 고성장으로 업황 강세`);
    else if (c.epsGrowth > 0) parts.push(`EPS ${c.epsGrowth.toFixed(0)}% 성장으로 실적 개선 중`);
    else if (c.epsGrowth < -20) parts.push(`EPS ${c.epsGrowth.toFixed(0)}% 하락, 실적 악화 주의`);
  }

  if (c.opsGrowthYoY !== null && c.opsGrowthYoY > 20) {
    parts.push(`영업이익 전년 대비 +${c.opsGrowthYoY.toFixed(0)}% 성장`);
  }

  if (c.pbr !== null && c.pbr <= 1) parts.push(`PBR ${c.pbr.toFixed(2)}배로 자산가치 대비 저평가`);
  if (c.dividendYield !== null && c.dividendYield > 3) parts.push(`배당수익률 ${c.dividendYield.toFixed(1)}%`);

  return parts.slice(0, 3).join(". ") + ".";
}

function fallbackLongTerm(candidates: LongTermCandidate[]): StockRecommendation[] {
  return candidates.map((c) => {
    const perFactor = c.effectivePer !== null && c.effectivePer > 0
      ? Math.min(Math.max(15 / c.effectivePer, 1.1), 1.5)
      : 1.25;
    return {
      code: c.code,
      name: c.name,
      market: c.market as "KOSPI" | "KOSDAQ",
      isLargeCap: c.isLargeCap,
      currentPrice: c.currentPrice,
      changeRate: c.changeRate,
      reason: describeLongTermSignal(c),
      targetPrice: Math.round(c.currentPrice * perFactor),
      stopLoss: Math.round(c.currentPrice * 0.88),
      score: c.score,
    };
  });
}

function getMarketContext(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  let season = "";
  if (month >= 1 && month <= 3) season = "1분기(연초 효과, 실적 시즌 대기)";
  else if (month >= 4 && month <= 6) season = "2분기(1Q 실적 발표 시즌)";
  else if (month >= 7 && month <= 9) season = "3분기(여름 비수기, 2Q 실적 시즌)";
  else season = "4분기(연말 배당 시즌, 윈도우드레싱)";

  return `현재 시점: ${now.getFullYear()}년 ${month}월 (${season})`;
}

export async function generateShortTermRecommendations(
  candidates: ShortTermCandidate[]
): Promise<StockRecommendation[]> {
  if (candidates.length === 0) return [];

  const compact = candidates.map(c => ({
    code: c.code, name: c.name, price: c.currentPrice,
    RSI: c.rsi14.toFixed(1), ROC5: `${c.roc5.toFixed(1)}%`, ROC20: `${c.roc20.toFixed(1)}%`,
    거래량비율: `${c.volumeRatio.toFixed(2)}x`,
    MACD히스토그램: c.macdHistogram > 0 ? "양" : "음",
    "볼린저%B": c.bollingerPctB.toFixed(2),
    스토캐스틱K: c.stochasticK.toFixed(1),
    투자기간: c.horizon, 점수: c.score,
  }));

  const prompt = `당신은 한국 주식 시장 단기 트레이딩 전문가입니다.
${getMarketContext()}

다음은 기술적 분석(RSI, ROC, MACD, 볼린저밴드, 스토캐스틱, 거래량)으로 선별된 단기 추천 후보입니다.

핵심 지표 설명:
- RSI 50~65: 적정 모멘텀 구간, >70: 과매수 주의
- ROC5/ROC20: 5일/20일 수익률. 높을수록 강한 추세
- MACD 히스토그램: 양→상승 모멘텀, 음→하락 모멘텀
- 볼린저%B: 0.5~0.8 적정, >1.0 과열, <0.2 반등 기대
- 스토캐스틱K: >80 과매수, <20 과매도

각 종목에 대해:
1. 매수 이유 (2-3문장, 위 지표 기반 구체적 분석)
2. 목표가 (변동성과 모멘텀 강도에 따라 현재가 +5~15%)
3. 손절가 (지지선 기반 -3~7%)

후보 종목:
${JSON.stringify(compact, null, 2)}

반드시 아래 JSON 배열 형식으로만 응답하세요:
[{"code":"종목코드","reason":"매수 이유","targetPrice":목표가,"stopLoss":손절가}]`;

  try {
    const jsonStr = await callAI(prompt);
    if (!jsonStr) return fallbackShortTerm(candidates);

    const aiResults: Array<{
      code: string; reason: string; targetPrice: number; stopLoss: number;
    }> = JSON.parse(jsonStr);

    return candidates.map((c) => {
      const ai = aiResults.find((r) => r.code === c.code);
      return {
        code: c.code,
        name: c.name,
        market: c.market as "KOSPI" | "KOSDAQ",
        isLargeCap: c.isLargeCap,
        currentPrice: c.currentPrice,
        changeRate: c.changeRate,
        reason: ai?.reason ?? describeShortTermSignal(c),
        targetPrice: ai?.targetPrice ?? Math.round(c.currentPrice * 1.08),
        stopLoss: ai?.stopLoss ?? Math.round(c.currentPrice * 0.95),
        horizon: c.horizon,
        score: c.score,
      };
    });
  } catch (err) {
    console.error("Short-term AI error:", err);
    return fallbackShortTerm(candidates);
  }
}

export async function generateLongTermRecommendations(
  candidates: LongTermCandidate[]
): Promise<StockRecommendation[]> {
  if (candidates.length === 0) return [];

  const compact = candidates.map(c => ({
    code: c.code, name: c.name, price: c.currentPrice,
    PER: c.per, 추정PER: c.cnsPer, 실효PER: c.effectivePer,
    EPS성장률: c.epsGrowth !== null ? `${c.epsGrowth.toFixed(0)}%` : null,
    영업이익YoY: c.opsGrowthYoY !== null ? `${c.opsGrowthYoY.toFixed(0)}%` : null,
    PBR: c.pbr, 배당률: c.dividendYield,
    "6개월수익률": `${c.momentum6m.toFixed(1)}%`,
    SMA200: c.belowSma200 ? "하회" : "상회",
  }));

  const prompt = `당신은 한국 주식 시장 장기 가치투자 전문가입니다.
${getMarketContext()}

다음은 펀더멘털 및 기술적 분석으로 선별된 장기 투자 후보 종목들입니다.

핵심 지표 설명:
- 실효PER: 현재PER 30% + 추정PER 70% 가중평균. 추정PER < 현재PER이면 업황 개선 중
- EPS성장률: (추정EPS - 현재EPS) / |현재EPS|. 양수=실적개선, 200%=적자→흑전
- 영업이익YoY: 최근 연간 영업이익 전년 대비 증감률
- PBR: 1배 미만이면 자산가치 대비 저평가 (단, 수익성 확인 필요)
- SMA200: 하회 시 장기 저점 매수 기회이나 추세 전환 확인 필요

분석 시 고려할 점:
- 저PER + EPS성장 양호 = 가치주 매수 기회
- 저PER + EPS 악화 = 가치함정 주의
- 고PER + EPS 고성장 = 성장 프리미엄 정당화 여부 판단

각 종목에 대해:
1. 투자 이유 (2-3문장, 업황 개선 여부와 밸류에이션 매력도 포함)
2. 목표가 (펀더멘털 기반, 현재가 +15~40%)
3. 손절가 (-10~15%)

후보 종목:
${JSON.stringify(compact, null, 2)}

반드시 아래 JSON 배열 형식으로만 응답하세요:
[{"code":"종목코드","reason":"투자 이유","targetPrice":목표가,"stopLoss":손절가}]`;

  try {
    const jsonStr = await callAI(prompt);
    if (!jsonStr) return fallbackLongTerm(candidates);

    const aiResults: Array<{
      code: string; reason: string; targetPrice: number; stopLoss: number;
    }> = JSON.parse(jsonStr);

    return candidates.map((c) => {
      const ai = aiResults.find((r) => r.code === c.code);
      return {
        code: c.code,
        name: c.name,
        market: c.market as "KOSPI" | "KOSDAQ",
        isLargeCap: c.isLargeCap,
        currentPrice: c.currentPrice,
        changeRate: c.changeRate,
        reason: ai?.reason ?? describeLongTermSignal(c),
        targetPrice: ai?.targetPrice ?? Math.round(c.currentPrice * 1.25),
        stopLoss: ai?.stopLoss ?? Math.round(c.currentPrice * 0.88),
        score: c.score,
      };
    });
  } catch (err) {
    console.error("Long-term AI error:", err);
    return fallbackLongTerm(candidates);
  }
}
