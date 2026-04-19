"use client";
import React from "react";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, SL, CSVUploader, Spinner, InfoBox, Badge, PageContainer, PageHeader, DataTable, DataRow, DataCell, ActionButton } from "@/components/ui";

export default function CoursesPage() {
  const [page, setPage] = React.useState(1);
  const [filters, setFilters] = React.useState({
    dept: "Tümü",
    year: "Tümü",
    type: "Tümü",
    search: ""
  });

  const queryParams = new URLSearchParams();
  queryParams.set("page", page.toString());
  if (filters.dept !== "Tümü") queryParams.set("dept", filters.dept);
  if (filters.year !== "Tümü") queryParams.set("year", filters.year);
  if (filters.type !== "Tümü") queryParams.set("type", filters.type);
  if (filters.search) queryParams.set("search", filters.search);

  const { data: termData } = useFetch("/terms/?status=Active");
  const term = termData?.results?.[0] || termData?.[0];

  const { data: depts } = useFetch("/academic-units/");
  const deptList = depts?.results || depts || [];

  const { data, loading, refetch } = useFetch(`/courses/?${queryParams.toString()}`);
  const rows = data?.results || data || [];

  const selectStyle = { width: "100%", background: "#0d0e1a", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px", color: C.text, fontSize: 13, outline: "none" };



  return (
    <PageContainer style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <PageHeader
        title="Ders Kataloğu"
        subtitle="Sistemdeki tüm derslerin listesi ve yükleme araçları."
        actions={null}
      />

      <Card style={{ padding: "16px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 140px 1fr", gap: 20, alignItems: "end" }}>
          <div>
            <label style={{ display: "block", fontSize: 10, color: C.textMuted, marginBottom: 8, ...mono }}>BÖLÜM</label>
            <select value={filters.dept} onChange={e => { setFilters({ ...filters, dept: e.target.value }); setPage(1); }} style={selectStyle}>
              <option value="Tümü">Tümü</option>
              {deptList.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 10, color: C.textMuted, marginBottom: 8, ...mono }}>YIL</label>
            <select value={filters.year} onChange={e => { setFilters({ ...filters, year: e.target.value }); setPage(1); }} style={selectStyle}>
              <option value="Tümü">Tümü</option>
              {[1, 2, 3, 4].map(y => <option key={y} value={y}>{y}. Sınıf</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 10, color: C.textMuted, marginBottom: 8, ...mono }}>TÜR</label>
            <select value={filters.type} onChange={e => { setFilters({ ...filters, type: e.target.value }); setPage(1); }} style={selectStyle}>
              <option value="Tümü">Tümü</option>
              <option value="COMPULSORY">Zorunlu</option>
              <option value="ELECTIVE">Seçmeli</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 10, color: C.textMuted, marginBottom: 8, ...mono }}>ARAMA</label>
            <input placeholder="Ders adı..." value={filters.search} onChange={e => { setFilters({ ...filters, search: e.target.value }); setPage(1); }} style={selectStyle} />
          </div>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <DataTable headers={["Ders Kodu", "Ders Adı", "Sınıf", "Tür", ""]}>
            {loading && <DataRow><DataCell colSpan={6} style={{ textAlign: "center", padding: 40 }}><Spinner size={20} /></DataCell></DataRow>}
            {!loading && rows.length === 0 && <DataRow><DataCell colSpan={6}><InfoBox msg="Uygun ders bulunamadı." /></DataCell></DataRow>}
            {rows.map((row: any) => (
              <DataRow key={row.id}>
                <DataCell style={{ color: C.cyan, ...mono, fontWeight: 600 }}>{row.code}</DataCell>
                <DataCell>{row.name}</DataCell>
                <DataCell style={{ color: C.textSub, fontSize: 12 }}>{row.year_level ? `${row.year_level}. Sınıf` : "—"}</DataCell>
                <DataCell>
                  <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: row.requirement === "COMPULSORY" ? "#1a2421" : "#1a1b2e", color: row.requirement === "COMPULSORY" ? "#52c41a" : C.accent }}>
                    {row.requirement === "COMPULSORY" ? "ZORUNLU" : "SEÇMELİ"}
                  </span>
                </DataCell>
                {/* <DataCell style={{ ...mono, color: C.textSub }}>{row.default_credits || "3.0"}</DataCell> */}
                <DataCell style={{ textAlign: "right", color: C.textMuted }}>⋮</DataCell>
              </DataRow>
            ))}
          </DataTable>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
            <ActionButton onClick={() => setPage(p => p - 1)} disabled={!data?.previous} variant="secondary">← Önceki</ActionButton>
            <span style={{ fontSize: 12, color: C.textMuted, ...mono }}>SAYFA {page}</span>
            <ActionButton onClick={() => setPage(p => p + 1)} disabled={!data?.next} variant="secondary">Sonraki →</ActionButton>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card style={{ padding: 24 }}>
            <SL>CSV VERİ YÜKLEME</SL>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
              <CSVUploader
                title="Ders Listesi (CSV)"
                endpoint="/courses/upload/"
                templateCols={["Course Name", "Capacity", "Program", "Instructor", "Mandatory", "Year", "T-hours"]}
                extraData={term ? { term_id: term.id } : undefined}
                onSuccess={refetch}
              />
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                <CSVUploader
                  title="Tahmini Bölüm Kontenjanları (Geçmiş Yıl - CSV)"
                  endpoint="/academic-units/update-estimates/"
                  templateCols={["Ders Kodu", "Ders Adı", "Sınıf", "Kon", "Program"]}
                  onSuccess={refetch}
                />
              </div>
            </div>
          </Card>

          <Card style={{ padding: 24, background: "#0a0b14", color: C.textMuted, fontSize: 12, lineHeight: 1.6 }}>
            <SL>YARDIM</SL>
            Ders kataloğu aktif döneme göre filtrelenmiştir. Filtreleri kullanarak spesifik bölümlerin derslerini inceleyebilir veya yeni dersleri CSV üzerinden topluca yükleyebilirsiniz.
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
