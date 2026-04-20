"use client";
import React, { useState, useRef } from "react";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, SL, CSVUploader, Spinner, InfoBox, ErrorBox, ActionButton, PageContainer, PageHeader, DataTable, DataRow, DataCell } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";

/* ── Multi-XLSX uploader for production enrollment files ─────────────────── */
function XlsxMultiUploader({
  term,
  onSuccess,
}: {
  term: { id: string } | undefined;
  onSuccess: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [st, setSt] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const pick = (picked: FileList | null) => {
    if (!picked) return;
    const valid = Array.from(picked).filter(f => f.name.match(/\.xlsx$/i));
    if (valid.length === 0) {
      setErrMsg("Sadece .xlsx dosyası kabul edilir.");
      setSt("error");
      return;
    }
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...valid.filter(f => !names.has(f.name))];
    });
    setSt("idle");
    setErrMsg("");
  };

  const remove = (name: string) => setFiles(prev => prev.filter(f => f.name !== name));

  const upload = async () => {
    if (!files.length || !term?.id) return;
    setSt("uploading");
    const fd = new FormData();
    fd.append("term_id", term.id);
    files.forEach(f => fd.append("files", f));
    try {
      const res = await api.upload("/students/upload-xlsx/", fd);
      setResult(res as Record<string, unknown>);
      setSt("success");
      onSuccess();
    } catch (e: unknown) {
      const err = e as { data?: { detail?: string; error?: string }; message?: string };
      setErrMsg(err.data?.detail ?? err.data?.error ?? err.message ?? "Yükleme başarısız.");
      setSt("error");
    }
  };

  const reset = () => { setFiles([]); setSt("idle"); setResult(null); setErrMsg(""); };

  return (
    <div>
      {/* Expected format */}
      <div style={{
        background: "color-mix(in srgb, var(--primary) 6%, transparent)",
        border: "1px solid color-mix(in srgb, var(--primary) 20%, transparent)",
        borderRadius: 8,
        padding: "10px 14px",
        marginBottom: 14,
        display: "flex",
        gap: 10,
        alignItems: "center",
        flexWrap: "wrap",
      }}>
        <span style={{ fontSize: "0.6875rem", color: "var(--primary)", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Her Dosyada Beklenen Sütunlar</span>
        {["Öğrenci No", "Program", "Sınıf", "Danışman", "A.Tipi"].map(c => (
          <span key={c} style={{
            fontSize: "0.6875rem",
            color: "var(--on-surface-variant)",
            background: "var(--surface-container-high)",
            border: "1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)",
            borderRadius: 4,
            padding: "2px 7px",
          }}>{c}</span>
        ))}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
        onClick={() => ref.current?.click()}
        style={{
          border: `2px dashed ${drag ? "var(--primary)" : "color-mix(in srgb, var(--outline-variant) 60%, transparent)"}`,
          borderRadius: 12,
          padding: "32px 24px",
          textAlign: "center",
          cursor: "pointer",
          background: "var(--surface-container)",
          transition: "border-color 140ms ease-out",
        }}
      >
        <input ref={ref} type="file" accept=".xlsx" multiple style={{ display: "none" }} onChange={e => pick(e.target.files)} />
        <div style={{ fontSize: 28, marginBottom: 10, color: "var(--on-surface-variant)" }}>↑</div>
        <div style={{ color: "var(--on-surface)", fontSize: "0.875rem", fontWeight: 600, marginBottom: 4 }}>
          Dosyaları sürükleyip bırakın veya tıklayın
        </div>
        <div style={{ color: "var(--on-surface-variant)", fontSize: "0.75rem" }}>
          Ders kodu ile isimlendirilmiş XLSX dosyaları (örn: CENG113.xlsx) · Çoklu seçim desteklenir
        </div>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {files.map(f => (
            <div key={f.name} style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "7px 12px",
              background: "var(--surface-container-high)",
              borderRadius: 8,
              fontSize: "0.8125rem",
            }}>
              <span style={{ color: "var(--primary)", ...mono, fontWeight: 600 }}>{f.name}</span>
              <span style={{ color: "var(--on-surface-variant)", fontSize: "0.75rem", marginLeft: 12 }}>
                {(f.size / 1024).toFixed(1)} KB
                <button
                  onClick={e => { e.stopPropagation(); remove(f.name); }}
                  style={{ marginLeft: 10, background: "none", border: "none", color: "var(--status-danger)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}
                >×</button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <ActionButton disabled={!files.length || st === "uploading" || !term?.id} onClick={upload}>
          {!term?.id ? "Aktif dönem yok" : st === "uploading" ? <><Spinner size={13} /> Yükleniyor…</> : `↑  ${files.length} Dosya Yükle`}
        </ActionButton>
        {(files.length > 0 || st !== "idle") && (
          <ActionButton onClick={reset} variant="secondary">Temizle</ActionButton>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        {st === "error" && <ErrorBox msg={errMsg} />}
        {st === "success" && (
          <div style={{
            background: "color-mix(in srgb, var(--status-success) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--status-success) 30%, transparent)",
            borderRadius: 8,
            padding: "14px 16px",
          }}>
            <div style={{ color: "var(--status-success)", fontSize: "0.8125rem", fontWeight: 700, marginBottom: 8 }}>✓  Yükleme başarılı</div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {result && Object.entries(result).map(([k, v]) => (
                <div key={k} style={{ fontSize: "0.75rem" }}>
                  <span style={{ color: "var(--on-surface-variant)" }}>{k}: </span>
                  <span style={{ color: "var(--status-success)", fontWeight: 700 }}>{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Mode badge ──────────────────────────────────────────────────────────── */
function ModeBadge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: "0.625rem",
      fontWeight: 700,
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      padding: "3px 8px",
      borderRadius: 4,
      background: `color-mix(in srgb, ${color} 14%, transparent)`,
      color,
      border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
    }}>
      {label}
    </span>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
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
    } catch (e: unknown) {
      const err = e as { message?: string };
      setSimError(err.message || "Silme işlemi başarısız.");
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
    } catch (e: unknown) {
      const err = e as { message?: string };
      setSimError(err.message || "Simülasyon başarısız.");
    } finally {
      setSimulating(false);
    }
  };

  const selectStyle = {
    background: "var(--surface)",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "9px 12px",
    color: C.text,
    fontSize: 13,
    outline: "none",
    width: "100%",
  };

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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 32 }}>
        {/* Left: simulation */}
        <Card style={{ padding: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <SL style={{ margin: 0 }}>Öğrenci Simülasyon Motoru</SL>
            <ModeBadge label="Demo" color="var(--status-warning)" />
          </div>
          <p style={{ color: C.textMuted, fontSize: 14, margin: "0 0 24px", lineHeight: 1.7 }}>
            Gerçek öğrenci verisi olmadan sistemi test etmek için kullanın. Yüklediğiniz ders kontenjanlarına tamamen uygun, binlerce rastgele öğrenci kaydı algoritmik olarak üretilir ve aktif döneme atanır.
          </p>
          <p style={{ color: C.textMuted, fontSize: 13, margin: "0 0 24px", lineHeight: 1.7 }}>
            Simülasyon tamamlandığında öğrenci listesi CSV olarak indirilir. Gerçek veri yüklendiğinde bu kayıtları silebilirsiniz.
          </p>
          <ActionButton onClick={handleSimulate} disabled={simulating || noTerm}>
            {noTerm ? "Aktif dönem yok" : simulating ? <><Spinner size={13} /> Simüle ediliyor…</> : "Öğrenci Simülasyonu Başlat"}
          </ActionButton>
          {showSuccess && !simulating && (
            <div style={{ marginTop: 12, color: C.green, fontSize: 13, ...mono }}>
              ✓ Simülasyon tamamlandı.
            </div>
          )}
          {simError && (
            <div style={{ marginTop: 12, color: C.red, fontSize: 13, ...mono }}>{simError}</div>
          )}
        </Card>

        {/* Right: upload cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Production upload */}
          <Card style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <SL style={{ margin: 0 }}>Gerçek Kayıt Yükleme</SL>
              <ModeBadge label="Üretim" color="var(--status-success)" />
            </div>
            <p style={{ color: C.textMuted, fontSize: 12, margin: "0 0 16px", lineHeight: 1.6 }}>
              Üniversite kayıt sisteminden alınan XLSX dosyalarını yükleyin. Her dosya bir derse ait öğrenci listesini içermeli ve dosya adı ders kodunu taşımalıdır (örn: <span style={{ ...mono, color: C.cyan }}>CENG113.xlsx</span>). Birden fazla dosyayı aynı anda seçebilirsiniz.
            </p>
            <XlsxMultiUploader term={term} onSuccess={refetch} />
          </Card>

          {/* Demo CSV upload */}
          <Card style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <SL style={{ margin: 0 }}>Manuel CSV Yükleme</SL>
              <ModeBadge label="Demo" color="var(--status-warning)" />
            </div>
            <p style={{ color: C.textMuted, fontSize: 12, margin: "0 0 16px", lineHeight: 1.6 }}>
              Test ve geliştirme amaçlıdır. Öğrenci-ders eşleşmelerini tek bir CSV dosyasında toplu olarak yükleyin. Her satır bir öğrencinin bir derse kaydını temsil eder.
            </p>
            <CSVUploader
              title="Kayıt Listesi (CSV)"
              endpoint="/students/"
              templateCols={["Student Identifier", "Program Name", "Year Level", "Course Code", "Section Label"]}
              extraData={term ? { term_id: term.id } : undefined}
              onSuccess={refetch}
            />
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px 100px", gap: 16, alignItems: "end" }}>
          <div>
            <label style={{ display: "block", fontSize: 10, color: C.textMuted, marginBottom: 6, ...mono }}>BÖLÜM</label>
            <select
              value={deptFilter}
              onChange={e => { setDeptFilter(e.target.value); setConflictPage(1); }}
              style={selectStyle}
            >
              <option value="">Tümü</option>
              {deptList.map((d: { id: string; name: string }) => (
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
              style={selectStyle}
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
          {conflicts.map((c: {
            course_a_id: string; course_b_id: string;
            course_a_code: string; course_a_name: string;
            course_b_code: string; course_b_name: string;
            dept_a?: string; dept_b?: string;
            shared_students: number;
          }, i: number) => (
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
                  background: c.shared_students >= 20 ? C.redSoft : c.shared_students >= 10 ? C.amberSoft : C.cyanSoft,
                  color: c.shared_students >= 20 ? C.red : c.shared_students >= 10 ? C.amber : C.cyan,
                }}>
                  {c.shared_students}
                </span>
              </DataCell>
            </DataRow>
          ))}
        </DataTable>

        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
            <ActionButton onClick={() => setConflictPage(p => p - 1)} disabled={conflictPage <= 1} variant="secondary">
              ← Önceki
            </ActionButton>
            <span style={{ fontSize: 12, color: C.textMuted, ...mono }}>
              SAYFA {conflictPage} / {totalPages}
            </span>
            <ActionButton onClick={() => setConflictPage(p => p + 1)} disabled={conflictPage >= totalPages} variant="secondary">
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
