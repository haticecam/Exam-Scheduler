"use client";
import React from "react";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, SL, CSVUploader, Spinner, PageContainer, PageHeader, ActionButton } from "@/components/ui";

export default function StudentsPage() {
  const { data, loading, refetch } = useFetch("/students/");
  const count = data?.count ?? (Array.isArray(data) ? data.length : 0);
  const [deleting, setDeleting] = React.useState(false);
  const [simulating, setSimulating] = React.useState(false);
  const [showSuccess, setShowSuccess] = React.useState(false);

  const handleDeleteAll = async () => {
    if (!confirm("Tüm öğrenciler ve kayıtlar silinecek. Emin misin?")) return;
    setDeleting(true);
    try {
      await api.delete("/students/deleteAll/");
      refetch();
    } catch (e: any) {
      alert(e.message || "Silme işlemi başarısız.");
    } finally {
      setDeleting(false);
    }
  };

  const handleSimulate = async () => {
    setSimulating(true);
    setShowSuccess(false); // Her yeni tıklamada eski mesajı gizle
    try {
      await api.downloadPost("/simulateStudents/", {}, "simile_ogrenciler.csv");
      refetch();
      setShowSuccess(true); // İşlem bittiğinde mesajı göster
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSimulating(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Öğrenci & Kayıt"
        actions={
          <ActionButton onClick={handleDeleteAll} variant="danger" disabled={deleting || count === 0}>
            {deleting ? "Siliniyor…" : `Tüm Veriyi Sil (${count})`}
          </ActionButton>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 32 }}>
        <Card style={{ padding: 32 }}>
          <p style={{ color: C.textMuted, fontSize: 14, margin: "0 0 24px", lineHeight: 1.7 }}>
            Sisteminizde halihazırda gerçek bir öğrenci kaydı bulunmuyor ise sınav çizelgeleme motorunu test edebilmek için, kendi geliştirdiğimiz algoritmik <b>Öğrenci Simülasyon Motorunu</b> çalıştırarak, yüklediğiniz ders kontenjanlarına tamamen uygun binlerce sahte öğrenci kaydı oluşturabilirsiniz.
          </p>
          <ActionButton onClick={handleSimulate} disabled={simulating}>
            {simulating ? "Simüle ediliyor…" : "Öğrenci Simülasyonu Başlat"}
          </ActionButton>
          {showSuccess && !simulating && (
            <div style={{ marginTop: 12, color: C.green, fontSize: 13, ...mono }}>
              ✓ Simülasyon tamamlandı.
            </div>
          )}
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card style={{ padding: 24 }}>
            <SL>MANUEL VERİ YÜKLEME</SL>
            <div style={{ marginTop: 16 }}>
              <CSVUploader
                title="Yükleme Aracı"
                endpoint="/students/"
                templateCols={["Student Identifier", "Program Name", "Year Level", "Course Code", "Section Label"]}
                onSuccess={refetch}
              />
            </div>
          </Card>

        </div>
      </div>
    </PageContainer>
  );
}
