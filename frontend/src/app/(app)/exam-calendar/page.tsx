"use client";
import React, { useState, useCallback } from "react";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, SL, Spinner, ErrorBox } from "@/components/ui";

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
  const { data: termsData } = useFetch("/terms/");
  const terms = termsData?.results || termsData || [];

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

  type SlotDef = { start: string; end: string; label: string };
  const [genMode, setGenMode] = useState<"auto" | "manual">("auto");
  const [genAuto, setGenAuto] = useState({ day_start: "08:30", day_end: "18:00" });
  const [manualSlots, setManualSlots] = useState<SlotDef[]>([
    { start: "09:00", end: "12:00", label: "1. Oturum" },
    { start: "14:00", end: "17:00", label: "2. Oturum" },
  ]);
  const [genLoading, setGenLoading] = useState(false);
  const [genErr, setGenErr] = useState("");

  const addManualSlot = () =>
    setManualSlots(prev => [...prev, { start: "09:00", end: "12:00", label: `${prev.length + 1}. Oturum` }]);

  const removeManualSlot = (idx: number) =>
    setManualSlots(prev => prev.filter((_, i) => i !== idx));

  const updateManualSlot = (idx: number, field: keyof SlotDef, value: string) =>
    setManualSlots(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));

  const generateSlots = async () => {
    if (!selectedPeriodId) return;
    setGenLoading(true); setGenErr(""); setSlotsLoaded(false);
    const body = genMode === "auto"
      ? genAuto
      : { slots: manualSlots };
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

  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 700, color: C.text, margin: "0 0 6px", ...mono }}>
        Sınav Takvimi
      </h2>
      <p style={{ color: C.textMuted, fontSize: 14, marginBottom: 24 }}>
        Sınav haftasını seçin, zaman dilimlerini ve engellenen günleri yönetin.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        <Card style={{ padding: 24 }}>
          <SL>DÖNEM & TAKVİM SEÇİMİ</SL>
          <div style={{ marginBottom: 14 }}>
            <label style={lStyle}>AKTİF DÖNEM</label>
            <select style={{ ...iStyle, cursor: "pointer" }} value={selectedTermId}
              onChange={e => { setSelectedTermId(e.target.value); setSelectedPeriodId(""); setSlotsLoaded(false); }}>
              <option value="">— Dönem seçin —</option>
              {(terms as Array<{ id: string; name: string }>).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          {periods.length > 0 && (
            <div>
              <label style={lStyle}>MEVCUT SINAV TAKVİMİ</label>
              <select style={{ ...iStyle, cursor: "pointer" }} value={selectedPeriodId}
                onChange={e => { setSelectedPeriodId(e.target.value); setSlotsLoaded(false); }}>
                <option value="">— Takvim seçin —</option>
                {periods.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.start_date} → {p.end_date})
                  </option>
                ))}
              </select>
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
            {(["auto", "manual"] as const).map(m => (
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
                {m === "auto" ? "Otomatik 30dk" : "Manuel Oturumlar"}
              </button>
            ))}
          </div>

          {genMode === "auto" && (
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
              <div>
                <label style={lStyle}>GÜN BAŞLANGICI</label>
                <input style={{ ...iStyle, width: 110 }} type="time" value={genAuto.day_start}
                  onChange={e => setGenAuto({ ...genAuto, day_start: e.target.value })} />
              </div>
              <div>
                <label style={lStyle}>GÜN BİTİŞİ</label>
                <input style={{ ...iStyle, width: 110 }} type="time" value={genAuto.day_end}
                  onChange={e => setGenAuto({ ...genAuto, day_end: e.target.value })} />
              </div>
            </div>
          )}

          {genMode === "manual" && (
            <div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                {manualSlots.map((slot, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div>
                      <label style={lStyle}>BAŞLANGIÇ</label>
                      <input style={{ ...iStyle, width: 110 }} type="time" value={slot.start}
                        onChange={e => updateManualSlot(idx, "start", e.target.value)} />
                    </div>
                    <div>
                      <label style={lStyle}>BİTİŞ</label>
                      <input style={{ ...iStyle, width: 110 }} type="time" value={slot.end}
                        onChange={e => updateManualSlot(idx, "end", e.target.value)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={lStyle}>ETİKET</label>
                      <input style={iStyle} value={slot.label} placeholder="Örn: Sabah Oturumu"
                        onChange={e => updateManualSlot(idx, "label", e.target.value)} />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeManualSlot(idx)}
                      disabled={manualSlots.length <= 1}
                      style={{ marginTop: 18, background: "transparent", border: `1px solid ${C.red}55`, borderRadius: 6, color: C.red, padding: "8px 10px", cursor: "pointer", ...mono, fontSize: 12, opacity: manualSlots.length <= 1 ? 0.3 : 1 }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addManualSlot}
                style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, color: C.textMuted, padding: "7px 14px", cursor: "pointer", ...mono, fontSize: 12 }}>
                + Oturum Ekle
              </button>
            </div>
          )}

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
    </div>
  );
}
