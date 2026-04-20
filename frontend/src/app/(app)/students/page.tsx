"use client";
import React, { useState } from "react";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, SL, CSVUploader, Spinner, InfoBox, PageContainer, PageHeader, ActionButton, DataTable, DataRow, DataCell } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function StudentsPage() {
  const { data, loading, refetch } = useFetch("/students/");
  const { data: termData } = useFetch("/terms/?status=Active");
  const { data: orgData } = useFetch("/organizations/");
  const { data: depts } = useFetch("/academic-units/");

  const count = data?.count ?? (Array.isArray(data) ? data.length : 0);
  const term = termData?.results?.[0] || termData?.[0];
  const orgId = orgData?.[0]?.id || orgData?.results?.[0]?.id;
  const noTerm = !term?.id;
  const deptList = depts?.results || depts || [];

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [simError, setSimError] = useState("");

  // Conflicts filters
  const [conflictPage, setConflictPage] = useState(1);
  const [minShared, setMinShared] = useState("2");
  const [deptFilter, setDeptFilter] = useState("");
  const [pageSize, setPageSize] = useState("50");

  const conflictParams = new URLSearchParams();
  conflictParams.set("page", conflictPage.toString());
  conflictParams.set("page_size", pageSize);
  if (minShared && parseInt(minShared) > 1) conflictParams.set("min_shared", minShared);
  if (deptFilter) conflictParams.set("department_id", deptFilter);

  const { data: conflictData, loading: conflictLoading } = useFetch(
    `/students/getConflicts/?${conflictParams.toString()}`
  );
  const conflicts = conflictData?.conflicts || [];
  const totalConflicts = conflictData?.total ?? 0;
  const totalPages = conflictData?.total_pages ?? 1;

  const handleDeleteAll = async () => {
    if (!orgId) return;
    setDeleting(true);
    try {
      await api.delete(`/students/deleteAll/?org_id=${orgId}`);
      refetch();
      setConfirmDeleteOpen(false);
    } catch (e: any) {
      setSimError(e.message || "Silme işlemi başarısız.");
    } finally {
      setDeleting(false);
    }
  };

  const handleSimulate = async () => {
    if (!term?.id) return;
    setSimulating(true);
    setShowSuccess(false);
    setSimError("");
    try {
      await api.downloadPost("/simulateStudents/", { term_id: term.id }, "simile_ogrenciler.csv");
      refetch();
      setShowSuccess(true);
    } catch (e: any) {
      setSimError(e.message || "Simülasyon başarısız.");
    } finally {
      setSimulating(false);
    }
  };

  const selectStyle = {
    background: "#0d0e1a",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "9px 12px",
    color: C.text,
    fontSize: 13,
    outline: "none",
    width: "100%",
  };

  const inputStyle = { ...selectStyle };

  return (
    <PageContainer style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <PageHeader
        title="Öğrenci & Kayıt"
        actions={
          <ActionButton
            onClick={() => setConfirmDeleteOpen(true)}
            variant="danger"
            disabled={deleting || count === 0}
          >
            {`Tüm Veriyi Sil (${count})`}
          </ActionButton>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 32 }}>
        <Card style={{ padding: 32 }}>
          <p style={{ color: C.textMuted, fontSize: 14, margin: "0 0 24px", lineHeight: 1.7 }}>
            Sisteminizde halihazırda gerçek bir öğrenci kaydı bulunmuyor ise sınav çizelgeleme motorunu test edebilmek için, kendi geliştirdiğimiz algoritmik <b>Öğrenci Simülasyon Motorunu</b> çalıştırarak, yüklediğiniz ders kontenjanlarına tamamen uygun binlerce sahte öğrenci kaydı oluşturabilirsiniz.
          </p>
          <ActionButton onClick={handleSimulate} disabled={simulating || noTerm}>
            {noTerm ? "Aktif dönem yok" : simulating ? "Simüle ediliyor…" : "Öğrenci Simülasyonu Başlat"}
          </ActionButton>
          {showSuccess && !simulating && (
            <div style={{ marginTop: 12, color: C.green, fontSize: 13, ...mono }}>
              ✓ Simülasyon tamamlandı.
            </div>
          )}
          {simError && (
            <div style={{ marginTop: 12, color: "#e05555", fontSize: 13, ...mono }}>{simError}</div>
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
                extraData={term ? { term_id: term.id } : undefined}
                onSuccess={refetch}
              />
            </div>
          </Card>
        </div>
      </div>

      {/* Conflicts section */}
      <Card style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <SL>DERS ÇAKIŞMA ANALİZİ</SL>
          {totalConflicts > 0 && (
            <span style={{ fontSize: 12, color: C.textMuted, ...mono }}>
              {totalConflicts} çakışma bulundu
            </span>
          )}
        </div>

        {/* Filters */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px 100px", gap: 16, alignItems: "end" }}>
          <div>
            <label style={{ display: "block", fontSize: 10, color: C.textMuted, marginBottom: 6, ...mono }}>BÖLÜM</label>
            <select
              value={deptFilter}
              onChange={e => { setDeptFilter(e.target.value); setConflictPage(1); }}
              style={selectStyle}
            >
              <option value="">Tümü</option>
              {deptList.map((d: any) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 10, color: C.textMuted, marginBottom: 6, ...mono }}>MİN. ORTAK ÖĞRENCİ</label>
            <input
              type="number"
              min={1}
              value={minShared}
              onChange={e => { setMinShared(e.target.value); setConflictPage(1); }}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 10, color: C.textMuted, marginBottom: 6, ...mono }}>SAYFA BOYUTU</label>
            <select
              value={pageSize}
              onChange={e => { setPageSize(e.target.value); setConflictPage(1); }}
              style={selectStyle}
            >
              {["20", "50", "100", "200"].map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <ActionButton variant="secondary" onClick={() => setConflictPage(1)}>
              Filtrele
            </ActionButton>
          </div>
        </div>

        <DataTable headers={["Ders A", "Bölüm A", "Ders B", "Bölüm B", "Ortak Öğrenci"]}>
          {conflictLoading && (
            <DataRow>
              <DataCell colSpan={5} style={{ textAlign: "center", padding: 40 }}>
                <Spinner size={20} />
              </DataCell>
            </DataRow>
          )}
          {!conflictLoading && conflicts.length === 0 && (
            <DataRow>
              <DataCell colSpan={5}>
                <InfoBox msg="Bu filtrelerle çakışma bulunamadı." />
              </DataCell>
            </DataRow>
          )}
          {conflicts.map((c: any, i: number) => (
            <DataRow key={`${c.course_a_id}-${c.course_b_id}-${i}`}>
              <DataCell>
                <div>
                  <span style={{ color: C.cyan, ...mono, fontWeight: 600, fontSize: 12 }}>{c.course_a_code}</span>
                  <div style={{ color: C.textSub, fontSize: 12, marginTop: 2 }}>{c.course_a_name}</div>
                </div>
              </DataCell>
              <DataCell style={{ color: C.textMuted, fontSize: 12 }}>{c.dept_a || "—"}</DataCell>
              <DataCell>
                <div>
                  <span style={{ color: C.cyan, ...mono, fontWeight: 600, fontSize: 12 }}>{c.course_b_code}</span>
                  <div style={{ color: C.textSub, fontSize: 12, marginTop: 2 }}>{c.course_b_name}</div>
                </div>
              </DataCell>
              <DataCell style={{ color: C.textMuted, fontSize: 12 }}>{c.dept_b || "—"}</DataCell>
              <DataCell>
                <span style={{
                  display: "inline-block",
                  padding: "4px 10px",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 700,
                  ...mono,
                  background: c.shared_students >= 20 ? "#2a1018" : c.shared_students >= 10 ? "#1f1a10" : "#101a1f",
                  color: c.shared_students >= 20 ? "#e05555" : c.shared_students >= 10 ? "#f5a623" : C.cyan,
                }}>
                  {c.shared_students}
                </span>
              </DataCell>
            </DataRow>
          ))}
        </DataTable>

        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
            <ActionButton
              onClick={() => setConflictPage(p => p - 1)}
              disabled={conflictPage <= 1}
              variant="secondary"
            >
              ← Önceki
            </ActionButton>
            <span style={{ fontSize: 12, color: C.textMuted, ...mono }}>
              SAYFA {conflictPage} / {totalPages}
            </span>
            <ActionButton
              onClick={() => setConflictPage(p => p + 1)}
              disabled={conflictPage >= totalPages}
              variant="secondary"
            >
              Sonraki →
            </ActionButton>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Tüm Öğrencileri Sil"
        description="Tüm öğrenciler ve kayıtları kalıcı olarak silinecek. Bu işlem geri alınamaz."
        confirmLabel="Evet, Sil"
        onConfirm={handleDeleteAll}
        loading={deleting}
      />
    </PageContainer>
  );
}
