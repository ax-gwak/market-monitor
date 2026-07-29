"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/* ─── CONSTANTS ─── */
const PHASE = {
  A: { label: "A 확장", color: "#0F6E56", bg: "#E1F5EE", icon: "↗", tip: "모멘텀 추종, 추격 매수 가능" },
  B: { label: "B 조정", color: "#854F0B", bg: "#FAEEDA", icon: "→", tip: "신규 진입 자제, 보유 관리" },
  C: { label: "C 수축", color: "#A32D2D", bg: "#FCEBEB", icon: "↘", tip: "현금 비중 확대, 방어 모드" },
  D: { label: "D 회복", color: "#185FA5", bg: "#E6F1FB", icon: "↑", tip: "분할 매수 시작 탐색" },
};

const TABS = ["cycle", "band", "ir", "scenario", "short", "long", "watchlist"];
const TAB_LABELS = {
  cycle: "Cycle phase",
  band: "Guide band",
  ir: "IR index",
  scenario: "시나리오",
  short: "종목추천-단기",
  long: "종목추천-장기",
  watchlist: "관심종목",
};

const DEFAULT_WATCHLIST = [
  { symbol: "KOSPI200", name: "코스피200" },
];

/* ─── HELPERS ─── */
const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const fmt = (n, d = 1) => Number(n).toFixed(d);

function getPhase(re, im) {
  if (re >= 0 && im >= 0) return "A";
  if (re < 0 && im >= 0) return "B";
  if (re < 0 && im < 0) return "C";
  return "D";
}

/* ─── GUIDE BAND CHART (Canvas) ─── */
function GuideBandChart({ prices, dates, irData, label }) {
  const ref = useRef(null);
  const TWO_MONTHS = 42;
  const [viewStart, setViewStart] = useState(Math.max(0, prices.length - TWO_MONTHS));
  const [viewEnd,   setViewEnd]   = useState(Math.max(0, prices.length - 1));
  const [isDragging, setIsDragging] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(null);
  const dragRef = useRef(null);

  // 새 데이터 로드 시 2개월 뷰로 리셋
  useEffect(() => {
    if (prices.length > 0) {
      setViewStart(Math.max(0, prices.length - TWO_MONTHS));
      setViewEnd(prices.length - 1);
    }
  }, [prices.length]);

  const zoomIn = () => {
    const range = viewEnd - viewStart;
    const newRange = Math.max(30, Math.floor(range * 0.6));
    const center = Math.floor((viewStart + viewEnd) / 2);
    const ns = Math.max(0, center - Math.floor(newRange / 2));
    const ne = Math.min(prices.length - 1, ns + newRange);
    setViewStart(ns); setViewEnd(ne);
  };

  const zoomOut = () => {
    const range = viewEnd - viewStart;
    const newRange = Math.min(prices.length - 1, Math.ceil(range / 0.6));
    const center = Math.floor((viewStart + viewEnd) / 2);
    const ns = Math.max(0, center - Math.floor(newRange / 2));
    const ne = Math.min(prices.length - 1, ns + newRange);
    setViewStart(ns); setViewEnd(ne);
  };

  const resetView = () => { setViewStart(0); setViewEnd(prices.length - 1); };

  const CANVAS_W = 680;
  const PX_PAD = 10, PW_PLOT = CANVAS_W - PX_PAD - 58;

  const onMouseDown = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startVS: viewStart, startVE: viewEnd, width: rect.width };
    setIsDragging(true);
  };

  const onMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // 호버 인덱스 계산 (항상)
    const canvasX = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const relX = canvasX - PX_PAD;
    const vLen = viewEnd - viewStart;
    const idx = Math.round((relX / PW_PLOT) * vLen);
    setHoverIdx(Math.max(0, Math.min(vLen, idx)));

    // 드래그 패닝
    if (!dragRef.current) return;
    const { startX, startVS, startVE, width } = dragRef.current;
    const range = startVE - startVS;
    const dx = e.clientX - startX;
    const barsPerPx = range / width;
    const delta = Math.round(-dx * barsPerPx);
    const ns = Math.max(0, Math.min(prices.length - 1 - range, startVS + delta));
    setViewStart(ns); setViewEnd(ns + range);
  };

  const onMouseUp = () => { dragRef.current = null; setIsDragging(false); };
  const onMouseLeave = () => { dragRef.current = null; setIsDragging(false); setHoverIdx(null); };

  useEffect(() => {
    if (!prices || prices.length < 30) return;
    const vPrices = prices.slice(viewStart, viewEnd + 1);
    const vDates  = dates?.slice(viewStart, viewEnd + 1) || [];
    const cv = ref.current;
    const ctx = cv.getContext("2d");
    const W = 680, H = 400;
    cv.width = W * 2; cv.height = H * 2;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, W, H);

    /* ── MA 계산 함수 ── */
    const sma = (arr, len) => {
      const r = []; let s = 0;
      for (let i = 0; i < arr.length; i++) {
        s += arr[i];
        if (i >= len) s -= arr[i - len];
        r.push(i >= len - 1 ? s / len : null);
      }
      return r;
    };
    const ema = (arr, len) => {
      const k = 2 / (len + 1), r = [arr[0]];
      for (let i = 1; i < arr.length; i++) r.push(arr[i] * k + r[i - 1] * (1 - k));
      return r;
    };
    const stdev = (arr, m, len) => {
      const r = [];
      for (let i = 0; i < arr.length; i++) {
        if (m[i] === null) { r.push(null); continue; }
        let ss = 0;
        for (let j = Math.max(0, i - len + 1); j <= i; j++) ss += (arr[j] - m[i]) ** 2;
        r.push(Math.sqrt(ss / Math.min(i + 1, len)));
      }
      return r;
    };

    /* ── 전체 데이터로 MA 계산 후 뷰 구간만 슬라이싱 ── */
    const sl = (arr) => arr.slice(viewStart, viewEnd + 1);

    /* ── Layer 1: 단기 EMA 리본 ── */
    const e5  = sl(ema(prices, 5));
    const e10 = sl(ema(prices, 10));
    const e20 = sl(ema(prices, 20));
    const e30 = sl(ema(prices, 30));

    /* ── Layer 2: 중기 SMA 밴드 ── */
    const s50  = sl(sma(prices, 50));
    const s75  = sl(sma(prices, 75));
    const s100 = sl(sma(prices, 100));
    const s150 = sl(sma(prices, 150));

    /* ── Layer 3: 장기 추세 기저선 ── */
    const s200 = sl(sma(prices, Math.min(200, prices.length - 1)));
    const s300 = sl(sma(prices, Math.min(300, prices.length - 1)));
    const s400 = sl(sma(prices, Math.min(400, prices.length - 1)));
    const s600 = sl(sma(prices, Math.min(600, prices.length - 1)));

    /* ── Layer 4: 표준편차 밴드 ── */
    const s200_full = sma(prices, Math.min(200, prices.length - 1));
    const sd = sl(stdev(prices, s200_full, Math.min(200, prices.length - 1)));

    /* ── 가격 범위 계산 ── */
    const all = [...vPrices];
    for (let i = 0; i < vPrices.length; i++) {
      if (s200[i] !== null && sd[i] !== null) {
        all.push(s200[i] + sd[i] * 3, s200[i] - sd[i] * 3);
      }
    }
    let minV = Math.min(...all.filter(v => v !== null && isFinite(v)));
    let maxV = Math.max(...all.filter(v => v !== null && isFinite(v)));
    const pad = (maxV - minV) * 0.05;
    minV -= pad; maxV += pad;

    const px = 10, pw = W - px - 58, py = 14, ph = H - py - 38;
    const tx = i => px + (i / (vPrices.length - 1)) * pw;
    const ty = v => py + (1 - (v - minV) / (maxV - minV)) * ph;

    const fillBand = (topArr, botArr, color) => {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < vPrices.length; i++) {
        if (topArr[i] === null) continue;
        if (!started) { ctx.moveTo(tx(i), ty(topArr[i])); started = true; }
        else ctx.lineTo(tx(i), ty(topArr[i]));
      }
      for (let i = vPrices.length - 1; i >= 0; i--) {
        if (botArr[i] === null) continue;
        ctx.lineTo(tx(i), ty(botArr[i]));
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };

    const drawLine = (arr, color, w) => {
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = w;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] === null) continue;
        if (i === 0 || arr[i - 1] === null) ctx.moveTo(tx(i), ty(arr[i]));
        else ctx.lineTo(tx(i), ty(arr[i]));
      }
      ctx.stroke();
    };

    /* ── σ 밴드 배열 계산 ── */
    const sd3p = s200.map((v, i) => v !== null && sd[i] !== null ? v + sd[i] * 3 : null);
    const sd2p = s200.map((v, i) => v !== null && sd[i] !== null ? v + sd[i] * 2 : null);
    const sd1p = s200.map((v, i) => v !== null && sd[i] !== null ? v + sd[i]     : null);
    const sd1n = s200.map((v, i) => v !== null && sd[i] !== null ? v - sd[i]     : null);
    const sd2n = s200.map((v, i) => v !== null && sd[i] !== null ? v - sd[i] * 2 : null);
    const sd3n = s200.map((v, i) => v !== null && sd[i] !== null ? v - sd[i] * 3 : null);

    /* ── 추세 상태 계산 (마지막 유효값 기준) ── */
    const lastPrice = vPrices[vPrices.length - 1];
    const lastSd1p  = sd1p.filter(v => v !== null).at(-1) ?? Infinity;
    const lastSd2p  = sd2p.filter(v => v !== null).at(-1) ?? Infinity;
    const lastBasis = s200.filter(v => v !== null).at(-1) ?? 0;
    const lastSd1n  = sd1n.filter(v => v !== null).at(-1) ?? -Infinity;
    const lastSd2n  = sd2n.filter(v => v !== null).at(-1) ?? -Infinity;

    /* ── Layer 4 채우기: σ 밴드 ── */
    // basis ~ ±1σ: 연분홍/연파랑
    fillBand(sd1p, s200, "rgba(255,205,210,0.12)");
    fillBand(s200, sd1n, "rgba(187,222,251,0.12)");
    // ±1σ ~ ±2σ: 분홍/파랑
    fillBand(sd2p, sd1p, "rgba(255,138,128,0.12)");
    fillBand(sd1n, sd2n, "rgba(130,177,255,0.12)");
    // ±2σ ~ ±3σ: 진분홍/진파랑
    fillBand(sd3p, sd2p, "rgba(255,82,82,0.12)");
    fillBand(sd2n, sd3n, "rgba(68,138,255,0.12)");

    /* ── Layer 3 채우기: SMA200 ~ SMA600 (회색/연분홍 조건부) ── */
    const longBull = (s200.filter(v=>v!==null).at(-1) ?? 0) >
                     (s600.filter(v=>v!==null).at(-1) ?? 0);
    const s200valid = s200.map((v, i) => (s600[i] !== null ? v : null));
    fillBand(s200valid, s600, longBull ? "rgba(158,158,158,0.12)" : "rgba(239,154,154,0.15)");

    /* ── Layer 2 채우기: SMA50~SMA150 (보라/분홍 조건부) ── */
    const midBull = (s50.filter(v=>v!==null).at(-1) ?? 0) >
                    (s150.filter(v=>v!==null).at(-1) ?? 0);
    fillBand(s50, s150, midBull ? "rgba(124,77,255,0.09)" : "rgba(255,128,171,0.09)");

    /* ── Layer 1 채우기: EMA 리본 (시안/주황 조건부) ── */
    for (let i = 1; i < vPrices.length; i++) {
      if (e5[i] === null || e30[i] === null || e5[i-1] === null || e30[i-1] === null) continue;
      const bullish = e5[i] >= e30[i];
      ctx.beginPath();
      ctx.moveTo(tx(i-1), ty(Math.min(e5[i-1], e30[i-1])));
      ctx.lineTo(tx(i),   ty(Math.min(e5[i],   e30[i])));
      ctx.lineTo(tx(i),   ty(Math.max(e5[i],   e30[i])));
      ctx.lineTo(tx(i-1), ty(Math.max(e5[i-1], e30[i-1])));
      ctx.closePath();
      ctx.fillStyle = bullish ? "rgba(0,229,255,0.18)" : "rgba(255,110,64,0.18)";
      ctx.fill();
    }

    /* ── 선 그리기 (장기→단기 순서) ── */
    // Layer 4 σ 외곽선
    drawLine(sd3p, "rgba(255,23,68,0.35)",  0.7);
    drawLine(sd2p, "rgba(255,82,82,0.55)",  0.8);
    drawLine(sd2n, "rgba(68,138,255,0.55)", 0.8);
    drawLine(sd3n, "rgba(41,98,255,0.35)",  0.7);

    // Layer 3 장기 기저선 — Pine Script 색상 그대로
    drawLine(s600, "#ff1744",              2.0);  // 진빨강
    drawLine(s400, "rgba(51,51,51,0.55)",  1.0);  // 어두운 회색
    drawLine(s300, "rgba(0,0,0,0.45)",     1.0);  // 반투명 검정
    drawLine(s200, "#000000",              2.0);  // 검정

    // Layer 2 중기 SMA
    drawLine(s150, "rgba(224,64,251,0.45)", 1.0);
    drawLine(s100, "#e040fb",               1.5);
    drawLine(s75,  "rgba(124,77,255,0.45)", 1.0);
    drawLine(s50,  "#2979ff",               1.5);

    // Layer 1 단기 EMA — Pine Script 색상 그대로
    drawLine(e30, "#2979ff",              1.5);  // 파랑
    drawLine(e20, "#00c853",              1.5);  // 초록
    drawLine(e10, "rgba(0,229,255,0.55)", 1.0);  // 연시안
    drawLine(e5,  "#00e5ff",              1.5);  // 시안

    // 가격선
    ctx.beginPath(); ctx.strokeStyle = "var(--color-text-primary)"; ctx.lineWidth = 1.5;
    for (let i = 0; i < vPrices.length; i++) {
      if (i === 0) ctx.moveTo(tx(i), ty(vPrices[i]));
      else ctx.lineTo(tx(i), ty(vPrices[i]));
    }
    ctx.stroke();

    /* ── Y축 (오른쪽, 진한 색) ── */
    ctx.fillStyle = "#222"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "left";
    for (let t = 0; t <= 6; t++) {
      const v = minV + (maxV - minV) * t / 6;
      ctx.fillText(v >= 1000 ? Math.round(v).toLocaleString() : fmt(v, 2), px + pw + 4, ty(v) + 3);
      ctx.beginPath(); ctx.strokeStyle = "#ccc"; ctx.lineWidth = 0.3;
      ctx.moveTo(px, ty(v)); ctx.lineTo(px + pw, ty(v)); ctx.stroke();
    }

    /* ── X축 (실제 날짜) ── */
    ctx.fillStyle = "#333"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center";
    const hasDates = vDates.length === vPrices.length && vDates.length > 0;
    const xTickCount = 6;
    for (let t = 0; t <= xTickCount; t++) {
      const idx = Math.round((t / xTickCount) * (vPrices.length - 1));
      let xLabel;
      if (hasDates) {
        const d = new Date(vDates[idx]);
        xLabel = d.toLocaleDateString("ko-KR", { year: "2-digit", month: "short" });
      } else {
        const daysAgo = vPrices.length - 1 - idx;
        xLabel = daysAgo === 0 ? "Today" : `-${daysAgo}d`;
      }
      const xPos = tx(idx);
      ctx.beginPath(); ctx.strokeStyle = "#aaa"; ctx.lineWidth = 0.5;
      ctx.moveTo(xPos, py + ph); ctx.lineTo(xPos, py + ph + 5); ctx.stroke();
      ctx.fillText(xLabel, xPos, py + ph + 16);
    }

    /* ── 추세 상태 라벨 ── */
    let posText = "", posColor = "#666";
    if (lastPrice > lastSd2p)       { posText = "과열 (2σ 이상)";    posColor = "#ff1744"; }
    else if (lastPrice > lastSd1p)  { posText = "강세 (1σ~2σ)";     posColor = "#ff6d00"; }
    else if (lastPrice > lastBasis) { posText = "중립 상단";          posColor = "#00c853"; }
    else if (lastPrice > lastSd1n)  { posText = "중립 하단";          posColor = "#2979ff"; }
    else if (lastPrice > lastSd2n)  { posText = "약세 (1σ~2σ)";     posColor = "#7c4dff"; }
    else                            { posText = "과매도 (2σ 이하)";   posColor = "#424242"; }

    ctx.font = "bold 11px sans-serif"; ctx.textAlign = "right";
    ctx.fillStyle = posColor;
    ctx.fillText(posText, px + pw - 4, py + 12);

    ctx.fillStyle = "#555"; ctx.font = "11px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(label + " — Guide band", px, H - 4);

    /* ── 호버 크로스헤어 + 툴팁 ── */
    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < vPrices.length) {
      const hx = tx(hoverIdx);
      const hv = vPrices[hoverIdx];
      const hy = ty(hv);

      // 가격선 두껍게 다시 그리기
      ctx.beginPath(); ctx.strokeStyle = "#111"; ctx.lineWidth = 2.5;
      for (let i = 0; i < vPrices.length; i++) {
        if (i === 0) ctx.moveTo(tx(i), ty(vPrices[i]));
        else ctx.lineTo(tx(i), ty(vPrices[i]));
      }
      ctx.stroke();

      // 수직 크로스헤어
      ctx.beginPath(); ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 0.8;
      ctx.setLineDash([4, 3]);
      ctx.moveTo(hx, py); ctx.lineTo(hx, py + ph);
      ctx.stroke(); ctx.setLineDash([]);

      // 가격 점
      ctx.beginPath(); ctx.fillStyle = "#111";
      ctx.arc(hx, hy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.fillStyle = "#fff";
      ctx.arc(hx, hy, 2, 0, Math.PI * 2); ctx.fill();

      // 날짜 + 가격 + IR 툴팁
      const absIdx = viewStart + hoverIdx;
      const dateStr = (hasDates && hoverIdx < vDates.length)
        ? new Date(vDates[hoverIdx]).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })
        : "";
      const valStr = hv >= 1000 ? Math.round(hv).toLocaleString() : fmt(hv, 2);
      const irVal  = irData && irData[absIdx] != null ? irData[absIdx] : null;
      const irStr  = irVal != null ? `IR ${fmt(irVal, 4)}` : "";

      ctx.font = "bold 11px sans-serif";
      const line1 = dateStr ? `${dateStr}  ${valStr}` : valStr;
      const line2 = irStr;
      const tw = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width);
      const lineH = 16;
      const boxH  = line2 ? lineH * 2 + 8 : lineH + 8;

      let tipX = hx + 8;
      if (tipX + tw + 14 > px + pw) tipX = hx - tw - 18;
      const tipY = Math.max(py + boxH / 2, Math.min(hy, py + ph - boxH / 2));

      ctx.fillStyle = "rgba(20,20,20,0.85)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(tipX - 5, tipY - lineH, tw + 14, boxH, 4);
      else ctx.rect(tipX - 5, tipY - lineH, tw + 14, boxH);
      ctx.fill();

      ctx.textAlign = "left";
      ctx.fillStyle = "#fff";
      ctx.fillText(line1, tipX + 2, tipY - 2);
      if (line2) {
        const irColor = irVal >= 1 ? "#6fffc0" : "#ff8f8f";
        ctx.fillStyle = irColor;
        ctx.fillText(line2, tipX + 2, tipY + lineH - 2);
      }
    }

  }, [prices, dates, label, viewStart, viewEnd, hoverIdx]);

  const viewRange = viewEnd - viewStart + 1;
  const totalDays = prices.length;

  return (
    <div>
      {/* 줌 컨트롤 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <button onClick={zoomIn}  style={{ width: 28, height: 28, fontSize: 16, fontWeight: 600, lineHeight: 1, padding: 0 }}>+</button>
        <button onClick={zoomOut} style={{ width: 28, height: 28, fontSize: 16, fontWeight: 600, lineHeight: 1, padding: 0 }}>−</button>
        <button onClick={resetView} style={{ fontSize: 11, padding: "2px 8px", opacity: viewRange === totalDays ? 0.4 : 1 }}>전체</button>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginLeft: 4 }}>
          {viewRange}일 표시 중 / 전체 {totalDays}일
        </span>
      </div>
      <canvas
        ref={ref}
        style={{
          width: "100%", height: 400,
          borderRadius: 8, border: "0.5px solid var(--color-border-tertiary)",
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      />
    </div>
  );
}

/* ─── IR INDEX CHART (Canvas) ─── */
function IRChart({ irData, dates, label }) {
  const ref = useRef(null);
  const TWO_MONTHS = 42;
  const [viewStart, setViewStart] = useState(Math.max(0, (irData?.length ?? 0) - TWO_MONTHS));
  const [viewEnd,   setViewEnd]   = useState(Math.max(0, (irData?.length ?? 1) - 1));
  const [isDragging, setIsDragging] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(null);
  const dragRef = useRef(null);

  const CANVAS_W = 680;
  const PX_PAD = 10, PW_PLOT = CANVAS_W - PX_PAD - 58;

  // 새 데이터 로드 시 2개월 뷰로 리셋
  useEffect(() => {
    if (irData && irData.length > 0) {
      setViewStart(Math.max(0, irData.length - TWO_MONTHS));
      setViewEnd(irData.length - 1);
    }
  }, [irData?.length]);

  const zoomIn = () => {
    const range = viewEnd - viewStart;
    const newRange = Math.max(20, Math.floor(range * 0.6));
    const center = Math.floor((viewStart + viewEnd) / 2);
    const ns = Math.max(0, center - Math.floor(newRange / 2));
    const ne = Math.min((irData?.length ?? 1) - 1, ns + newRange);
    setViewStart(ns); setViewEnd(ne);
  };

  const zoomOut = () => {
    const range = viewEnd - viewStart;
    const newRange = Math.min((irData?.length ?? 1) - 1, Math.ceil(range / 0.6));
    const center = Math.floor((viewStart + viewEnd) / 2);
    const ns = Math.max(0, center - Math.floor(newRange / 2));
    const ne = Math.min((irData?.length ?? 1) - 1, ns + newRange);
    setViewStart(ns); setViewEnd(ne);
  };

  const resetView = () => { setViewStart(0); setViewEnd((irData?.length ?? 1) - 1); };

  const onMouseDown = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startVS: viewStart, startVE: viewEnd, width: rect.width };
    setIsDragging(true);
  };

  const onMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const relX = canvasX - PX_PAD;
    const vLen = viewEnd - viewStart;
    const idx = Math.round((relX / PW_PLOT) * vLen);
    setHoverIdx(Math.max(0, Math.min(vLen, idx)));

    if (!dragRef.current) return;
    const { startX, startVS, startVE, width } = dragRef.current;
    const range = startVE - startVS;
    const dx = e.clientX - startX;
    const barsPerPx = range / width;
    const delta = Math.round(-dx * barsPerPx);
    const totalLen = irData?.length ?? 1;
    const ns = Math.max(0, Math.min(totalLen - 1 - range, startVS + delta));
    setViewStart(ns); setViewEnd(ns + range);
  };

  const onMouseUp = () => { dragRef.current = null; setIsDragging(false); };
  const onMouseLeave = () => { dragRef.current = null; setIsDragging(false); setHoverIdx(null); };

  useEffect(() => {
    if (!irData || irData.length < 10) return;
    const vData  = irData.slice(viewStart, viewEnd + 1);
    const vDates = dates?.slice(viewStart, viewEnd + 1) || [];
    const cv = ref.current;
    const ctx = cv.getContext("2d");
    const W = 680, H = 260;
    cv.width = W * 2; cv.height = H * 2;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, W, H);

    let minV = Math.min(...vData) - 0.02;
    let maxV = Math.max(...vData) + 0.02;
    if (minV > 0.9) minV = 0.9;
    if (maxV < 1.1) maxV = 1.1;

    const px = 10, pw = W - px - 58, py = 10, ph = H - py - 38;
    const tx = i => px + (i / Math.max(1, vData.length - 1)) * pw;
    const ty = v => py + (1 - (v - minV) / (maxV - minV)) * ph;

    const y1 = ty(1.0);
    ctx.fillStyle = "rgba(0,200,83,0.05)";
    ctx.fillRect(px, py, pw, y1 - py);
    ctx.fillStyle = "rgba(255,23,68,0.05)";
    ctx.fillRect(px, y1, pw, py + ph - y1);

    ctx.beginPath(); ctx.strokeStyle = "#888"; ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.moveTo(px, y1); ctx.lineTo(px + pw, y1);
    ctx.stroke(); ctx.setLineDash([]);

    /* ── Y축 (오른쪽) ── */
    ctx.fillStyle = "#222"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "left";
    const y1Label = ty(1.0);
    ctx.fillText("1.000", px + pw + 4, y1Label + 3);
    for (let t = 0; t <= 5; t++) {
      const v = minV + (maxV - minV) * t / 5;
      if (Math.abs(v - 1.0) < 0.008) continue;
      ctx.fillStyle = "#222";
      ctx.fillText(fmt(v, 3), px + pw + 4, ty(v) + 3);
      ctx.beginPath(); ctx.strokeStyle = "#ccc"; ctx.lineWidth = 0.3;
      ctx.moveTo(px, ty(v)); ctx.lineTo(px + pw, ty(v)); ctx.stroke();
    }

    /* ── IR 선 그리기 ── */
    ctx.beginPath(); ctx.lineWidth = 1.5;
    for (let i = 0; i < vData.length; i++) {
      ctx.strokeStyle = vData[i] >= 1.0 ? "#00c853" : "#ff1744";
      if (i === 0) ctx.moveTo(tx(i), ty(vData[i]));
      else { ctx.lineTo(tx(i), ty(vData[i])); ctx.stroke(); ctx.beginPath(); ctx.moveTo(tx(i), ty(vData[i])); }
    }
    ctx.stroke();

    const last = vData[vData.length - 1];
    ctx.beginPath();
    ctx.fillStyle = last >= 1.0 ? "#00c853" : "#ff1744";
    ctx.arc(tx(vData.length - 1), ty(last), 4, 0, Math.PI * 2);
    ctx.fill();

    /* ── X축 (실제 날짜) ── */
    const hasDates = vDates.length === vData.length && vDates.length > 0;
    ctx.fillStyle = "#333"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center";
    const xTickCount = 6;
    for (let t = 0; t <= xTickCount; t++) {
      const idx = Math.round((t / xTickCount) * (vData.length - 1));
      let xLabel;
      if (hasDates) {
        const d = new Date(vDates[idx]);
        xLabel = d.toLocaleDateString("ko-KR", { year: "2-digit", month: "short" });
      } else {
        const daysAgo = vData.length - 1 - idx;
        xLabel = daysAgo === 0 ? "Today" : `-${daysAgo}d`;
      }
      const xPos = tx(idx);
      ctx.beginPath(); ctx.strokeStyle = "#aaa"; ctx.lineWidth = 0.5;
      ctx.moveTo(xPos, py + ph); ctx.lineTo(xPos, py + ph + 5); ctx.stroke();
      ctx.fillText(xLabel, xPos, py + ph + 16);
    }

    ctx.fillStyle = "#555"; ctx.font = "11px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(label + " — IR index (1.0 = equilibrium)", px, H - 4);

    /* ── 호버 크로스헤어 + 툴팁 ── */
    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < vData.length) {
      const hx = tx(hoverIdx);
      const hv = vData[hoverIdx];
      const hy = ty(hv);

      // IR 선 두껍게 다시 그리기
      ctx.beginPath(); ctx.lineWidth = 2.5;
      for (let i = 0; i < vData.length; i++) {
        ctx.strokeStyle = vData[i] >= 1.0 ? "#00c853" : "#ff1744";
        if (i === 0) ctx.moveTo(tx(i), ty(vData[i]));
        else { ctx.lineTo(tx(i), ty(vData[i])); ctx.stroke(); ctx.beginPath(); ctx.moveTo(tx(i), ty(vData[i])); }
      }
      ctx.stroke();

      // 수직 크로스헤어
      ctx.beginPath(); ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 0.8;
      ctx.setLineDash([4, 3]);
      ctx.moveTo(hx, py); ctx.lineTo(hx, py + ph);
      ctx.stroke(); ctx.setLineDash([]);

      // 점
      ctx.beginPath(); ctx.fillStyle = hv >= 1.0 ? "#00c853" : "#ff1744";
      ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.fillStyle = "#fff";
      ctx.arc(hx, hy, 2.5, 0, Math.PI * 2); ctx.fill();

      // 툴팁
      const dateStr = (hasDates && hoverIdx < vDates.length)
        ? new Date(vDates[hoverIdx]).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })
        : "";
      const irStr = `IR ${fmt(hv, 4)}`;
      const line1 = dateStr || "";
      const line2 = irStr;

      ctx.font = "bold 11px sans-serif";
      const tw = Math.max(
        line1 ? ctx.measureText(line1).width : 0,
        ctx.measureText(line2).width
      );
      const lineH = 16;
      const boxH = line1 ? lineH * 2 + 8 : lineH + 8;

      let tipX = hx + 8;
      if (tipX + tw + 14 > px + pw) tipX = hx - tw - 18;
      const tipY = Math.max(py + boxH / 2, Math.min(hy, py + ph - boxH / 2));

      ctx.fillStyle = "rgba(20,20,20,0.85)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(tipX - 5, tipY - lineH, tw + 14, boxH, 4);
      else ctx.rect(tipX - 5, tipY - lineH, tw + 14, boxH);
      ctx.fill();

      ctx.textAlign = "left";
      if (line1) {
        ctx.fillStyle = "#fff";
        ctx.fillText(line1, tipX + 2, tipY - 2);
        ctx.fillStyle = hv >= 1 ? "#6fffc0" : "#ff8f8f";
        ctx.fillText(line2, tipX + 2, tipY + lineH - 2);
      } else {
        ctx.fillStyle = hv >= 1 ? "#6fffc0" : "#ff8f8f";
        ctx.fillText(line2, tipX + 2, tipY - 2);
      }
    }

  }, [irData, dates, label, viewStart, viewEnd, hoverIdx]);

  const viewRange = viewEnd - viewStart + 1;
  const totalDays = irData?.length ?? 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <button onClick={zoomIn}  style={{ width: 28, height: 28, fontSize: 16, fontWeight: 600, lineHeight: 1, padding: 0 }}>+</button>
        <button onClick={zoomOut} style={{ width: 28, height: 28, fontSize: 16, fontWeight: 600, lineHeight: 1, padding: 0 }}>−</button>
        <button onClick={resetView} style={{ fontSize: 11, padding: "2px 8px", opacity: viewRange === totalDays ? 0.4 : 1 }}>전체</button>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginLeft: 4 }}>
          {viewRange}일 표시 중 / 전체 {totalDays}일
        </span>
      </div>
      <canvas
        ref={ref}
        style={{
          width: "100%", height: 260,
          borderRadius: 8, border: "0.5px solid var(--color-border-tertiary)",
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      />
    </div>
  );
}

/* ─── PHASE COMPASS ─── */
function PhaseCompass({ re, im, phase, size = 220 }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv.getContext("2d");
    cv.width = size * 2; cv.height = size * 2;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const c = size / 2, r = c - 24;

    const quads = [
      { x: c, y: 0, w: c, h: c, fill: "#E1F5EE30", label: "A", lc: "#0F6E56", lx: c + r * 0.45, ly: c - r * 0.45 },
      { x: 0, y: 0, w: c, h: c, fill: "#FAEEDA30", label: "B", lc: "#854F0B", lx: c - r * 0.55, ly: c - r * 0.45 },
      { x: 0, y: c, w: c, h: c, fill: "#FCEBEB30", label: "C", lc: "#A32D2D", lx: c - r * 0.55, ly: c + r * 0.55 },
      { x: c, y: c, w: c, h: c, fill: "#E6F1FB30", label: "D", lc: "#185FA5", lx: c + r * 0.45, ly: c + r * 0.55 },
    ];
    quads.forEach(q => { ctx.fillStyle = q.fill; ctx.fillRect(q.x, q.y, q.w, q.h); });

    ctx.strokeStyle = "#ddd"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0, c); ctx.lineTo(size, c); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c, 0); ctx.lineTo(c, size); ctx.stroke();
    [0.33, 0.66, 1].forEach(s => { ctx.beginPath(); ctx.arc(c, c, r * s, 0, Math.PI * 2); ctx.stroke(); });

    ctx.font = "10px sans-serif";
    quads.forEach(q => { ctx.fillStyle = q.lc; ctx.fillText(q.label, q.lx, q.ly); });

    const dotX = c + clamp(re) * r, dotY = c - clamp(im) * r;
    ctx.beginPath(); ctx.fillStyle = PHASE[phase].color; ctx.arc(dotX, dotY, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.fillStyle = "#fff"; ctx.arc(dotX, dotY, 3, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = "#aaa"; ctx.font = "9px sans-serif";
    ctx.fillText("Re", size - 16, c - 3);
    ctx.fillText("Im", c + 3, 10);
  }, [re, im, phase, size]);

  return <canvas ref={ref} style={{ width: size, height: size }} />;
}

/* ─── NORMAL CDF APPROXIMATION ─── */
function normCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/* ─── BACKTEST ENGINE ─── */
function runBacktest(prices) {
  const LEVELS = [5, 10, 15, 20, 25];
  const HORIZONS = [
    { label: "1일", days: 1 },
    { label: "3일", days: 3 },
    { label: "1주일", days: 5 },
    { label: "2주일", days: 10 },
    { label: "1개월", days: 21 },
  ];
  const START = 260;
  const END = prices.length - 22;
  if (END <= START) return null;

  const cVol = (rets) => {
    if (rets.length < 2) return 0.01;
    const m = rets.reduce((a, b) => a + b, 0) / rets.length;
    return Math.sqrt(rets.reduce((a, r) => a + (r - m) ** 2, 0) / (rets.length - 1));
  };

  // Pre-compute all log returns
  const allReturns = [];
  for (let i = 1; i < prices.length; i++) allReturns.push(Math.log(prices[i] / prices[i - 1]));

  // Pre-compute EMAs for full series
  const eCalc = (arr, len) => {
    const k = 2 / (len + 1); const r = [arr[0]];
    for (let i = 1; i < arr.length; i++) r.push(arr[i] * k + r[i - 1] * (1 - k));
    return r;
  };
  const allEma5 = eCalc(prices, 5);
  const allEma12 = eCalc(prices, 12);
  const allEma20 = eCalc(prices, 20);
  const allEma26 = eCalc(prices, 26);
  const allEma60 = eCalc(prices, Math.min(60, prices.length - 1));

  // Results collectors
  const calibBuckets = {};
  for (let b = 0; b <= 90; b += 10) calibBuckets[b] = { preds: [], actuals: [] };
  const dirByHorizon = {};
  HORIZONS.forEach(h => { dirByHorizon[h.label] = { correct: 0, total: 0 }; });
  let brierSum = 0, brierCount = 0;

  for (let t = START; t < END; t++) {
    const cp = prices[t];
    const rets = allReturns.slice(0, t);
    const meanRet = rets.reduce((a, b) => a + b, 0) / rets.length;

    // Rolling volatilities
    const v10 = cVol(rets.slice(-10));
    const v20 = cVol(rets.slice(-20));
    const v60 = cVol(rets.slice(-60));
    const vFull = cVol(rets);
    const blended = v10 * 0.35 + v20 * 0.30 + v60 * 0.20 + vFull * 0.15;

    // SMA200 & band sigma
    const s200s = prices.slice(Math.max(0, t - 199), t + 1);
    const s200 = s200s.reduce((a, b) => a + b, 0) / s200s.length;
    const sd200 = Math.sqrt(s200s.reduce((a, p) => a + (p - s200) ** 2, 0) / s200s.length);
    const bSigma = sd200 > 0 ? (cp - s200) / sd200 : 0;

    // Direction signals
    const mom5 = t >= 5 ? (cp / prices[t - 5] - 1) : 0;
    const mom10 = t >= 10 ? (cp / prices[t - 10] - 1) : 0;
    const mom20 = t >= 20 ? (cp / prices[t - 20] - 1) : 0;
    const momSig = Math.tanh((mom5 * 3 + mom10 * 2 + mom20) / 6 * 30);

    const maAlign = ((allEma5[t] > allEma20[t] ? 1 : -1) + (allEma20[t] > allEma60[t] ? 1 : -1) + (cp > allEma20[t] ? 1 : -1)) / 3;

    let gains = 0, losses = 0;
    const rsiR = rets.slice(-14);
    for (const r of rsiR) { if (r > 0) gains += r; else losses -= r; }
    const aG = gains / 14, aL = losses / 14;
    const rsi = aL === 0 ? 100 : 100 - 100 / (1 + aG / aL);
    const rsiSig = (50 - rsi) / 50;

    const macdL = allEma12[t] - allEma26[t];
    const macdP = t >= 1 ? allEma12[t - 1] - allEma26[t - 1] : macdL;
    const macdN = cp > 0 ? macdL / cp * 100 : 0;
    const macdA = cp > 0 ? (macdL - macdP) / cp * 100 : 0;
    const macdSig = Math.tanh((macdN * 2 + macdA * 5) * 10);

    const bDrift = -bSigma * 0.25;
    // Cycle phase not available historically → redistribute weights
    const dirScore = momSig * 0.30 + maAlign * 0.24 + rsiSig * 0.12 + macdSig * 0.18 + bDrift * 0.16;
    const cDir = Math.max(-1, Math.min(1, dirScore));
    const adjDrift = meanRet + cDir * blended * 0.8;

    const getHVol = (d) => {
      if (d <= 1) return v10;
      if (d <= 3) return v10 * 0.6 + v20 * 0.3 + v60 * 0.1;
      if (d <= 5) return v20 * 0.5 + v60 * 0.3 + vFull * 0.2;
      if (d <= 10) return v20 * 0.3 + v60 * 0.4 + vFull * 0.3;
      return v60 * 0.4 + vFull * 0.6;
    };

    for (const h of HORIZONS) {
      if (t + h.days >= prices.length) continue;
      const futureP = prices[t + h.days];
      const actualPct = (futureP - cp) / cp * 100;

      // Direction accuracy
      if (Math.abs(cDir) > 0.05) {
        dirByHorizon[h.label].total++;
        if ((cDir > 0 && actualPct > 0) || (cDir < 0 && actualPct < 0)) {
          dirByHorizon[h.label].correct++;
        }
      }

      const hVol = getHVol(h.days);
      const vol = hVol * Math.sqrt(h.days);
      const drift = adjDrift * h.days;

      for (const pct of LEVELS) {
        // Upside
        const upTarget = Math.log(1 + pct / 100);
        const upProb = (1 - normCDF((upTarget - drift) / vol)) * 100;
        const upActual = actualPct >= pct ? 1 : 0;
        const upBucket = Math.min(90, Math.floor(upProb / 10) * 10);
        calibBuckets[upBucket].preds.push(upProb);
        calibBuckets[upBucket].actuals.push(upActual * 100);
        brierSum += (upProb / 100 - upActual) ** 2;
        brierCount++;

        // Downside
        const dnTarget = Math.log(1 - pct / 100);
        const dnProb = normCDF((dnTarget - drift) / vol) * 100;
        const dnActual = actualPct <= -pct ? 1 : 0;
        const dnBucket = Math.min(90, Math.floor(dnProb / 10) * 10);
        calibBuckets[dnBucket].preds.push(dnProb);
        calibBuckets[dnBucket].actuals.push(dnActual * 100);
        brierSum += (dnProb / 100 - dnActual) ** 2;
        brierCount++;
      }
    }
  }

  // Process results
  const calibration = [];
  let eceSum = 0, eceCount = 0;
  for (let b = 0; b <= 90; b += 10) {
    const d = calibBuckets[b];
    if (d.preds.length > 0) {
      const avgP = d.preds.reduce((a, v) => a + v, 0) / d.preds.length;
      const avgA = d.actuals.reduce((a, v) => a + v, 0) / d.actuals.length;
      calibration.push({ bucket: `${b}-${b + 10}`, avgPredicted: avgP, avgActual: avgA, count: d.preds.length });
      eceSum += Math.abs(avgP - avgA) * d.preds.length;
      eceCount += d.preds.length;
    }
  }

  const dirHorizonArr = HORIZONS.map(h => ({
    label: h.label,
    accuracy: dirByHorizon[h.label].total > 0 ? dirByHorizon[h.label].correct / dirByHorizon[h.label].total * 100 : 0,
    count: dirByHorizon[h.label].total,
  }));

  const totalDirCorrect = dirHorizonArr.reduce((a, h) => a + h.count * h.accuracy / 100, 0);
  const totalDirCount = dirHorizonArr.reduce((a, h) => a + h.count, 0);

  return {
    testDays: END - START,
    dirAccuracy: totalDirCount > 0 ? totalDirCorrect / totalDirCount * 100 : 0,
    dirTotal: totalDirCount,
    dirByHorizon: dirHorizonArr,
    brierScore: brierCount > 0 ? brierSum / brierCount : 0,
    calError: eceCount > 0 ? eceSum / eceCount : 0,
    calibration,
  };
}

/* ─── 과거 N일간 확률 매트릭스 재계산 ─── */
function computeRetroMatrices(allPrices, allDates, numDays) {
  const LEVELS = [25, 20, 15, 10, 5];
  const HORIZONS = [
    { label: "1일", days: 1 },
    { label: "3일", days: 3 },
    { label: "1주일", days: 5 },
    { label: "2주일", days: 10 },
    { label: "1개월", days: 21 },
  ];

  const emaCalc = (arr, len) => {
    const k = 2 / (len + 1); const r = [arr[0]];
    for (let i = 1; i < arr.length; i++) r.push(arr[i] * k + r[i - 1] * (1 - k));
    return r;
  };
  const calcVol = (rets) => {
    const m = rets.reduce((a, b) => a + b, 0) / rets.length;
    return Math.sqrt(rets.reduce((a, r) => a + (r - m) ** 2, 0) / (rets.length - 1));
  };

  const results = [];

  for (let daysAgo = 1; daysAgo <= numDays; daysAgo++) {
    const endIdx = allPrices.length - daysAgo;
    if (endIdx < 60) continue;

    const prices = allPrices.slice(0, endIdx);
    const basePrice = prices[prices.length - 1];
    const baseDate = allDates[endIdx - 1];

    const returns = [];
    for (let i = 1; i < prices.length; i++) returns.push(Math.log(prices[i] / prices[i - 1]));

    const recent10 = returns.slice(-10);
    const recent20 = returns.slice(-20);
    const recent60 = returns.slice(-60);
    const vol10Daily = calcVol(recent10);
    const vol20Daily = calcVol(recent20);
    const vol60Daily = calcVol(recent60);
    const volFullDaily = calcVol(returns);
    const blendedDailyVol = vol10Daily * 0.35 + vol20Daily * 0.30 + vol60Daily * 0.20 + volFullDaily * 0.15;
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;

    const sma200Len = Math.min(200, prices.length);
    const sma200Slice = prices.slice(-sma200Len);
    const sma200 = sma200Slice.reduce((a, b) => a + b, 0) / sma200Slice.length;
    const sd200 = Math.sqrt(sma200Slice.reduce((a, p) => a + (p - sma200) ** 2, 0) / sma200Len);
    const bandSigma = sd200 > 0 ? (basePrice - sma200) / sd200 : 0;

    const mom5 = prices.length >= 6 ? (basePrice / prices[prices.length - 6] - 1) : 0;
    const mom10 = prices.length >= 11 ? (basePrice / prices[prices.length - 11] - 1) : 0;
    const mom20 = prices.length >= 21 ? (basePrice / prices[prices.length - 21] - 1) : 0;
    const momSignal = Math.tanh((mom5 * 3 + mom10 * 2 + mom20 * 1) / 6 * 30);

    const ema5 = emaCalc(prices, 5);
    const ema20 = emaCalc(prices, 20);
    const ema60 = emaCalc(prices, Math.min(60, prices.length - 1));
    const maAlignScore = ((ema5[ema5.length - 1] > ema20[ema20.length - 1] ? 1 : -1) + (ema20[ema20.length - 1] > ema60[ema60.length - 1] ? 1 : -1) + (basePrice > ema20[ema20.length - 1] ? 1 : -1)) / 3;

    const rsiLen = 14;
    let gains = 0, losses = 0;
    const rsiReturns = returns.slice(-rsiLen);
    for (const r of rsiReturns) { if (r > 0) gains += r; else losses -= r; }
    const avgGain = gains / rsiLen;
    const avgLoss = losses / rsiLen;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    const rsiSignal = (50 - rsi) / 50;

    const ema12 = emaCalc(prices, 12);
    const ema26 = emaCalc(prices, 26);
    const macdLine = ema12[ema12.length - 1] - ema26[ema26.length - 1];
    const macdPrev = ema12.length >= 2 ? ema12[ema12.length - 2] - ema26[ema26.length - 2] : macdLine;
    const macdNorm = basePrice > 0 ? macdLine / basePrice * 100 : 0;
    const macdAccel = basePrice > 0 ? (macdLine - macdPrev) / basePrice * 100 : 0;
    const macdSignal = Math.tanh((macdNorm * 2 + macdAccel * 5) * 10);

    const bandDrift = -bandSigma * 0.25;

    const directionScore = momSignal * 0.30 + maAlignScore * 0.24 + rsiSignal * 0.12 + macdSignal * 0.18 + bandDrift * 0.16;
    const clampedDirection = Math.max(-1, Math.min(1, directionScore));
    const adjustedDrift = meanReturn + clampedDirection * blendedDailyVol * 0.8;

    const getHorizonVol = (horizonDays) => {
      if (horizonDays <= 1) return vol10Daily;
      if (horizonDays <= 3) return vol10Daily * 0.6 + vol20Daily * 0.3 + vol60Daily * 0.1;
      if (horizonDays <= 5) return vol20Daily * 0.5 + vol60Daily * 0.3 + volFullDaily * 0.2;
      if (horizonDays <= 10) return vol20Daily * 0.3 + vol60Daily * 0.4 + volFullDaily * 0.3;
      return vol60Daily * 0.4 + volFullDaily * 0.6;
    };

    const matrix = {};
    for (const h of HORIZONS) {
      const hVol = getHorizonVol(h.days);
      const vol = hVol * Math.sqrt(h.days);
      const drift = adjustedDrift * h.days;
      matrix[h.label] = {};
      for (const pct of LEVELS) {
        const upTarget = Math.log(1 + pct / 100);
        const dnTarget = Math.log(1 - pct / 100);
        matrix[h.label][pct] = {
          up: (1 - normCDF((upTarget - drift) / vol)) * 100,
          down: normCDF((dnTarget - drift) / vol) * 100,
        };
      }
    }

    const actuals = {};
    for (const h of HORIZONS) {
      const futureIdx = endIdx - 1 + h.days;
      if (futureIdx < allPrices.length) {
        const futurePrice = allPrices[futureIdx];
        actuals[h.label] = ((futurePrice - basePrice) / basePrice) * 100;
      } else {
        actuals[h.label] = null;
      }
    }

    results.push({
      date: baseDate,
      basePrice,
      direction: clampedDirection,
      annualVol: blendedDailyVol * Math.sqrt(252) * 100,
      matrix,
      actuals,
    });
  }

  return results;
}

/* ─── SCENARIO MATRIX ─── */
function ScenarioMatrix({ prices, dates, phase, cycleData, label, hasRealData, marketPrice }) {
  const [btResults, setBtResults] = useState(null);
  const [btRunning, setBtRunning] = useState(false);
  const [retroMode, setRetroMode] = useState(null);
  const [retroData, setRetroData] = useState(null);
  const [retroLoading, setRetroLoading] = useState(false);

  const LEVELS = [25, 20, 15, 10, 5];
  const HORIZONS = [
    { label: "1일", days: 1 },
    { label: "3일", days: 3 },
    { label: "1주일", days: 5 },
    { label: "2주일", days: 10 },
    { label: "1개월", days: 21 },
  ];

  if (!prices || prices.length < 60) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "var(--color-text-tertiary)", fontSize: 13 }}>
        데이터를 먼저 불러와주세요. (Fetch data 버튼)
      </div>
    );
  }

  const currentPrice = marketPrice || prices[prices.length - 1];

  // 일별 수익률
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }

  // 구간별 변동성 계산 헬퍼
  const calcVol = (rets) => {
    const m = rets.reduce((a, b) => a + b, 0) / rets.length;
    return Math.sqrt(rets.reduce((a, r) => a + (r - m) ** 2, 0) / (rets.length - 1));
  };

  const recent10 = returns.slice(-10);
  const recent20 = returns.slice(-20);
  const recent60 = returns.slice(-60);
  const vol10Daily = calcVol(recent10);
  const vol20Daily = calcVol(recent20);
  const vol60Daily = calcVol(recent60);
  const volFullDaily = calcVol(returns);

  // 가중 혼합 변동성: 단기에 무게를 두되 장기로 앵커링
  // 10일(35%) + 20일(30%) + 60일(20%) + 전체(15%)
  const blendedDailyVol = vol10Daily * 0.35 + vol20Daily * 0.30 + vol60Daily * 0.20 + volFullDaily * 0.15;
  const annualVol = blendedDailyVol * Math.sqrt(252);

  // 변동성 비율 (현재 vs 평균) — UI 표시용
  const volRatio = blendedDailyVol / volFullDaily;
  const vol20Ann = vol20Daily * Math.sqrt(252) * 100;
  const vol60Ann = vol60Daily * Math.sqrt(252) * 100;
  const volFullAnn = volFullDaily * Math.sqrt(252) * 100;

  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;

  // SMA200 계산
  const sma200Len = Math.min(200, prices.length);
  const sma200Slice = prices.slice(-sma200Len);
  const sma200 = sma200Slice.reduce((a, b) => a + b, 0) / sma200Slice.length;

  // Guide Band 상태 판단
  const sd200 = Math.sqrt(sma200Slice.reduce((a, p) => a + (p - sma200) ** 2, 0) / sma200Len);
  const bandSigma = sd200 > 0 ? (currentPrice - sma200) / sd200 : 0;
  let bandState = "중립";
  if (bandSigma >= 2) bandState = "과열";
  else if (bandSigma >= 1) bandState = "강세";
  else if (bandSigma >= 0) bandState = "중립 상단";
  else if (bandSigma >= -1) bandState = "중립 하단";
  else if (bandSigma >= -2) bandState = "약세";
  else bandState = "과매도";

  // ── 방향성 지표 계산 ──
  const emaCalc = (arr, len) => {
    const k = 2 / (len + 1); const r = [arr[0]];
    for (let i = 1; i < arr.length; i++) r.push(arr[i] * k + r[i - 1] * (1 - k));
    return r;
  };
  const smaCalc = (arr, len) => {
    const r = []; let s = 0;
    for (let i = 0; i < arr.length; i++) {
      s += arr[i]; if (i >= len) s -= arr[i - len];
      r.push(i >= len - 1 ? s / len : null);
    }
    return r;
  };

  // 1) 추세 모멘텀: 5/10/20일 수익률 방향 (-1 ~ +1)
  const mom5 = prices.length >= 6 ? (currentPrice / prices[prices.length - 6] - 1) : 0;
  const mom10 = prices.length >= 11 ? (currentPrice / prices[prices.length - 11] - 1) : 0;
  const mom20 = prices.length >= 21 ? (currentPrice / prices[prices.length - 21] - 1) : 0;
  const momSignal = Math.tanh((mom5 * 3 + mom10 * 2 + mom20 * 1) / 6 * 30);

  // 2) MA 배열: EMA5 > EMA20 > EMA60이면 +1, 역순이면 -1
  const ema5 = emaCalc(prices, 5);
  const ema20 = emaCalc(prices, 20);
  const ema60 = emaCalc(prices, Math.min(60, prices.length - 1));
  const e5Last = ema5[ema5.length - 1];
  const e20Last = ema20[ema20.length - 1];
  const e60Last = ema60[ema60.length - 1];
  const maAlignScore = ((e5Last > e20Last ? 1 : -1) + (e20Last > e60Last ? 1 : -1) + (currentPrice > e20Last ? 1 : -1)) / 3;

  // 3) RSI 14: >70이면 하방 편향, <30이면 상방 편향
  const rsiLen = 14;
  let gains = 0, losses = 0;
  const rsiReturns = returns.slice(-rsiLen);
  for (const r of rsiReturns) { if (r > 0) gains += r; else losses -= r; }
  const avgGain = gains / rsiLen;
  const avgLoss = losses / rsiLen;
  const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  const rsiSignal = (50 - rsi) / 50;

  // 4) MACD 히스토그램: 양수 → 상방, 음수 → 하방
  const ema12 = emaCalc(prices, 12);
  const ema26 = emaCalc(prices, 26);
  const macdLine = ema12[ema12.length - 1] - ema26[ema26.length - 1];
  const macdPrev = ema12.length >= 2 ? ema12[ema12.length - 2] - ema26[ema26.length - 2] : macdLine;
  const macdNorm = currentPrice > 0 ? macdLine / currentPrice * 100 : 0;
  const macdAccel = currentPrice > 0 ? (macdLine - macdPrev) / currentPrice * 100 : 0;
  const macdSignal = Math.tanh((macdNorm * 2 + macdAccel * 5) * 10);

  // 5) Guide Band 위치: 평균회귀 (과열→하방, 과매도→상방)
  const bandDrift = -bandSigma * 0.25;

  // 6) Cycle Phase: 확장기 → 상방, 수축기 → 하방
  const re = cycleData?.re || 0;
  const im = cycleData?.im || 0;
  const phaseDrift = re * 0.4 + im * 0.3;

  // 종합 방향성 점수 (-1 ~ +1) — Cycle Phase 제외 (재현성 확보: 과거 재계산 시 동일 결과)
  const directionScore = (
    momSignal    * 0.30 +
    maAlignScore * 0.24 +
    rsiSignal    * 0.12 +
    macdSignal   * 0.18 +
    bandDrift    * 0.16
  );
  const clampedDirection = Math.max(-1, Math.min(1, directionScore));
  const adjustedDrift = meanReturn + clampedDirection * blendedDailyVol * 0.8;

  // 시간대별 변동성 스케일링: 단기는 최근 변동성 비중↑, 장기는 평균 회귀
  const getHorizonVol = (horizonDays) => {
    if (horizonDays <= 1) return vol10Daily;
    if (horizonDays <= 3) return vol10Daily * 0.6 + vol20Daily * 0.3 + vol60Daily * 0.1;
    if (horizonDays <= 5) return vol20Daily * 0.5 + vol60Daily * 0.3 + volFullDaily * 0.2;
    if (horizonDays <= 10) return vol20Daily * 0.3 + vol60Daily * 0.4 + volFullDaily * 0.3;
    return vol60Daily * 0.4 + volFullDaily * 0.6;
  };

  // 확률 계산
  const calcProb = (targetPct, horizonDays) => {
    const hVol = getHorizonVol(horizonDays);
    const vol = hVol * Math.sqrt(horizonDays);
    const drift = adjustedDrift * horizonDays;
    const targetReturn = Math.log(1 + targetPct / 100);
    if (targetPct > 0) {
      return (1 - normCDF((targetReturn - drift) / vol)) * 100;
    } else {
      return normCDF((targetReturn - drift) / vol) * 100;
    }
  };

  // 셀 색상
  const getCellColor = (prob, isUp) => {
    if (prob < 1) return { bg: "var(--color-background-secondary)", text: "var(--color-text-tertiary)" };
    if (isUp) {
      if (prob >= 30) return { bg: "#0F6E56", text: "#fff" };
      if (prob >= 15) return { bg: "#E1F5EE", text: "#0F6E56" };
      if (prob >= 5)  return { bg: "#f0faf5", text: "#0F6E56" };
      return { bg: "var(--color-background-secondary)", text: "#0F6E56" };
    } else {
      if (prob >= 30) return { bg: "#A32D2D", text: "#fff" };
      if (prob >= 15) return { bg: "#FCEBEB", text: "#A32D2D" };
      if (prob >= 5)  return { bg: "#fef5f5", text: "#A32D2D" };
      return { bg: "var(--color-background-secondary)", text: "#A32D2D" };
    }
  };

  const phaseInfo = PHASE[phase];
  const bandColor = bandSigma >= 1 ? "#A32D2D" : bandSigma <= -1 ? "#185FA5" : "#0F6E56";
  const volStateLabel = volRatio >= 1.5 ? "매우 높음" : volRatio >= 1.2 ? "높음" : volRatio >= 0.8 ? "보통" : "낮음";
  const volStateColor = volRatio >= 1.5 ? "#A32D2D" : volRatio >= 1.2 ? "#854F0B" : "#0F6E56";

  return (
    <div>
      {/* 상단 요약 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 16 }}>
        <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)" }}>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>현재가 ({label})</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: "var(--color-text-primary)" }}>
            {hasRealData ? (currentPrice >= 1000 ? Math.round(currentPrice).toLocaleString() : currentPrice.toFixed(2)) : "—"}
          </div>
        </div>
        <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)" }}>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>적용 변동성 (가중)</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 20, fontWeight: 600, color: "var(--color-text-primary)" }}>{(annualVol * 100).toFixed(1)}%</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: volStateColor, padding: "1px 6px", borderRadius: 4, background: volStateColor + "18" }}>{volStateLabel}</span>
          </div>
          <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 2 }}>20일 {vol20Ann.toFixed(1)}% / 60일 {vol60Ann.toFixed(1)}% / 평균 {volFullAnn.toFixed(1)}%</div>
          {volRatio >= 1.2 && <div style={{ fontSize: 10, color: volStateColor, marginTop: 2 }}>⚡ 최근 변동성이 평균 대비 {((volRatio - 1) * 100).toFixed(0)}% 높음</div>}
          {volRatio < 0.8 && <div style={{ fontSize: 10, color: volStateColor, marginTop: 2 }}>😴 최근 변동성이 평균 대비 {((1 - volRatio) * 100).toFixed(0)}% 낮음</div>}
        </div>
        <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--color-background-secondary)", border: `0.5px solid var(--color-border-tertiary)` }}>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>Guide Band 위치</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: bandColor }}>{bandState}</div>
          <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{bandSigma >= 0 ? "+" : ""}{bandSigma.toFixed(2)}σ (SMA200 대비)</div>
        </div>
        <div style={{ padding: "10px 12px", borderRadius: 8, background: phaseInfo.bg, border: `0.5px solid ${phaseInfo.color}40` }}>
          <div style={{ fontSize: 11, color: phaseInfo.color }}>Cycle Phase</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: phaseInfo.color }}>{phaseInfo.icon} {phaseInfo.label}</div>
          <div style={{ fontSize: 10, color: phaseInfo.color, opacity: 0.8 }}>{phaseInfo.tip}</div>
        </div>
        {(() => {
          const dirPct = Math.round(clampedDirection * 100);
          const dirColor = dirPct >= 20 ? "#0F6E56" : dirPct >= 5 ? "#4caf50" : dirPct <= -20 ? "#A32D2D" : dirPct <= -5 ? "#e57373" : "#854F0B";
          const dirLabel = dirPct >= 30 ? "강한 상방" : dirPct >= 15 ? "상방 우세" : dirPct >= 5 ? "약한 상방" : dirPct <= -30 ? "강한 하방" : dirPct <= -15 ? "하방 우세" : dirPct <= -5 ? "약한 하방" : "중립";
          const dirArrow = dirPct >= 5 ? "▲" : dirPct <= -5 ? "▼" : "●";
          const details = [
            { name: "모멘텀", val: momSignal },
            { name: "MA배열", val: maAlignScore },
            { name: "RSI", val: rsiSignal },
            { name: "MACD", val: macdSignal },
            { name: "밴드", val: Math.max(-1, Math.min(1, bandDrift)) },
            { name: "국면(참고)", val: Math.max(-1, Math.min(1, phaseDrift)) },
          ];
          return (
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--color-background-secondary)", border: `1.5px solid ${dirColor}40` }}>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>방향성 판단</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 18, fontWeight: 600, color: dirColor }}>{dirArrow} {dirLabel}</span>
                <span style={{ fontSize: 12, color: dirColor }}>{dirPct >= 0 ? "+" : ""}{dirPct}%</span>
              </div>
              <div style={{ display: "flex", gap: 3, marginTop: 6, flexWrap: "wrap" }}>
                {details.map(d => {
                  const c = d.val > 0.1 ? "#0F6E56" : d.val < -0.1 ? "#A32D2D" : "var(--color-text-tertiary)";
                  const arrow = d.val > 0.1 ? "↑" : d.val < -0.1 ? "↓" : "·";
                  return (
                    <span key={d.name} style={{ fontSize: 9, color: c, padding: "1px 4px", borderRadius: 3, background: c === "var(--color-text-tertiary)" ? "transparent" : c + "12", border: `0.5px solid ${c}30` }}>
                      {arrow}{d.name}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>

      {/* 확률 매트릭스 */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 2, fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ padding: "8px 6px", fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 500, textAlign: "left", minWidth: 100 }}>
                가격 수준
              </th>
              {HORIZONS.map(h => (
                <th key={h.label} style={{ padding: "8px 6px", fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 500, textAlign: "center", minWidth: 70 }}>
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* 상승 구간 (25% → 5%) */}
            {LEVELS.map(pct => {
              const targetPrice = currentPrice * (1 + pct / 100);
              return (
                <tr key={`up-${pct}`}>
                  <td style={{ padding: "6px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500, color: "#0F6E56", background: "var(--color-background-secondary)" }}>
                    <span>▲ +{pct}%</span>
                    <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-text-tertiary)", fontWeight: 400 }}>
                      {targetPrice >= 1000 ? Math.round(targetPrice).toLocaleString() : targetPrice.toFixed(1)}
                    </span>
                  </td>
                  {HORIZONS.map(h => {
                    const prob = calcProb(pct, h.days);
                    const style = getCellColor(prob, true);
                    return (
                      <td key={h.label} style={{
                        padding: "6px 4px", borderRadius: 4, textAlign: "center",
                        fontWeight: prob >= 10 ? 600 : 400,
                        background: style.bg, color: style.text,
                        transition: "all 0.2s",
                      }}>
                        {prob < 0.1 ? "—" : prob.toFixed(1) + "%"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* 현재가 행 */}
            <tr>
              <td colSpan={HORIZONS.length + 1} style={{
                padding: "4px 8px", fontSize: 11, fontWeight: 600,
                background: "var(--color-text-primary)", color: "var(--color-background-primary)",
                borderRadius: 4, textAlign: "center",
              }}>
                ● 현재가 {hasRealData ? (currentPrice >= 1000 ? Math.round(currentPrice).toLocaleString() : currentPrice.toFixed(2)) : "—"}
              </td>
            </tr>

            {/* 하락 구간 (-5% → -25%) */}
            {LEVELS.slice().reverse().map(pct => {
              const targetPrice = currentPrice * (1 - pct / 100);
              return (
                <tr key={`down-${pct}`}>
                  <td style={{ padding: "6px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500, color: "#A32D2D", background: "var(--color-background-secondary)" }}>
                    <span>▼ -{pct}%</span>
                    <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-text-tertiary)", fontWeight: 400 }}>
                      {targetPrice >= 1000 ? Math.round(targetPrice).toLocaleString() : targetPrice.toFixed(1)}
                    </span>
                  </td>
                  {HORIZONS.map(h => {
                    const prob = calcProb(-pct, h.days);
                    const style = getCellColor(prob, false);
                    return (
                      <td key={h.label} style={{
                        padding: "6px 4px", borderRadius: 4, textAlign: "center",
                        fontWeight: prob >= 10 ? 600 : 400,
                        background: style.bg, color: style.text,
                        transition: "all 0.2s",
                      }}>
                        {prob < 0.1 ? "—" : prob.toFixed(1) + "%"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ─── 과거 예측 정확도 ─── */}
      <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>과거 예측 정확도</span>
          {[5, 20].map(n => {
            const isActive = retroMode === n;
            return (
              <button
                key={n}
                onClick={() => {
                  if (isActive) { setRetroMode(null); setRetroData(null); return; }
                  setRetroMode(n);
                  setRetroLoading(true);
                  setTimeout(() => {
                    setRetroData(computeRetroMatrices(prices, dates, n));
                    setRetroLoading(false);
                  }, 30);
                }}
                disabled={retroLoading}
                style={{
                  fontSize: 11, padding: "4px 12px", cursor: retroLoading ? "wait" : "pointer",
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? "var(--color-text-primary)" : "var(--color-background-primary)",
                  color: isActive ? "var(--color-background-primary)" : "var(--color-text-secondary)",
                  border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6,
                }}
              >
                과거 {n}일
              </button>
            );
          })}
          {retroLoading && <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>계산 중...</span>}
          {!retroMode && !retroLoading && (
            <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
              과거 날짜별 예측 매트릭스와 실제 결과를 비교합니다
            </span>
          )}
        </div>

        {retroData && retroMode && (
          <div style={{ marginTop: 12 }}>
            {retroData.map((day, idx) => {
              const dirPct = Math.round(day.direction * 100);
              const dirLabel = dirPct >= 15 ? "상방" : dirPct <= -15 ? "하방" : "중립";
              const dirColor = dirPct >= 5 ? "#0F6E56" : dirPct <= -5 ? "#A32D2D" : "#854F0B";
              return (
                <div key={idx} style={{
                  marginBottom: 10, padding: "10px 12px", borderRadius: 8,
                  background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>
                      {day.date}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                      기준가 {day.basePrice >= 1000 ? Math.round(day.basePrice).toLocaleString() : day.basePrice.toFixed(2)}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
                      변동성 {day.annualVol.toFixed(1)}%
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: dirColor, padding: "1px 6px", borderRadius: 4, background: dirColor + "15" }}>
                      {dirLabel} {dirPct >= 0 ? "+" : ""}{dirPct}%
                    </span>
                  </div>

                  {/* 실제 결과 vs 예측 */}
                  <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
                    {HORIZONS.map(h => {
                      const actual = day.actuals[h.label];
                      if (actual == null) return (
                        <div key={h.label} style={{ flex: 1, minWidth: 65, textAlign: "center", padding: "4px 6px", borderRadius: 5, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)" }}>
                          <div style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>{h.label} 후</div>
                          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>미래</div>
                        </div>
                      );
                      const c = actual >= 0 ? "#0F6E56" : "#A32D2D";
                      const arrow = actual >= 0 ? "▲" : "▼";
                      return (
                        <div key={h.label} style={{ flex: 1, minWidth: 65, textAlign: "center", padding: "4px 6px", borderRadius: 5, background: c + "08", border: `0.5px solid ${c}30` }}>
                          <div style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>{h.label} 후 실제</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: c }}>{arrow} {actual >= 0 ? "+" : ""}{actual.toFixed(2)}%</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 축소된 확률 매트릭스 */}
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 1, fontSize: 10 }}>
                      <thead>
                        <tr>
                          <th style={{ padding: "4px 4px", fontSize: 9, color: "var(--color-text-tertiary)", fontWeight: 500, textAlign: "left", minWidth: 70 }}>수준</th>
                          {HORIZONS.map(h => (
                            <th key={h.label} style={{ padding: "4px 3px", fontSize: 9, color: "var(--color-text-tertiary)", fontWeight: 500, textAlign: "center", minWidth: 50 }}>
                              {h.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {LEVELS.map(pct => (
                          <tr key={`up-${pct}`}>
                            <td style={{ padding: "3px 4px", borderRadius: 3, fontSize: 9, fontWeight: 500, color: "#0F6E56", background: "var(--color-background-secondary)" }}>▲+{pct}%</td>
                            {HORIZONS.map(h => {
                              const prob = day.matrix[h.label][pct].up;
                              const actual = day.actuals[h.label];
                              const hit = actual != null && actual >= pct;
                              const style = getCellColor(prob, true);
                              return (
                                <td key={h.label} style={{
                                  padding: "3px 2px", borderRadius: 3, textAlign: "center",
                                  fontWeight: prob >= 10 ? 600 : 400,
                                  background: hit ? "#0F6E56" : style.bg, color: hit ? "#fff" : style.text,
                                  outline: hit ? "2px solid #0F6E56" : "none",
                                }}>
                                  {prob < 0.1 ? "—" : prob.toFixed(1) + "%"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        <tr>
                          <td colSpan={HORIZONS.length + 1} style={{
                            padding: "2px 4px", fontSize: 9, fontWeight: 600,
                            background: "var(--color-text-primary)", color: "var(--color-background-primary)",
                            borderRadius: 3, textAlign: "center",
                          }}>
                            ● {day.basePrice >= 1000 ? Math.round(day.basePrice).toLocaleString() : day.basePrice.toFixed(2)}
                          </td>
                        </tr>
                        {LEVELS.slice().reverse().map(pct => (
                          <tr key={`dn-${pct}`}>
                            <td style={{ padding: "3px 4px", borderRadius: 3, fontSize: 9, fontWeight: 500, color: "#A32D2D", background: "var(--color-background-secondary)" }}>▼-{pct}%</td>
                            {HORIZONS.map(h => {
                              const prob = day.matrix[h.label][pct].down;
                              const actual = day.actuals[h.label];
                              const hit = actual != null && actual <= -pct;
                              const style = getCellColor(prob, false);
                              return (
                                <td key={h.label} style={{
                                  padding: "3px 2px", borderRadius: 3, textAlign: "center",
                                  fontWeight: prob >= 10 ? 600 : 400,
                                  background: hit ? "#A32D2D" : style.bg, color: hit ? "#fff" : style.text,
                                  outline: hit ? "2px solid #A32D2D" : "none",
                                }}>
                                  {prob < 0.1 ? "—" : prob.toFixed(1) + "%"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            {/* 요약 통계 */}
            {(() => {
              let totalChecks = 0, correctHits = 0;
              for (const day of retroData) {
                for (const h of HORIZONS) {
                  const actual = day.actuals[h.label];
                  if (actual == null) continue;
                  const predicted = day.direction >= 0 ? "up" : "down";
                  const happened = actual >= 0 ? "up" : "down";
                  totalChecks++;
                  if (predicted === happened) correctHits++;
                }
              }
              const dirAcc = totalChecks > 0 ? (correctHits / totalChecks * 100) : 0;
              const dirColor = dirAcc >= 55 ? "#0F6E56" : dirAcc >= 50 ? "#854F0B" : "#A32D2D";

              let probAcc5 = { total: 0, correct: 0 };
              let probAcc10 = { total: 0, correct: 0 };
              for (const day of retroData) {
                for (const h of HORIZONS) {
                  const actual = day.actuals[h.label];
                  if (actual == null) continue;
                  const prob5up = day.matrix[h.label][5].up;
                  const prob5dn = day.matrix[h.label][5].down;
                  if (prob5up >= 50) { probAcc5.total++; if (actual >= 5) probAcc5.correct++; }
                  if (prob5dn >= 50) { probAcc5.total++; if (actual <= -5) probAcc5.correct++; }
                  const prob10up = day.matrix[h.label][10].up;
                  const prob10dn = day.matrix[h.label][10].down;
                  if (prob10up >= 30) { probAcc10.total++; if (actual >= 10) probAcc10.correct++; }
                  if (prob10dn >= 30) { probAcc10.total++; if (actual <= -10) probAcc10.correct++; }
                }
              }

              return (
                <div style={{
                  padding: "8px 10px", borderRadius: 6, background: "var(--color-background-primary)",
                  border: "0.5px solid var(--color-border-tertiary)", marginTop: 4,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 6 }}>최근 {retroMode}일 요약</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ padding: "4px 8px", borderRadius: 5, background: dirColor + "10", border: `0.5px solid ${dirColor}30` }}>
                      <div style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>방향 적중률</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: dirColor }}>{dirAcc.toFixed(1)}%</div>
                      <div style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>{correctHits}/{totalChecks}건</div>
                    </div>
                    {probAcc5.total > 0 && (
                      <div style={{ padding: "4px 8px", borderRadius: 5, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)" }}>
                        <div style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>±5% 예측 ({">"}50%일 때)</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>{probAcc5.correct}/{probAcc5.total}</div>
                      </div>
                    )}
                    {probAcc10.total > 0 && (
                      <div style={{ padding: "4px 8px", borderRadius: 5, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)" }}>
                        <div style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>±10% 예측 ({">"}30%일 때)</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>{probAcc10.correct}/{probAcc10.total}</div>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 9, color: "var(--color-text-tertiary)", marginTop: 6, lineHeight: 1.5 }}>
                    각 매트릭스는 해당 날짜까지의 가격 데이터만으로 재계산한 값입니다. 실제 결과에 해당하는 셀은 강조 표시됩니다.
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* ─── 변동성 전망 ─── */}
      {(() => {
        // Signal 1: Bollinger Band 스퀴즈 (밴드 폭 축소 → 확대 임박)
        const bandWidths = [];
        for (let i = 19; i < prices.length; i++) {
          const slice = prices.slice(i - 19, i + 1);
          const m = slice.reduce((a, b) => a + b, 0) / 20;
          const sd = Math.sqrt(slice.reduce((a, p) => a + (p - m) ** 2, 0) / 20);
          bandWidths.push(sd / m);
        }
        const currentBW = bandWidths[bandWidths.length - 1];
        const sortedBW = [...bandWidths].sort((a, b) => a - b);
        const bwPercentile = sortedBW.findIndex(v => v >= currentBW) / sortedBW.length;
        const squeezeScore = Math.round((1 - bwPercentile) * 100);
        const squeezeLabel = bwPercentile <= 0.1 ? "극단적 수축" : bwPercentile <= 0.25 ? "수축 구간" : bwPercentile <= 0.5 ? "보통" : bwPercentile <= 0.75 ? "확장 중" : "고변동 구간";

        // Signal 2: VIX 수준
        const vix = cycleData?.vix;
        let vixScore = 30;
        let vixLabel = "데이터 없음";
        if (vix != null) {
          if (vix >= 30) { vixScore = 95; vixLabel = `${vix.toFixed(1)} — 극단적 공포`; }
          else if (vix >= 25) { vixScore = 75; vixLabel = `${vix.toFixed(1)} — 높은 공포`; }
          else if (vix >= 20) { vixScore = 55; vixLabel = `${vix.toFixed(1)} — 경계`; }
          else if (vix >= 15) { vixScore = 30; vixLabel = `${vix.toFixed(1)} — 보통`; }
          else { vixScore = 10; vixLabel = `${vix.toFixed(1)} — 안정`; }
        }

        // Signal 3: 변동성 가속도 (5일 vol vs 20일 vol 비율)
        const vol5 = returns.length >= 5 ? calcVol(returns.slice(-5)) : vol10Daily;
        const accelRatio = vol5 / vol60Daily;
        const accelScore = Math.min(100, Math.round(Math.max(0, (accelRatio - 0.5) / 2.5 * 100)));
        const accelLabel = accelRatio >= 2.0 ? "급격한 상승" : accelRatio >= 1.5 ? "상승 추세" : accelRatio >= 1.0 ? "보통" : accelRatio >= 0.7 ? "하락 추세" : "매우 낮음";

        // Signal 4: 주요 MA 근접도 (SMA200 근처 = 결정 구간)
        const distFromMA = Math.abs(currentPrice - sma200) / sma200 * 100;
        const maScore = distFromMA <= 1 ? 90 : distFromMA <= 2 ? 70 : distFromMA <= 5 ? 45 : distFromMA <= 10 ? 25 : 10;
        const maLabel = distFromMA <= 1 ? `SMA200까지 ${distFromMA.toFixed(1)}% — 결정적 구간` : distFromMA <= 3 ? `SMA200까지 ${distFromMA.toFixed(1)}% — 근접` : `SMA200까지 ${distFromMA.toFixed(1)}%`;

        // Signal 5: 변동성 군집 (최근 고변동 지속 여부)
        const highVolDays = returns.slice(-20).filter(r => Math.abs(r) > volFullDaily * 1.5).length;
        const clusterScore = Math.min(100, Math.round(highVolDays / 20 * 250));
        const clusterLabel = highVolDays >= 8 ? `20일 중 ${highVolDays}일 이상치 — 강한 군집` : highVolDays >= 4 ? `20일 중 ${highVolDays}일 이상치` : `20일 중 ${highVolDays}일 이상치 — 안정`;

        // Signal 6: Cycle Phase 전환 근접도
        const reAbs = Math.abs(cycleData?.re || 0);
        const imAbs = Math.abs(cycleData?.im || 0);
        const transitionDist = Math.min(reAbs, imAbs);
        const transScore = transitionDist <= 0.05 ? 85 : transitionDist <= 0.1 ? 65 : transitionDist <= 0.2 ? 40 : 15;
        const transLabel = transitionDist <= 0.05 ? "국면 전환 임박" : transitionDist <= 0.1 ? "전환 근접" : transitionDist <= 0.2 ? "전환 가능" : "안정적 국면";

        const signals = [
          { name: "밴드 스퀴즈", score: squeezeScore, detail: squeezeLabel, weight: 25, desc: "밴드 폭 축소 시 확대 임박" },
          { name: "VIX 공포지수", score: vixScore, detail: vixLabel, weight: 20, desc: "시장 공포 수준" },
          { name: "변동성 가속도", score: accelScore, detail: accelLabel, weight: 20, desc: "5일/60일 변동성 비율" },
          { name: "MA 근접도", score: maScore, detail: maLabel, weight: 15, desc: "SMA200 근처에서 방향 결정" },
          { name: "변동성 군집", score: clusterScore, detail: clusterLabel, weight: 10, desc: "최근 큰 변동 빈도" },
          { name: "국면 전환", score: transScore, detail: transLabel, weight: 10, desc: "Cycle Phase 경계 근접" },
        ];

        const totalScore = Math.round(signals.reduce((a, s) => a + s.score * s.weight, 0) / 100);
        const totalColor = totalScore >= 70 ? "#A32D2D" : totalScore >= 50 ? "#854F0B" : totalScore >= 30 ? "#185FA5" : "#0F6E56";
        const totalLabel = totalScore >= 70 ? "높음" : totalScore >= 50 ? "주의" : totalScore >= 30 ? "보통" : "낮음";
        const totalTip = totalScore >= 70
          ? "변동성 확대 가능성이 높습니다. 포지션 크기를 줄이거나 헤지를 고려하세요."
          : totalScore >= 50
          ? "일부 경고 신호가 감지됩니다. 시장 상황을 주의 깊게 모니터링하세요."
          : totalScore >= 30
          ? "변동성이 비교적 안정적입니다. 정상적인 시장 상태입니다."
          : "변동성이 낮은 구간입니다. 밴드 스퀴즈 여부를 확인하세요.";

        return (
          <div style={{ marginTop: 16, padding: "14px 14px", borderRadius: 10, border: `1.5px solid ${totalColor}30`, background: `${totalColor}08` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>변동성 전망</div>
              <div style={{
                padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                color: totalColor, background: totalColor + "18",
              }}>
                {totalScore}점 — {totalLabel}
              </div>
              <div style={{
                flex: 1, height: 6, borderRadius: 3, background: "var(--color-border-tertiary)",
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%", borderRadius: 3, background: totalColor,
                  width: `${totalScore}%`, transition: "width 0.5s ease",
                }} />
              </div>
            </div>

            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 12, lineHeight: 1.5 }}>
              {totalTip}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 6 }}>
              {signals.map(s => {
                const c = s.score >= 70 ? "#A32D2D" : s.score >= 50 ? "#854F0B" : s.score >= 30 ? "#185FA5" : "#0F6E56";
                return (
                  <div key={s.name} style={{
                    padding: "8px 10px", borderRadius: 6,
                    background: "var(--color-background-primary)",
                    border: "0.5px solid var(--color-border-tertiary)",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-primary)" }}>{s.name}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: c, padding: "1px 5px", borderRadius: 3, background: c + "15" }}>{s.score}</span>
                    </div>
                    <div style={{ height: 3, borderRadius: 2, background: "var(--color-border-tertiary)", marginBottom: 4 }}>
                      <div style={{ height: "100%", borderRadius: 2, background: c, width: `${s.score}%` }} />
                    </div>
                    <div style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>{s.detail}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ─── 모델 검증 (백테스트) ─── */}
      <div style={{ marginTop: 16, padding: "14px", borderRadius: 10, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: btResults ? 12 : 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>모델 검증</div>
          <button
            onClick={() => {
              setBtRunning(true);
              setBtResults(null);
              setTimeout(() => {
                const r = runBacktest(prices);
                setBtResults(r);
                setBtRunning(false);
              }, 50);
            }}
            disabled={btRunning}
            style={{ fontSize: 11, padding: "4px 12px", cursor: btRunning ? "wait" : "pointer" }}
          >
            {btRunning ? "분석 중..." : btResults ? "재검증" : "백테스트 실행"}
          </button>
          {!btResults && !btRunning && (
            <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
              과거 데이터로 모델 정확도를 검증합니다
            </span>
          )}
        </div>

        {btResults && (
          <div>
            {/* 요약 카드 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginBottom: 12 }}>
              <div style={{ padding: "8px 10px", borderRadius: 6, background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)" }}>
                <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>검증 기간</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text-primary)" }}>{btResults.testDays}일</div>
              </div>
              {(() => {
                const acc = btResults.dirAccuracy;
                const c = acc >= 55 ? "#0F6E56" : acc >= 50 ? "#854F0B" : "#A32D2D";
                return (
                  <div style={{ padding: "8px 10px", borderRadius: 6, background: "var(--color-background-primary)", border: `1px solid ${c}30` }}>
                    <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>방향 적중률</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: c }}>{acc.toFixed(1)}%</div>
                    <div style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>{btResults.dirTotal}건 판단</div>
                  </div>
                );
              })()}
              {(() => {
                const bs = btResults.brierScore;
                const c = bs <= 0.05 ? "#0F6E56" : bs <= 0.15 ? "#854F0B" : "#A32D2D";
                const lbl = bs <= 0.05 ? "우수" : bs <= 0.10 ? "양호" : bs <= 0.15 ? "보통" : "개선 필요";
                return (
                  <div style={{ padding: "8px 10px", borderRadius: 6, background: "var(--color-background-primary)", border: `1px solid ${c}30` }}>
                    <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>Brier Score</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: c }}>{bs.toFixed(4)}</div>
                    <div style={{ fontSize: 9, color: c }}>{lbl} (0에 가까울수록 정확)</div>
                  </div>
                );
              })()}
              {(() => {
                const ce = btResults.calError;
                const c = ce <= 3 ? "#0F6E56" : ce <= 6 ? "#854F0B" : "#A32D2D";
                return (
                  <div style={{ padding: "8px 10px", borderRadius: 6, background: "var(--color-background-primary)", border: `1px solid ${c}30` }}>
                    <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>보정 오차 (ECE)</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: c }}>{ce.toFixed(1)}%p</div>
                    <div style={{ fontSize: 9, color: c }}>예측확률 vs 실제빈도 차이</div>
                  </div>
                );
              })()}
            </div>

            {/* 시간대별 방향 적중률 */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 6 }}>시간대별 방향 적중률</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {btResults.dirByHorizon.map(h => {
                  const c = h.accuracy >= 55 ? "#0F6E56" : h.accuracy >= 50 ? "#854F0B" : "#A32D2D";
                  return (
                    <div key={h.label} style={{
                      flex: 1, minWidth: 80, padding: "6px 8px", borderRadius: 6, textAlign: "center",
                      background: "var(--color-background-primary)", border: `1px solid ${c}30`,
                    }}>
                      <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{h.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: c }}>{h.accuracy.toFixed(1)}%</div>
                      <div style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>{h.count}건</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 확률 보정 차트 */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 6 }}>확률 보정 (Calibration)</div>
              <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginBottom: 8 }}>
                예측 확률 구간별 실제 발생 빈도 — 대각선에 가까울수록 보정이 정확
              </div>
              <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 100, padding: "0 4px" }}>
                {btResults.calibration.map((cal, i) => {
                  const ideal = cal.avgPredicted;
                  const actual = cal.avgActual;
                  const diff = Math.abs(actual - ideal);
                  const c = diff <= 3 ? "#0F6E56" : diff <= 8 ? "#854F0B" : "#A32D2D";
                  const maxH = 100;
                  return (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      <div style={{ width: "100%", display: "flex", gap: 1, alignItems: "flex-end", justifyContent: "center", height: maxH }}>
                        <div title={`예측: ${ideal.toFixed(1)}%`}
                          style={{ width: 8, height: Math.max(2, ideal / 50 * maxH), background: "var(--color-border-tertiary)", borderRadius: 2 }} />
                        <div title={`실제: ${actual.toFixed(1)}%`}
                          style={{ width: 8, height: Math.max(2, actual / 50 * maxH), background: c, borderRadius: 2 }} />
                      </div>
                      <div style={{ fontSize: 8, color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>{cal.bucket}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 6, justifyContent: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "var(--color-text-tertiary)" }}>
                  <div style={{ width: 8, height: 8, background: "var(--color-border-tertiary)", borderRadius: 2 }} /> 예측 확률
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "var(--color-text-tertiary)" }}>
                  <div style={{ width: 8, height: 8, background: "#0F6E56", borderRadius: 2 }} /> 실제 빈도
                </div>
              </div>
            </div>

            {/* 해석 */}
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: "var(--color-background-primary)", fontSize: 10, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>해석: </span>
              {btResults.dirAccuracy >= 55
                ? "방향 예측이 유의미한 수준입니다. 모멘텀/추세 지표가 과거 데이터에서 유효했습니다."
                : btResults.dirAccuracy >= 50
                ? "방향 예측이 동전 던지기 수준입니다. 방향성보다 변동성(크기) 예측에 더 무게를 두세요."
                : "방향 예측이 50% 미만입니다. 역추세(mean-reversion) 전략이 더 적합한 데이터입니다."}
              {" "}Brier Score {btResults.brierScore.toFixed(4)}는 {btResults.brierScore <= 0.05 ? "확률 추정이 정확함을" : btResults.brierScore <= 0.15 ? "확률 추정이 합리적 수준임을" : "확률 추정의 개선이 필요함을"} 나타냅니다.
              {" "}(VIX·Cycle Phase 데이터는 현재 시점만 존재하여 백테스트에서 제외)
            </div>
          </div>
        )}
      </div>

      {/* 하단 설명 */}
      <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)" }}>
        <div style={{ fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          <span style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>산출 방식: </span>
          가중 변동성 모델 (10일 35% + 20일 30% + 60일 20% + 전체 15%) · 시간대별 변동성 스케일링 (단기→최근 비중↑, 장기→평균 회귀) · 5개 기술지표 방향성 편향 (모멘텀·MA배열·RSI·MACD·밴드위치)
        </div>
        <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 4 }}>
          ※ 통계적 추정이며 투자 조언이 아닙니다. 과거 변동성 기반이므로 급변하는 시장 상황은 반영되지 않습니다.
        </div>
      </div>
    </div>
  );
}

/* ─── LOADING PROGRESS ─── */
function LoadingProgress({ message }) {
  return (
    <div style={{ textAlign: "center", padding: 40 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{
          width: 200, height: 4, background: "var(--color-border-tertiary)",
          borderRadius: 2, margin: "0 auto", overflow: "hidden",
        }}>
          <div style={{
            height: "100%", borderRadius: 2,
            background: "linear-gradient(90deg, #185FA5, #0F6E56)",
            animation: "loading-bar 2s ease-in-out infinite",
          }} />
        </div>
      </div>
      <div style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}>
        {message || "종목 분석 중..."}
      </div>
      <style>{`
        @keyframes loading-bar {
          0% { width: 5%; margin-left: 0; }
          50% { width: 60%; margin-left: 20%; }
          100% { width: 5%; margin-left: 95%; }
        }
      `}</style>
    </div>
  );
}

/* ─── SORT CONTROLS ─── */
function SortControls({ sortBy, sortDir, onSortChange }) {
  const options = [
    { value: "score", label: "점수순" },
    { value: "changeRate", label: "등락률순" },
    { value: "currentPrice", label: "가격순" },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
      <select
        value={sortBy}
        onChange={e => onSortChange(e.target.value, sortDir)}
        style={{ fontSize: 11, padding: "2px 4px", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 4, color: "var(--color-text-secondary)" }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button
        onClick={() => onSortChange(sortBy, sortDir === "desc" ? "asc" : "desc")}
        style={{ fontSize: 11, padding: "2px 6px", background: "transparent", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 4, cursor: "pointer", color: "var(--color-text-secondary)" }}
      >
        {sortDir === "desc" ? "↓" : "↑"}
      </button>
    </div>
  );
}

/* ─── SCORE BAR ─── */
function ScoreBar({ score }) {
  const color = score >= 70 ? "#0F6E56" : score >= 50 ? "#854F0B" : score >= 30 ? "#A32D2D" : "#666";
  const label = score >= 70 ? "강력" : score >= 50 ? "양호" : score >= 30 ? "보통" : "약함";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
      <div style={{ width: 60, height: 5, background: "var(--color-border-tertiary)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(score, 100)}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span style={{ color, fontWeight: 600 }}>{score}점 ({label})</span>
    </div>
  );
}

/* ─── STOCK CARD ─── */
function StockCard({ stock, onAddToWatchlist, inWatchlist, onRemove, livePrice }) {
  const isPositive = (stock.changeRate ?? 0) >= 0;
  const changeColor = isPositive ? "#0F6E56" : "#A32D2D";
  const changePrefix = isPositive ? "▲" : "▼";

  return (
    <div style={{
      padding: "12px 14px",
      borderRadius: 8,
      border: "0.5px solid var(--color-border-tertiary)",
      background: "var(--color-background-secondary)",
      display: "flex",
      flexDirection: "column",
      gap: 6,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>{stock.name}</span>
          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginLeft: 6 }}>
            {stock.code} · {stock.market}
          </span>
        </div>
        {stock.horizon && (
          <span style={{
            fontSize: 10, fontWeight: 500, padding: "2px 7px", borderRadius: 10,
            background: stock.horizon === "1~2주" ? "#E1F5EE" : "#E6F1FB",
            color: stock.horizon === "1~2주" ? "#0F6E56" : "#185FA5",
            whiteSpace: "nowrap",
          }}>
            {stock.horizon}
          </span>
        )}
      </div>

      {/* Price */}
      {stock.currentPrice > 0 && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: "var(--color-text-primary)" }}>
            {Math.round(stock.currentPrice).toLocaleString()}원
          </span>
          {stock.changeRate != null && (
            <span style={{ fontSize: 12, color: changeColor, fontWeight: 500 }}>
              {changePrefix} {Math.abs(stock.changeRate).toFixed(2)}%
            </span>
          )}
        </div>
      )}

      {/* Reason */}
      {stock.reason && (
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
          {stock.reason}
        </div>
      )}

      {/* Target / Stop-loss */}
      {(stock.targetPrice || stock.stopLoss) && (
        <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
          {stock.targetPrice && (
            <span style={{ color: "#0F6E56" }}>
              목표가 {Math.round(stock.targetPrice).toLocaleString()}원
            </span>
          )}
          {stock.targetPrice && stock.stopLoss && (
            <span style={{ color: "var(--color-text-tertiary)" }}>·</span>
          )}
          {stock.stopLoss && (
            <span style={{ color: "#A32D2D" }}>
              손절가 {Math.round(stock.stopLoss).toLocaleString()}원
            </span>
          )}
        </div>
      )}

      {/* Score */}
      {stock.score != null && (
        <ScoreBar score={stock.score} />
      )}

      {/* Live price indicator for watchlist */}
      {livePrice && (
        <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
          실시간 가격: {livePrice.toLocaleString()}원 (1분 주기 갱신)
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
        {onAddToWatchlist && (
          <button
            onClick={() => onAddToWatchlist(stock)}
            style={{
              fontSize: 11, padding: "3px 10px", borderRadius: 6,
              background: inWatchlist ? "var(--color-background-secondary)" : "transparent",
              border: "0.5px solid var(--color-border-tertiary)",
              cursor: inWatchlist ? "default" : "pointer",
              color: inWatchlist ? "#0F6E56" : "var(--color-text-secondary)",
            }}
            disabled={inWatchlist}
          >
            {inWatchlist ? "✓ 관심종목" : "★ 관심종목 추가"}
          </button>
        )}
        {onRemove && (
          <button
            onClick={onRemove}
            style={{
              fontSize: 11, padding: "3px 10px", borderRadius: 6,
              background: "transparent",
              border: "0.5px solid var(--color-border-tertiary)",
              cursor: "pointer",
              color: "#A32D2D",
            }}
          >
            삭제
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── MARKET SECTION ─── */
function MarketSection({ title, data, type, onAdd, watchlist, sortBy = "score", sortDir = "desc" }) {
  const sortStocks = (stocks) => {
    if (!stocks) return [];
    return [...stocks].sort((a, b) => {
      const va = a[sortBy] ?? 0;
      const vb = b[sortBy] ?? 0;
      return sortDir === "desc" ? vb - va : va - vb;
    });
  };

  const sortedLarge = sortStocks(data.large);
  const sortedSmall = sortStocks(data.small);

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 10 }}>
        {title}
      </div>
      {sortedLarge.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 6 }}>
            대형주 ({sortedLarge.length}종목)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {sortedLarge.map(stock => (
              <StockCard
                key={stock.code}
                stock={stock}
                onAddToWatchlist={onAdd}
                inWatchlist={!!(watchlist && watchlist.find(w => w.code === stock.code))}
              />
            ))}
          </div>
        </div>
      )}
      {sortedSmall.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 6 }}>
            중소형주 ({sortedSmall.length}종목)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {sortedSmall.map(stock => (
              <StockCard
                key={stock.code}
                stock={stock}
                onAddToWatchlist={onAdd}
                inWatchlist={!!(watchlist && watchlist.find(w => w.code === stock.code))}
              />
            ))}
          </div>
        </div>
      )}
      {sortedLarge.length === 0 && sortedSmall.length === 0 && (
        <div style={{ color: "var(--color-text-tertiary)", fontSize: 13, padding: "12px 0" }}>
          추천 종목이 없습니다.
        </div>
      )}
    </div>
  );
}

/* ─── MAIN COMPONENT ─── */
export default function IntegratedMonitor() {
  const [activeTab, setActiveTab] = useState("cycle");
  const [watchlist, setWatchlist] = useState(DEFAULT_WATCHLIST);
  const [activeSymbol, setActiveSymbol] = useState("KOSPI200");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hasRealData, setHasRealData] = useState(false);

  const [priceData, setPriceData] = useState({});
  const [dateData, setDateData] = useState({});
  const [irValues, setIrValues] = useState({});
  const [marketPrices, setMarketPrices] = useState({});
  const [cycleData, setCycleData] = useState({ re: 0, im: 0 });

  // Stock recommendation state
  const [shortRecs, setShortRecs] = useState(null);
  const [longRecs, setLongRecs] = useState(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState("");
  const [recsProgress, setRecsProgress] = useState("");
  const [recsSortBy, setRecsSortBy] = useState("score");
  const [recsSortDir, setRecsSortDir] = useState("desc");

  // Watchlist state
  const [myWatchlist, setMyWatchlist] = useState([]);
  const [wlSearch, setWlSearch] = useState("");
  const [wlSearchResults, setWlSearchResults] = useState([]);
  const [wlSearching, setWlSearching] = useState(false);
  const [wlPrices, setWlPrices] = useState({});

  const phase = getPhase(cycleData.re, cycleData.im);
  const pInfo = PHASE[phase];

  // Load watchlist from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("stock_watchlist");
      if (saved) setMyWatchlist(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  // Save watchlist to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem("stock_watchlist", JSON.stringify(myWatchlist));
    } catch { /* ignore */ }
  }, [myWatchlist]);

  // Client-side cache for recommendations (2 hour TTL)
  const CACHE_TTL = 2 * 60 * 60 * 1000;
  const getCachedRecs = (type) => {
    try {
      const raw = localStorage.getItem(`recs_cache_${type}`);
      if (!raw) return null;
      const { data, timestamp } = JSON.parse(raw);
      if (Date.now() - timestamp > CACHE_TTL) return null;
      return data;
    } catch { return null; }
  };
  const setCachedRecs = (type, data) => {
    try {
      localStorage.setItem(`recs_cache_${type}`, JSON.stringify({ data, timestamp: Date.now() }));
    } catch { /* ignore */ }
  };

  // Auto-fetch recommendations when switching to short/long tabs
  useEffect(() => {
    if (activeTab === "short" && !shortRecs && !recsLoading) {
      const cached = getCachedRecs("short");
      if (cached) setShortRecs(cached);
      else fetchRecs("short");
    }
    if (activeTab === "long" && !longRecs && !recsLoading) {
      const cached = getCachedRecs("long");
      if (cached) setLongRecs(cached);
      else fetchRecs("long");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const fetchRecs = async (type) => {
    setRecsLoading(true);
    setRecsError("");
    setRecsProgress("데이터 수집 중...");

    const progressTimer = setTimeout(() => setRecsProgress("기술적 분석 수행 중..."), 5000);
    const progressTimer2 = setTimeout(() => setRecsProgress("AI 추천 생성 중..."), 15000);
    const progressTimer3 = setTimeout(() => setRecsProgress("거의 완료..."), 40000);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      const res = await fetch(`/api/stocks/recommend?type=${type}`, { signal: controller.signal });
      if (!res.ok) throw new Error("추천 데이터 로드 실패");
      const data = await res.json();
      if (type === "short") setShortRecs(data);
      else setLongRecs(data);
      setCachedRecs(type, data);
    } catch (e) {
      if (e.name === "AbortError") setRecsError("요청 시간 초과 (2분). 다시 시도해주세요.");
      else setRecsError(e.message);
    }
    clearTimeout(progressTimer);
    clearTimeout(progressTimer2);
    clearTimeout(progressTimer3);
    clearTimeout(timeout);
    setRecsProgress("");
    setRecsLoading(false);
  };

  // Watchlist price polling
  useEffect(() => {
    if (activeTab !== "watchlist" || myWatchlist.length === 0) return;
    const fetchPrices = async () => {
      const prices = {};
      await Promise.all(
        myWatchlist.map(async (stock) => {
          try {
            const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(stock.code)}`);
            const data = await res.json();
            const found = data.find(d => d.code === stock.code);
            if (found?.currentPrice) prices[stock.code] = found.currentPrice;
          } catch { /* skip */ }
        })
      );
      setWlPrices(prev => ({ ...prev, ...prices }));
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 60000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, myWatchlist.length]);

  const addToWatchlist = (stock) => {
    setMyWatchlist(prev => {
      if (prev.find(w => w.code === stock.code)) return prev;
      return [...prev, { ...stock, addedAt: new Date().toISOString() }];
    });
  };

  const removeFromWatchlist = (code) => {
    setMyWatchlist(prev => prev.filter(w => w.code !== code));
  };

  const searchWatchlist = async (query) => {
    if (!query.trim()) { setWlSearchResults([]); return; }
    setWlSearching(true);
    try {
      const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setWlSearchResults(data);
    } catch { setWlSearchResults([]); }
    setWlSearching(false);
  };

  const addSymbol = () => {
    const sym = searchInput.trim().toUpperCase();
    if (!sym || watchlist.find(w => w.symbol === sym)) return;
    setWatchlist(prev => [...prev, { symbol: sym, name: sym }]);
    setActiveSymbol(sym);
    setSearchInput("");
  };

  const removeSymbol = (sym) => {
    if (sym === "KOSPI200") return;
    setWatchlist(prev => prev.filter(w => w.symbol !== sym));
    if (activeSymbol === sym) setActiveSymbol("KOSPI200");
  };

  const fetchMarketData = useCallback(async () => {
    setLoading(true);
    setStatusMsg("Searching market data...");
    try {
      const symbols = watchlist.map(w => w.symbol);
      const response = await fetch("/api/market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "API error");
      }

      const parsed = await response.json();

      const newPrices = {};
      const newDates = {};
      const newIR = {};
      const newMarketPrices = {};
      Object.entries(parsed.symbols || {}).forEach(([sym, d]) => {
        const p = d.prices || [];
        newPrices[sym] = p;
        if (d.current) newMarketPrices[sym] = d.current;
        if (d.timestamps) newDates[sym] = d.timestamps;
        if (p.length >= 20) {
          const ir = [];
          for (let i = 0; i < p.length; i++) {
            const lookback = Math.min(i + 1, 200);
            const slice = p.slice(Math.max(0, i - lookback + 1), i + 1);
            const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
            ir.push(avg > 0 ? p[i] / avg : 1);
          }
          newIR[sym] = ir;
        }
        if (d.name) {
          setWatchlist(prev => prev.map(w => w.symbol === sym ? { ...w, name: d.name } : w));
        }
      });
      setPriceData(newPrices);
      setDateData(newDates);
      setIrValues(newIR);
      setMarketPrices(newMarketPrices);

      const m = parsed.macro || {};
      const re = clamp(
        ((m.spx_ratio || 1) - 1) * 5 * 0.3 +
        ((m.kospi_ratio || 1) - 1) * 5 * 0.4 +
        ((100 - (m.dxy || 100)) / 10) * 0.3
      );
      const im = clamp(
        ((20 - (m.vix || 20)) / 20) * 0.4 +
        ((3.5 - (m.us10y || 4)) / 3) * 0.3 +
        ((1300 - (m.usdkrw || 1350)) / 200) * 0.3
      );
      setCycleData({ re, im, vix: m.vix || null, usdkrw: m.usdkrw || null, us10y: m.us10y || null });
      setLastUpdated(new Date());
      setHasRealData(true);
      setStatusMsg(`Updated ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      console.error(e);
      setStatusMsg("Error: " + e.message);
    }
    setLoading(false);
  }, [watchlist]);

  useEffect(() => {
    const demo = [];
    let p = 350;
    for (let i = 0; i < 250; i++) {
      p += p * (Math.random() - 0.48) * 0.015;
      p += Math.sin(i * 0.03) * 1.5;
      demo.push(Math.round(p * 100) / 100);
    }
    setPriceData({ KOSPI200: demo });
    const ir = [];
    for (let i = 0; i < demo.length; i++) {
      const lb = Math.min(i + 1, 200);
      const sl = demo.slice(Math.max(0, i - lb + 1), i + 1);
      const avg = sl.reduce((a, b) => a + b, 0) / sl.length;
      ir.push(avg > 0 ? demo[i] / avg : 1);
    }
    setIrValues({ KOSPI200: ir });
    setCycleData({ re: 0.15, im: -0.1 });
  }, []);

  const currentPrices = priceData[activeSymbol] || [];
  const currentDates = dateData[activeSymbol] || [];
  const currentIR = irValues[activeSymbol] || [];
  const lastPrice = marketPrices[activeSymbol] || (currentPrices.length > 0 ? currentPrices[currentPrices.length - 1] : 0);
  const lastIR = currentIR.length > 0 ? currentIR[currentIR.length - 1] : 1;

  return (
    <div style={{ fontFamily: "var(--font-sans)", padding: "0.5rem 0" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{
          padding: "4px 14px", borderRadius: 16, fontSize: 13, fontWeight: 500,
          background: pInfo.bg, color: pInfo.color, border: `1px solid ${pInfo.color}40`
        }}>
          {pInfo.icon} {pInfo.label}
        </div>
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
          Re {fmt(cycleData.re * 100)}% · Im {fmt(cycleData.im * 100)}%
        </span>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginLeft: "auto" }}>{statusMsg}</span>
      </div>

      {/* Watchlist + Search */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        {watchlist.map(w => (
          <div key={w.symbol} onClick={() => setActiveSymbol(w.symbol)}
            style={{
              padding: "4px 10px", borderRadius: 8, fontSize: 12, cursor: "pointer",
              background: activeSymbol === w.symbol ? "var(--color-text-primary)" : "var(--color-background-secondary)",
              color: activeSymbol === w.symbol ? "var(--color-background-primary)" : "var(--color-text-secondary)",
              border: "0.5px solid var(--color-border-tertiary)",
              display: "flex", alignItems: "center", gap: 4,
            }}>
            {w.name || w.symbol}
            {w.symbol !== "KOSPI200" && (
              <span onClick={e => { e.stopPropagation(); removeSymbol(w.symbol); }}
                style={{ cursor: "pointer", opacity: 0.5, fontSize: 10 }}>✕</span>
            )}
          </div>
        ))}
        <div style={{ display: "flex", gap: 4 }}>
          <input type="text" placeholder="Add symbol..." value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addSymbol()}
            style={{ width: 120, fontSize: 12 }} />
          <button onClick={addSymbol} style={{ fontSize: 11, padding: "2px 8px" }}>+</button>
        </div>
        <button onClick={fetchMarketData} disabled={loading}
          style={{ marginLeft: "auto", fontSize: 12 }}>
          {loading ? "Searching..." : "Fetch data ↗"}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 12 }}>
        {TABS.map(tab => (
          <div key={tab} onClick={() => setActiveTab(tab)}
            style={{
              padding: "6px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer",
              fontWeight: activeTab === tab ? 500 : 400,
              background: activeTab === tab ? "var(--color-text-primary)" : "transparent",
              color: activeTab === tab ? "var(--color-background-primary)" : "var(--color-text-secondary)",
            }}>
            {TAB_LABELS[tab]}
          </div>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "cycle" && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div>
            {/* 날짜 + KOSPI200 현재값 */}
            {(() => {
              const kospi200Price = marketPrices["KOSPI200"] || priceData["KOSPI200"]?.[priceData["KOSPI200"].length - 1];
              const prevPrice = priceData["KOSPI200"]?.[priceData["KOSPI200"].length - 2];
              const change = kospi200Price && prevPrice ? kospi200Price - prevPrice : null;
              const changePct = change && prevPrice ? (change / prevPrice) * 100 : null;
              const dateStr = lastUpdated
                ? lastUpdated.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" })
                : new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
              return (
                <div style={{
                  marginBottom: 10, padding: "10px 14px", borderRadius: 10,
                  background: "var(--color-background-secondary)",
                  border: "0.5px solid var(--color-border-tertiary)",
                  minWidth: 220,
                }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 4 }}>{dateStr}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>KOSPI200</span>
                    <span style={{ fontSize: 22, fontWeight: 600, color: "var(--color-text-primary)" }}>
                      {hasRealData && kospi200Price ? Math.round(kospi200Price * 100) / 100 : "—"}
                    </span>
                    {hasRealData && changePct !== null && (
                      <span style={{ fontSize: 12, fontWeight: 500, color: changePct >= 0 ? "#0F6E56" : "#A32D2D" }}>
                        {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}
            <PhaseCompass re={cycleData.re} im={cycleData.im} phase={phase} />
            <div style={{
              marginTop: 8, padding: 10, borderRadius: 8,
              background: pInfo.bg, fontSize: 12, color: pInfo.color,
            }}>
              <div style={{ fontWeight: 500, marginBottom: 2 }}>{pInfo.label}</div>
              {pInfo.tip}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {Object.entries(PHASE).map(([k, v]) => (
                <div key={k} style={{
                  padding: "8px 10px", borderRadius: 8, fontSize: 12,
                  background: phase === k ? v.bg : "var(--color-background-secondary)",
                  border: phase === k ? `2px solid ${v.color}` : "0.5px solid var(--color-border-tertiary)",
                  color: phase === k ? v.color : "var(--color-text-secondary)",
                }}>
                  <div style={{ fontWeight: 500 }}>{v.icon} {v.label}</div>
                  <div style={{ fontSize: 11, marginTop: 2, opacity: 0.8 }}>{v.tip}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 8 }}>
                {activeSymbol} snapshot
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>Price</div>
                  <div style={{ fontSize: 18, fontWeight: 500 }}>{lastPrice >= 1000 ? Math.round(lastPrice).toLocaleString() : fmt(lastPrice, 2)}</div>
                </div>
                <div style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>IR index</div>
                  <div style={{ fontSize: 18, fontWeight: 500, color: lastIR >= 1 ? "#0F6E56" : "#A32D2D" }}>{fmt(lastIR, 4)}</div>
                </div>
                <div style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>vs SMA</div>
                  <div style={{ fontSize: 18, fontWeight: 500, color: lastIR >= 1 ? "#0F6E56" : "#A32D2D" }}>
                    {lastIR >= 1 ? "+" : ""}{fmt((lastIR - 1) * 100, 1)}%
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              <span style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>Strategy note: </span>
              {phase === "A" && "Momentum is strong. Trend-following works. Consider trailing stops rather than fixed targets."}
              {phase === "B" && "Momentum fading. Avoid new entries. Tighten stops on existing positions. Build cash reserves."}
              {phase === "C" && "Risk-off mode. Maximize cash allocation. Watch for D-phase reversal signals before re-entering."}
              {phase === "D" && "Bottoming process underway. Begin dollar-cost averaging into quality assets. Patience is key."}
            </div>
          </div>
        </div>
      )}

      {activeTab === "band" && (
        <div>
          <GuideBandChart prices={currentPrices} dates={currentDates} irData={currentIR} label={activeSymbol} />
          <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            {[
              { color: "#00e5ff",               label: "EMA 5 (시안)" },
              { color: "#00c853",               label: "EMA 20 (초록)" },
              { color: "#2979ff",               label: "EMA 30 / SMA 50" },
              { color: "#e040fb",               label: "SMA 100" },
              { color: "#000",                  label: "SMA 200 (검정)" },
              { color: "#ff1744",               label: "SMA 600 (빨강)" },
              { color: "rgba(255,100,100,0.6)", label: "+1σ/2σ/3σ" },
              { color: "rgba(68,138,255,0.6)",  label: "-1σ/2σ/3σ" },
            ].map(l => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--color-text-secondary)" }}>
                <div style={{ width: 12, height: 3, borderRadius: 1, background: l.color }} />
                {l.label}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
            Price position within the band structure indicates trend strength. Above all EMAs + inside upper SD band = strong uptrend.
            Below SMA200 + near lower SD band = oversold territory.
            {lastIR > 1.05 && " Currently in the upper zone — watch for overbought conditions."}
            {lastIR < 0.95 && " Currently in the lower zone — potential mean reversion opportunity."}
          </div>
        </div>
      )}

      {activeTab === "ir" && (
        <div>
          <IRChart irData={currentIR} dates={currentDates} label={activeSymbol} />
          <div style={{
            display: "flex", gap: 12, marginTop: 8, fontSize: 12,
          }}>
            <div style={{
              padding: "6px 12px", borderRadius: 8,
              background: lastIR >= 1 ? "#E1F5EE" : "#FCEBEB",
              color: lastIR >= 1 ? "#0F6E56" : "#A32D2D",
              fontWeight: 500,
            }}>
              IR = {fmt(lastIR, 4)} → {lastIR >= 1.05 ? "Expansion" : lastIR >= 1.0 ? "Mild expansion" : lastIR >= 0.95 ? "Mild contraction" : "Contraction"}
            </div>
            <div style={{ color: "var(--color-text-tertiary)", display: "flex", alignItems: "center" }}>
              1.0 = equilibrium (green above, red below)
            </div>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
            The IR index measures current price relative to its long-term moving average, normalized around 1.0.
            When IR crosses above 1.0, the asset enters expansion mode. Below 1.0 signals contraction.
            {lastIR > 1 && lastIR < 1.02 && " IR just crossed 1.0 — critical juncture. Watch for confirmation."}
          </div>
        </div>
      )}

      {/* ─── Scenario Tab ─── */}
      {activeTab === "scenario" && (
        <ScenarioMatrix
          prices={currentPrices}
          dates={currentDates}
          phase={phase}
          cycleData={cycleData}
          label={activeSymbol}
          hasRealData={hasRealData}
          marketPrice={marketPrices[activeSymbol]}
        />
      )}

      {/* ─── Short-term Recommendations Tab ─── */}
      {activeTab === "short" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <button
              onClick={() => { setShortRecs(null); fetchRecs("short"); }}
              disabled={recsLoading}
              style={{ fontSize: 12, padding: "4px 12px" }}
            >
              {recsLoading ? "분석중..." : "↻ 갱신"}
            </button>
            {shortRecs && (
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                {new Date(shortRecs.generatedAt).toLocaleString("ko-KR")} 기준
              </span>
            )}
            {shortRecs && !recsLoading && (
              <SortControls sortBy={recsSortBy} sortDir={recsSortDir} onSortChange={(by, dir) => { setRecsSortBy(by); setRecsSortDir(dir); }} />
            )}
          </div>
          {recsError && (
            <div style={{ color: "#A32D2D", fontSize: 13, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
              {recsError}
              <button onClick={() => fetchRecs("short")} style={{ fontSize: 11, padding: "3px 10px", cursor: "pointer" }}>재시도</button>
            </div>
          )}
          {recsLoading && (
            <LoadingProgress message={recsProgress} />
          )}
          {shortRecs && !recsLoading && (
            <>
              <MarketSection
                title="코스피"
                data={shortRecs.kospi}
                type="short"
                onAdd={addToWatchlist}
                watchlist={myWatchlist}
                sortBy={recsSortBy}
                sortDir={recsSortDir}
              />
              <MarketSection
                title="코스닥"
                data={shortRecs.kosdaq}
                type="short"
                onAdd={addToWatchlist}
                watchlist={myWatchlist}
                sortBy={recsSortBy}
                sortDir={recsSortDir}
              />
            </>
          )}
        </div>
      )}

      {/* ─── Long-term Recommendations Tab ─── */}
      {activeTab === "long" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <button
              onClick={() => { setLongRecs(null); fetchRecs("long"); }}
              disabled={recsLoading}
              style={{ fontSize: 12, padding: "4px 12px" }}
            >
              {recsLoading ? "분석중..." : "↻ 갱신"}
            </button>
            {longRecs && (
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                {new Date(longRecs.generatedAt).toLocaleString("ko-KR")} 기준
              </span>
            )}
            {longRecs && !recsLoading && (
              <SortControls sortBy={recsSortBy} sortDir={recsSortDir} onSortChange={(by, dir) => { setRecsSortBy(by); setRecsSortDir(dir); }} />
            )}
          </div>
          {recsError && (
            <div style={{ color: "#A32D2D", fontSize: 13, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
              {recsError}
              <button onClick={() => fetchRecs("long")} style={{ fontSize: 11, padding: "3px 10px", cursor: "pointer" }}>재시도</button>
            </div>
          )}
          {recsLoading && (
            <LoadingProgress message={recsProgress} />
          )}
          {longRecs && !recsLoading && (
            <>
              <MarketSection
                title="코스피"
                data={longRecs.kospi}
                type="long"
                onAdd={addToWatchlist}
                watchlist={myWatchlist}
                sortBy={recsSortBy}
                sortDir={recsSortDir}
              />
              <MarketSection
                title="코스닥"
                data={longRecs.kosdaq}
                type="long"
                onAdd={addToWatchlist}
                watchlist={myWatchlist}
                sortBy={recsSortBy}
                sortDir={recsSortDir}
              />
            </>
          )}
        </div>
      )}

      {/* ─── Watchlist Tab ─── */}
      {activeTab === "watchlist" && (
        <div>
          {/* Search bar */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <input
              placeholder="종목명 또는 코드 검색..."
              value={wlSearch}
              onChange={e => {
                setWlSearch(e.target.value);
                searchWatchlist(e.target.value);
              }}
              style={{ flex: 1, fontSize: 13 }}
            />
            {wlSearching && (
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", alignSelf: "center" }}>
                검색중...
              </span>
            )}
          </div>

          {/* Search results */}
          {wlSearchResults.length > 0 && (
            <div style={{
              marginBottom: 12,
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: 8,
              overflow: "hidden",
              background: "var(--color-background-secondary)",
            }}>
              {wlSearchResults.map(r => (
                <div
                  key={r.code}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 12px",
                    cursor: "pointer",
                    borderBottom: "0.5px solid var(--color-border-tertiary)",
                  }}
                  onClick={() => {
                    addToWatchlist(r);
                    setWlSearch("");
                    setWlSearchResults([]);
                  }}
                >
                  <span style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
                    {r.name}{" "}
                    <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                      {r.code} {r.market}
                    </span>
                  </span>
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {r.currentPrice ? `${r.currentPrice.toLocaleString()}원 · ` : ""}+ 추가
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Watchlist items */}
          {myWatchlist.length === 0 ? (
            <div style={{
              textAlign: "center", padding: 40,
              color: "var(--color-text-tertiary)", fontSize: 13, lineHeight: 1.8,
            }}>
              관심종목이 없습니다.<br />
              종목 추천 탭에서 ★을 눌러 추가하거나 위에서 검색하여 추가하세요.
            </div>
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 10,
            }}>
              {myWatchlist.map(stock => (
                <StockCard
                  key={stock.code}
                  stock={{ ...stock, currentPrice: wlPrices[stock.code] || stock.currentPrice }}
                  inWatchlist={true}
                  onRemove={() => removeFromWatchlist(stock.code)}
                  livePrice={wlPrices[stock.code]}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
