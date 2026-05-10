# Term-Room Configuration UI — Design Spec

**Date:** 2026-05-10
**Status:** Approved

---

## Goal

Add a per-room "configure for active term" dialog to the Rooms page so administrators can set term-specific capacity overrides, day availability, academic unit restrictions, and notes for each room via the `TermResource` API.

---

## Scope

- **In scope:** Dialog UI on the Rooms page, data fetching, create/update via `/api/term-resources/`, visual indicator when a room is already configured for the active term.
- **Out of scope:** Enforcing `available_days` / `restricted_to_units` in the solver MIP (tracked separately), bulk-configure all rooms at once, term-resource deletion from the UI.

---

## Architecture

### Files

| File | Change |
|------|--------|
| `frontend/src/app/(app)/rooms/TermResourceDialog.tsx` | **Create** — self-contained configure dialog |
| `frontend/src/app/(app)/rooms/page.tsx` | **Modify** — add data fetches, button per row, badge indicator |

`page.tsx` owns all data fetching and passes data down as props. The dialog manages its own form state and calls the API directly, signaling completion via `onSaved()`.

### Data Flow

`page.tsx` fetches on mount (parallel where possible):

1. `/resources/` — rooms list (existing)
2. `/terms/` — to identify the active term
3. `/academic-units/` — for unit restriction checkboxes

Once the active term is known, a dependent fetch runs:

4. `/term-resources/?term=<activeTermId>` — term-specific configs

A derived lookup map is built:

```ts
const termResourceMap: Record<string, TermResource> = Object.fromEntries(
  termResources.map(tr => [tr.resource, tr])
);
```

This lets each row cheaply check `termResourceMap[room.id]` to know whether a config exists.

---

## Rooms Table Changes

The existing action buttons column gains a fourth button per row:

| State | Button label | Extra indicator |
|-------|-------------|-----------------|
| No TermResource for active term | **Yapılandır** | — |
| TermResource exists | **Düzenle** | `"Yapılandırıldı"` badge (cyan) |

The button is disabled (greyed out with a tooltip) when no active term is found.

---

## TermResourceDialog Component

### Props

```ts
interface TermResourceDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  room: Resource;                     // org-level room record
  termId: string;                     // active term UUID
  existingConfig: TermResource | null; // null = create mode, object = edit mode
  academicUnits: AcademicUnit[];
}
```

### Fields

| Field | Input type | Default (create) | Notes |
|-------|-----------|-----------------|-------|
| `is_active` | Checkbox / Switch | `true` | "Bu dönemde aktif" |
| `exam_capacity` | Number input (nullable) | `""` | Placeholder = `room.exam_capacity` |
| `full_capacity` | Number input (nullable) | `""` | Placeholder = `room.full_capacity` |
| `available_days` | 7 toggle buttons | `127` (all selected) | Pzt=1, Sal=2, Çar=4, Per=8, Cum=16, Cmt=32, Paz=64 |
| `restricted_to_units` | Scrollable checkbox list | `[]` (none selected = no restriction) | Academic units from props |
| `notes` | Textarea | `""` | Optional free text |

### Bitmask Helper

```ts
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
```

### Save Behavior

- **Create mode** (`existingConfig === null`): `POST /api/term-resources/`
- **Edit mode** (`existingConfig !== null`): `PATCH /api/term-resources/<id>/`

Payload always omits empty-string capacity overrides (send `null` instead of `""`).

On success: call `onSaved()` then `onClose()`. `onSaved` triggers a refetch of the term-resources list in `page.tsx`.

On error: display error message inside the dialog footer.

---

## State in page.tsx

New state additions:

```ts
const [configRoom, setConfigRoom] = useState<Resource | null>(null);
```

`configRoom !== null` opens the dialog. On close, `setConfigRoom(null)`. On `onSaved`, refetch term-resources.

Active term derivation:

```ts
const activeTerm = (terms as Term[]).find(t => t.status === "Active") ?? null;
```

---

## Error States

| Scenario | Handling |
|----------|---------|
| No active term | Configure button is disabled; tooltip "Önce aktif bir dönem seçin" |
| Academic units fetch fails | Scrollable list shows "Bölümler yüklenemedi" |
| Save fails | Inline error below the dialog footer buttons |
| Term-resources fetch fails | Silently treat as empty (no badge, button shows "Yapılandır") |

---

## UI Consistency Notes

- All styling follows existing patterns: `inputStyle` inline styles for custom inputs, shadcn `Dialog`/`Button`/`Input`/`Label`/`Switch` for standard controls.
- Day toggle buttons use `C.cyan` / `C.cyanSoft` for selected state (matches existing badge styling).
- The `"Yapılandırıldı"` badge uses the same `span` styling as the room type badge.
- Turkish labels throughout, consistent with the rest of the page.
