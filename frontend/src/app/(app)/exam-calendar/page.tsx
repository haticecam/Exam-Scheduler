"use client";
import React, { useState, useCallback } from "react";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, SL, Spinner, ErrorBox, DataTable, DataRow, DataCell, ActionButton, InfoBox } from "@/components/ui";
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
import SimultaneousExamsTab from "./SimultaneousExamsTab";

type ExamPeriod = {
  id: string;
  term: string;
  name: string;
  exam_type: string;
  start_date: string;
  end_date: string;
  slot_count: number;
  blocked_count: number;
};

type ExamDateSlot = {
  id: string;
  exam_period: string;
  date: string;
  start_time: string;
  end_time: string;
  label: string;
  is_blocked: boolean;
};

const EXAM_TYPES = ["MIDTERM", "FINAL", "MAKEUP", "QUIZ", "OTHER"];

const REQUIREMENT_OPTIONS = [
  { value: "COMPULSORY", label: "Zorunlu" },
  { value: "ELECTIVE", label: "Seçmeli" },
];

const iStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: "9px 12px",
  color: C.text,
  ...mono,
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
};
const lStyle: React.CSSProperties = {
  fontSize: 11,
  color: C.textMuted,
  ...mono,
  letterSpacing: "0.06em",
  display: "block",
  marginBottom: 6,
};

export default function ExamCalendarPage() {
  const [activeTab, setActiveTab] = useState<"calendar" | "optimization" | "simultaneous">("calendar");

  /* ── Shared: terms list ─────────────────────────────────────────────────── */
  const { data: termsData } = useFetch("/terms/");
  const terms: any[] = termsData?.results || termsData || [];

  /* ── Calendar tab state ─────────────────────────────────────────────────── */
  const [selectedTermId, setSelectedTermId] = useState("");
  const { data: periodsData, refetch: refetchPeriods } = useFetch(
    selectedTermId ? `/exam-periods/?term_id=${selectedTermId}` : "",
    [selectedTermId]
  );
  const periods: ExamPeriod[] = periodsData || [];

  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const { data: slotsData, refetch: refetchSlots } = useFetch(
    selectedPeriodId ? `/exam-periods/${selectedPeriodId}/slots/` : "",
    [selectedPeriodId]
  );

  const [localSlots, setLocalSlots] = useState<ExamDateSlot[]>([]);
  const [slotsLoaded, setSlotsLoaded] = useState(false);

  React.useEffect(() => {
    if (slotsData) {
      setLocalSlots(slotsData);
      setSlotsLoaded(true);
    }
  }, [slotsData]);

  const [form, setForm] = useState({
    name: "", exam_type: "FINAL", start_date: "", end_date: "",
  });
  const [createErr, setCreateErr] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  const [editPeriod, setEditPeriod] = useState<ExamPeriod | null>(null);
  const [editPeriodForm, setEditPeriodForm] = useState({ name: "", exam_type: "FINAL", start_date: "", end_date: "" });
  const [editPeriodLoading, setEditPeriodLoading] = useState(false);
  const [editPeriodError, setEditPeriodError] = useState("");

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const createPeriod = async () => {
    if (!selectedTermId) { setCreateErr("Dönem seçin."); return; }
    setCreateLoading(true); setCreateErr("");
    try {
      const res = await api.post("/exam-periods/", {
        term: selectedTermId, ...form,
      });
      setSelectedPeriodId(res.id);
      refetchPeriods();
    } catch (e: unknown) {
      const err = e as { data?: { detail?: string }; message?: string };
      setCreateErr(err.data?.detail || JSON.stringify((e as { data?: unknown }).data) || err.message || "Hata");
    } finally {
      setCreateLoading(false);
    }
  };

  const openEditPeriod = (period: ExamPeriod) => {
    setEditPeriod(period);
    setEditPeriodForm({ name: period.name, exam_type: period.exam_type, start_date: period.start_date, end_date: period.end_date });
    setEditPeriodError("");
  };

  const handleEditPeriod = async () => {
    if (!editPeriod) return;
    const datesChanged =
      editPeriodForm.start_date !== editPeriod.start_date ||
      editPeriodForm.end_date !== editPeriod.end_date;
    const shouldRegenerateSlots =
      datesChanged &&
      editPeriod.id === selectedPeriodId &&
      slotsLoaded &&
      localSlots.length > 0;

    setEditPeriodLoading(true); setEditPeriodError("");
    try {
      await api.patch(`/exam-periods/${editPeriod.id}/`, editPeriodForm);
      refetchPeriods();
      setEditPeriod(null);
      if (shouldRegenerateSlots) {
        setSlotsLoaded(false);
        const body = genMode === "auto"
          ? { day_start: genFields.day_start, day_end: genFields.day_end }
          : { day_start: genFields.day_start, day_end: genFields.day_end, slot_duration_minutes: genFields.slot_duration_minutes };
        await api.post(`/exam-periods/${editPeriod.id}/generate-slots/`, body);
        refetchSlots();
      }
    } catch (e: unknown) {
      const err = e as { data?: { detail?: string }; message?: string };
      setEditPeriodError(err.data?.detail || JSON.stringify((e as { data?: unknown }).data) || err.message || "Hata");
    } finally {
      setEditPeriodLoading(false);
    }
  };

  const handleDeletePeriod = async (id: string) => {
    setDeleteLoading(true); setDeleteError("");
    try {
      await api.delete(`/exam-periods/${id}/`);
      if (selectedPeriodId === id) { setSelectedPeriodId(""); setSlotsLoaded(false); setLocalSlots([]); }
      setDeleteConfirmId(null);
      refetchPeriods();
    } catch (e: unknown) {
      const err = e as { data?: { detail?: string }; message?: string };
      setDeleteError(err.data?.detail || err.message || "Silme başarısız.");
    } finally {
      setDeleteLoading(false);
    }
  };

  const [genMode, setGenMode] = useState<"auto" | "custom">("auto");
  const [genFields, setGenFields] = useState({ day_start: "08:30", day_end: "18:00", slot_duration_minutes: 90 });
  const [genLoading, setGenLoading] = useState(false);
  const [genErr, setGenErr] = useState("");

  const generateSlots = async () => {
    if (!selectedPeriodId) return;
    setGenLoading(true); setGenErr(""); setSlotsLoaded(false);
    const body = genMode === "auto"
      ? { day_start: genFields.day_start, day_end: genFields.day_end }
      : { day_start: genFields.day_start, day_end: genFields.day_end, slot_duration_minutes: genFields.slot_duration_minutes };
    try {
      await api.post(`/exam-periods/${selectedPeriodId}/generate-slots/`, body);
      refetchSlots();
    } catch (e: unknown) {
      const err = e as { data?: { detail?: string }; message?: string };
      setGenErr(err.data?.detail || JSON.stringify((e as { data?: unknown }).data) || err.message || "Hata");
    } finally {
      setGenLoading(false);
    }
  };

  const toggleSlot = useCallback(async (slot: ExamDateSlot) => {
    const newBlocked = !slot.is_blocked;
    setLocalSlots(prev =>
      prev.map(s => s.id === slot.id ? { ...s, is_blocked: newBlocked } : s)
    );
    try {
      await api.patch(`/exam-date-slots/${slot.id}/`, { is_blocked: newBlocked });
    } catch {
      setLocalSlots(prev =>
        prev.map(s => s.id === slot.id ? { ...s, is_blocked: slot.is_blocked } : s)
      );
    }
  }, []);

  const toggleDay = async (date: string, blocked: boolean) => {
    setLocalSlots(prev =>
      prev.map(s => s.date === date ? { ...s, is_blocked: blocked } : s)
    );
    try {
      await api.post(`/exam-periods/${selectedPeriodId}/toggle-day/`, { date, blocked });
    } catch {
      refetchSlots();
    }
  };

  const dates = Array.from(new Set(localSlots.map(s => s.date))).sort();
  const times = Array.from(new Set(localSlots.map(s => s.start_time))).sort();

  const slotMap: Record<string, ExamDateSlot> = {};
  localSlots.forEach(s => { slotMap[`${s.date}|${s.start_time}`] = s; });

  const dayBlocked = (date: string) =>
    localSlots.filter(s => s.date === date).every(s => s.is_blocked);

  const weekdayLabel = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"][d.getDay()];
  };

  const selectedPeriod = periods.find(p => p.id === selectedPeriodId);

  /* ── Optimization tab state ─────────────────────────────────────────────── */
  const [optTermId, setOptTermId] = useState("");
  const [optPeriodId, setOptPeriodId] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  React.useEffect(() => {
    if (terms.length > 0 && !optTermId) {
      const active = terms.find((t: any) => t.status === "Active") || terms[0];
      if (active) setOptTermId(String(active.id));
    }
  }, [terms.length]);

  const { data: optPeriodsData, refetch: refetchOptPeriods } = useFetch(
    optTermId ? `/exam-periods/?term_id=${optTermId}` : ""
  );
  const optPeriods: any[] = optPeriodsData?.results || optPeriodsData || [];

  React.useEffect(() => {
    setOptPeriodId("");
  }, [optTermId]);

  const { data: sectionsData, loading: sectionsLoading, refetch: refetchSections } = useFetch(
    optTermId && optPeriodId
      ? `/course-sections/?term_id=${optTermId}&exam_period_id=${optPeriodId}&include_empty=true`
      : ""
  );
  const sections: any[] = sectionsData?.results || sectionsData || [];

  const [toggleError, setToggleError] = useState<string | null>(null);

  const toggleExclusion = async (section: any) => {
    if (!optPeriodId) return;
    setTogglingId(section.id);
    setToggleError(null);
    try {
      await api.post(`/exam-periods/${optPeriodId}/toggle-exclusion/`, {
        section_id: section.id,
      });
      refetchSections();
    } catch (err: any) {
      setToggleError(err.message || "Hariç tutma değiştirilemedi.");
    }
    setTogglingId(null);
  };

  const [editCourse, setEditCourse] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    code: "", name: "", year_level: "", requirement: "",
    weekly_hours_lecture: "", weekly_hours_lab: "", default_credits: "",
    exam_duration_minutes: "",
  });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");

  const openEdit = (sec: any) => {
    const courseId = sec.course_id ?? sec.id;
    setEditCourse({ ...sec, id: courseId });
    setEditForm({
      code: sec.course_code ?? sec.code ?? "",
      name: sec.course_name ?? sec.name ?? "",
      year_level: sec.year_level != null ? String(sec.year_level) : "",
      requirement: sec.requirement ?? "COMPULSORY",
      weekly_hours_lecture: sec.weekly_hours_lecture != null ? String(sec.weekly_hours_lecture) : "",
      weekly_hours_lab: sec.weekly_hours_lab != null ? String(sec.weekly_hours_lab) : "",
      default_credits: sec.default_credits != null ? String(sec.default_credits) : "",
      exam_duration_minutes: sec.exam_duration_minutes != null ? String(sec.exam_duration_minutes) : "",
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
      payload.exam_duration_minutes =
        editForm.exam_duration_minutes !== "" ? parseInt(editForm.exam_duration_minutes) : null;

      await api.patch(`/courses/${editCourse.id}/`, payload);
      refetchSections();
      setEditCourse(null);
    } catch (err: any) {
      setEditError(err.data ? Object.values(err.data).flat().join(" ") : err.message || "Güncelleme başarısız.");
    } finally {
      setEditLoading(false);
    }
  };

  const setField = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEditForm(f => ({ ...f, [field]: e.target.value }));

  const optSelectStyle = { width: "100%", background: "var(--surface)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px", color: C.text, fontSize: 13, outline: "none" };

  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 700, color: C.text, margin: "0 0 6px", ...mono }}>
        Sınav Takvimi
      </h2>
      <p style={{ color: C.textMuted, fontSize: 14, marginBottom: 20 }}>
        Sınav haftasını seçin, zaman dilimlerini ve engellenen günleri yönetin.
      </p>

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 24 }}>
        {(["calendar", "optimization", "simultaneous"] as const).map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => { setActiveTab(tab); if (tab === "optimization") refetchOptPeriods(); }}
            style={{
              background: "transparent",
              border: "none",
              borderBottom: activeTab === tab ? `2px solid ${C.accent}` : "2px solid transparent",
              color: activeTab === tab ? C.text : C.textMuted,
              padding: "10px 16px",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: activeTab === tab ? 700 : 400,
              ...mono,
              marginBottom: -1,
            }}
          >
            {tab === "calendar" ? "Sınav Takvimi" : tab === "optimization" ? "Ders Seçimi" : "Eş zamanlı sınavlar"}
          </button>
        ))}
      </div>

      {/* ── Calendar tab ──────────────────────────────────────────────────── */}
      {activeTab === "calendar" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
            <Card style={{ padding: 24 }}>
              <SL>DÖNEM & TAKVİM SEÇİMİ</SL>
              <div style={{ marginBottom: 14 }}>
                <label style={lStyle}>AKTİF DÖNEM</label>
                <select style={{ ...iStyle, cursor: "pointer" }} value={selectedTermId}
                  onChange={e => { setSelectedTermId(e.target.value); setSelectedPeriodId(""); setSlotsLoaded(false); }}>
                  <option value="">— Dönem seçin —</option>
                  {terms.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              {periods.length > 0 && (
                <div>
                  <label style={lStyle}>MEVCUT SINAV TAKVİMİ</label>
                  <select style={{ ...iStyle, cursor: "pointer" }} value={selectedPeriodId}
                    onChange={e => { setSelectedPeriodId(e.target.value); setSlotsLoaded(false); setDeleteConfirmId(null); setDeleteError(""); }}>
                    <option value="">— Takvim seçin —</option>
                    {periods.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.start_date} → {p.end_date})
                      </option>
                    ))}
                  </select>
                  {selectedPeriod && (
                    <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => openEditPeriod(selectedPeriod)}
                        style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", color: C.text, ...mono, fontSize: 12 }}
                      >
                        Düzenle
                      </button>
                      {deleteConfirmId === selectedPeriod.id ? (
                        <>
                          <button
                            type="button"
                            disabled={deleteLoading}
                            onClick={() => handleDeletePeriod(selectedPeriod.id)}
                            style={{ background: C.red, border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", color: "#fff", ...mono, fontSize: 12, fontWeight: 700, opacity: deleteLoading ? 0.6 : 1 }}
                          >
                            {deleteLoading ? "Siliniyor…" : "Evet, Sil"}
                          </button>
                          <button
                            type="button"
                            disabled={deleteLoading}
                            onClick={() => { setDeleteConfirmId(null); setDeleteError(""); }}
                            style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", color: C.textMuted, ...mono, fontSize: 12 }}
                          >
                            İptal
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setDeleteConfirmId(selectedPeriod.id); setDeleteError(""); }}
                          style={{ background: "transparent", border: `1px solid ${C.red}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", color: C.red, ...mono, fontSize: 12 }}
                        >
                          Sil
                        </button>
                      )}
                      {deleteError && <span style={{ fontSize: 11, color: C.red }}>{deleteError}</span>}
                    </div>
                  )}
                </div>
              )}
            </Card>

            <Card style={{ padding: 24 }}>
              <SL>YENİ TAKVİM OLUŞTUR</SL>
              <div style={{ marginBottom: 10 }}>
                <label style={lStyle}>TAKVİM ADI</label>
                <input style={iStyle} value={form.name} placeholder="Örn: Güz 2025 Final"
                  onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={lStyle}>TÜR</label>
                  <select style={{ ...iStyle, cursor: "pointer" }} value={form.exam_type}
                    onChange={e => setForm({ ...form, exam_type: e.target.value })}>
                    {EXAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lStyle}>BAŞLANGIÇ TARİHİ</label>
                  <input style={iStyle} type="date" value={form.start_date}
                    onChange={e => setForm({ ...form, start_date: e.target.value })} />
                </div>
                <div>
                  <label style={lStyle}>BİTİŞ TARİHİ</label>
                  <input style={iStyle} type="date" value={form.end_date}
                    onChange={e => setForm({ ...form, end_date: e.target.value })} />
                </div>
              </div>
              {createErr && <ErrorBox msg={createErr} />}
              <button type="button" onClick={createPeriod}
                disabled={createLoading || !form.name || !form.start_date || !form.end_date}
                style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", cursor: "pointer", ...mono, fontSize: 13, fontWeight: 700, opacity: createLoading ? 0.6 : 1 }}>
                {createLoading ? "Oluşturuluyor…" : "+ Takvim Oluştur"}
              </button>
            </Card>
          </div>

          {selectedPeriodId && (
            <Card style={{ padding: 20, marginBottom: 20 }}>
              <SL>SLOT OLUŞTUR</SL>
              <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 14 }}>
                Mevcut slotları siler ve yeniden oluşturur.
              </p>

              <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                {(["auto", "custom"] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setGenMode(m)}
                    style={{
                      padding: "7px 16px",
                      borderRadius: 6,
                      border: `1px solid ${genMode === m ? C.accent : C.border}`,
                      background: genMode === m ? `color-mix(in srgb, ${C.accent} 10%, transparent)` : "transparent",
                      color: genMode === m ? C.accent : C.textMuted,
                      cursor: "pointer",
                      ...mono,
                      fontSize: 12,
                      fontWeight: genMode === m ? 700 : 400,
                    }}
                  >
                    {m === "auto" ? "Otomatik 30dk" : "Özel Süre"}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                <div>
                  <label style={lStyle}>GÜN BAŞLANGICI</label>
                  <input style={{ ...iStyle, width: 110 }} type="time" value={genFields.day_start}
                    onChange={e => setGenFields({ ...genFields, day_start: e.target.value })} />
                </div>
                <div>
                  <label style={lStyle}>GÜN BİTİŞİ</label>
                  <input style={{ ...iStyle, width: 110 }} type="time" value={genFields.day_end}
                    onChange={e => setGenFields({ ...genFields, day_end: e.target.value })} />
                </div>
                {genMode === "custom" && (
                  <div>
                    <label style={lStyle}>SLOT SÜRESİ (DAKİKA)</label>
                    <input
                      style={{ ...iStyle, width: 110 }}
                      type="number"
                      min={15}
                      max={480}
                      step={15}
                      value={genFields.slot_duration_minutes}
                      onChange={e => setGenFields({ ...genFields, slot_duration_minutes: Number(e.target.value) })}
                    />
                  </div>
                )}
              </div>

              <div style={{ marginTop: 16 }}>
                <button type="button" onClick={generateSlots} disabled={genLoading}
                  style={{ background: C.green, color: "#000", border: "none", borderRadius: 8, padding: "10px 20px", cursor: "pointer", ...mono, fontSize: 13, fontWeight: 700, opacity: genLoading ? 0.6 : 1, display: "flex", alignItems: "center", gap: 8 }}>
                  {genLoading ? <><Spinner size={13} /> Oluşturuluyor…</> : "Slotları Oluştur"}
                </button>
              </div>
              {genErr && <div style={{ marginTop: 10 }}><ErrorBox msg={genErr} /></div>}
            </Card>
          )}

          {slotsLoaded && localSlots.length > 0 && (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
                <SL>TAKVİM — {selectedPeriod?.name}</SL>
                <p style={{ fontSize: 11, color: C.textMuted, margin: 0 }}>
                  Engellenmemiş: {localSlots.filter(s => !s.is_blocked).length} slot &nbsp;·&nbsp;
                  Engellendi: {localSlots.filter(s => s.is_blocked).length} slot &nbsp;·&nbsp;
                  Tıklayarak tek slot veya başlık butonu ile tüm günü engelleyin.
                </p>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ position: "sticky", left: 0, background: "var(--surface)", zIndex: 2, padding: "10px 14px", borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, ...mono, fontSize: 10, color: C.textMuted, fontWeight: 600, whiteSpace: "nowrap", textAlign: "left" }}>
                        SAAT
                      </th>
                      {dates.map(date => {
                        const blocked = dayBlocked(date);
                        return (
                          <th key={date} style={{ padding: "8px 10px", borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, background: blocked ? `color-mix(in srgb, ${C.red} 8%, var(--surface))` : "var(--surface)", minWidth: 100, textAlign: "center" }}>
                            <div style={{ ...mono, fontSize: 11, color: C.text, fontWeight: 700 }}>
                              {weekdayLabel(date)}
                            </div>
                            <div style={{ ...mono, fontSize: 10, color: C.textMuted, marginBottom: 6 }}>
                              {date.slice(5)}
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleDay(date, !blocked)}
                              style={{
                                background: blocked ? C.red : C.border,
                                color: blocked ? "#fff" : C.textMuted,
                                border: "none",
                                borderRadius: 4,
                                padding: "3px 8px",
                                cursor: "pointer",
                                ...mono,
                                fontSize: 9,
                                fontWeight: 700,
                                letterSpacing: "0.04em",
                              }}
                            >
                              {blocked ? "ENGEL KALDIR" : "ENGELLE"}
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {times.map((time, rowIdx) => (
                      <tr key={time} style={{ background: rowIdx % 2 === 0 ? "transparent" : "color-mix(in srgb, var(--surface) 50%, transparent)" }}>
                        <td style={{ position: "sticky", left: 0, background: "var(--surface)", zIndex: 1, padding: "6px 14px", borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, ...mono, fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}>
                          {time}
                        </td>
                        {dates.map(date => {
                          const slot = slotMap[`${date}|${time}`];
                          if (!slot) {
                            return <td key={date} style={{ borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }} />;
                          }
                          return (
                            <td
                              key={date}
                              onClick={() => toggleSlot(slot)}
                              style={{
                                borderBottom: `1px solid ${C.border}`,
                                borderRight: `1px solid ${C.border}`,
                                background: slot.is_blocked
                                  ? `color-mix(in srgb, ${C.red} 18%, transparent)`
                                  : `color-mix(in srgb, ${C.green} 12%, transparent)`,
                                cursor: "pointer",
                                padding: "6px 10px",
                                textAlign: "center",
                                transition: "background 120ms ease-out",
                                userSelect: "none",
                              }}
                              title={slot.is_blocked ? "Engellendi — tıkla kaldır" : "Müsait — tıkla engelle"}
                            >
                              <span style={{ fontSize: 14 }}>
                                {slot.is_blocked ? "✕" : "✓"}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {selectedPeriodId && slotsLoaded && localSlots.length === 0 && (
            <Card style={{ padding: "32px 24px", textAlign: "center" }}>
              <p style={{ color: C.textMuted, fontSize: 14 }}>
                Bu takvim için henüz slot oluşturulmadı. Yukarıdan &quot;Slotları Oluştur&quot;u kullanın.
              </p>
            </Card>
          )}
        </>
      )}

      {/* ── Shared selector: Optimization + Simultaneous tabs ─────────────── */}
      {(activeTab === "optimization" || activeTab === "simultaneous") && (
        <Card style={{ padding: "16px 24px", marginBottom: 0 }}>
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ flex: 1, maxWidth: 320 }}>
              <label style={{ display: "block", fontSize: 10, color: C.textMuted, marginBottom: 8, ...mono }}>
                DÖNEM
              </label>
              <select
                value={optTermId}
                onChange={e => setOptTermId(e.target.value)}
                style={optSelectStyle}
              >
                <option value="">— Dönem seçin —</option>
                {terms.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, maxWidth: 320 }}>
              <label style={{ display: "block", fontSize: 10, color: C.textMuted, marginBottom: 8, ...mono }}>
                SINAV TAKVİMİ
              </label>
              <select
                value={optPeriodId}
                onChange={e => setOptPeriodId(e.target.value)}
                style={{ ...optSelectStyle, opacity: optPeriods.length === 0 ? 0.5 : 1 }}
                disabled={!optTermId || optPeriods.length === 0}
              >
                <option value="">— Takvim seçin —</option>
                {optPeriods.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
        </Card>
      )}

      {/* ── Optimization tab ──────────────────────────────────────────────── */}
      {activeTab === "optimization" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {toggleError && (
            <p style={{ color: "red", fontSize: 12, margin: "0 0 8px" }}>{toggleError}</p>
          )}
          <DataTable headers={["Ders Kodu", "Ders Adı", "Sınıf", "Bölüm", "Sınav Süresi", "Hariç Tut", ""]}>
            {sectionsLoading && (
              <DataRow>
                <DataCell colSpan={7} style={{ textAlign: "center", padding: 40 }}>
                  <Spinner size={20} />
                </DataCell>
              </DataRow>
            )}
            {!sectionsLoading && !optTermId && (
              <DataRow>
                <DataCell colSpan={7}>
                  <InfoBox msg="Lütfen bir dönem seçin." />
                </DataCell>
              </DataRow>
            )}
            {!sectionsLoading && optTermId && !optPeriodId && (
              <DataRow>
                <DataCell colSpan={7}>
                  <InfoBox msg="Hariç tutma ayarları sınav takvimine özgüdür. Lütfen bir sınav takvimi seçin." />
                </DataCell>
              </DataRow>
            )}
            {!sectionsLoading && optTermId && optPeriodId && sections.length === 0 && (
              <DataRow>
                <DataCell colSpan={7}>
                  <InfoBox msg="Bu dönemde kayıtlı öğrencisi olan ders bulunamadı." />
                </DataCell>
              </DataRow>
            )}
            {sections.map((sec: any) => {
              const effSlots = sec.exam_duration_minutes ? Math.ceil(sec.exam_duration_minutes / 30) : null;
              const effMins = effSlots ? effSlots * 30 : null;
              const isRounded = effMins !== null && effMins !== sec.exam_duration_minutes;
              return (
                <DataRow
                  key={sec.id}
                  style={{ opacity: sec.excluded_from_optimization ? 0.4 : 1, transition: "opacity 150ms" }}
                >
                  <DataCell style={{ color: C.cyan, ...mono, fontWeight: 600 }}>{sec.course_code}</DataCell>
                  <DataCell>{sec.course_name}</DataCell>
                  <DataCell style={{ color: C.textSub, fontSize: 12 }}>
                    {sec.year_level ? `${sec.year_level}. Sınıf` : "—"}
                  </DataCell>
                  <DataCell style={{ fontSize: 12, color: C.textSub }}>{sec.academic_unit_name ?? "—"}</DataCell>
                  <DataCell style={{ fontSize: 12 }}>
                    {sec.exam_duration_minutes != null ? (
                      <span style={{ ...mono }}>
                        {isRounded
                          ? <span>{sec.exam_duration_minutes} dk <span style={{ color: C.textMuted }}>→ {effMins} dk</span></span>
                          : <span>{sec.exam_duration_minutes} dk</span>
                        }
                      </span>
                    ) : (
                      <span style={{ color: C.textMuted, fontSize: 11 }}>
                        {(() => {
                          const h = sec.weekly_hours_lecture;
                          if (h != null) {
                            const auto = h >= 4 ? 180 : h === 3 ? 120 : 60;
                            return `Otomatik (${auto} dk)`;
                          }
                          return "Otomatik";
                        })()}
                      </span>
                    )}
                  </DataCell>
                  <DataCell>
                    <button
                      type="button"
                      title={!optPeriodId ? "Hariç tutmak için önce bir sınav takvimi seçin" : undefined}
                      disabled={togglingId === sec.id || !optPeriodId}
                      onClick={() => toggleExclusion(sec)}
                      style={{
                        width: 36,
                        height: 20,
                        borderRadius: 10,
                        background: sec.excluded_from_optimization ? C.red : C.border,
                        border: "none",
                        cursor: togglingId === sec.id ? "not-allowed" : "pointer",
                        position: "relative",
                        display: "inline-block",
                        transition: "background 140ms ease-out",
                        flexShrink: 0,
                      }}
                    >
                      <span style={{
                        position: "absolute",
                        top: 3,
                        left: sec.excluded_from_optimization ? 19 : 3,
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        background: "#fff",
                        display: "inline-block",
                        transition: "left 140ms ease-out",
                      }} />
                    </button>
                  </DataCell>
                  <DataCell style={{ textAlign: "right" }}>
                    <ActionButton variant="secondary" onClick={() => openEdit(sec)}>Düzenle</ActionButton>
                  </DataCell>
                </DataRow>
              );
            })}
          </DataTable>
        </div>
      )}

      {/* ── Simultaneous exams tab ────────────────────────────────────────── */}
      {activeTab === "simultaneous" && <SimultaneousExamsTab termId={optTermId} periodId={optPeriodId} />}

      {/* Edit ExamPeriod dialog */}
      <Dialog open={!!editPeriod} onOpenChange={open => { if (!open) setEditPeriod(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Takvimi Düzenle</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ep-name">Takvim Adı</Label>
              <Input id="ep-name" value={editPeriodForm.name} onChange={e => setEditPeriodForm(f => ({ ...f, name: e.target.value }))} autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ep-type">Tür</Label>
              <select
                id="ep-type"
                value={editPeriodForm.exam_type}
                onChange={e => setEditPeriodForm(f => ({ ...f, exam_type: e.target.value }))}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {EXAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ep-start">Başlangıç Tarihi</Label>
                <Input id="ep-start" type="date" value={editPeriodForm.start_date} onChange={e => setEditPeriodForm(f => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ep-end">Bitiş Tarihi</Label>
                <Input id="ep-end" type="date" value={editPeriodForm.end_date} onChange={e => setEditPeriodForm(f => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
            {editPeriodError && <p className="text-sm text-destructive">{editPeriodError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPeriod(null)} disabled={editPeriodLoading}>İptal</Button>
            <Button onClick={handleEditPeriod} disabled={editPeriodLoading || !editPeriodForm.name || !editPeriodForm.start_date || !editPeriodForm.end_date}>
              {editPeriodLoading ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog (optimization tab) */}
      <Dialog open={!!editCourse} onOpenChange={open => { if (!open) setEditCourse(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dersi Düzenle</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="oe-code">Ders Kodu</Label>
                <Input id="oe-code" value={editForm.code} onChange={setField("code")} autoFocus />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="oe-year">Sınıf (1–4)</Label>
                <Input id="oe-year" type="number" min={1} max={4} value={editForm.year_level} onChange={setField("year_level")} placeholder="—" />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oe-name">Ders Adı</Label>
              <Input id="oe-name" value={editForm.name} onChange={setField("name")} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oe-req">Tür</Label>
              <select
                id="oe-req"
                value={editForm.requirement}
                onChange={setField("requirement")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {REQUIREMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="oe-lec">Teorik Saat</Label>
                <Input id="oe-lec" type="number" min={0} value={editForm.weekly_hours_lecture} onChange={setField("weekly_hours_lecture")} placeholder="—" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="oe-lab">Lab Saat</Label>
                <Input id="oe-lab" type="number" min={0} value={editForm.weekly_hours_lab} onChange={setField("weekly_hours_lab")} placeholder="—" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="oe-cred">Kredi</Label>
                <Input id="oe-cred" type="number" min={0} step={0.5} value={editForm.default_credits} onChange={setField("default_credits")} placeholder="—" />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oe-dur">Sınav Süresi (dk)</Label>
              <Input
                id="oe-dur"
                type="number"
                min={1}
                value={editForm.exam_duration_minutes}
                onChange={setField("exam_duration_minutes")}
                placeholder={(() => {
                  const h = parseInt(editForm.weekly_hours_lecture);
                  if (!isNaN(h)) {
                    const auto = h >= 4 ? 180 : h === 3 ? 120 : 60;
                    return `Otomatik (${auto} dk)`;
                  }
                  return "Otomatik";
                })()}
              />
              {editForm.exam_duration_minutes !== "" &&
                parseInt(editForm.exam_duration_minutes) % 30 !== 0 && (
                <p className="text-xs text-muted-foreground">
                  Yuvarlanır: {editForm.exam_duration_minutes} dk →{" "}
                  {Math.ceil(parseInt(editForm.exam_duration_minutes) / 30) * 30} dk
                </p>
              )}
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
    </div>
  );
}
