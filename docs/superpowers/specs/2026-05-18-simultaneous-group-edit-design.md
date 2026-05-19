# Design: Simultaneous Exam Group Editing

**Date:** 2026-05-18  
**Status:** Approved

## Problem

In `/exam-calendar?tab=simultaneous`, existing simultaneous exam groups can only be deleted — there is no way to edit which courses belong to a group or to reassign the group to a different calendar slot without destroying and recreating it.

## Solution: Approach B — PATCH endpoint + unified edit modal

### Backend

**File:** `core/views/simultaneous.py`

- Add `'patch'` to `http_method_names` on `SimultaneousExamGroupViewSet`
- Override `partial_update()` to accept:
  ```json
  { "slot": "<slot_id>", "course_ids": ["<id1>", "<id2>", ...] }
  ```
- Both fields are optional; either can be patched independently
- For course updates: delete existing `SimultaneousExamGroupCourse` rows for the group, then bulk-create new ones from `course_ids`
- Reuse existing validation from the serializer's `create()` — same exam period constraint, no course duplicated across groups (excluding the group being edited from the duplicate check)

**File:** `core/serializers.py` — no changes needed  
- The serializer's `validate()` already does `exclude(pk=self.instance.pk if self.instance else None)` in the sibling overlap check. Passing the instance via `serializer = Serializer(instance, data=..., partial=True)` will automatically exclude the group being edited from conflict detection.

### Frontend

**File:** `frontend/src/app/(app)/exam-calendar/SimultaneousExamsTab.tsx`

#### New state
```ts
editingGroup: SimGroup | null       // group currently open in the edit modal
editChecked: Set<string>            // course IDs selected in the edit modal
editSlotId: string | null           // selected slot ID in the edit modal
editSaving: boolean
editErr: string
```

#### "Düzenle" button
- Added next to the existing "Sil" button on each group card
- On click: populates `editingGroup`, `editChecked` (from group's current courses), `editSlotId` (from group's current slot), clears `editErr`

#### Edit modal — two sections

**Section 1: Ders Seçimi (course selection)**
- Shows courses currently in the group — pre-checked, visually highlighted (cyan border/background)
- Shows all ungrouped candidate courses (same filtered logic as the main course table, but the group being edited's courses are excluded from the "already grouped" hide-filter so they appear)
- Minimum 2 courses must remain checked for "Kaydet" to be enabled

**Section 2: Zaman Seçimi (slot calendar)**
- Same date×time grid as the existing slot-picker modal
- Current assigned slot shown with a distinct highlight (blue outline)
- Clicking a slot selects it; clicking the already-selected slot deselects it (unassigns)
- Conflict detection remains active — other groups' windows shown in red/amber as usual

#### Save flow
1. Call `PATCH /simultaneous-groups/<editingGroup.id>/` with `{ slot: editSlotId, course_ids: [...editChecked] }`
2. On success: close modal, call `refetchGroups()`
3. On error: display error message inline in the modal (same `ErrorBox` pattern as the existing slot picker)

## Data flow

```
User clicks Düzenle
  → editingGroup set, editChecked/editSlotId pre-populated
  → Edit modal opens

User adjusts courses / slot
  → editChecked / editSlotId updated in state

User clicks Kaydet
  → PATCH /simultaneous-groups/<id>/
  → Success: modal closes, groups list refreshed
  → Error: ErrorBox shown inside modal
```

## Constraints

- The existing DELETE flow is unchanged
- At least 2 courses must be selected to save
- A group must remain within the same exam period (slot picker is already filtered to the correct period's slots)
- The serializer's sibling overlap check already excludes the group being edited via `self.instance.pk` — no extra logic needed

## Files changed

| File | Change |
|------|--------|
| `core/views/simultaneous.py` | Add `patch` to `http_method_names`, add `partial_update()` |
| `core/serializers.py` | Extract or reuse validation for course uniqueness |
| `frontend/src/app/(app)/exam-calendar/SimultaneousExamsTab.tsx` | Add edit state, Düzenle button, edit modal |
