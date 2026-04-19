"use client";
import React from "react";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, Badge, Spinner, PageContainer, PageHeader, ActionButton } from "@/components/ui";

export default function TermsPage() {
  const { data, error, loading: isLoading, refetch: mutate } = useFetch("/terms/");

  if (isLoading) return <PageContainer><Spinner /></PageContainer>;
  if (error) return <PageContainer>Hata: {error}</PageContainer>;

  const terms = data?.results || data || [];

  const handleAddTerm = async () => {
    try {
      let orgs = await api.get("/organizations/");
      let orgList = orgs?.results || orgs || [];
      let org_id;
      if (orgList.length === 0) {
        const newOrg = await api.post("/organizations/", { name: "Varsayılan Üniversite" });
        org_id = newOrg.id;
      } else {
        org_id = orgList[0].id;
      }
      const termName = prompt("Dönem adı girin (Örn: 2024-2025 Güz):", "2024-2025 Güz");
      if (termName) {
        await api.post("/terms/", { name: termName, status: "Active", organization: org_id });
        mutate();
      }
    } catch (err: any) {
      alert("Hata: " + err.message);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Dönem Yönetimi"
        subtitle="Akademik dönemleri görüntüleyin ve yönetin."
        actions={
          <ActionButton onClick={handleAddTerm} icon="+">YENİ DÖNEM EKLE</ActionButton>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 24 }}>
        {terms.length === 0 ? (
          <div style={{ color: C.textMuted, ...mono }}>Sistemde kayıtlı dönem bulunamadı.</div>
        ) : (
          terms.map((t: any) => (
            <Card key={t.id} style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{t.name}</div>
                <Badge status={t.status} />
              </div>

              {/*  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 12, color: C.textMuted, ...mono }}>ID: <span style={{ color: C.textSub }}>{t.id}</span></div>
                <div style={{ fontSize: 12, color: C.textMuted, ...mono }}>Organizasyon: <span style={{ color: C.textSub }}>{t.organization}</span></div>
              </div>*/}

              <div style={{ marginTop: 8, paddingTop: 16, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
                {t.status !== 'Active' && (
                  <ActionButton
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await api.patch(`/terms/${t.id}/`, { status: 'Active' });
                        mutate();
                      } catch (err: any) {
                        alert(err.message || "Dönem aktif edilemedi.");
                      }
                    }}
                  >
                    Aktif Yap
                  </ActionButton>
                )}
                <ActionButton
                  variant="danger"

                  onClick={async () => {
                    if (confirm("Silmek istediğinize emin misiniz?")) {
                      try {
                        await api.delete("/terms/" + t.id + "/");
                        mutate();
                      } catch (err: any) {
                        alert(err.message);
                      }
                    }
                  }}
                >
                  Sil
                </ActionButton>
              </div>
            </Card>
          ))
        )}
      </div>
    </PageContainer>
  );
}
