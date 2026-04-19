"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, Spinner, ErrorBox, Badge, PageHeader, DataTable, DataRow, DataCell, ActionButton } from "@/components/ui";

export default function SolutionsPage() {
  const router = useRouter();
  const { data, loading, error, refetch } = useFetch("/optimize/history/");
  const solutions = data?.results || data || [];
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!confirm("Bu çözüm silinecek. Emin misin?")) return;
    setDeletingId(id);
    try {
      await api.delete(`/optimize/${id}/`);
      refetch();
    } catch (e: any) {
      alert(e.message || "Silme başarısız.");
    } finally {
      setDeletingId(null);
    }
  };

  const DONE = ["COMPLETED", "OPTIMAL", "FEASIBLE", "FEASIBLE (TIME LIMIT)"];

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
        <DataTable headers={["Senaryo Adı", "Tarih", "Durum"]}>
          {solutions.map((s: any) => (
            <DataRow key={s.id}>
              <DataCell style={{ fontWeight: 600, ...mono }}>{s.name || `Senaryo #${String(s.id).slice(0, 8)}`}</DataCell>
              <DataCell style={{ color: C.textMuted }}>{s.created_at ? new Date(s.created_at).toLocaleDateString("tr-TR") : "—"}</DataCell>
              <DataCell><Badge status={s.status} /></DataCell>
              <DataCell style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                {DONE.includes(s.status) && (
                  <ActionButton onClick={() => router.push(`/schedule?id=${s.id}`)} variant="secondary">
                    Takvimi Görüntüle
                  </ActionButton>
                )}
                <ActionButton
                  onClick={() => handleDelete(s.id)}
                  variant="danger"
                  disabled={deletingId === s.id}
                >
                  {deletingId === s.id ? "..." : "Sil"}
                </ActionButton>
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
    </div>
  );
}
