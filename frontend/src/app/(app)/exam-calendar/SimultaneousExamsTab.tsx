"use client";
import React, { useState, useCallback } from "react";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, SL, Spinner, ErrorBox, DataTable, DataRow, DataCell, InfoBox } from "@/components/ui";
import {
  groupExamDurationMinutes,
  intervalsOverlap,
  timeStringToMinutes,
  type DurationInputs,
} from "@/lib/examDuration";

type SimGroup = {
  id: string;
  label: string;
  slot: string | null;
  slot_date: string | null;
  slot_start_time: string | null;
  slot_end_time: string | null;
  courses: {
    course_id: string;
    code: string;
    name: string;
    year_level: number | null;
    exam_duration_minutes: number | null;
    weekly_hours_lecture: number | null;
  }[];
};

type ExamDateSlot = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  is_blocked: boolean;
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--surface)",
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: "10px",
  color: C.text,
  fontSize: 13,
  outline: "none",
};

const lStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  color: C.textMuted,
  marginBottom: 8,
  ...mono,
};

export default function SimultaneousExamsTab({ termId, periodId }: { termId: string; periodId: string }) {

  const { data: groupsData, refetch: refetchGroups } = useFetch(
    periodId ? `/simultaneous-groups/?exam_period_id=${periodId}` : "",
    [periodId]
  );
  const groups: SimGroup[] = groupsData?.results || groupsData || [];

  const { data: slotsData } = useFetch(
    periodId ? `/exam-periods/${periodId}/slots/` : "",
    [periodId]
  );
  const slots: ExamDateSlot[] = slotsData || [];

  const { data: periodData } = useFetch(
    periodId ? `/exam-periods/${periodId}/` : "",
    [periodId]
  );
  const sessionMode: boolean = (periodData?.config?.slot_mode === "session");
  const slotDurationMinutes: number = (() => {
    if (slots.length === 0) return 30;
    const s = slots[0];
    return timeStringToMinutes(s.end_time) - timeStringToMinutes(s.start_time);
  })();

  const { data: sectionsData, loading: sectionsLoading } = useFetch(
    termId && periodId
      ? `/course-sections/?term_id=${termId}&exam_period_id=${periodId}&include_empty=true`
      : "",
    [termId, periodId]
  );
  const sections: any[] = sectionsData?.results || sectionsData || [];

  const { data: deptsData } = useFetch("/academic-units/");
  const depts: any[] = deptsData?.results || deptsData || [];

  const [filterDept, setFilterDept] = useState("Tümü");
  const [filterYear, setFilterYear] = useState("Tümü");
  const [filterType, setFilterType] = useState("Tümü");
  const [search, setSearch] = useState("");

  // A course code is a candidate for a simultaneous-exam group whenever it has
  // 2+ section rows — either across departments (e.g. MATH101 in ELEKTRIK + MET-MALZ)
  // or as multiple Şube within a single department (e.g. ENGR265 Şube 1/2/3).
  // Exclusions don't count.
  const duplicateCodes = React.useMemo(() => {
    const countByCode = new Map<string, number>();
    for (const s of sections as any[]) {
      if (s.excluded_from_optimization) continue;
      if (!s.course_code) continue;
      countByCode.set(s.course_code, (countByCode.get(s.course_code) ?? 0) + 1);
    }
    const out = new Set<string>();
    for (const [code, n] of countByCode) {
      if (n >= 2) out.add(code);
    }
    return out;
  }, [sections]);

  // Courses already in any simultaneous group are hidden from the candidate
  // list so they cannot be re-grouped. Deleting the group restores them.
  const groupedCourseIds = React.useMemo(() => {
    const s = new Set<string>();
    for (const g of groups) for (const c of g.courses) s.add(String(c.course_id));
    return s;
  }, [groups]);

  const filtered = sections
    .filter((s: any) => {
      if (s.excluded_from_optimization) return false;
      if (!duplicateCodes.has(s.course_code)) return false;
      if (groupedCourseIds.has(String(s.course_id))) return false;
      if (filterDept !== "Tümü" && String(s.academic_unit_id) !== filterDept) return false;
      if (filterYear !== "Tümü" && String(s.year_level) !== filterYear) return false;
      if (filterType !== "Tümü" && s.requirement !== filterType) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!s.course_name?.toLowerCase().includes(q) && !s.course_code?.toLowerCase().includes(q)) return false;
      }
      return true;
    })
    .sort((a: any, b: any) =>
      String(a.course_code ?? "").localeCompare(String(b.course_code ?? ""))
    );

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggleCheck = (courseId: string) =>
    setChecked(prev => {
      const next = new Set(prev);
      next.has(courseId) ? next.delete(courseId) : next.add(courseId);
      return next;
    });

  const [showModal, setShowModal] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [editingGroup, setEditingGroup] = useState<SimGroup | null>(null);
  const [editChecked, setEditChecked] = useState<Set<string>>(new Set());
  const [editSlotId, setEditSlotId] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState("");

  const dates = Array.from(new Set(slots.map(s => s.date))).sort();
  const times = Array.from(new Set(slots.map(s => s.start_time))).sort();
  const slotMap: Record<string, ExamDateSlot> = {};
  slots.forEach(s => { slotMap[`${s.date}|${s.start_time}`] = s; });

  const newGroupCourses: DurationInputs[] = React.useMemo(() => {
    return sections
      .filter((s: any) => checked.has(String(s.course_id ?? s.id)))
      .map((s: any) => ({
        weekly_hours_lecture: s.weekly_hours_lecture ?? null,
        exam_duration_minutes: s.exam_duration_minutes ?? null,
      }));
  }, [sections, checked]);

  const newGroupDurationMinutes = React.useMemo(
    () => groupExamDurationMinutes(newGroupCourses, slotDurationMinutes, sessionMode),
    [newGroupCourses, slotDurationMinutes, sessionMode],
  );

  // Courses to show in the edit modal: current group's courses + ungrouped candidates.
  // We exclude the editing group's courses from the "already grouped" filter so they appear.
  const editCandidates = React.useMemo(() => {
    if (!editingGroup) return [];
    const editingGroupCourseIds = new Set(editingGroup.courses.map(c => String(c.course_id)));
    return sections
      .filter((s: any) => {
        if (s.excluded_from_optimization) return false;
        if (!duplicateCodes.has(s.course_code)) return false;
        const courseId = String(s.course_id ?? s.id);
        if (editingGroupCourseIds.has(courseId)) return true;
        if (groupedCourseIds.has(courseId)) return false;
        return true;
      })
      .sort((a: any, b: any) =>
        String(a.course_code ?? "").localeCompare(String(b.course_code ?? ""))
      );
  }, [sections, editingGroup, duplicateCodes, groupedCourseIds]);

  type PinnedWindow = {
    groupLabel: string;
    startMin: number;
    endMin: number;
    codes: string[];
  };

  // Pinned windows excluding the group being edited (so its own slot shows as available).
  const editPinnedWindowsByDate: Record<string, PinnedWindow[]> = React.useMemo(() => {
    if (!editingGroup) return {};
    const out: Record<string, PinnedWindow[]> = {};
    for (const g of groups) {
      if (g.id === editingGroup.id) continue;
      if (!g.slot_date || !g.slot_start_time) continue;
      const courses: DurationInputs[] = g.courses.map(c => ({
        weekly_hours_lecture: c.weekly_hours_lecture,
        exam_duration_minutes: c.exam_duration_minutes,
      }));
      const dur = groupExamDurationMinutes(courses, slotDurationMinutes, sessionMode);
      if (dur <= 0) continue;
      const start = timeStringToMinutes(g.slot_start_time);
      (out[g.slot_date] ||= []).push({
        groupLabel: g.label,
        startMin: start,
        endMin: start + dur,
        codes: Array.from(new Set(g.courses.map(c => c.code))),
      });
    }
    return out;
  }, [groups, editingGroup, slotDurationMinutes, sessionMode]);

  // Duration of the group being edited based on currently checked courses.
  const editGroupCourses: DurationInputs[] = React.useMemo(() => {
    if (!editingGroup) return [];
    return sections
      .filter((s: any) => editChecked.has(String(s.course_id ?? s.id)))
      .map((s: any) => ({
        weekly_hours_lecture: s.weekly_hours_lecture ?? null,
        exam_duration_minutes: s.exam_duration_minutes ?? null,
      }));
  }, [sections, editChecked, editingGroup]);

  const editGroupDurationMinutes = React.useMemo(
    () => groupExamDurationMinutes(editGroupCourses, slotDurationMinutes, sessionMode),
    [editGroupCourses, slotDurationMinutes, sessionMode],
  );

  // Conflict cells for the edit modal slot grid.
  const editConflictCells: Map<string, ConflictCellInfo> = React.useMemo(() => {
    const result = new Map<string, ConflictCellInfo>();
    if (!editingGroup || editGroupDurationMinutes <= 0) return result;

    for (const date of dates) {
      const windows = editPinnedWindowsByDate[date] || [];
      let runStartKey: string | null = null;
      let runLength = 0;
      let runLabel: string | null = null;

      const closeRun = () => {
        if (runStartKey) {
          const startInfo = result.get(runStartKey);
          if (startInfo) startInfo.rowSpan = runLength;
        }
        runStartKey = null;
        runLength = 0;
        runLabel = null;
      };

      for (const time of times) {
        const slot = slotMap[`${date}|${time}`];
        const key = `${date}|${time}`;
        let conflict: PinnedWindow | null = null;
        let conflictType: 'window' | 'buffer' = 'window';
        if (slot && !slot.is_blocked) {
          const sStart = timeStringToMinutes(slot.start_time);
          const sEnd = sStart + editGroupDurationMinutes;
          for (const w of windows) {
            if (intervalsOverlap(sStart, sEnd, w.startMin, w.endMin)) {
              conflict = w;
              conflictType = sStart >= w.startMin ? 'window' : 'buffer';
              break;
            }
          }
        }

        if (conflict && conflictType === 'window' && conflict.groupLabel === runLabel) {
          runLength += 1;
          result.set(key, { conflict, rowSpan: 0, conflictType: 'window' });
        } else {
          closeRun();
          if (conflict) {
            if (conflictType === 'window') {
              runStartKey = key;
              runLength = 1;
              runLabel = conflict.groupLabel;
              result.set(key, { conflict, rowSpan: 1, conflictType: 'window' });
            } else {
              result.set(key, { conflict, rowSpan: 1, conflictType: 'buffer' });
            }
          }
        }
      }
      closeRun();
    }
    return result;
  }, [editingGroup, editGroupDurationMinutes, dates, times, slotMap, editPinnedWindowsByDate]);

  const pinnedWindowsByDate: Record<string, PinnedWindow[]> = React.useMemo(() => {
    const out: Record<string, PinnedWindow[]> = {};
    for (const g of groups) {
      if (!g.slot_date || !g.slot_start_time) continue;
      const courses: DurationInputs[] = g.courses.map(c => ({
        weekly_hours_lecture: c.weekly_hours_lecture,
        exam_duration_minutes: c.exam_duration_minutes,
      }));
      const dur = groupExamDurationMinutes(courses, slotDurationMinutes, sessionMode);
      if (dur <= 0) continue;
      const start = timeStringToMinutes(g.slot_start_time);
      (out[g.slot_date] ||= []).push({
        groupLabel: g.label,
        startMin: start,
        endMin: start + dur,
        // Dedupe: same course code can appear once per department in the group.
        codes: Array.from(new Set(g.courses.map(c => c.code))),
      });
    }
    return out;
  }, [groups, slotDurationMinutes, sessionMode]);

  // Current-grid occupancy: maps "date|time" → { group, rowSpan } for the
  // read-only schedule view. rowSpan === 0 means the cell is covered by the
  // rowSpan'd start cell above it and should not be rendered.
  const gridOccupancyCells = React.useMemo(() => {
    const result = new Map<string, { group: SimGroup; rowSpan: number }>();
    for (const g of groups) {
      if (!g.slot_date || !g.slot_start_time) continue;
      const courses: DurationInputs[] = g.courses.map(c => ({
        weekly_hours_lecture: c.weekly_hours_lecture,
        exam_duration_minutes: c.exam_duration_minutes,
      }));
      const dur = groupExamDurationMinutes(courses, slotDurationMinutes, sessionMode);
      if (dur <= 0) continue;
      const startMin = timeStringToMinutes(g.slot_start_time);
      const endMin = startMin + dur;
      let firstKey: string | null = null;
      let span = 0;
      for (const time of times) {
        const slot = slotMap[`${g.slot_date}|${time}`];
        if (!slot) continue;
        const sStart = timeStringToMinutes(slot.start_time);
        if (sStart >= startMin && sStart < endMin) {
          const key = `${g.slot_date}|${time}`;
          if (!firstKey) { firstKey = key; result.set(key, { group: g, rowSpan: 1 }); }
          else { result.set(key, { group: g, rowSpan: 0 }); }
          span++;
        }
      }
      if (firstKey && span > 1) {
        const cell = result.get(firstKey);
        if (cell) cell.rowSpan = span;
      }
    }
    return result;
  }, [groups, times, slotMap, slotDurationMinutes, sessionMode]);

  // Per-cell merge info: consecutive conflict cells with the same group label
  // are collapsed into one rowSpan'd start cell. rowSpan === 0 means "skip
  // rendering this cell, it's covered by the merged start above".
  //
  // conflictType:
  //   'window' — the slot falls inside the existing group's actual exam window
  //              [w.startMin, w.endMin). These cells are merged and show the
  //              group's time/courses (red). This is what the user sees as the
  //              exam occupying that time.
  //   'buffer' — the slot is BEFORE w.startMin but a new exam starting here
  //              would still run into the existing group. Shown individually
  //              in amber so the user understands "can't start here, exam
  //              begins soon" without making it look like the exam IS here.
  type ConflictCellInfo = { conflict: PinnedWindow; rowSpan: number; conflictType: 'window' | 'buffer' };
  const conflictCells: Map<string, ConflictCellInfo> = React.useMemo(() => {
    const result = new Map<string, ConflictCellInfo>();
    if (newGroupDurationMinutes <= 0) return result;

    for (const date of dates) {
      const windows = pinnedWindowsByDate[date] || [];
      let runStartKey: string | null = null;
      let runLength = 0;
      let runLabel: string | null = null;

      const closeRun = () => {
        if (runStartKey) {
          const startInfo = result.get(runStartKey);
          if (startInfo) startInfo.rowSpan = runLength;
        }
        runStartKey = null;
        runLength = 0;
        runLabel = null;
      };

      for (const time of times) {
        const slot = slotMap[`${date}|${time}`];
        const key = `${date}|${time}`;
        let conflict: PinnedWindow | null = null;
        let conflictType: 'window' | 'buffer' = 'window';
        if (slot && !slot.is_blocked) {
          const sStart = timeStringToMinutes(slot.start_time);
          const sEnd = sStart + newGroupDurationMinutes;
          for (const w of windows) {
            if (intervalsOverlap(sStart, sEnd, w.startMin, w.endMin)) {
              conflict = w;
              conflictType = sStart >= w.startMin ? 'window' : 'buffer';
              break;
            }
          }
        }

        if (conflict && conflictType === 'window' && conflict.groupLabel === runLabel) {
          // Continuation of a window run — merge into rowSpan'd start cell.
          runLength += 1;
          result.set(key, { conflict, rowSpan: 0, conflictType: 'window' });
        } else {
          closeRun();
          if (conflict) {
            if (conflictType === 'window') {
              runStartKey = key;
              runLength = 1;
              runLabel = conflict.groupLabel;
              result.set(key, { conflict, rowSpan: 1, conflictType: 'window' });
            } else {
              // Buffer cells are never merged — each renders individually.
              result.set(key, { conflict, rowSpan: 1, conflictType: 'buffer' });
            }
          }
        }
      }
      closeRun();
    }
    return result;
  }, [dates, times, slotMap, pinnedWindowsByDate, newGroupDurationMinutes]);

  const minutesToTimeStr = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  const weekdayLabel = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"][d.getDay()];
  };

  const weekdayLabelLong = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"][d.getDay()];
  };

  const formatDdMm = (dateStr: string) => {
    const [, mm, dd] = dateStr.split("-");
    return `${dd}/${mm}`;
  };

  const pickSlot = useCallback(async (slot: ExamDateSlot) => {
    if (slot.is_blocked || saving) return;
    setSaving(true);
    setSaveErr("");
    try {
      await api.post("/simultaneous-groups/", {
        exam_period: periodId,
        slot: slot.id,
        course_ids: Array.from(checked),
      });
      setChecked(new Set());
      setShowModal(false);
      refetchGroups();
    } catch (e: any) {
      const msg =
        e?.data?.slot
          ? (Array.isArray(e.data.slot) ? e.data.slot.join(" ") : String(e.data.slot))
          : e?.data?.detail
            ? String(e.data.detail)
            : e?.data
              ? JSON.stringify(e.data)
              : e?.message || "Kayıt başarısız.";
      setSaveErr(msg);
    } finally {
      setSaving(false);
    }
  }, [periodId, checked, saving, refetchGroups]);

  const deleteGroup = async (id: string) => {
    setDeletingId(id);
    try {
      await api.delete(`/simultaneous-groups/${id}/`);
      refetchGroups();
    } finally {
      setDeletingId(null);
    }
  };

  const openEdit = useCallback((group: SimGroup) => {
    setEditingGroup(group);
    setEditChecked(new Set(group.courses.map(c => String(c.course_id))));
    setEditSlotId(group.slot ?? null);
    setEditErr("");
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingGroup) return;
    setEditSaving(true);
    setEditErr("");
    try {
      await api.patch(`/simultaneous-groups/${editingGroup.id}/`, {
        slot: editSlotId,
        course_ids: Array.from(editChecked),
      });
      setEditingGroup(null);
      refetchGroups();
    } catch (e: any) {
      const msg =
        e?.data?.slot
          ? (Array.isArray(e.data.slot) ? e.data.slot.join(" ") : String(e.data.slot))
          : e?.data?.course_ids
            ? (Array.isArray(e.data.course_ids) ? e.data.course_ids.join(" ") : String(e.data.course_ids))
            : e?.data?.detail
              ? String(e.data.detail)
              : e?.message || "Kayıt başarısız.";
      setEditErr(msg);
    } finally {
      setEditSaving(false);
    }
  }, [editingGroup, editSlotId, editChecked, refetchGroups]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {periodId ? (
        <>
          {/* 2 — Existing groups */}
          <Card style={{ padding: "16px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <SL style={{ margin: 0 }}>EŞ ZAMANLI SINAV GRUPLARI</SL>
              {slots.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowGrid(v => !v)}
                  style={{
                    background: showGrid ? `color-mix(in srgb, ${C.cyan} 14%, transparent)` : "transparent",
                    border: `1px solid ${showGrid ? C.cyan : C.border}`,
                    borderRadius: 6,
                    padding: "6px 14px",
                    cursor: "pointer",
                    color: showGrid ? C.cyan : C.textMuted,
                    fontSize: 12,
                    fontWeight: showGrid ? 700 : 400,
                    ...mono,
                    transition: "all 140ms ease-out",
                  }}
                >
                  {showGrid ? "Takvimi Gizle" : "Takvimi Görüntüle"}
                </button>
              )}
            </div>
            {groups.length === 0 ? (
              <InfoBox msg="Henüz eş zamanlı sınav grubu oluşturulmadı." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {groups.map(g => (
                  <div key={g.id} style={{
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: "12px 16px",
                    background: "var(--surface-container)",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, ...mono, color: C.text }}>
                        {g.label}
                        {g.slot_date && (
                          <span style={{ color: C.accent, marginLeft: 12, fontWeight: 400 }}>
                            → {weekdayLabelLong(g.slot_date)} {formatDdMm(g.slot_date)} {g.slot_start_time?.slice(0, 5)}
                          </span>
                        )}
                      </span>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => openEdit(g)}
                          style={{
                            background: "transparent",
                            border: `1px solid ${C.border}`,
                            borderRadius: 6,
                            padding: "4px 12px",
                            cursor: "pointer",
                            color: C.text,
                            fontSize: 12,
                            ...mono,
                          }}
                        >
                          Düzenle
                        </button>
                        <button
                          onClick={() => deleteGroup(g.id)}
                          disabled={deletingId === g.id}
                          style={{
                            background: "transparent",
                            border: `1px solid ${C.red}`,
                            borderRadius: 6,
                            padding: "4px 12px",
                            cursor: deletingId === g.id ? "not-allowed" : "pointer",
                            color: C.red,
                            fontSize: 12,
                            ...mono,
                            opacity: deletingId === g.id ? 0.5 : 1,
                          }}
                        >
                          {deletingId === g.id ? "Siliniyor…" : "Sil"}
                        </button>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {g.courses.map(c => (
                        <span key={c.course_id} style={{
                          fontSize: 11, padding: "3px 8px", borderRadius: 4,
                          background: `color-mix(in srgb, ${C.cyan} 12%, transparent)`,
                          color: C.cyan, ...mono,
                        }}>
                          {c.code}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* 2b — Current schedule grid */}
          {showGrid && slots.length > 0 && (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
                <SL style={{ margin: 0 }}>MEVCUT TAKVİM</SL>
                {groups.filter(g => g.slot_date).length > 0 && (
                  <span style={{ fontSize: 11, color: C.textMuted, ...mono }}>
                    {groups.filter(g => g.slot_date).length} grup atanmış
                  </span>
                )}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{
                        position: "sticky", left: 0, background: "var(--surface)", zIndex: 2,
                        padding: "8px 14px", borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`,
                        ...mono, fontSize: 10, color: C.textMuted, textAlign: "left", fontWeight: 600,
                      }}>
                        SAAT
                      </th>
                      {dates.map(date => (
                        <th key={date} style={{
                          padding: "8px 10px", borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`,
                          minWidth: 110, textAlign: "center", background: "var(--surface)",
                        }}>
                          <div style={{ ...mono, fontSize: 11, color: C.text, fontWeight: 700 }}>{weekdayLabel(date)}</div>
                          <div style={{ ...mono, fontSize: 10, color: C.textMuted }}>{formatDdMm(date)}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {times.map((time, rowIdx) => (
                      <tr key={time} style={{ background: rowIdx % 2 === 0 ? "transparent" : "color-mix(in srgb, var(--surface) 50%, transparent)" }}>
                        <td style={{
                          position: "sticky", left: 0, background: "var(--surface)", zIndex: 1,
                          padding: "6px 14px", borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`,
                          ...mono, fontSize: 11, color: C.textMuted, whiteSpace: "nowrap",
                        }}>
                          {time.slice(0, 5)}
                        </td>
                        {dates.map(date => {
                          const slot = slotMap[`${date}|${time}`];
                          if (!slot) return (
                            <td key={date} style={{ borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }} />
                          );
                          const cellInfo = gridOccupancyCells.get(`${date}|${time}`);
                          if (cellInfo && cellInfo.rowSpan === 0) return null;
                          const occupied = cellInfo ?? null;
                          const bg = slot.is_blocked
                            ? `color-mix(in srgb, ${C.red} 10%, transparent)`
                            : occupied
                              ? `color-mix(in srgb, ${C.cyan} 14%, transparent)`
                              : "transparent";
                          return (
                            <td
                              key={date}
                              rowSpan={occupied?.rowSpan ?? 1}
                              style={{
                                borderBottom: `1px solid ${C.border}`,
                                borderRight: `1px solid ${C.border}`,
                                background: bg,
                                padding: occupied ? "6px 8px" : "6px 10px",
                                textAlign: "center",
                                verticalAlign: "middle",
                              }}
                            >
                              {slot.is_blocked ? (
                                <span style={{ fontSize: 12, color: C.red, opacity: 0.5 }}>✕</span>
                              ) : occupied ? (
                                <div style={{ ...mono, lineHeight: 1.3 }}>
                                  <div style={{ fontSize: 9, color: C.textMuted, marginBottom: 2 }}>
                                    {minutesToTimeStr(timeStringToMinutes(occupied.group.slot_start_time!))}
                                    –
                                    {minutesToTimeStr(
                                      timeStringToMinutes(occupied.group.slot_start_time!) +
                                      groupExamDurationMinutes(
                                        occupied.group.courses.map(c => ({
                                          weekly_hours_lecture: c.weekly_hours_lecture,
                                          exam_duration_minutes: c.exam_duration_minutes,
                                        })),
                                        slotDurationMinutes,
                                        sessionMode
                                      )
                                    )}
                                  </div>
                                  {Array.from(new Set(occupied.group.courses.map(c => c.code))).slice(0, 4).map(code => (
                                    <div key={code} style={{ fontSize: 10, color: C.cyan, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                      {code}
                                    </div>
                                  ))}
                                  {occupied.group.courses.length > 4 && (
                                    <div style={{ fontSize: 9, color: C.textMuted }}>
                                      +{occupied.group.courses.length - 4}
                                    </div>
                                  )}
                                </div>
                              ) : null}
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

          {/* 3 — Course list with checkboxes */}
          <Card style={{ padding: "16px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <SL style={{ margin: 0 }}>DERS SEÇİMİ</SL>
              <button
                disabled={checked.size < 2}
                onClick={() => { setSaveErr(""); setShowModal(true); }}
                style={{
                  background: checked.size >= 2 ? C.accent : C.border,
                  color: checked.size >= 2 ? "#fff" : C.textMuted,
                  border: "none", borderRadius: 8, padding: "10px 20px",
                  cursor: checked.size >= 2 ? "pointer" : "not-allowed",
                  fontSize: 13, fontWeight: 700, ...mono,
                  transition: "background 140ms ease-out",
                }}
              >
                Eş Zamanlı Yap ({checked.size} seçili)
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 150px 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={lStyle}>BÖLÜM</label>
                <select value={filterDept} onChange={e => setFilterDept(e.target.value)} style={selectStyle}>
                  <option value="Tümü">Tümü</option>
                  {depts.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label style={lStyle}>YIL</label>
                <select value={filterYear} onChange={e => setFilterYear(e.target.value)} style={selectStyle}>
                  <option value="Tümü">Tümü</option>
                  {[1, 2, 3, 4].map(y => <option key={y} value={String(y)}>{y}. Sınıf</option>)}
                </select>
              </div>
              <div>
                <label style={lStyle}>TÜR</label>
                <select value={filterType} onChange={e => setFilterType(e.target.value)} style={selectStyle}>
                  <option value="Tümü">Tümü</option>
                  <option value="COMPULSORY">Zorunlu</option>
                  <option value="ELECTIVE">Seçmeli</option>
                </select>
              </div>
              <div>
                <label style={lStyle}>ARAMA</label>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Ders adı veya kodu..."
                  style={selectStyle}
                />
              </div>
            </div>

            <DataTable headers={["", "Şube", "Ders Kodu", "Ders Adı", "Sınıf", "Bölüm", "Tür"]}>
              {sectionsLoading && (
                <DataRow>
                  <DataCell colSpan={7} style={{ textAlign: "center", padding: 40 }}><Spinner size={20} /></DataCell>
                </DataRow>
              )}
              {!sectionsLoading && filtered.length === 0 && (
                <DataRow>
                  <DataCell colSpan={7}><InfoBox msg="Aynı koda sahip birden fazla şube bulunamadı." /></DataCell>
                </DataRow>
              )}
              {filtered.map((sec: any) => {
                const courseId = String(sec.course_id ?? sec.id);
                const isChecked = checked.has(courseId);
                return (
                  <tr
                    key={sec.id}
                    style={{ borderBottom: "1px solid color-mix(in srgb, var(--outline-variant) 40%, transparent)", transition: "background 140ms ease-out", cursor: "pointer" }}
                    onClick={() => toggleCheck(courseId)}
                    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = "var(--surface-container-high)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = ""; }}
                  >
                    <DataCell style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleCheck(courseId)}
                        onClick={e => e.stopPropagation()}
                      />
                    </DataCell>
                    <DataCell style={{ color: C.textSub, ...mono, fontSize: 12 }}>{sec.section_code ?? "—"}</DataCell>
                    <DataCell style={{ color: C.cyan, ...mono, fontWeight: 600 }}>{sec.course_code}</DataCell>
                    <DataCell>{sec.course_name}</DataCell>
                    <DataCell style={{ color: C.textSub, fontSize: 12 }}>
                      {sec.year_level ? `${sec.year_level}. Sınıf` : "—"}
                    </DataCell>
                    <DataCell style={{ fontSize: 12, color: C.textSub }}>{sec.academic_unit_name ?? "—"}</DataCell>
                    <DataCell>
                      <span style={{
                        fontSize: 10, padding: "3px 8px", borderRadius: 4,
                        background: sec.requirement === "COMPULSORY"
                          ? `color-mix(in srgb, ${C.green} 14%, transparent)`
                          : `color-mix(in srgb, ${C.cyan} 12%, transparent)`,
                        color: sec.requirement === "COMPULSORY" ? C.green : C.accent,
                      }}>
                        {sec.requirement === "COMPULSORY" ? "ZORUNLU" : "SEÇMELİ"}
                      </span>
                    </DataCell>
                  </tr>
                );
              })}
            </DataTable>
          </Card>
        </>
      ) : (
        <InfoBox msg="Dönem ve sınav takvimi seçmek için 'Ders Seçimi' sekmesine gidin." />
      )}

      {/* 4 — Slot picker modal */}
      {showModal && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 100,
        }}>
          <div style={{
            background: "var(--surface)",
            borderRadius: 12,
            padding: 24,
            maxWidth: "90vw",
            maxHeight: "80vh",
            overflow: "auto",
            minWidth: 420,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, ...mono, color: C.text }}>
                Başlangıç Saati Seçin
              </h3>
              <button
                onClick={() => setShowModal(false)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: C.textMuted, fontSize: 20, lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
            <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>
              {checked.size} ders seçili. Eş zamanlı sınavın başlayacağı saate tıklayın.
            </p>

            {saveErr && <div style={{ marginBottom: 12 }}><ErrorBox msg={saveErr} /></div>}

            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th style={{
                      position: "sticky", left: 0, background: "var(--surface)", zIndex: 2,
                      padding: "8px 14px", borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`,
                      ...mono, fontSize: 10, color: C.textMuted, textAlign: "left", fontWeight: 600,
                    }}>
                      SAAT
                    </th>
                    {dates.map(date => (
                      <th key={date} style={{
                        padding: "8px 10px",
                        borderBottom: `1px solid ${C.border}`,
                        borderRight: `1px solid ${C.border}`,
                        minWidth: 90, textAlign: "center",
                        background: "var(--surface)",
                      }}>
                        <div style={{ ...mono, fontSize: 11, color: C.text, fontWeight: 700 }}>{weekdayLabel(date)}</div>
                        <div style={{ ...mono, fontSize: 10, color: C.textMuted }}>{formatDdMm(date)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {times.map((time, rowIdx) => (
                    <tr key={time} style={{ background: rowIdx % 2 === 0 ? "transparent" : "color-mix(in srgb, var(--surface) 50%, transparent)" }}>
                      <td style={{
                        position: "sticky", left: 0, background: "var(--surface)", zIndex: 1,
                        padding: "6px 14px", borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`,
                        ...mono, fontSize: 11, color: C.textMuted, whiteSpace: "nowrap",
                      }}>
                        {time}
                      </td>
                      {dates.map(date => {
                        const slot = slotMap[`${date}|${time}`];
                        if (!slot) return (
                          <td key={date} style={{ borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }} />
                        );
                        const blocked = slot.is_blocked;
                        const cellInfo = conflictCells.get(`${date}|${time}`);
                        // Continuation of a merged window-conflict run — fully covered by the
                        // rowSpan'd start cell above; do not emit a <td>.
                        if (cellInfo && cellInfo.rowSpan === 0) return null;

                        const conflict = cellInfo?.conflict ?? null;
                        const conflictType = cellInfo?.conflictType ?? null;
                        const rowSpan = cellInfo?.rowSpan ?? 1;
                        const isLocked = blocked || !!conflict;
                        const bg = blocked
                          ? `color-mix(in srgb, ${C.red} 16%, transparent)`
                          : conflictType === 'buffer'
                            ? `color-mix(in srgb, ${C.amber} 14%, transparent)`
                            : conflict
                              ? `color-mix(in srgb, ${C.red} 12%, transparent)`
                              : `color-mix(in srgb, ${C.green} 12%, transparent)`;
                        const tooltip = blocked
                          ? "Engellenmiş — seçilemez"
                          : conflictType === 'buffer'
                            ? `${conflict!.groupLabel} bu saatte başlar (${minutesToTimeStr(conflict!.startMin)}) — ${newGroupDurationMinutes} dk'lık sınav çakışır`
                            : conflict
                              ? `${conflict.groupLabel} — ${minutesToTimeStr(conflict.startMin)}–${minutesToTimeStr(conflict.endMin)} — ${conflict.codes.join(", ")}`
                              : "Tıkla: bu saate ata";

                        return (
                          <td
                            key={date}
                            rowSpan={rowSpan}
                            onClick={() => !isLocked && !saving && pickSlot(slot)}
                            title={tooltip}
                            style={{
                              borderBottom: `1px solid ${C.border}`,
                              borderRight: `1px solid ${C.border}`,
                              background: bg,
                              cursor: isLocked ? "not-allowed" : saving ? "wait" : "pointer",
                              padding: conflict ? "4px 6px" : "8px 10px",
                              textAlign: "center",
                              verticalAlign: "middle",
                              transition: "background 120ms ease-out",
                              userSelect: "none",
                              opacity: saving ? 0.6 : 1,
                              minWidth: 90,
                            }}
                          >
                            {blocked ? (
                              <span style={{ fontSize: 14 }}>✕</span>
                            ) : conflictType === 'buffer' ? (
                              <div style={{ ...mono, fontSize: 9, color: C.amber, fontWeight: 600, lineHeight: 1.3 }}>
                                →{minutesToTimeStr(conflict!.startMin)}
                              </div>
                            ) : conflict ? (
                              <div style={{ ...mono, fontSize: 10, lineHeight: 1.25, color: C.red, fontWeight: 600 }}>
                                <div style={{ fontSize: 9, opacity: 0.8, marginBottom: 2 }}>
                                  {minutesToTimeStr(conflict.startMin)}–{minutesToTimeStr(conflict.endMin)}
                                </div>
                                {conflict.codes.slice(0, 3).map(code => (
                                  <div key={code} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {code}
                                  </div>
                                ))}
                                {conflict.codes.length > 3 && (
                                  <div style={{ opacity: 0.7 }}>+{conflict.codes.length - 3}</div>
                                )}
                              </div>
                            ) : (
                              <span style={{ fontSize: 14 }}>✓</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {saving && (
              <div style={{ marginTop: 12, textAlign: "center" }}>
                <Spinner size={16} />
              </div>
            )}
          </div>
        </div>
      )}
      {/* 5 — Edit group modal */}
      {editingGroup && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 100,
        }}>
          <div style={{
            background: "var(--surface)",
            borderRadius: 12,
            padding: 24,
            maxWidth: "92vw",
            maxHeight: "88vh",
            overflow: "auto",
            minWidth: 480,
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, ...mono, color: C.text }}>
                {editingGroup.label} — Düzenle
              </h3>
              <button
                onClick={() => setEditingGroup(null)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: C.textMuted, fontSize: 20, lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            {editErr && <ErrorBox msg={editErr} />}

            {/* Section 1: Course selection */}
            <div>
              <div style={{ fontSize: 10, color: C.textMuted, ...mono, marginBottom: 10, letterSpacing: "0.06em" }}>
                DERS SEÇİMİ — en az 2 ders seçili olmalı
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                {editCandidates.map((s: any) => {
                  const courseId = String(s.course_id ?? s.id);
                  const isInGroup = editingGroup.courses.some(c => String(c.course_id) === courseId);
                  const isChecked = editChecked.has(courseId);
                  return (
                    <label
                      key={s.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                        padding: "6px 10px", borderRadius: 6,
                        background: isChecked
                          ? `color-mix(in srgb, ${C.cyan} 10%, transparent)`
                          : "transparent",
                        border: `1px solid ${isChecked ? C.cyan : "transparent"}`,
                        transition: "all 120ms ease-out",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() =>
                          setEditChecked(prev => {
                            const next = new Set(prev);
                            next.has(courseId) ? next.delete(courseId) : next.add(courseId);
                            return next;
                          })
                        }
                      />
                      <span style={{ ...mono, fontSize: 12, color: C.cyan, fontWeight: 600, minWidth: 90 }}>
                        {s.course_code}
                      </span>
                      <span style={{ fontSize: 12, color: C.text }}>{s.course_name}</span>
                      {isInGroup && (
                        <span style={{ fontSize: 10, color: C.textMuted, marginLeft: "auto" }}>mevcut</span>
                      )}
                    </label>
                  );
                })}
                {editCandidates.length === 0 && (
                  <p style={{ fontSize: 12, color: C.textMuted, margin: 0 }}>Uygun ders bulunamadı.</p>
                )}
              </div>
            </div>

            {/* Section 2: Slot calendar */}
            {slots.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: C.textMuted, ...mono, marginBottom: 10, letterSpacing: "0.06em" }}>
                  ZAMAN SEÇİMİ — mevcut slot mavi, çakışanlar kırmızı/turuncu
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
                    <thead>
                      <tr>
                        <th style={{
                          position: "sticky", left: 0, background: "var(--surface)", zIndex: 2,
                          padding: "8px 14px", borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`,
                          ...mono, fontSize: 10, color: C.textMuted, textAlign: "left", fontWeight: 600,
                        }}>
                          SAAT
                        </th>
                        {dates.map(date => (
                          <th key={date} style={{
                            padding: "8px 10px",
                            borderBottom: `1px solid ${C.border}`,
                            borderRight: `1px solid ${C.border}`,
                            minWidth: 90, textAlign: "center",
                            background: "var(--surface)",
                          }}>
                            <div style={{ ...mono, fontSize: 11, color: C.text, fontWeight: 700 }}>{weekdayLabel(date)}</div>
                            <div style={{ ...mono, fontSize: 10, color: C.textMuted }}>{formatDdMm(date)}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {times.map((time, rowIdx) => (
                        <tr key={time} style={{ background: rowIdx % 2 === 0 ? "transparent" : "color-mix(in srgb, var(--surface) 50%, transparent)" }}>
                          <td style={{
                            position: "sticky", left: 0, background: "var(--surface)", zIndex: 1,
                            padding: "6px 14px", borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`,
                            ...mono, fontSize: 11, color: C.textMuted, whiteSpace: "nowrap",
                          }}>
                            {time}
                          </td>
                          {dates.map(date => {
                            const slot = slotMap[`${date}|${time}`];
                            if (!slot) return (
                              <td key={date} style={{ borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }} />
                            );
                            const blocked = slot.is_blocked;
                            const cellInfo = editConflictCells.get(`${date}|${time}`);
                            if (cellInfo && cellInfo.rowSpan === 0) return null;

                            const conflict = cellInfo?.conflict ?? null;
                            const conflictType = cellInfo?.conflictType ?? null;
                            const rowSpan = cellInfo?.rowSpan ?? 1;
                            const isSelected = slot.id === editSlotId;
                            const isLocked = blocked || !!conflict;

                            const bg = blocked
                              ? `color-mix(in srgb, ${C.red} 16%, transparent)`
                              : isSelected
                                ? `color-mix(in srgb, #3b82f6 18%, transparent)`
                                : conflictType === 'buffer'
                                  ? `color-mix(in srgb, ${C.amber} 14%, transparent)`
                                  : conflict
                                    ? `color-mix(in srgb, ${C.red} 12%, transparent)`
                                    : `color-mix(in srgb, ${C.green} 12%, transparent)`;

                            const border = isSelected
                              ? `2px solid #3b82f6`
                              : `1px solid ${C.border}`;

                            const tooltip = blocked
                              ? "Engellenmiş — seçilemez"
                              : isSelected
                                ? "Mevcut seçim — tıkla kaldır"
                                : conflictType === 'buffer'
                                  ? `${conflict!.groupLabel} bu saatte başlar — çakışır`
                                  : conflict
                                    ? `${conflict!.groupLabel} — ${minutesToTimeStr(conflict!.startMin)}–${minutesToTimeStr(conflict!.endMin)}`
                                    : "Tıkla: bu saate ata";

                            return (
                              <td
                                key={date}
                                rowSpan={rowSpan}
                                onClick={() => {
                                  if (isLocked && !isSelected) return;
                                  setEditSlotId(isSelected ? null : slot.id);
                                }}
                                title={tooltip}
                                style={{
                                  borderBottom: border,
                                  borderRight: border,
                                  background: bg,
                                  cursor: (isLocked && !isSelected) ? "not-allowed" : "pointer",
                                  padding: conflict ? "4px 6px" : "8px 10px",
                                  textAlign: "center",
                                  verticalAlign: "middle",
                                  transition: "background 120ms ease-out",
                                  userSelect: "none",
                                  minWidth: 90,
                                }}
                              >
                                {blocked ? (
                                  <span style={{ fontSize: 14 }}>✕</span>
                                ) : isSelected ? (
                                  <span style={{ fontSize: 14, color: "#3b82f6" }}>✓</span>
                                ) : conflictType === 'buffer' ? (
                                  <div style={{ ...mono, fontSize: 9, color: C.amber, fontWeight: 600 }}>
                                    →{minutesToTimeStr(conflict!.startMin)}
                                  </div>
                                ) : conflict ? (
                                  <div style={{ ...mono, fontSize: 10, lineHeight: 1.25, color: C.red, fontWeight: 600 }}>
                                    <div style={{ fontSize: 9, opacity: 0.8, marginBottom: 2 }}>
                                      {minutesToTimeStr(conflict.startMin)}–{minutesToTimeStr(conflict.endMin)}
                                    </div>
                                    {conflict.codes.slice(0, 3).map(code => (
                                      <div key={code} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {code}
                                      </div>
                                    ))}
                                    {conflict.codes.length > 3 && (
                                      <div style={{ opacity: 0.7 }}>+{conflict.codes.length - 3}</div>
                                    )}
                                  </div>
                                ) : (
                                  <span style={{ fontSize: 14 }}>✓</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Footer */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 4 }}>
              <button
                onClick={() => setEditingGroup(null)}
                disabled={editSaving}
                style={{
                  background: "transparent", border: `1px solid ${C.border}`,
                  borderRadius: 8, padding: "10px 20px",
                  cursor: editSaving ? "not-allowed" : "pointer",
                  color: C.textMuted, fontSize: 13, ...mono,
                }}
              >
                İptal
              </button>
              <button
                onClick={saveEdit}
                disabled={editSaving || editChecked.size < 2}
                style={{
                  background: editChecked.size >= 2 ? C.accent : C.border,
                  color: editChecked.size >= 2 ? "#fff" : C.textMuted,
                  border: "none", borderRadius: 8, padding: "10px 20px",
                  cursor: (editSaving || editChecked.size < 2) ? "not-allowed" : "pointer",
                  fontSize: 13, fontWeight: 700, ...mono,
                  transition: "background 140ms ease-out",
                  display: "flex", alignItems: "center", gap: 8,
                }}
              >
                {editSaving ? <><Spinner size={13} /> Kaydediliyor…</> : "Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
