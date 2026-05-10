"use client";
import React, { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { C, mono } from "@/lib/colors";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface Resource {
  id: string;
  organization: string;
  name: string;
  type: string;
  full_capacity: number | null;
  exam_capacity: number | null;
  attributes: Record<string, unknown>;
  is_active: boolean;
}

export interface TermResource {
  id: string;
  resource: string;
  term: string;
  full_capacity: number | null;
  exam_capacity: number | null;
  effective_exam_capacity: number | null;
  available_days: number;
  restricted_to_units: string[];
  is_active: boolean;
  notes: string;
}

export interface AcademicUnit {
  id: string;
  name: string;
  type: string;
  organization: string;
  parent: string | null;
}

export interface TermResourceDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  room: Resource;
  termId: string;
  existingConfig: TermResource | null;
  academicUnits: AcademicUnit[];
}

const DAYS = [
  { label: "Pzt", bit: 1 },
  { label: "Sal", bit: 2 },
  { label: "Çar", bit: 4 },
  { label: "Per", bit: 8 },
  { label: "Cum", bit: 16 },
  { label: "Cmt", bit: 32 },
  { label: "Paz", bit: 64 },
];

const toggleDay = (mask: number, bit: number): number =>
  mask & bit ? mask & ~bit : mask | bit;

export function TermResourceDialog({
  open,
  onClose,
  onSaved,
  room,
  termId,
  existingConfig,
  academicUnits,
}: TermResourceDialogProps) {
  const [isActive, setIsActive] = useState(true);
  const [examCapacity, setExamCapacity] = useState("");
  const [fullCapacity, setFullCapacity] = useState("");
  const [availableDays, setAvailableDays] = useState(127);
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (existingConfig) {
      setIsActive(existingConfig.is_active);
      setExamCapacity(
        existingConfig.exam_capacity != null
          ? String(existingConfig.exam_capacity)
          : ""
      );
      setFullCapacity(
        existingConfig.full_capacity != null
          ? String(existingConfig.full_capacity)
          : ""
      );
      setAvailableDays(existingConfig.available_days);
      setSelectedUnits(existingConfig.restricted_to_units);
      setNotes(existingConfig.notes);
    } else {
      setIsActive(true);
      setExamCapacity("");
      setFullCapacity("");
      setAvailableDays(127);
      setSelectedUnits([]);
      setNotes("");
    }
    setError("");
  }, [open, existingConfig]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = {
        resource: room.id,
        term: termId,
        is_active: isActive,
        exam_capacity: examCapacity !== "" ? parseInt(examCapacity) : null,
        full_capacity: fullCapacity !== "" ? parseInt(fullCapacity) : null,
        available_days: availableDays,
        restricted_to_units: selectedUnits,
        notes,
      };
      if (existingConfig) {
        await api.patch(`/term-resources/${existingConfig.id}/`, payload);
      } else {
        await api.post("/term-resources/", payload);
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message || "Kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  };

  const toggleUnit = (id: string) =>
    setSelectedUnits((prev) =>
      prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id]
    );

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--surface)",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "10px 12px",
    color: C.text,
    outline: "none",
    fontSize: 13,
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{room.name} — Dönem Yapılandırması</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* is_active toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Label>Bu dönemde aktif</Label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                style={{ width: 16, height: 16, cursor: "pointer" }}
              />
              <span style={{ fontSize: 13, color: isActive ? C.green : C.textMuted }}>
                {isActive ? "Aktif" : "Pasif"}
              </span>
            </label>
          </div>

          {/* Capacity overrides */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tr-exam-cap">Sınav Kapasitesi</Label>
              <Input
                id="tr-exam-cap"
                type="number"
                value={examCapacity}
                onChange={(e) => setExamCapacity(e.target.value)}
                placeholder={String(room.exam_capacity ?? "—")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tr-full-cap">Tam Kapasite</Label>
              <Input
                id="tr-full-cap"
                type="number"
                value={fullCapacity}
                onChange={(e) => setFullCapacity(e.target.value)}
                placeholder={String(room.full_capacity ?? "—")}
              />
            </div>
          </div>

          {/* Available days */}
          <div className="flex flex-col gap-1.5">
            <Label>Uygun Günler</Label>
            <div style={{ display: "flex", gap: 6 }}>
              {DAYS.map(({ label, bit }) => {
                const selected = !!(availableDays & bit);
                return (
                  <button
                    key={bit}
                    type="button"
                    onClick={() => setAvailableDays(toggleDay(availableDays, bit))}
                    style={{
                      flex: 1,
                      padding: "6px 0",
                      borderRadius: 6,
                      border: `1px solid ${selected ? C.cyan : C.border}`,
                      background: selected ? C.cyanSoft : "transparent",
                      color: selected ? C.cyan : C.textMuted,
                      fontSize: 11,
                      fontWeight: selected ? 600 : 400,
                      cursor: "pointer",
                      transition: "all 120ms ease-out",
                      ...mono,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Academic unit restriction */}
          <div className="flex flex-col gap-1.5">
            <Label>
              Bölüm Kısıtı{" "}
              <span style={{ color: C.textMuted, fontSize: 11 }}>(boş = kısıt yok)</span>
            </Label>
            <div
              style={{
                maxHeight: 140,
                overflowY: "auto",
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "8px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {academicUnits.length === 0 ? (
                <span style={{ color: C.textMuted, fontSize: 12 }}>
                  Bölümler yüklenemedi
                </span>
              ) : (
                academicUnits.map((u) => (
                  <label
                    key={u.id}
                    style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedUnits.includes(u.id)}
                      onChange={() => toggleUnit(u.id)}
                      style={{ width: 14, height: 14, cursor: "pointer" }}
                    />
                    <span style={{ fontSize: 13, color: C.text }}>{u.name}</span>
                    <span style={{ fontSize: 11, color: C.textMuted, ...mono }}>
                      {u.type}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tr-notes">Notlar</Label>
            <textarea
              id="tr-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
              placeholder="Opsiyonel not..."
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            İptal
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
