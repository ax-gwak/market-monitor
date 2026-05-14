import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
};

function fallbackShortTerm(candidates: ShortTermCandidate[]): StockRecommendation[] {
  return candidates.map((c) => ({
    code: c.code,
    name: c.name,
    market: c.market as "KOSPI" | "KOSDAQ",
    isLargeCap: c.isLargeCap,
    currentPrice: c.currentPrice,
    changeRate: c.changeRate,
    reason: `RSI ${c.rsi14.toFixed(1)}, ROC5 ${c.roc5.toFixed(1)}%, 거래량비율 ${c.volumeRatio.toFixed(2)}x`,
    targetPrice: Math.round(c.currentPrice * 1.08),
    stopLoss: Math.round(c.currentPrice * 0.95),
    horizon: c.horizon,
    score: c.score,
  }));
}

function fallbackLongTerm(candidates: LongTermCandidate[]): StockRecommendation[] {
  return candidates.map((c) => ({
    code: c.code,
    name: c.name,
    market: c.market as "KOSPI" | "KOSDAQ",
    isLargeCap: c.isLargeCap,
    currentPrice: c.currentPrice,
    changeRate: c.changeRate,
    reason: `모멘텀 ${c.momentum6m.toFixed(1)}%, PER ${c.per ?? "N/A"}, PBR ${c.pbr ?? "N/A"}`,
    targetPrice: Math.round(c.currentPrice * 1.25),
    stopLoss: Math.round(c.currentPrice * 0.88),
    score: c.score,
  }));
}

export async function generateShortTermRecommendations(
  candidates: ShortTermCandidate[]
): Promise<StockRecommendation[]> {
  if (candidates.length === 0) return [];

  const prompt = `당신은 한국 주식 시장 단기 트레이딩 전문가입니다.
다음은 기술적 분석으로 선별된 단기 추천 후보 종목들입니다.
각 종목에 대해 매수 이유(2-3문장, 구체적인 기술적 분석), 목표가(현재가 기준 +5~15%), 손절가(-3~7%)를 제시하세요.

후보 종목:
${JSON.stringify(candidates, null, 2)}

반드시 아래 JSON 배열 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요:
[
  {
    "code": "종목코드",
    "reason": "매수 이유 (2-3문장)",
    "targetPrice": 목표가숫자,
    "stopLoss": 손절가숫자
  }
]`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return fallbackShortTerm(candidates);

    const aiResults: Array<{
      code: string;
      reason: string;
      targetPrice: number;
      stopLoss: number;
    }> = JSON.parse(jsonMatch[0]);

    // Merge AI results back with candidate data
    return candidates.map((c) => {
      const ai = aiResults.find((r) => r.code === c.code);
      return {
        code: c.code,
        name: c.name,
        market: c.market as "KOSPI" | "KOSDAQ",
        isLargeCap: c.isLargeCap,
        currentPrice: c.currentPrice,
        changeRate: c.changeRate,
        reason: ai?.reason ?? `RSI ${c.rsi14.toFixed(1)}, ROC5 ${c.roc5.toFixed(1)}%, 거래량비율 ${c.volumeRatio.toFixed(2)}x`,
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

  const prompt = `당신은 한국 주식 시장 장기 가치투자 전문가입니다.
다음은 펀더멘털 및 기술적 분석으로 선별된 장기 투자 후보 종목들입니다.
각 종목에 대해 투자 이유(2-3문장, 가치평가와 성장성 중심), 목표가(현재가 기준 +15~40%), 손절가(-10~15%)를 제시하세요.

후보 종목:
${JSON.stringify(candidates, null, 2)}

반드시 아래 JSON 배열 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요:
[
  {
    "code": "종목코드",
    "reason": "투자 이유 (2-3문장)",
    "targetPrice": 목표가숫자,
    "stopLoss": 손절가숫자
  }
]`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return fallbackLongTerm(candidates);

    const aiResults: Array<{
      code: string;
      reason: string;
      targetPrice: number;
      stopLoss: number;
    }> = JSON.parse(jsonMatch[0]);


    return candidates.map((c) => {
      const ai = aiResults.find((r) => r.code === c.code);
      return {
        code: c.code,
        name: c.name,
        market: c.market as "KOSPI" | "KOSDAQ",
        isLargeCap: c.isLargeCap,
        currentPrice: c.currentPrice,
        changeRate: c.changeRate,
        reason:
          ai?.reason ??
          `모멘텀 ${c.momentum6m.toFixed(1)}%, PER ${c.per ?? "N/A"}, PBR ${c.pbr ?? "N/A"}`,
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
