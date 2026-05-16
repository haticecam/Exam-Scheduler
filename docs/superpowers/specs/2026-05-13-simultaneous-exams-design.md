# Simultaneous Exams Feature Design

**Date:** 2026-05-13  
**Branch:** simultaneous-exam-features  
**Status:** Approved

---

## Summary

Add a third tab "Eş zamanlı sınavlar" to the existing "Sınav Takvimi" page (`/exam-calendar`). Users can define groups of courses that must be scheduled at the exact same time slot. These groups are saved to the database per exam period and are automatically applied when the optimizer runs on that period.

---

## Database

### New models (2 new tables)

```python
class SimultaneousExamGroup(models.Model):
    id          = UUIDField(primary_key=True)
    exam_period = ForeignKey(ExamPeriod, on_delete=CASCADE, related_name='simultaneous_groups')
    slot        = ForeignKey(ExamDateSlot, on_delete=SET_NULL, null=True, blank=True)
    label       = CharField(max_length=255, blank=True)  # auto-generated: "Grup 1", "Grup 2", …

class SimultaneousExamGroupCourse(models.Model):
    group  = ForeignKey(SimultaneousExamGroup, on_delete=CASCADE, related_name='courses')
    course = ForeignKey(CourseCatalog, on_delete=CASCADE)

    class Meta:
        unique_together = ('group', 'course')
```

**Why not `ExamPeriod.config` JSONField:**  
The config field is a single column blob — no referential integrity, no clean CRUD endpoints, no cascade deletes. A dedicated model gives free DRF ViewSet CRUD and proper FK cleanup.

### Migration

One new migration file with both tables.

---

## Backend

### API endpoints (new ViewSet)

| Method | URL | Action |
|--------|-----|--------|
| GET | `/api/simultaneous-groups/?exam_period_id=<id>` | List all groups for a period |
| POST | `/api/simultaneous-groups/` | Create a new group (with course IDs + slot ID) |
| DELETE | `/api/simultaneous-groups/<id>/` | Delete a group |

Serializer returns: `id`, `label`, `slot` (date + start_time + end_time), `courses` (list of course_id, code, name, dept, year_level).

### Optimizer integration

In `tasks.py`, before calling `svc.solve()`:

```python
from core.models import SimultaneousExamGroup

groups_qs = SimultaneousExamGroup.objects.filter(
    exam_period_id=exam_period_id
).prefetch_related('courses', 'slot')

pinned_exams = {}
for group in groups_qs:
    if not group.slot:
        continue
    slot_index = _compute_slot_index(group.slot, calendar)
    for gc in group.courses.all():
        # unit_key format: course_id|student_dept_id
        # Pin all dept variants of this course to the same slot
        for unit_key in [k for k in C if k.startswith(str(gc.course_id) + "|")]:
            pinned_exams[unit_key] = slot_index
```

In `optimizer.py`, `solve()` gains a `pinned_exams: dict = None` parameter. After `m.update()` and before `m.optimize()`:

```python
if pinned_exams:
    for unit_key, slot in pinned_exams.items():
        if unit_key in info and (unit_key, slot) in y:
            y[(unit_key, slot)].lb = 1
```

The existing `one_start` constraint (sum == 1) automatically zeroes out all other slots for that course.

---

## Frontend

### Tab addition

Add `"simultaneous"` to the tab array in `exam-calendar/page.tsx`:

```tsx
{ id: "simultaneous", label: "Eş zamanlı sınavlar" }
```

### Tab layout (top to bottom)

**1. Term & Calendar selectors**
- Two dropdowns: Dönem, Sınav Takvimi (same `optSelectStyle` pattern as "Ders Seçimi" tab)
- Nothing below renders until both are selected

**2. Existing groups panel**
- Fetched from `GET /api/simultaneous-groups/?exam_period_id=<id>`
- Each group rendered as a card:
  - Header: label + slot date/time
  - Body: list of course codes + names
  - Footer: "Sil" delete button (calls DELETE, refetches list)
- Empty state: "Henüz eş zamanlı sınav grubu oluşturulmadı."

**3. Course list with checkboxes**
- Filters: Bölüm (dept), Yıl (1–4), Tür (Zorunlu/Seçmeli), Arama (text search)
- Data source: `/course-sections/?term_id=<id>` (term-enrolled courses only, same endpoint as "Ders Seçimi" tab)
- Each row has a checkbox (left column)
- "Eş Zamanlı Yap" button above the table — disabled until ≥ 2 courses checked

**4. Slot picker modal**
- Opens when "Eş Zamanlı Yap" is clicked
- Renders the same date × time grid as the "Sınav Takvimi" tab
- User selects only the **start time cell** — one click, one cell. No range selection.
- Exam duration is not shown or selected here; Gurobi handles it internally using each course's `exam_duration_minutes` / weekly hours.
- Blocked cells (`is_blocked=true`): greyed out, cursor `not-allowed`, not clickable. This covers both individually blocked slots and fully-blocked days (since blocking a day sets `is_blocked=true` on all its slots).
- Clicking an available (unblocked) cell:
  1. POSTs to `/api/simultaneous-groups/` with `{ exam_period_id, slot_id, course_ids: [...] }`
  2. Closes modal
  3. Clears all checkboxes
  4. Refetches groups panel → new group card appears immediately

---

## Data flow

```
User checks courses → clicks "Eş Zamanlı Yap"
  → modal opens (slots from existing slotsData)
  → user clicks unblocked slot
  → POST /api/simultaneous-groups/
  → group saved: SimultaneousExamGroup + SimultaneousExamGroupCourse rows
  → group card appears in Section 2

User runs optimizer (optimizer page)
  → tasks.py loads SimultaneousExamGroup for the exam_period
  → computes slot indices → builds pinned_exams dict
  → passes to svc.solve(pinned_exams=...)
  → optimizer.py fixes y[(unit_key, slot)].lb = 1 before m.optimize()
```

---

## Error handling

- If a pinned slot is blocked or invalid for a course duration: log a warning and skip (do not crash the optimizer)
- If a group has no slot assigned: skip it silently
- If all courses in a group share a hard conflict with each other: infeasible — surfaces through the existing IIS diagnostics path
- Frontend: if POST fails, show inline error in modal, keep modal open

---

## Out of scope (this phase)

- Editing a group's slot after creation (user deletes and recreates)
- Editing which courses are in a group after creation (user deletes and recreates)
- Showing simultaneous groups on the schedule/calendar view
- Conflict warnings in the UI before running the optimizer
