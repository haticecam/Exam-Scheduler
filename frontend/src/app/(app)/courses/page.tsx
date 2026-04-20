"use client";
import React, { useState } from "react";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, SL, CSVUploader, Spinner, InfoBox, PageContainer, PageHeader, DataTable, DataRow, DataCell, ActionButton } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const REQUIREMENT_OPTIONS = [
  { value: "COMPULSORY", label: "Zorunlu" },
  { value: "ELECTIVE", label: "Seçmeli" },
];

export default function CoursesPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ dept: "Tümü", year: "Tümü", type: "Tümü", search: "" });

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

  // Edit dialog state
  const [editCourse, setEditCourse] = useState<any>(null);
  const [editForm, setEditForm] = useState({ code: "", name: "", year_level: "", requirement: "", weekly_hours_lecture: "", weekly_hours_lab: "", default_credits: "" });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");

  const openEdit = (course: any) => {
    setEditCourse(course);
    setEditForm({
      code: course.code ?? "",
      name: course.name ?? "",
      year_level: course.year_level != null ? String(course.year_level) : "",
      requirement: course.requirement ?? "COMPULSORY",
      weekly_hours_lecture: course.weekly_hours_lecture != null ? String(course.weekly_hours_lecture) : "",
      weekly_hours_lab: course.weekly_hours_lab != null ? String(course.weekly_hours_lab) : "",
      default_credits: course.default_credits != null ? String(course.default_credits) : "",
    });
    setEditError("");
  };

  const handleEdit = async () => {
    if (!editCourse) return;
    setEditLoading(true);
    setEditError("");
    try {
      const payload: Record<string, any> = {
        code: editForm.code,
        name: editForm.name,
        requirement: editForm.requirement || null,
      };
      if (editForm.year_level !== "") payload.year_level = parseInt(editForm.year_level);
      if (editForm.weekly_hours_lecture !== "") payload.weekly_hours_lecture = parseInt(editForm.weekly_hours_lecture);
      if (editForm.weekly_hours_lab !== "") payload.weekly_hours_lab = parseInt(editForm.weekly_hours_lab);
      if (editForm.default_credits !== "") payload.default_credits = parseFloat(editForm.default_credits);

      await api.patch(`/courses/${editCourse.id}/`, payload);
      refetch();
      setEditCourse(null);
    } catch (err: any) {
      setEditError(err.data ? Object.values(err.data).flat().join(" ") : err.message || "Güncelleme başarısız.");
    } finally {
      setEditLoading(false);
    }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEditForm(f => ({ ...f, [field]: e.target.value }));

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
            {loading && <DataRow><DataCell colSpan={5} style={{ textAlign: "center", padding: 40 }}><Spinner size={20} /></DataCell></DataRow>}
            {!loading && rows.length === 0 && <DataRow><DataCell colSpan={5}><InfoBox msg="Uygun ders bulunamadı." /></DataCell></DataRow>}
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
                <DataCell style={{ textAlign: "right" }}>
                  <ActionButton variant="secondary" onClick={() => openEdit(row)}>Düzenle</ActionButton>
                </DataCell>
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

      {/* Edit dialog */}
      <Dialog open={!!editCourse} onOpenChange={open => { if (!open) setEditCourse(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dersi Düzenle</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="e-code">Ders Kodu</Label>
                <Input id="e-code" value={editForm.code} onChange={set("code")} autoFocus />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="e-year">Sınıf (1–4)</Label>
                <Input id="e-year" type="number" min={1} max={4} value={editForm.year_level} onChange={set("year_level")} placeholder="—" />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="e-name">Ders Adı</Label>
              <Input id="e-name" value={editForm.name} onChange={set("name")} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="e-req">Tür</Label>
              <select
                id="e-req"
                value={editForm.requirement}
                onChange={set("requirement")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {REQUIREMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="e-lec">Teorik Saat</Label>
                <Input id="e-lec" type="number" min={0} value={editForm.weekly_hours_lecture} onChange={set("weekly_hours_lecture")} placeholder="—" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="e-lab">Lab Saat</Label>
                <Input id="e-lab" type="number" min={0} value={editForm.weekly_hours_lab} onChange={set("weekly_hours_lab")} placeholder="—" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="e-cred">Kredi</Label>
                <Input id="e-cred" type="number" min={0} step={0.5} value={editForm.default_credits} onChange={set("default_credits")} placeholder="—" />
              </div>
            </div>

            {editError && <p className="text-sm text-destructive">{editError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCourse(null)} disabled={editLoading}>İptal</Button>
            <Button onClick={handleEdit} disabled={editLoading || !editForm.code || !editForm.name}>
              {editLoading ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
