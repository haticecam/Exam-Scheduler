"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, Spinner, ErrorBox, Badge, PageHeader, DataTable, DataRow, DataCell, ActionButton } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTermVersion } from "@/lib/term-context";

type DiagnoseResult = {
  success: boolean;
  explanation: string;
  root_causes: { cause: string; constraint_type: string; severity: string }[];
  suggestions: { code: string; suggested_value: unknown; reason: string; impact: string; priority: number }[];
  combined_recommendation: string;
  error?: string;
};

type ExamPeriodInfo = { name: string; start_date: string; end_date: string } | null;

type Solution = {
  id: string;
  name: string;
  term_id: string | null;
  status: string;
  score: number | null;
  created_at: string;
  parameters: Record<string, any> | null;
  stats: Record<string, any> | null;
  exam_period: ExamPeriodInfo;
};

function formatRuntime(runtimeS: number | null | undefined): string {
  if (runtimeS == null) return "—";
  if (runtimeS < 60) return `${runtimeS.toFixed(1)}s`;
  const m = Math.floor(runtimeS / 60);
  const s = Math.round(runtimeS % 60);
  return `${m}d ${s}s`;
}

function StatPill({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "8px 14px", borderRadius: 8,
      background: `color-mix(in srgb, ${color ?? C.accent} 8%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color ?? C.accent} 25%, transparent)`,
      minWidth: 80,
    }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: color ?? C.accent, ...mono }}>{value}</span>
      <span style={{ fontSize: 10, color: C.textMuted, marginTop: 2, letterSpacing: "0.05em" }}>{label}</span>
    </div>
  );
}

function ParamRow({ label, value, source }: { label: string; value: string | number; source?: "calendar" | "llm" | null }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 11, ...mono, marginBottom: 3 }}>
      <span style={{ color: C.textMuted, minWidth: 130, flexShrink: 0 }}>{label}:</span>
      <span style={{ color: source === "calendar" ? C.green : source === "llm" ? C.cyan : C.text, fontWeight: source ? 700 : 400 }}>
        {String(value)}
        {source === "calendar" && <span style={{ fontSize: 9, color: C.green, marginLeft: 4, letterSpacing: "0.04em" }}>TAKVİM</span>}
        {source === "llm" && <span style={{ fontSize: 9, color: C.cyan, marginLeft: 4, letterSpacing: "0.04em" }}>AI</span>}
      </span>
    </div>
  );
}

function SolutionDetail({ s }: { s: Solution }) {
  const p = s.parameters ?? {};
  const stats = s.stats ?? {};
  const llmCodes = new Set(Object.keys(p.llm_proposed_params ?? {}));
  const calendarActive = Boolean(p.exam_period_id);

  const totalRuntime = (stats.build_time_s ?? 0) + (stats.runtime_s ?? 0);

  return (
    <div style={{ padding: "20px 24px", background: "var(--surface-container-low)", borderTop: `1px solid ${C.border}` }}>

      {/* ── Stat pills ─────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
        <StatPill label="Oluşturulma" value={s.created_at ? new Date(s.created_at).toLocaleString("tr-TR") : "—"} color={C.textMuted} />
        <StatPill label="Model Kurma" value={formatRuntime(stats.build_time_s)} color={C.textMuted} />
        <StatPill label="Solver Süresi" value={formatRuntime(stats.runtime_s)} color={C.accent} />
        <StatPill label="Toplam Süre" value={formatRuntime(totalRuntime || stats.runtime_s)} color={C.accent} />
        <StatPill label="Çizelgelenen Ders" value={stats.scheduling_units ?? "—"} color={C.green} />
        {stats.mip_gap != null && (
          <StatPill label="MIP Gap" value={`%${stats.mip_gap}`} color={C.cyan} />
        )}
      </div>

      {/* ── Configuration detail ──────────────────────────────── */}
      <div>
        <div>
          <div style={{ fontSize: 10, color: C.textMuted, ...mono, letterSpacing: "0.08em", marginBottom: 10 }}>YAPILANDIRMA</div>

          {s.exam_period ? (
            <ParamRow
              label="Sınav Takvimi"
              value={`${s.exam_period.name} (${s.exam_period.start_date} → ${s.exam_period.end_date})`}
              source="calendar"
            />
          ) : (
            <ParamRow label="Sınav Takvimi" value="Manuel parametreler" />
          )}

          {!calendarActive && (
            <>
              <ParamRow
                label="Sınav Gün Sayısı"
                value={p.exam_days ?? "—"}
                source={llmCodes.has("PARAM_EXAM_DAYS") ? "llm" : null}
              />
              <ParamRow
                label="Slot/Gün (30dk)"
                value={p.slots_per_day ?? "—"}
                source={llmCodes.has("PARAM_SLOTS_PER_DAY") ? "llm" : null}
              />
              <ParamRow
                label="Başlangıç Saati"
                value={p.start_hour != null ? `${p.start_hour}:00` : "—"}
                source={llmCodes.has("PARAM_START_HOUR") ? "llm" : null}
              />
            </>
          )}
          <ParamRow
            label="Hard Threshold"
            value={p.hard_threshold ?? "—"}
            source={llmCodes.has("PARAM_HARD_THRESHOLD") ? "llm" : null}
          />
          <ParamRow
            label="Ardışık Yasak"
            value={p.no_back_to_back ? "Evet" : "Hayır"}
            source={llmCodes.has("PARAM_NO_BACK_TO_BACK") ? "llm" : null}
          />
          {p.no_back_to_back_depts && (
            <ParamRow
              label="Ardışık Yasak Bölüm"
              value={JSON.stringify(p.no_back_to_back_depts)}
              source={llmCodes.has("SCOPE_DEPT_NO_BACK_TO_BACK") ? "llm" : null}
            />
          )}
          <ParamRow
            label="Zaman Limiti"
            value={p.time_limit != null ? `${p.time_limit}s` : "—"}
            source={llmCodes.has("PARAM_TIME_LIMIT") ? "llm" : null}
          />
          <ParamRow
            label="MIP Gap (ayar)"
            value={p.mip_gap != null ? `%${(p.mip_gap * 100).toFixed(0)}` : "—"}
            source={llmCodes.has("PARAM_MIP_GAP") ? "llm" : null}
          />
          {p.year_order_sequence && (
            <ParamRow
              label="Yıl Sırası"
              value={JSON.stringify(p.year_order_sequence)}
              source={llmCodes.has("PARAM_YEAR_ORDER_SEQUENCE") ? "llm" : null}
            />
          )}
        </div>
      </div>

      {/* ── AI proposed params ─────────────────────────────────── */}
      {p.llm_proposed_params && Object.keys(p.llm_proposed_params).length > 0 && (
        <div style={{ marginTop: 16, padding: "10px 12px", background: `color-mix(in srgb, ${C.cyan} 7%, transparent)`, borderRadius: 6, border: `1px solid color-mix(in srgb, ${C.cyan} 20%, transparent)` }}>
          <div style={{ fontSize: 9, color: C.cyan, ...mono, letterSpacing: "0.08em", marginBottom: 6 }}>AI ÖNERDİ</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
            {Object.entries(p.llm_proposed_params).map(([k, v]) => (
              <span key={k} style={{ fontSize: 11, ...mono, color: C.cyan }}>
                {k}: <span style={{ color: C.text }}>{typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SolutionsPage() {
  const router = useRouter();
  const { termVersion } = useTermVersion();
  const { data, loading, error, refetch } = useFetch("/optimize/history/", [termVersion]);
  const solutions: Solution[] = data?.results || data || [];

  const hasInFlight = solutions.some(s => s.status === "PROCESSING" || s.status === "PENDING");
  useEffect(() => {
    if (!hasInFlight) return;
    const id = setInterval(() => refetch({ silent: true }), 5000);
    return () => clearInterval(id);
  }, [hasInFlight, refetch]);

  const [deleteTarget, setDeleteTarget] = useState<Solution | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [diagTarget, setDiagTarget] = useState<string | null>(null);
  const [diagSt, setDiagSt] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [diagResult, setDiagResult] = useState<DiagnoseResult | null>(null);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/optimize/${deleteTarget.id}/`);
      refetch();
      setDeleteTarget(null);
      if (expandedId === deleteTarget.id) setExpandedId(null);
    } catch {
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDiagnose = async (solutionId: string) => {
    if (diagTarget === solutionId && diagSt === "done") {
      setDiagTarget(null);
      setDiagResult(null);
      setDiagSt("idle");
      return;
    }
    setDiagTarget(solutionId);
    setDiagSt("loading");
    setDiagResult(null);
    try {
      const res = await api.post("/llm/diagnose/", { solution_id: solutionId });
      setDiagResult(res);
      setDiagSt("done");
    } catch {
      setDiagSt("error");
    }
  };

  const DONE = ["COMPLETED", "OPTIMAL", "FEASIBLE", "FEASIBLE (TIME LIMIT)", "FEASIBLE_TIME_LIMIT"];

  return (
    <div style={{ padding: "32px 40px" }}>
      <PageHeader
        title="Çözüm Geçmişi"
        subtitle="Tüm sınav takvimi senaryoları ve arşiv"
        actions={
          <ActionButton onClick={refetch} variant="secondary" icon="↻">Yenile</ActionButton>
        }
      />

      {error && <div style={{ marginBottom: 16 }}><ErrorBox msg={error} /></div>}
      {loading && <div style={{ display: "flex", gap: 10, alignItems: "center", color: C.textMuted, marginBottom: 16 }}><Spinner size={20} /><span>Yükleniyor…</span></div>}

      {!loading && !solutions.length ? (
        <Card style={{ padding: "80px 40px", textAlign: "center", color: C.textMuted }}>
          Henüz kayıtlı bir senaryo bulunamadı.
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <DataTable headers={["Senaryo Adı", "Tarih", "Durum", ""]}>
            {solutions.map((s) => (
              <React.Fragment key={s.id}>
                <DataRow>
                  <DataCell style={{ fontWeight: 600, ...mono }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {s.name || `Senaryo #${s.id.slice(0, 8)}`}
                      {s.exam_period && (
                        <span style={{ fontSize: 10, color: C.green, background: `color-mix(in srgb, ${C.green} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${C.green} 30%, transparent)`, padding: "1px 6px", borderRadius: 4, letterSpacing: "0.04em", fontWeight: 600 }}>
                          {s.exam_period.name}
                        </span>
                      )}
                    </div>
                  </DataCell>
                  <DataCell style={{ color: C.textMuted }}>
                    {s.created_at ? new Date(s.created_at).toLocaleDateString("tr-TR") : "—"}
                  </DataCell>
                  <DataCell><Badge status={s.status} /></DataCell>
                  <DataCell>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      {DONE.includes(s.status) && (
                        <ActionButton onClick={() => router.push(`/schedule?id=${s.id}`)} variant="secondary">
                          Takvimi Görüntüle
                        </ActionButton>
                      )}
                      {s.status === "INFEASIBLE" && (
                        <button
                          type="button"
                          onClick={() => handleDiagnose(s.id)}
                          disabled={diagTarget === s.id && diagSt === "loading"}
                          style={{
                            background: diagTarget === s.id && diagSt === "done"
                              ? `color-mix(in srgb, ${C.purple} 15%, transparent)`
                              : C.purpleSoft,
                            color: C.purple,
                            border: `1px solid color-mix(in srgb, ${C.purple} 35%, transparent)`,
                            borderRadius: 6,
                            padding: "7px 14px",
                            cursor: diagTarget === s.id && diagSt === "loading" ? "not-allowed" : "pointer",
                            ...mono,
                            fontSize: 12,
                            fontWeight: 600,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          {diagTarget === s.id && diagSt === "loading"
                            ? <><Spinner size={11} /> Analiz ediliyor…</>
                            : diagTarget === s.id && diagSt === "done"
                            ? "✦  Tanıyı Kapat"
                            : "✦  AI ile Tanı Koy"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setExpandedId(v => v === s.id ? null : s.id)}
                        style={{
                          background: expandedId === s.id ? `color-mix(in srgb, ${C.accent} 10%, transparent)` : "transparent",
                          color: expandedId === s.id ? C.accent : C.textMuted,
                          border: `1px solid ${expandedId === s.id ? C.accent + "55" : C.border}`,
                          borderRadius: 6,
                          padding: "7px 12px",
                          cursor: "pointer",
                          ...mono,
                          fontSize: 12,
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          transition: "all 140ms",
                        }}
                      >
                        <span style={{ fontSize: 9, display: "inline-block", transform: expandedId === s.id ? "rotate(90deg)" : "none", transition: "transform 150ms" }}>▶</span>
                        Detaylar
                      </button>
                      <ActionButton onClick={() => setDeleteTarget(s)} variant="danger">
                        Sil
                      </ActionButton>
                    </div>
                  </DataCell>
                </DataRow>

                {/* Expandable detail row */}
                {expandedId === s.id && (
                  <tr>
                    <DataCell colSpan={4} style={{ padding: 0 }}>
                      <SolutionDetail s={s} />
                    </DataCell>
                  </tr>
                )}

                {/* Diagnosis panel inline */}
                {diagTarget === s.id && diagSt === "done" && diagResult && (
                  <tr>
                    <DataCell colSpan={4} style={{ padding: 0 }}>
                      <div style={{ padding: "16px 24px", background: C.purpleSoft, borderTop: `1px solid color-mix(in srgb, ${C.purple} 20%, transparent)` }}>
                        <div style={{ fontSize: 10, color: C.purple, ...mono, letterSpacing: "0.08em", marginBottom: 10 }}>
                          AI TANISI
                        </div>
                        <p style={{ fontSize: 13, color: C.text, lineHeight: 1.7, marginBottom: 14 }}>{diagResult.explanation}</p>
                        {diagResult.suggestions.length > 0 && (
                          <>
                            <div style={{ fontSize: 10, color: C.textMuted, ...mono, letterSpacing: "0.08em", marginBottom: 10 }}>ÖNERİLEN DEĞİŞİKLİKLER</div>
                            {diagResult.suggestions.slice(0, 5).map((sg, i) => (
                              <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
                                <span style={{ color: C.purple, fontSize: 12, marginTop: 2, flexShrink: 0 }}>{sg.priority}.</span>
                                <div>
                                  <span style={{ ...mono, fontSize: 11, color: C.purple, background: `color-mix(in srgb, ${C.purple} 12%, transparent)`, padding: "2px 6px", borderRadius: 4 }}>{sg.code}</span>
                                  <span style={{ fontSize: 12, color: C.textSub, marginLeft: 8 }}>→ {String(sg.suggested_value)}</span>
                                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>{sg.reason}</div>
                                  <div style={{ fontSize: 11, color: C.amber, marginTop: 2 }}>Etki: {sg.impact}</div>
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                        {diagResult.combined_recommendation && (
                          <div style={{ fontSize: 13, color: C.text, borderTop: `1px solid color-mix(in srgb, ${C.purple} 20%, transparent)`, paddingTop: 12, marginTop: 12 }}>
                            <b>Öneri:</b> {diagResult.combined_recommendation}
                          </div>
                        )}
                      </div>
                    </DataCell>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </DataTable>

          {diagTarget && diagSt === "error" && (
            <div style={{ marginTop: 12, fontSize: 12, color: C.red }}>
              AI tanısı başarısız. OPENAI_API_KEY ayarlandı mı?
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null); }}
        title="Çözümü Sil"
        description={`"${deleteTarget?.name || "Bu senaryo"}" kalıcı olarak silinecek. Bu işlem geri alınamaz.`}
        confirmLabel="Sil"
        onConfirm={handleDelete}
        loading={deleteLoading}
      />
    </div>
  );
}
