"use client";
import React, { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, SL, Spinner, Badge, ErrorBox } from "@/components/ui";

const IIS_LABELS: Record<string, string> = {
  no_feasible_slot: "Hiçbir sınav için uygun zaman dilimi bulunamadı.",
  room_capacity_exceeded: "Oda kapasitesi yetersiz — daha büyük sınav odası ekleyin.",
  instructor_conflict: "Eğitmen çakışması çözülemedi.",
  too_many_hard_conflicts: "Hard conflict sayısı hard_threshold eşiğini aştı.",
};

export default function OptimizerPage() {
  const router = useRouter();
  const { data: termsData } = useFetch("/terms/");
  const terms = termsData?.results || termsData || [];

  const [params, setParams] = useState({
    term_id: "", name: "", hard_threshold: 5, time_limit: 300,
    mip_gap: 0.10, no_back_to_back: false, exam_days: 5, slots_per_day: 10, start_hour: 8,
  });

  const [runSt, setRunSt] = useState("idle");
  const [solId, setSolId] = useState<string | null>(null);
  const [submitErr, setSubErr] = useState("");
  const [iis, setIis] = useState<string[]>([]);
  const [pollSnap, setPollSnap] = useState<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const stopPoll = () => { if (timerRef.current) clearInterval(timerRef.current); };

  const startPolling = useCallback((id: string) => {
    setRunSt("polling");
    const tick = async () => {
      try {
        const res = await api.get(`/optimize/${id}/result/`);
        const DONE_STATUSES = ["COMPLETED", "OPTIMAL", "FEASIBLE", "FEASIBLE (TIME LIMIT)"];
        const FAIL_STATUSES = ["FAILED", "INFEASIBLE", "ERROR"];
        const sol = res?.id ? res : res?.results?.[0] || res?.[0] || res;
        setPollSnap(sol);
        if (DONE_STATUSES.includes(sol?.status)) {
          stopPoll(); setRunSt("done");
        } else if (FAIL_STATUSES.includes(sol?.status)) {
          stopPoll();
          setIis(sol?.stats?.infeasibility_reasons || []);
          setRunSt(sol.status === "INFEASIBLE" ? "infeasible" : "error");
        }
      } catch { /* ignore transient */ }
    };
    tick();
    timerRef.current = setInterval(tick, 5000);
  }, []);

  useEffect(() => () => stopPoll(), []);

  const submit = async () => {
    if (!params.term_id) { setSubErr("Lütfen bir dönem seçin."); return; }
    setRunSt("submitting"); setSubErr(""); setIis([]); setPollSnap(null);
    try {
      const { name, ...rest } = params;
      const payload = name ? { ...rest, name } : rest;
      const res = await api.post("/optimize/run/", payload);
      const id = res?.task_id || res?.solution_id || res?.id;
      if (!id) throw new Error("Backend'den geçerli bir task/solution ID alınamadı.");
      setSolId(id);
      startPolling(id);
    } catch (e: any) {
      setSubErr(e.data?.detail || e.data?.error || e.message);
      setRunSt("error");
    }
  };

  const reset = () => { stopPoll(); setRunSt("idle"); setSolId(null); setPollSnap(null); setIis([]); setSubErr(""); };
  const isRunning = runSt === "submitting" || runSt === "polling";

  const barColor = runSt === "done" ? C.green : runSt === "error" || runSt === "infeasible" ? C.red : C.accent;

  const iStyle = { background: "#0d0e1a", border: `1px solid ${C.border}`, borderRadius: 6, padding: "9px 12px", color: C.text, ...mono, fontSize: 13, width: "100%", boxSizing: "border-box" as const };
  const lStyle = { fontSize: 11, color: C.textMuted, ...mono, letterSpacing: "0.06em", display: "block", marginBottom: 6 };

  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 700, color: C.text, margin: "0 0 6px", ...mono }}>Optimizer Çalıştır</h2>
      <p style={{ color: C.textMuted, fontSize: 14, marginBottom: 24 }}>Gurobi MIP tabanlı sınav çizelgeleme motorunu yapılandırın ve çalıştırın.</p>

      {runSt !== "idle" && (
        <Card style={{ padding: "16px 20px", marginBottom: 20, borderColor: `${barColor}55` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {isRunning && <Spinner color={barColor} />}
            <div style={{ flex: 1 }}>
              <div style={{ ...mono, fontSize: 13, fontWeight: 700, color: barColor }}>
                {runSt === "submitting" && "İstek gönderiliyor…"}
                {runSt === "polling" && `Gurobi çalışıyor`}
                {runSt === "done" && `✓  Optimizasyon tamamlandı.`}
                {runSt === "error" && `✕  Hata: ${submitErr || pollSnap?.error_message}`}
                {runSt === "infeasible" && "✕  INFEASIBLE — Bu parametrelerle çözüm bulunamadı"}
              </div>
              {runSt === "polling" && pollSnap && (
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, ...mono, display: "flex", gap: 10, alignItems: "center" }}>
                  Durum: <Badge status={pollSnap.status} />
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {runSt === "done" && (
                <button onClick={() => router.push("/schedule")} style={{ background: C.green, color: "#000", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", ...mono, fontSize: 12, fontWeight: 700 }}>
                  Takvimi Görüntüle →
                </button>
              )}
              <button onClick={reset} style={{ background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", cursor: "pointer", ...mono, fontSize: 12 }}>Sıfırla</button>
            </div>
          </div>

          {runSt === "infeasible" && (
            <div style={{ marginTop: 14, borderTop: `1px solid ${C.red}33`, paddingTop: 14 }}>
              <div style={{ fontSize: 10, color: C.red, ...mono, letterSpacing: "0.08em", marginBottom: 10 }}>IIS TANI RAPORU</div>
              {(iis.length ? iis : ["solver_metadata alanında detaylı tanı bilgisi mevcuttur."]).map((d, i) => (
                <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                  <span style={{ color: C.red }}>▸</span>
                  <span style={{ fontSize: 13, color: C.textSub }}>{IIS_LABELS[d] || d}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <Card style={{ padding: "24px" }}>
          <SL>TEMEL PARAMETRELER</SL>
          <div style={{ marginBottom: 16 }}>
            <label style={lStyle}>AKTİF DÖNEM</label>
            <select style={{ ...iStyle, cursor: "pointer" }} value={params.term_id} onChange={e => setParams({ ...params, term_id: e.target.value })}>
              <option value="">— Dönem seçin —</option>
              {terms.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={lStyle}>ÇÖZÜM ADI <span style={{ color: C.textMuted }}>(opsiyonel)</span></label>
            <input style={iStyle} placeholder="Örn: Güz 2025 Test 3" value={params.name} onChange={e => setParams({ ...params, name: e.target.value })} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { label: "SINAV GÜN SAYISI", key: "exam_days" },
              { label: "GÜN BAŞI SLOT", key: "slots_per_day" },
              { label: "BAŞLANGIÇ SAATİ", key: "start_hour" },
              { label: "HARD THRESHOLD", key: "hard_threshold" },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 4 }}>
                <label style={lStyle}>{f.label}</label>
                <input style={iStyle} type="number" value={params[f.key as keyof typeof params] as number} onChange={e => setParams({ ...params, [f.key]: +e.target.value })} />
              </div>
            ))}
          </div>
        </Card>

        <Card style={{ padding: "24px" }}>
          <SL>SOLVER AYARLARI (GUROBI)</SL>
          <div style={{ marginBottom: 16 }}>
            <label style={lStyle}>ZAMAN LİMİTİ (saniye)</label>
            <input style={iStyle} type="number" value={params.time_limit} onChange={e => setParams({ ...params, time_limit: +e.target.value })} />
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>Gurobi max bekleme · varsayılan 300 sn</div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={lStyle}>MIP GAP TOLERANSI</label>
            <input style={iStyle} type="number" step="0.01" value={params.mip_gap} onChange={e => setParams({ ...params, mip_gap: +e.target.value })} />
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>0.10 = %10 gap · düşüktükçe daha uzun çalışır</div>
          </div>
          <div style={{ background: "#0d0e1a", border: `1px solid ${C.border}`, borderRadius: 8, padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
            <input type="checkbox" id="btb" checked={params.no_back_to_back} onChange={e => setParams({ ...params, no_back_to_back: e.target.checked })} style={{ accentColor: C.accent, marginTop: 2, cursor: "pointer" }} />
            <div>
              <label htmlFor="btb" style={{ color: C.text, fontSize: 13, ...mono, cursor: "pointer", fontWeight: 600 }}>no_back_to_back</label>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3, lineHeight: 1.6 }}>
                Aynı bölüm derslerini arka arkaya vermeyi engeller.<br />
                <span style={{ color: C.red, fontSize: 10 }}>TRUE → Hard Constraint · MIP süresi uzayabilir.</span>
              </div>
            </div>
          </div>
          {submitErr && !isRunning && <div style={{ marginTop: 14 }}><ErrorBox msg={submitErr} /></div>}
        </Card>
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center" }}>
        <button
          onClick={submit} disabled={isRunning}
          style={{ background: isRunning ? C.accentSoft : C.accent, color: isRunning ? C.accent : "#fff", border: "none", borderRadius: 8, padding: "13px 32px", cursor: isRunning ? "not-allowed" : "pointer", ...mono, fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 10, transition: "background 0.2s" }}
        >
          {isRunning ? <><Spinner size={14} color={C.accent} /> Çalışıyor…</> : "▶  Optimizasyonu Başlat"}
        </button>
      </div>
    </div>
  );
}
