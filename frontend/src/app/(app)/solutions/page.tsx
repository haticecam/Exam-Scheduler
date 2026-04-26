"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, Spinner, ErrorBox, Badge, PageHeader, DataTable, DataRow, DataCell, ActionButton } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type DiagnoseResult = {
  success: boolean;
  explanation: string;
  root_causes: { cause: string; constraint_type: string; severity: string }[];
  suggestions: { code: string; suggested_value: unknown; reason: string; impact: string; priority: number }[];
  combined_recommendation: string;
  error?: string;
};

export default function SolutionsPage() {
  const router = useRouter();
  const { data, loading, error, refetch } = useFetch("/optimize/history/");
  const solutions = data?.results || data || [];

  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

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
            {solutions.map((s: any) => (
              <DataRow key={s.id}>
                <DataCell style={{ fontWeight: 600, ...mono }}>{s.name || `Senaryo #${String(s.id).slice(0, 8)}`}</DataCell>
                <DataCell style={{ color: C.textMuted }}>{s.created_at ? new Date(s.created_at).toLocaleDateString("tr-TR") : "—"}</DataCell>
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
                    <ActionButton onClick={() => setDeleteTarget(s)} variant="danger">
                      Sil
                    </ActionButton>
                  </div>
                </DataCell>
              </DataRow>
            ))}
          </DataTable>

          {/* Diagnosis panel */}
          {diagTarget && diagSt === "done" && diagResult && (
            <Card style={{
              marginTop: 16,
              padding: "20px 24px",
              borderColor: `color-mix(in srgb, ${C.purple} 30%, transparent)`,
              background: C.purpleSoft,
            }}>
              <div style={{ fontSize: 10, color: C.purple, ...mono, letterSpacing: "0.08em", marginBottom: 10 }}>
                AI TANISI — {solutions.find((s: any) => s.id === diagTarget)?.name || `Senaryo #${String(diagTarget).slice(0, 8)}`}
              </div>
              <p style={{ fontSize: 13, color: C.text, lineHeight: 1.7, marginBottom: 14 }}>{diagResult.explanation}</p>

              {diagResult.suggestions.length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: C.textMuted, ...mono, letterSpacing: "0.08em", marginBottom: 10 }}>ÖNERİLEN DEĞİŞİKLİKLER</div>
                  {diagResult.suggestions.slice(0, 5).map((s, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
                      <span style={{ color: C.purple, fontSize: 12, marginTop: 2, flexShrink: 0 }}>{s.priority}.</span>
                      <div>
                        <span style={{ ...mono, fontSize: 11, color: C.purple, background: `color-mix(in srgb, ${C.purple} 12%, transparent)`, padding: "2px 6px", borderRadius: 4 }}>{s.code}</span>
                        <span style={{ fontSize: 12, color: C.textSub, marginLeft: 8 }}>→ {String(s.suggested_value)}</span>
                        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>{s.reason}</div>
                        <div style={{ fontSize: 11, color: C.amber, marginTop: 2 }}>Etki: {s.impact}</div>
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
            </Card>
          )}

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
