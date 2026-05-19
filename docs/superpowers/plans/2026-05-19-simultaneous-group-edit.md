# Simultaneous Group Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to edit the courses and/or slot assignment of an existing simultaneous exam group without deleting and recreating it.

**Architecture:** A PATCH endpoint is added to `SimultaneousExamGroupViewSet` that accepts optional `slot` and `course_ids` fields, validates slot conflicts, and applies partial updates. The frontend adds an "Düzenle" button to each group card that opens a unified modal with two sections — course checkboxes and a slot calendar grid — and calls the PATCH endpoint on save.

**Tech Stack:** Django REST Framework (backend), React + TypeScript + custom `api` fetch wrapper (frontend)

---

## File Map

| File | Change |
|------|--------|
| `core/views/simultaneous.py` | Add `'patch'` to `http_method_names`, add `partial_update()` |
| `core/tests/test_simultaneous_exams.py` | Add PATCH endpoint tests |
| `frontend/src/app/(app)/exam-calendar/SimultaneousExamsTab.tsx` | Add edit state, openEdit, saveEdit, Düzenle button, edit modal |

---

## Task 1: Backend — PATCH endpoint (TDD)

**Files:**
- Modify: `core/tests/test_simultaneous_exams.py`
- Modify: `core/views/simultaneous.py`

---

- [ ] **Step 1: Add test fixtures and failing PATCH tests**

Append to `core/tests/test_simultaneous_exams.py`:

```python
import datetime
import pytest
from rest_framework.test import APIClient
from django.contrib.auth.models import User as DjangoUser
from rest_framework.authtoken.models import Token
from core.models import (
    Organization, Term, ExamPeriod, ExamDateSlot,
    CourseCatalog, AcademicUnit,
    SimultaneousExamGroup, SimultaneousExamGroupCourse,
)


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def api_client(db):
    user = DjangoUser.objects.create_user("testadmin2", password="pass")
    token = Token.objects.create(user=user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return client


@pytest.fixture
def org2(db):
    return Organization.objects.create(name="Patch Test University")


@pytest.fixture
def term2(org2):
    return Term.objects.create(organization=org2, name="Spring 2026", status="Active")


@pytest.fixture
def dept2(org2):
    return AcademicUnit.objects.create(
        organization=org2, name="Math", type="Department",
        scheduling_config={"code": "MATH"},
    )


@pytest.fixture
def period2(term2):
    return ExamPeriod.objects.create(
        term=term2,
        name="Finals",
        exam_type="FINAL",
        start_date=datetime.date(2026, 6, 1),
        end_date=datetime.date(2026, 6, 1),
        config={},
    )


@pytest.fixture
def slot_a(period2):
    return ExamDateSlot.objects.create(
        exam_period=period2,
        date=datetime.date(2026, 6, 1),
        start_time=datetime.time(9, 0),
        end_time=datetime.time(9, 30),
        is_blocked=False,
    )


@pytest.fixture
def slot_b(period2):
    return ExamDateSlot.objects.create(
        exam_period=period2,
        date=datetime.date(2026, 6, 1),
        start_time=datetime.time(10, 0),
        end_time=datetime.time(10, 30),
        is_blocked=False,
    )


@pytest.fixture
def course_x(org2, dept2):
    return CourseCatalog.objects.create(
        organization=org2, academic_unit=dept2,
        code="MATH101", name="Calculus", year_level=1,
        weekly_hours_lecture=2, requirement="COMPULSORY",
    )


@pytest.fixture
def course_y(org2, dept2):
    return CourseCatalog.objects.create(
        organization=org2, academic_unit=dept2,
        code="MATH101", name="Calculus", year_level=1,
        weekly_hours_lecture=2, requirement="COMPULSORY",
    )


@pytest.fixture
def course_z(org2, dept2):
    return CourseCatalog.objects.create(
        organization=org2, academic_unit=dept2,
        code="MATH101", name="Calculus", year_level=1,
        weekly_hours_lecture=2, requirement="COMPULSORY",
    )


@pytest.fixture
def group2(period2, slot_a, course_x, course_y):
    g = SimultaneousExamGroup.objects.create(
        exam_period=period2, slot=slot_a, label="Grup 1"
    )
    SimultaneousExamGroupCourse.objects.bulk_create([
        SimultaneousExamGroupCourse(group=g, course=course_x),
        SimultaneousExamGroupCourse(group=g, course=course_y),
    ])
    return g


# ── PATCH tests ───────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_patch_slot_only(api_client, group2, slot_b):
    """PATCH with only a new slot updates the slot and leaves courses unchanged."""
    res = api_client.patch(
        f"/api/simultaneous-groups/{group2.id}/",
        {"slot": str(slot_b.id)},
        format="json",
    )
    assert res.status_code == 200, res.data
    group2.refresh_from_db()
    assert group2.slot_id == slot_b.id
    assert group2.group_courses.count() == 2


@pytest.mark.django_db
def test_patch_course_ids_only(api_client, group2, slot_a, course_x, course_z):
    """PATCH with only course_ids updates courses and leaves slot unchanged."""
    res = api_client.patch(
        f"/api/simultaneous-groups/{group2.id}/",
        {"course_ids": [str(course_x.id), str(course_z.id)]},
        format="json",
    )
    assert res.status_code == 200, res.data
    group2.refresh_from_db()
    assert group2.slot_id == slot_a.id
    ids = set(group2.group_courses.values_list("course_id", flat=True))
    assert ids == {course_x.id, course_z.id}


@pytest.mark.django_db
def test_patch_both_slot_and_courses(api_client, group2, slot_b, course_x, course_z):
    """PATCH with both slot and course_ids updates both."""
    res = api_client.patch(
        f"/api/simultaneous-groups/{group2.id}/",
        {"slot": str(slot_b.id), "course_ids": [str(course_x.id), str(course_z.id)]},
        format="json",
    )
    assert res.status_code == 200, res.data
    group2.refresh_from_db()
    assert group2.slot_id == slot_b.id
    ids = set(group2.group_courses.values_list("course_id", flat=True))
    assert ids == {course_x.id, course_z.id}


@pytest.mark.django_db
def test_patch_requires_at_least_two_courses(api_client, group2, course_x):
    """PATCH with fewer than 2 course_ids returns 400."""
    res = api_client.patch(
        f"/api/simultaneous-groups/{group2.id}/",
        {"course_ids": [str(course_x.id)]},
        format="json",
    )
    assert res.status_code == 400


@pytest.mark.django_db
def test_patch_unassign_slot(api_client, group2):
    """PATCH with slot=null unassigns the slot."""
    res = api_client.patch(
        f"/api/simultaneous-groups/{group2.id}/",
        {"slot": None},
        format="json",
    )
    assert res.status_code == 200, res.data
    group2.refresh_from_db()
    assert group2.slot is None
```

- [ ] **Step 2: Run the new tests — they must all FAIL**

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler
pytest core/tests/test_simultaneous_exams.py::test_patch_slot_only \
       core/tests/test_simultaneous_exams.py::test_patch_course_ids_only \
       core/tests/test_simultaneous_exams.py::test_patch_both_slot_and_courses \
       core/tests/test_simultaneous_exams.py::test_patch_requires_at_least_two_courses \
       core/tests/test_simultaneous_exams.py::test_patch_unassign_slot \
       -v
```

Expected: All 5 FAIL (405 Method Not Allowed — `patch` not in `http_method_names`)

- [ ] **Step 3: Implement `partial_update()` in `core/views/simultaneous.py`**

Replace the entire file with:

```python
from rest_framework import viewsets, serializers as drf_serializers
from rest_framework.response import Response

from ..models import SimultaneousExamGroup, SimultaneousExamGroupCourse, ExamDateSlot
from ..serializers import SimultaneousExamGroupSerializer
from ..services.exam_duration import group_exam_duration_minutes


class SimultaneousExamGroupViewSet(viewsets.ModelViewSet):
    serializer_class = SimultaneousExamGroupSerializer
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_queryset(self):
        qs = SimultaneousExamGroup.objects.prefetch_related(
            'group_courses__course', 'slot'
        ).order_by('label')
        exam_period_id = self.request.query_params.get('exam_period_id')
        if exam_period_id:
            qs = qs.filter(exam_period_id=exam_period_id)
        return qs

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()

        # --- Update course_ids first (may affect duration used in slot check) ---
        if 'course_ids' in request.data:
            course_ids = request.data.get('course_ids') or []
            if len(course_ids) < 2:
                raise drf_serializers.ValidationError(
                    {'course_ids': 'En az 2 ders seçmelisiniz.'}
                )
            instance.group_courses.all().delete()
            SimultaneousExamGroupCourse.objects.bulk_create([
                SimultaneousExamGroupCourse(group=instance, course_id=cid)
                for cid in course_ids
            ])

        # --- Update slot (with conflict check) ---
        if 'slot' in request.data:
            slot_id = request.data.get('slot')
            if slot_id is None:
                instance.slot = None
            else:
                try:
                    new_slot = ExamDateSlot.objects.get(
                        pk=slot_id, exam_period=instance.exam_period
                    )
                except ExamDateSlot.DoesNotExist:
                    raise drf_serializers.ValidationError(
                        {'slot': 'Bu sınav dönemine ait geçerli bir slot değil.'}
                    )
                self._check_slot_conflict(instance, new_slot)
                instance.slot = new_slot
            instance.save(update_fields=['slot'])

        instance.refresh_from_db()
        return Response(self.get_serializer(instance).data)

    @staticmethod
    def _check_slot_conflict(instance: SimultaneousExamGroup, new_slot: ExamDateSlot):
        def _min(t):
            return t.hour * 60 + t.minute

        session_mode = (instance.exam_period.config or {}).get('slot_mode') == 'session'
        slot_duration = _min(new_slot.end_time) - _min(new_slot.start_time)

        courses = [gc.course for gc in instance.group_courses.select_related('course').all()]
        new_dur = group_exam_duration_minutes(courses, slot_duration, session_mode)
        new_start = _min(new_slot.start_time)
        new_end = new_start + new_dur

        siblings = (
            SimultaneousExamGroup.objects
            .filter(exam_period=instance.exam_period, slot__date=new_slot.date)
            .exclude(slot__isnull=True)
            .exclude(pk=instance.pk)
            .prefetch_related('group_courses__course', 'slot')
        )
        for g in siblings:
            g_courses = [gc.course for gc in g.group_courses.all()]
            g_dur = group_exam_duration_minutes(g_courses, slot_duration, session_mode)
            g_start = _min(g.slot.start_time)
            g_end = g_start + g_dur
            if new_start < g_end and g_start < new_end:
                raise drf_serializers.ValidationError(
                    {'slot': f"Bu slot '{g.label}' grubuyla çakışıyor."}
                )
```

- [ ] **Step 4: Run the failing tests — they must all PASS**

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler
pytest core/tests/test_simultaneous_exams.py::test_patch_slot_only \
       core/tests/test_simultaneous_exams.py::test_patch_course_ids_only \
       core/tests/test_simultaneous_exams.py::test_patch_both_slot_and_courses \
       core/tests/test_simultaneous_exams.py::test_patch_requires_at_least_two_courses \
       core/tests/test_simultaneous_exams.py::test_patch_unassign_slot \
       -v
```

Expected: All 5 PASS

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler
pytest core/tests/ -v
```

Expected: All previously passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add core/views/simultaneous.py core/tests/test_simultaneous_exams.py
git commit -m "feat: add PATCH endpoint for simultaneous exam group editing"
```

---

## Task 2: Frontend — Edit state, openEdit, saveEdit, Düzenle button

**Files:**
- Modify: `frontend/src/app/(app)/exam-calendar/SimultaneousExamsTab.tsx`

---

- [ ] **Step 1: Add edit state variables**

After the existing state declarations (around line 150, after `const [deletingId, setDeletingId] = ...`), add:

```tsx
const [editingGroup, setEditingGroup] = useState<SimGroup | null>(null);
const [editChecked, setEditChecked] = useState<Set<string>>(new Set());
const [editSlotId, setEditSlotId] = useState<string | null>(null);
const [editSaving, setEditSaving] = useState(false);
const [editErr, setEditErr] = useState("");
```

- [ ] **Step 2: Add `openEdit` callback**

After the `deleteGroup` function (around line 372), add:

```tsx
const openEdit = useCallback((group: SimGroup) => {
  setEditingGroup(group);
  setEditChecked(new Set(group.courses.map(c => String(c.course_id))));
  setEditSlotId(group.slot ?? null);
  setEditErr("");
}, []);
```

- [ ] **Step 3: Add `saveEdit` callback**

After `openEdit`, add:

```tsx
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
```

- [ ] **Step 4: Add "Düzenle" button to each group card**

In the group card's button row (around line 424, the row that has the "Sil" button), add a "Düzenle" button **before** the "Sil" button:

Find:
```tsx
                      <button
                        onClick={() => deleteGroup(g.id)}
                        disabled={deletingId === g.id}
```

Replace the `<div style={{ display: "flex", justifyContent: "space-between" ...}>` wrapper to add the edit button:

```tsx
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
```

- [ ] **Step 5: Verify the Düzenle button appears and opens state (no modal yet)**

Start the dev server and open `http://localhost:3000/exam-calendar?tab=simultaneous`. Select a term and period. Confirm:
- "Düzenle" button appears on each group card
- Browser DevTools shows no console errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/(app)/exam-calendar/SimultaneousExamsTab.tsx
git commit -m "feat: add edit state, openEdit/saveEdit handlers, and Düzenle button"
```

---

## Task 3: Frontend — Edit modal (courses + slot sections)

**Files:**
- Modify: `frontend/src/app/(app)/exam-calendar/SimultaneousExamsTab.tsx`

---

- [ ] **Step 1: Add `editCandidates` memo**

After the `newGroupDurationMinutes` memo, add:

```tsx
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
```

- [ ] **Step 2: Add edit-modal conflict detection memos**

After `editCandidates`, add three memos for the edit modal's slot grid conflict detection:

```tsx
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
```

- [ ] **Step 3: Add the edit modal JSX**

After the existing `{/* 4 — Slot picker modal */}` block (after its closing `}`), add the edit modal:

```tsx
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
```

- [ ] **Step 4: Verify the full edit flow in the browser**

Start the dev server (`cd frontend && npm run dev`) and open `http://localhost:3000/exam-calendar?tab=simultaneous`.

Test these scenarios:
1. Click "Düzenle" on a group — modal opens, current courses are pre-checked (cyan highlight), current slot is highlighted in blue
2. Uncheck a course — "Kaydet" disables when < 2 checked
3. Check a new course, click a different slot, click "Kaydet" — modal closes, group card updates
4. Click "Düzenle" again — the updated courses and slot are pre-filled
5. Open edit modal, click the currently selected slot — it deselects (slot becomes unassigned)
6. Verify blocked slots still show ✕ and can't be selected
7. Verify other groups' windows still show in red/amber

- [ ] **Step 5: Check for TypeScript errors**

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler/frontend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/(app)/exam-calendar/SimultaneousExamsTab.tsx
git commit -m "feat: add simultaneous group edit modal with course and slot editing"
```
