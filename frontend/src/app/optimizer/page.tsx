"use client";
import React, { useState } from "react";
import { COLORS } from "@/lib/colors";

export default function OptimizerPage() {
  const [params, setParams] = useState({ 
    name: "", hard_threshold: 5, time_limit: 300, 
    mip_gap: 0.10, no_back_to_back: false, 
    exam_days: 5, slots_per_day: 10, start_hour: 8 
  });
  
  const [running, setRunning] = useState(false);

  // Todo: Connect this to actual Axios call to POST /api/optimize/run/
  const run = () => { 
    setRunning(true); 
    setTimeout(() => setRunning(false), 3000); 
  };

  const inputStyle = { 
    background: "#0d0e1a", border: `1px solid ${COLORS.border}`, borderRadius: 6, 
    padding: "8px 12px", color: COLORS.text, fontFamily: "monospace", fontSize: 13, 
    width: "100%", boxSizing: "border-box" as const
  };
  const labelStyle = { 
    fontSize: 11, color: COLORS.textMuted, fontFamily: "monospace", 
    letterSpacing: "0.06em", display: "block", marginBottom: 6 
  };
  const fieldWrap = { marginBottom: 16 };

  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 700, color: COLORS.text, margin: "0 0 6px", fontFamily: "monospace" }}>Optimizer Çalıştır</h2>
      <p style={{ color: COLORS.textMuted, fontSize: 14, marginBottom: 24 }}>Gurobi MIP tabanlı sınav çizelgeleme motorunu yapılandırın ve çalıştırın.</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "24px" }}>
          <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "monospace", letterSpacing: "0.08em", marginBottom: 18 }}>TEMEL PARAMETRELER</div>
          <div style={fieldWrap}>
            <label style={labelStyle}>ÇÖZÜM ADI</label>
            <input style={inputStyle} placeholder="Örn: Güz 2025 Test 3" value={params.name} onChange={e => setParams({...params, name: e.target.value})} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={fieldWrap}>
              <label style={labelStyle}>SINAV GÜN SAYISI</label>
              <input style={inputStyle} type="number" value={params.exam_days} onChange={e => setParams({...params, exam_days: +e.target.value})} />
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>GÜN BAŞI SLOT</label>
              <input style={inputStyle} type="number" value={params.slots_per_day} onChange={e => setParams({...params, slots_per_day: +e.target.value})} />
            </div>
          </div>
        </div>

        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "24px" }}>
          <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "monospace", letterSpacing: "0.08em", marginBottom: 18 }}>SOLVER AYARLARI</div>
          <div style={fieldWrap}>
            <label style={labelStyle}>ZAMAN LİMİTİ (saniye)</label>
            <input style={inputStyle} type="number" value={params.time_limit} onChange={e => setParams({...params, time_limit: +e.target.value})} />
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>Gurobi max bekleme süresi</div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center" }}>
        <button
          onClick={run}
          disabled={running}
          style={{ 
            background: running ? COLORS.accentSoft : COLORS.accent, 
            color: running ? COLORS.accent : "#fff", border: "none", 
            borderRadius: 8, padding: "12px 28px", cursor: running ? "not-allowed" : "pointer", 
            fontFamily: "monospace", fontSize: 14, fontWeight: 700 
          }}
        >
          {running ? "⟳ Çalışıyor..." : "▶ Optimizasyonu Başlat"}
        </button>
      </div>
    </div>
  );
}
