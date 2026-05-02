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

type LLMChange = { code: string; value: unknown; reason: string };
type LLMResult = {
  success: boolean;
  is_scheduling_request?: boolean;
  summary: string;
  changes: LLMChange[];
  warnings: string[];
  proposed_params: Record<string, unknown>;
  optimizer_kwargs: Record<string, unknown>;
  weight_config: Record<string, unknown>;
  error?: string;
};
type DiagnoseResult = {
  success: boolean;
  explanation: string;
  root_causes: { cause: string; constraint_type: string; severity: string }[];
  suggestions: { code: string; suggested_value: unknown; reason: string; impact: string; priority: number }[];
  combined_recommendation: string;
  error?: string;
};

export default function OptimizerPage() {
  const router = useRouter();
  const { data: termsData } = useFetch("/terms/");
  const terms = termsData?.results || termsData || [];

  const [params, setParams] = useState({
    term_id: "", name: "", hard_threshold: 5, time_limit: null as number | null,
    mip_gap: 0.10, no_back_to_back: false, exam_days: 5, slots_per_day: 20, start_hour: 8,
    year_order_weight: 100.0, year_order_sequence: null as number[] | null,
    year_order_weights: null as Record<string, number> | null,
  });

  const [runSt, setRunSt] = useState("idle");
  const [solId, setSolId] = useState<string | null>(null);
  const [submitErr, setSubErr] = useState("");
  const [iis, setIis] = useState<string[]>([]);
  const [pollSnap, setPollSnap] = useState<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // LLM state
  const [llmMessage, setLlmMessage] = useState("");
  const [llmSt, setLlmSt] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [llmResult, setLlmResult] = useState<LLMResult | null>(null);
  const [llmErr, setLlmErr] = useState("");
  const [diagSt, setDiagSt] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [diagResult, setDiagResult] = useState<DiagnoseResult | null>(null);
  const [pendingProposedParams, setPendingProposedParams] = useState<Record<string, unknown> | null>(null);

  const stopPoll = () => { if (timerRef.current) clearInterval(timerRef.current); };

  const startPolling = useCallback((id: string) => {
    setRunSt("polling");
    const tick = async () => {
      try {
        const res = await api.get(`/optimize/${id}/result/`);
        const DONE_STATUSES = ["COMPLETED", "OPTIMAL", "FEASIBLE", "FEASIBLE (TIME LIMIT)", "FEASIBLE_TIME_LIMIT"];
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
      const finalPayload = pendingProposedParams
        ? { ...payload, proposed_params: pendingProposedParams }
        : payload;
      const res = await api.post("/optimize/run/", finalPayload);
      const id = res?.task_id || res?.solution_id || res?.id;
      if (!id) throw new Error("Backend'den geçerli bir task/solution ID alınamadı.");
      setSolId(id);
      startPolling(id);
    } catch (e: any) {
      const d = e.data || {};
      const msg = d.detail || d.error ||
        Object.entries(d).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join(" | ") ||
        e.message;
      setSubErr(msg);
      setRunSt("error");
    }
  };

  const reset = () => {
    stopPoll(); setRunSt("idle"); setSolId(null); setPollSnap(null);
    setIis([]); setSubErr(""); setDiagSt("idle"); setDiagResult(null);
  };

  // LLM: configure
  const askLlm = async () => {
    if (!llmMessage.trim()) return;
    setLlmSt("loading"); setLlmErr(""); setLlmResult(null);
    try {
      const res = await api.post("/llm/configure/", { message: llmMessage });
      setLlmResult(res);
      setLlmSt("done");
    } catch (e: any) {
      setLlmErr(e.data?.error || e.message || "LLM isteği başarısız.");
      setLlmSt("error");
    }
  };

  // LLM: apply proposed params to the form
  const applyToForm = () => {
    if (!llmResult?.optimizer_kwargs) return;
    setPendingProposedParams(llmResult.proposed_params ?? null);
    const kw = llmResult.optimizer_kwargs as any;
    setParams(p => ({
      ...p,
      ...(kw.hard_threshold !== undefined  && { hard_threshold: kw.hard_threshold }),
      ...(kw.exam_days      !== undefined  && { exam_days: kw.exam_days }),
      ...(kw.slots_per_day  !== undefined  && { slots_per_day: kw.slots_per_day }),
      ...(kw.start_hour     !== undefined  && { start_hour: kw.start_hour }),
      ...(kw.time_limit     !== undefined  && { time_limit: kw.time_limit }),
      ...(kw.mip_gap        !== undefined  && { mip_gap: kw.mip_gap }),
      ...(kw.no_back_to_back  !== undefined && { no_back_to_back: kw.no_back_to_back }),
      ...(kw.year_order_weight  !== undefined && { year_order_weight: kw.year_order_weight }),
      ...(kw.year_order_sequence !== undefined && { year_order_sequence: kw.year_order_sequence }),
      ...(kw.year_order_weights  !== undefined && { year_order_weights: kw.year_order_weights }),
    }));
  };


  // LLM: diagnose infeasible
  const diagnose = async () => {
    if (!solId) return;
    setDiagSt("loading"); setDiagResult(null);
    try {
      const res = await api.post("/llm/diagnose/", { solution_id: solId });
      setDiagResult(res);
      setDiagSt("done");
    } catch (e: any) {
      setDiagSt("error");
    }
  };

  const isRunning = runSt === "submitting" || runSt === "polling";
  const barColor = runSt === "done" ? C.green : runSt === "error" || runSt === "infeasible" ? C.red : C.accent;

  const iStyle = { background: "var(--surface)", border: `1px solid ${C.border}`, borderRadius: 6, padding: "9px 12px", color: C.text, ...mono, fontSize: 13, width: "100%", boxSizing: "border-box" as const };
  const lStyle = { fontSize: 11, color: C.textMuted, ...mono, letterSpacing: "0.06em", display: "block", marginBottom: 6 };

  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 700, color: C.text, margin: "0 0 6px", ...mono }}>Optimizer Çalıştır</h2>
      <p style={{ color: C.textMuted, fontSize: 14, marginBottom: 24 }}>Gurobi MIP tabanlı sınav çizelgeleme motorunu yapılandırın ve çalıştırın.</p>

      {/* ── Status bar ───────────────────────────────────────────── */}
      {runSt !== "idle" && (
        <Card style={{ padding: "16px 20px", marginBottom: 20, borderColor: `${barColor}55` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {isRunning && <Spinner color={barColor} />}
            <div style={{ flex: 1 }}>
              <div style={{ ...mono, fontSize: 13, fontWeight: 700, color: barColor }}>
                {runSt === "submitting" && "İstek gönderiliyor…"}
                {runSt === "polling" && `Gurobi çalışıyor`}
                {runSt === "done" && `✓  ${["FEASIBLE_TIME_LIMIT", "FEASIBLE (TIME LIMIT)"].includes(pollSnap?.status) ? "Zaman limitinde çözüm bulundu." : "Optimizasyon tamamlandı."}`}
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
                <button type="button" onClick={() => router.push("/schedule")} style={{ background: C.green, color: "#000", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", ...mono, fontSize: 12, fontWeight: 700 }}>
                  Takvimi Görüntüle →
                </button>
              )}
              <button type="button" onClick={reset} style={{ background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", cursor: "pointer", ...mono, fontSize: 12 }}>Sıfırla</button>
            </div>
          </div>

          {/* IIS report */}
          {runSt === "infeasible" && (
            <div style={{ marginTop: 14, borderTop: `1px solid ${C.red}33`, paddingTop: 14 }}>
              <div style={{ fontSize: 10, color: C.red, ...mono, letterSpacing: "0.08em", marginBottom: 10 }}>IIS TANI RAPORU</div>
              {(iis.length ? iis : ["solver_metadata alanında detaylı tanı bilgisi mevcuttur."]).map((d, i) => (
                <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                  <span style={{ color: C.red }}>▸</span>
                  <span style={{ fontSize: 13, color: C.textSub }}>{IIS_LABELS[d] || d}</span>
                </div>
              ))}

              {/* AI Diagnose button */}
              <div style={{ marginTop: 14 }}>
                {diagSt === "idle" && (
                  <button
                    type="button"
                    onClick={diagnose}
                    style={{ background: C.purpleSoft, color: C.purple, border: `1px solid color-mix(in srgb, ${C.purple} 35%, transparent)`, borderRadius: 6, padding: "8px 16px", cursor: "pointer", ...mono, fontSize: 12, fontWeight: 600 }}
                  >
                    ✦  AI ile Tanı Koy
                  </button>
                )}
                {diagSt === "loading" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.purple, fontSize: 13, ...mono }}>
                    <Spinner /> AI analiz ediyor…
                  </div>
                )}
                {diagSt === "done" && diagResult && (
                  <div style={{ background: C.purpleSoft, border: `1px solid color-mix(in srgb, ${C.purple} 30%, transparent)`, borderRadius: 8, padding: "14px 16px", marginTop: 4 }}>
                    <div style={{ fontSize: 10, color: C.purple, ...mono, letterSpacing: "0.08em", marginBottom: 8 }}>AI TANISı</div>
                    <p style={{ fontSize: 13, color: C.text, lineHeight: 1.7, marginBottom: 12 }}>{diagResult.explanation}</p>
                    {diagResult.suggestions.length > 0 && (
                      <>
                        <div style={{ fontSize: 10, color: C.textMuted, ...mono, letterSpacing: "0.08em", marginBottom: 8 }}>ÖNERİLEN DEĞİŞİKLİKLER</div>
                        {diagResult.suggestions.slice(0, 4).map((s, i) => (
                          <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
                            <span style={{ color: C.purple, fontSize: 11, marginTop: 2, flexShrink: 0 }}>{s.priority}.</span>
                            <div>
                              <span style={{ ...mono, fontSize: 11, color: C.purple, background: `color-mix(in srgb, ${C.purple} 12%, transparent)`, padding: "2px 6px", borderRadius: 4 }}>{s.code}</span>
                              <span style={{ fontSize: 12, color: C.textSub, marginLeft: 8 }}>→ {typeof s.suggested_value === "object" && s.suggested_value !== null ? JSON.stringify(s.suggested_value) : String(s.suggested_value)}</span>
                              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>{s.reason}</div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                    {diagResult.combined_recommendation && (
                      <div style={{ fontSize: 12, color: C.text, borderTop: `1px solid color-mix(in srgb, ${C.purple} 20%, transparent)`, paddingTop: 10, marginTop: 10 }}>
                        <b>Öneri:</b> {diagResult.combined_recommendation}
                      </div>
                    )}
                  </div>
                )}
                {diagSt === "error" && (
                  <div style={{ fontSize: 12, color: C.red }}>AI tanısı başarısız. OPENAI_API_KEY ayarlandı mı?</div>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ── AI Assistant panel ───────────────────────────────────── */}
      <Card style={{ padding: "20px 24px", marginBottom: 20, borderColor: `color-mix(in srgb, ${C.cyan} 30%, transparent)` }}>
        <SL>✦ AI ASISTAN — DOĞAL DİL İLE YAPILANDIRMA</SL>
        <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 14, lineHeight: 1.6 }}>
          Parametreleri doğal dilde tanımlayın. AI, istediğinizi anlayıp optimizer ayarlarına dönüştürür.
        </p>

        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <textarea
              rows={3}
              placeholder={"Örn: Sınavları 10 güne yay, arka arkaya sınav olmasın, başlangıç saati 09:00 olsun"}
              value={llmMessage}
              onChange={e => setLlmMessage(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) askLlm(); }}
              style={{
                ...iStyle,
                resize: "vertical",
                minHeight: 72,
                lineHeight: 1.6,
              }}
            />
          </div>
          <button
            type="button"
            onClick={askLlm}
            disabled={llmSt === "loading" || !llmMessage.trim()}
            style={{
              background: llmSt === "loading" ? C.cyanSoft : C.cyan,
              color: llmSt === "loading" ? C.cyan : "#fff",
              border: "none",
              borderRadius: 8,
              padding: "12px 20px",
              cursor: llmSt === "loading" || !llmMessage.trim() ? "not-allowed" : "pointer",
              ...mono,
              fontSize: 13,
              fontWeight: 700,
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            {llmSt === "loading" ? <><Spinner size={13} /> Analiz ediliyor…</> : "✦  Yapılandır"}
          </button>
        </div>
        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 6 }}>Ctrl+Enter ile gönder</div>

        {/* LLM error */}
        {llmSt === "error" && (
          <div style={{ marginTop: 12 }}>
            <ErrorBox msg={llmErr || "LLM isteği başarısız. OPENAI_API_KEY ayarlandı mı?"} />
          </div>
        )}

        {/* LLM result — rejection (not a scheduling request) */}
        {llmSt === "done" && llmResult?.success && llmResult.is_scheduling_request === false && (
          <div style={{
            marginTop: 16,
            background: C.amberSoft,
            border: `1px solid color-mix(in srgb, ${C.amber} 40%, transparent)`,
            borderRadius: 8,
            padding: "14px 16px",
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>⚠</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: C.amber, ...mono, letterSpacing: "0.08em", marginBottom: 6 }}>GEÇERSİZ İSTEK</div>
              <p style={{ fontSize: 13, color: C.text, lineHeight: 1.7, margin: 0 }}>{llmResult.summary}</p>
            </div>
            <button
              type="button"
              onClick={() => { setLlmSt("idle"); setLlmResult(null); setLlmMessage(""); setPendingProposedParams(null); }}
              style={{ background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", cursor: "pointer", ...mono, fontSize: 11, flexShrink: 0 }}
            >
              Kapat
            </button>
          </div>
        )}

        {/* LLM result — normal scheduling response */}
        {llmSt === "done" && llmResult?.success && llmResult.is_scheduling_request !== false && (
          <div style={{
            marginTop: 16,
            background: C.cyanSoft,
            border: `1px solid color-mix(in srgb, ${C.cyan} 30%, transparent)`,
            borderRadius: 8,
            padding: "14px 16px",
          }}>
            <div style={{ fontSize: 10, color: C.cyan, ...mono, letterSpacing: "0.08em", marginBottom: 8 }}>AI ÖNERİSİ</div>
            <p style={{ fontSize: 13, color: C.text, lineHeight: 1.7, marginBottom: 12 }}>{llmResult.summary}</p>

            {/* Change list */}
            {llmResult.changes.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: C.textMuted, ...mono, letterSpacing: "0.08em", marginBottom: 8 }}>YAPILACAK DEĞİŞİKLİKLER</div>
                {llmResult.changes.map((ch, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
                    <span style={{ color: C.cyan, fontSize: 12, flexShrink: 0, marginTop: 1 }}>▸</span>
                    <div>
                      <span style={{ ...mono, fontSize: 11, color: C.cyan, background: `color-mix(in srgb, ${C.cyan} 12%, transparent)`, padding: "2px 6px", borderRadius: 4 }}>{ch.code}</span>
                      <span style={{ fontSize: 12, color: C.text, marginLeft: 8, fontWeight: 600 }}>{typeof ch.value === "object" && ch.value !== null ? JSON.stringify(ch.value) : String(ch.value)}</span>
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>{ch.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Warnings */}
            {llmResult.warnings && llmResult.warnings.length > 0 && (
              <div style={{ marginBottom: 14, background: C.amberSoft, borderRadius: 6, padding: "10px 12px" }}>
                {llmResult.warnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 12, color: C.amber }}>⚠ {w}</div>
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={applyToForm}
                style={{ background: "var(--surface)", color: C.cyan, border: `1px solid color-mix(in srgb, ${C.cyan} 40%, transparent)`, borderRadius: 6, padding: "8px 16px", cursor: "pointer", ...mono, fontSize: 12, fontWeight: 600 }}
              >
                Forma Uygula
              </button>
              <button
                type="button"
                onClick={() => { setLlmSt("idle"); setLlmResult(null); setLlmMessage(""); setPendingProposedParams(null); }}
                style={{ background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", cursor: "pointer", ...mono, fontSize: 12 }}
              >
                Kapat
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* ── Parameter form ───────────────────────────────────────── */}
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {[
              { label: "SINAV GÜN SAYISI", key: "exam_days" },
              { label: "GÜN BAŞI SLOT (30dk)", key: "slots_per_day" },
              { label: "BAŞLANGIÇ SAATİ", key: "start_hour" },
            ].map(f => (
              <div key={f.key}>
                <label style={lStyle}>{f.label}</label>
                <input style={iStyle} type="number" value={params[f.key as keyof typeof params] as number} onChange={e => setParams({ ...params, [f.key]: +e.target.value })} />
              </div>
            ))}
          </div>
          <div>
            <label style={lStyle}>ÇAKIŞMA EŞİĞİ (HARD THRESHOLD)</label>
            <input style={iStyle} type="number" min={0} value={params.hard_threshold} onChange={e => setParams({ ...params, hard_threshold: +e.target.value })} />
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 5, lineHeight: 1.6 }}>
              Aynı anda iki sınava girecek öğrenci çakışmalarının <b>izin verilen maksimum sayısı</b>. <br />
              <span style={{ color: C.textSub }}>0 → hiçbir çakışmaya izin verme (en katı, çözüm uzar) · yüksek değer çözümü hızlandırır ancak bazı öğrenciler çakışmalı sınava girebilir.</span>
            </div>
          </div>
        </Card>

        <Card style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <SL>SOLVER AYARLARI (GUROBI)</SL>
          <div>
            <label style={lStyle}>ZAMAN LİMİTİ (saniye)</label>
            <input style={iStyle} type="number" value={params.time_limit} onChange={e => setParams({ ...params, time_limit: +e.target.value })} />
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>Gurobi'nin maksimum çalışma süresi · varsayılan 300 sn</div>
          </div>
          <div>
            <label style={lStyle}>MIP GAP TOLERANSI</label>
            <input style={iStyle} type="number" step="0.01" value={params.mip_gap} onChange={e => setParams({ ...params, mip_gap: +e.target.value })} />
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>0.10 = %10 tolerans · düşüldükçe çözüm daha optimal ama daha yavaş</div>
          </div>

          {/* No back-to-back toggle */}
          <button
            type="button"
            onClick={() => setParams(p => ({ ...p, no_back_to_back: !p.no_back_to_back }))}
            style={{
              background: params.no_back_to_back
                ? `color-mix(in srgb, ${C.accent} 8%, transparent)`
                : "var(--surface)",
              border: `1px solid ${params.no_back_to_back ? C.accent + "66" : C.border}`,
              borderRadius: 8,
              padding: "14px 16px",
              display: "flex",
              gap: 14,
              alignItems: "flex-start",
              cursor: "pointer",
              textAlign: "left",
              width: "100%",
              transition: "all 140ms ease-out",
            }}
          >
            <span style={{
              flexShrink: 0,
              marginTop: 2,
              width: 36,
              height: 20,
              borderRadius: 10,
              background: params.no_back_to_back ? C.accent : C.border,
              position: "relative",
              display: "inline-block",
              transition: "background 140ms ease-out",
            }}>
              <span style={{
                position: "absolute",
                top: 3,
                left: params.no_back_to_back ? 19 : 3,
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "#fff",
                display: "inline-block",
                transition: "left 140ms ease-out",
              }} />
            </span>
            <span style={{ display: "inline-block" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>Arka Arkaya Sınav Engeli</span>
                {params.no_back_to_back && (
                  <span style={{
                    fontSize: "0.6rem",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    padding: "2px 7px",
                    borderRadius: 4,
                    background: `color-mix(in srgb, ${C.red} 14%, transparent)`,
                    color: C.red,
                    border: `1px solid color-mix(in srgb, ${C.red} 35%, transparent)`,
                  }}>
                    HARD KISIT
                  </span>
                )}
              </span>
              <span style={{ display: "block", fontSize: 12, color: C.textMuted, lineHeight: 1.65 }}>
                Aynı bölüm öğrencilerinin iki sınavının ardışık slotlara denk gelmesini engeller.
                Öğrenci dostu çizelgeler üretir; ancak hard kısıt olarak uygulandığından
                <span style={{ color: params.no_back_to_back ? C.amber : C.textMuted }}> çözüm süresi önemli ölçüde uzayabilir.</span>
              </span>
            </span>
          </button>

          {submitErr && !isRunning && <ErrorBox msg={submitErr} />}
        </Card>
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center" }}>
        <button
          type="button"
          onClick={submit} disabled={isRunning}
          style={{ background: isRunning ? C.accentSoft : C.accent, color: isRunning ? C.accent : "#fff", border: "none", borderRadius: 8, padding: "13px 32px", cursor: isRunning ? "not-allowed" : "pointer", ...mono, fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 10, transition: "background 0.2s" }}
        >
          {isRunning ? <><Spinner size={14} color={C.accent} /> Çalışıyor…</> : "▶  Optimizasyonu Başlat"}
        </button>
      </div>
    </div>
  );
}
