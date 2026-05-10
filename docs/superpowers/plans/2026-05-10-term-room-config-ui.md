# Term-Room Configuration UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-room "configure for active term" dialog to the Rooms page so admins can set TermResource overrides (capacity, day availability, unit restrictions, notes) for each room.

**Architecture:** Two-file change — create `TermResourceDialog.tsx` as a self-contained dialog component, modify `rooms/page.tsx` to fetch active-term data and render the dialog. The dialog receives all needed data as props and calls the API itself on save.

**Tech Stack:** Next.js 14, React, TypeScript, shadcn/ui (`Dialog`, `Button`, `Input`, `Label`), `useFetch`/`api` from `@/lib/api`, `C`/`mono` from `@/lib/colors`.

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/app/(app)/rooms/TermResourceDialog.tsx` | **Create** — the configure dialog |
| `frontend/src/app/(app)/rooms/page.tsx` | **Modify** — add fetches, button, badge, render dialog |

---

## Task 1: Create TermResourceDialog Component

**Files:**
- Create: `frontend/src/app/(app)/rooms/TermResourceDialog.tsx`

- [ ] **Step 1: Create the file with types, constants, and helpers**

Create `frontend/src/app/(app)/rooms/TermResourceDialog.tsx` with the following complete content:

```tsx
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
              style={{
                ...inputStyle,
                resize: "vertical",
              }}
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
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler/frontend
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors referencing `TermResourceDialog.tsx`.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/(app)/rooms/TermResourceDialog.tsx"
git commit -m "feat: add TermResourceDialog component"
```

---

## Task 2: Update Rooms Page

**Files:**
- Modify: `frontend/src/app/(app)/rooms/page.tsx`

The page needs four new things:
1. Import `TermResourceDialog` and its exported types
2. Three extra `useFetch` calls (terms, term-resources, academic-units) + derived state
3. A "Yapılandır" / "Düzenle" button per row + "Yapılandırıldı" badge
4. The `<TermResourceDialog>` rendered at the bottom

- [ ] **Step 1: Add imports at the top of page.tsx**

Replace the existing import block at the top of `frontend/src/app/(app)/rooms/page.tsx`:

```tsx
"use client";
import React, { useState } from "react";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import {
  Card, SL, Spinner, InfoBox, PageContainer, PageHeader,
  DataTable, DataRow, DataCell, ActionButton,
} from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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
import {
  TermResourceDialog,
  type Resource,
  type TermResource,
  type AcademicUnit,
} from "./TermResourceDialog";
```

- [ ] **Step 2: Add new state and derived data after the existing state declarations**

Inside `RoomsPage`, after the existing `deleteLoading` state, add:

```tsx
  // Term-resource config dialog
  const [configRoom, setConfigRoom] = useState<Resource | null>(null);

  // Active term + term-specific room configs
  const { data: termsData } = useFetch("/terms/");
  const terms: any[] = termsData?.results ?? termsData ?? [];
  const activeTerm = terms.find((t: any) => t.status === "Active") ?? null;

  const { data: trData, refetch: refetchTR } = useFetch(
    activeTerm ? `/term-resources/?term=${activeTerm.id}` : "",
    [activeTerm?.id]
  );
  const termResources: TermResource[] = trData?.results ?? trData ?? [];
  const termResourceMap: Record<string, TermResource> = Object.fromEntries(
    termResources.map((tr) => [tr.resource, tr])
  );

  // Academic units for the unit-restriction checkboxes
  const { data: unitsData } = useFetch("/academic-units/");
  const academicUnits: AcademicUnit[] = unitsData?.results ?? unitsData ?? [];
```

- [ ] **Step 3: Add the configure button and badge to each table row**

Find the existing row actions block inside the `rooms.map(...)` section. Replace the actions `<div>`:

```tsx
                <DataCell>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                    {termResourceMap[room.id] && (
                      <span style={{
                        fontSize: 11,
                        background: C.cyanSoft,
                        color: C.cyan,
                        padding: "3px 8px",
                        borderRadius: 4,
                        ...mono,
                      }}>
                        Yapılandırıldı
                      </span>
                    )}
                    <ActionButton
                      onClick={() => setConfigRoom(room as Resource)}
                      variant="secondary"
                      disabled={!activeTerm}
                      title={!activeTerm ? "Önce aktif bir dönem seçin" : undefined}
                    >
                      {termResourceMap[room.id] ? "Düzenle" : "Yapılandır"}
                    </ActionButton>
                    <ActionButton onClick={() => openEdit(room)} variant="secondary">Düzenle</ActionButton>
                    <ActionButton onClick={() => setDeleteTarget(room)} variant="danger">Sil</ActionButton>
                  </div>
                </DataCell>
```

- [ ] **Step 4: Render the TermResourceDialog at the bottom of the return block**

Add the dialog just before the final `</PageContainer>` closing tag:

```tsx
      {/* Term-resource configure dialog */}
      {configRoom && activeTerm && (
        <TermResourceDialog
          open={!!configRoom}
          onClose={() => setConfigRoom(null)}
          onSaved={refetchTR}
          room={configRoom}
          termId={activeTerm.id}
          existingConfig={termResourceMap[configRoom.id] ?? null}
          academicUnits={academicUnits}
        />
      )}
```

- [ ] **Step 5: Verify TypeScript compiles cleanly**

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler/frontend
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (or only pre-existing errors unrelated to rooms).

- [ ] **Step 6: Manual browser verification**

Start the frontend dev server and verify:

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler/frontend
npm run dev
```

Open `http://localhost:3000/rooms` and check:

1. Each room row has a "Yapılandır" button (disabled if no active term).
2. Clicking "Yapılandır" opens the dialog with the correct room name in the title.
3. Day toggle buttons all start selected (bitmask 127).
4. Filling in exam capacity override and clicking "Kaydet" creates a TermResource (check Network tab: POST `/api/term-resources/`).
5. The row now shows a "Yapılandırıldı" badge and the button label changes to "Düzenle".
6. Clicking "Düzenle" re-opens the dialog pre-filled with the saved values.
7. Updating a field and saving sends PATCH `/api/term-resources/<id>/`.
8. Deselecting all days and saving sends `available_days: 0`.
9. Selecting academic units and saving includes their IDs in `restricted_to_units`.

- [ ] **Step 7: Commit**

```bash
git add "frontend/src/app/(app)/rooms/page.tsx"
git commit -m "feat: rooms page — per-room term config button and TermResourceDialog"
```

---

## Self-Review

### Spec Coverage

| Requirement | Covered |
|-------------|---------|
| "Yapılandır" button per row | Task 2 Step 3 |
| "Yapılandırıldı" badge when config exists | Task 2 Step 3 |
| Button label changes to "Düzenle" when config exists | Task 2 Step 3 |
| Button disabled when no active term | Task 2 Step 3 |
| Dialog: is_active toggle | Task 1 Step 1 |
| Dialog: exam_capacity + full_capacity overrides | Task 1 Step 1 |
| Dialog: available_days day toggles (bitmask) | Task 1 Step 1 |
| Dialog: restricted_to_units checkbox list | Task 1 Step 1 |
| Dialog: notes textarea | Task 1 Step 1 |
| Pre-fill from existingConfig in edit mode | Task 1 Step 1 (useEffect) |
| POST on create, PATCH on edit | Task 1 Step 1 (handleSave) |
| onSaved triggers refetch | Task 2 Step 4 |
| Uses active term from sidebar (no extra selector) | Task 2 Step 2 |
| academicUnits fetched from /academic-units/ | Task 2 Step 2 |
| Empty units list shows "Bölümler yüklenemedi" | Task 1 Step 1 |
| Error displayed inline on save failure | Task 1 Step 1 |
