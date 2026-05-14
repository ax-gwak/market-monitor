"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/* ─── CONSTANTS ─── */
const PHASE = {
  A: { label: "A 확장", color: "#0F6E56", bg: "#E1F5EE", icon: "↗", tip: "모멘텀 추종, 추격 매수 가능" },
  B: { label: "B 조정", color: "#854F0B", bg: "#FAEEDA", icon: "→", tip: "신규 진입 자제, 보유 관리" },
  C: { label: "C 수축", color: "#A32D2D", bg: "#FCEBEB", icon: "↘", tip: "현금 비중 확대, 방어 모드" },
  D: { label: "D 회복", color: "#185FA5", bg: "#E6F1FB", icon: "↑", tip: "분할 매수 시작 탐색" },
};

const TABS = ["cycle", "band", "ir", "short", "long", "watchlist"];
const TAB_LABELS = {
  cycle: "Cycle phase",
  band: "Guide band",
  ir: "IR index",
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
      Object.entries(parsed.symbols || {}).forEach(([sym, d]) => {
        const p = d.prices || [];
        newPrices[sym] = p;
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
      setCycleData({ re, im });
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
  const lastPrice = currentPrices.length > 0 ? currentPrices[currentPrices.length - 1] : 0;
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
              const kospi200Price = priceData["KOSPI200"]?.[priceData["KOSPI200"].length - 1];
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
