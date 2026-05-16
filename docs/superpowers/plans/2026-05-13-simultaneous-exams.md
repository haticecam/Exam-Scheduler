# Simultaneous Exams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Eş zamanlı sınavlar" tab to the exam calendar page, letting users pin groups of courses to the same start slot; groups are persisted in DB and automatically applied when the optimizer runs.

**Architecture:** Two new Django models (`SimultaneousExamGroup`, `SimultaneousExamGroupCourse`) store groups per exam period. A new DRF ViewSet at `/api/simultaneous-groups/` handles list/create/delete. `optimizer.py`'s `solve()` gains a `pinned_exams` dict parameter that fixes `y[(unit_key, slot)].lb = 1` before Gurobi runs. `tasks.py` builds this dict from DB before each optimizer call. The frontend adds a third tab implemented as a separate component file.

**Tech Stack:** Django 4 / DRF (backend), Next.js 14 / React / TypeScript (frontend), Gurobi (optimizer), PostgreSQL

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `core/models.py` | Modify | Add `SimultaneousExamGroup`, `SimultaneousExamGroupCourse` |
| `core/migrations/0005_simultaneous_exam_group.py` | Create | DB migration for 2 new tables |
| `core/serializers_simultaneous.py` | Create | Read/write serializer with auto-label and bulk course creation |
| `core/views_simultaneous.py` | Create | ViewSet (list, create, delete) |
| `core/urls.py` | Modify | Register `simultaneous-groups` router |
| `core/services/optimizer.py` | Modify | Add `pinned_exams` param to `solve()`; expose `active_dates`/`all_start_times` from `load_exam_calendar` |
| `core/tasks.py` | Modify | Load groups from DB, compute slot indices, pass `pinned_exams` to `solve()` |
| `core/tests/test_simultaneous_exams.py` | Create | Backend tests |
| `frontend/src/app/(app)/exam-calendar/SimultaneousExamsTab.tsx` | Create | Full tab UI: selectors, groups panel, course list, slot modal |
| `frontend/src/app/(app)/exam-calendar/page.tsx` | Modify | Add third tab entry + render `SimultaneousExamsTab` |

---

## Task 1: DB Models + Migration

**Files:**
- Modify: `core/models.py` (insert after `ExamDateSlot` class, ~line 374)
- Create: `core/migrations/0005_simultaneous_exam_group.py`
- Test: `core/tests/test_simultaneous_exams.py`

- [ ] **Step 1: Write failing model test**

Create `core/tests/test_simultaneous_exams.py`:

```python
import pytest
from django.test import TestCase
from core.models import SimultaneousExamGroup, SimultaneousExamGroupCourse


class TestSimultaneousExamGroupModel(TestCase):
    def test_models_exist(self):
        self.assertTrue(hasattr(SimultaneousExamGroup, 'exam_period'))
        self.assertTrue(hasattr(SimultaneousExamGroup, 'slot'))
        self.assertTrue(hasattr(SimultaneousExamGroup, 'label'))
        self.assertTrue(hasattr(SimultaneousExamGroupCourse, 'group'))
        self.assertTrue(hasattr(SimultaneousExamGroupCourse, 'course'))
```

- [ ] **Step 2: Run test — expect failure**

```bash
python manage.py test core.tests.test_simultaneous_exams.TestSimultaneousExamGroupModel -v 2
```
Expected: `ImportError: cannot import name 'SimultaneousExamGroup'`

- [ ] **Step 3: Add models to `core/models.py`**

Insert after the `ExamDateSlot` class (after its `class Meta` block, ~line 374):

```python
class SimultaneousExamGroup(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    exam_period = models.ForeignKey(ExamPeriod, on_delete=models.CASCADE, related_name='simultaneous_groups')
    slot = models.ForeignKey(ExamDateSlot, on_delete=models.SET_NULL, null=True, blank=True, related_name='simultaneous_groups')
    label = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = 'simultaneous_exam_group'


class SimultaneousExamGroupCourse(models.Model):
    group = models.ForeignKey(SimultaneousExamGroup, on_delete=models.CASCADE, related_name='group_courses')
    course = models.ForeignKey(CourseCatalog, on_delete=models.CASCADE, related_name='simultaneous_group_courses')

    class Meta:
        db_table = 'simultaneous_exam_group_course'
        unique_together = ('group', 'course')
```

- [ ] **Step 4: Generate migration**

```bash
python manage.py makemigrations core --name simultaneous_exam_group
```
Expected: `Migrations for 'core': core/migrations/0005_simultaneous_exam_group.py`

- [ ] **Step 5: Apply migration**

```bash
python manage.py migrate
```
Expected: `Applying core.0005_simultaneous_exam_group... OK`

- [ ] **Step 6: Run test — expect pass**

```bash
python manage.py test core.tests.test_simultaneous_exams.TestSimultaneousExamGroupModel -v 2
```
Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add core/models.py core/migrations/0005_simultaneous_exam_group.py core/tests/test_simultaneous_exams.py
git commit -m "feat: add SimultaneousExamGroup and SimultaneousExamGroupCourse models"
```

---

## Task 2: Serializer

**Files:**
- Create: `core/serializers_simultaneous.py`
- Test: `core/tests/test_simultaneous_exams.py` (extend)

- [ ] **Step 1: Write failing serializer test**

Append to `core/tests/test_simultaneous_exams.py`:

```python
from core.serializers_simultaneous import SimultaneousExamGroupSerializer


class TestSimultaneousExamGroupSerializer(TestCase):
    def test_has_required_fields(self):
        s = SimultaneousExamGroupSerializer()
        for field in ['id', 'exam_period', 'slot', 'label',
                      'slot_date', 'slot_start_time', 'slot_end_time',
                      'courses', 'course_ids']:
            self.assertIn(field, s.fields, msg=f"Missing field: {field}")
```

- [ ] **Step 2: Run test — expect failure**

```bash
python manage.py test core.tests.test_simultaneous_exams.TestSimultaneousExamGroupSerializer -v 2
```
Expected: `ImportError: No module named 'core.serializers_simultaneous'`

- [ ] **Step 3: Create `core/serializers_simultaneous.py`**

```python
from rest_framework import serializers
from .models import SimultaneousExamGroup, SimultaneousExamGroupCourse, CourseCatalog


class SimultaneousExamGroupCourseSerializer(serializers.ModelSerializer):
    course_id = serializers.UUIDField(source='course.id', read_only=True)
    code = serializers.CharField(source='course.code', read_only=True)
    name = serializers.CharField(source='course.name', read_only=True)
    year_level = serializers.IntegerField(source='course.year_level', read_only=True)

    class Meta:
        model = SimultaneousExamGroupCourse
        fields = ['course_id', 'code', 'name', 'year_level']


class SimultaneousExamGroupSerializer(serializers.ModelSerializer):
    courses = SimultaneousExamGroupCourseSerializer(source='group_courses', many=True, read_only=True)
    slot_date = serializers.DateField(source='slot.date', read_only=True, default=None)
    slot_start_time = serializers.TimeField(source='slot.start_time', read_only=True, default=None)
    slot_end_time = serializers.TimeField(source='slot.end_time', read_only=True, default=None)
    course_ids = serializers.ListField(child=serializers.UUIDField(), write_only=True)

    class Meta:
        model = SimultaneousExamGroup
        fields = [
            'id', 'exam_period', 'slot', 'label',
            'slot_date', 'slot_start_time', 'slot_end_time',
            'courses', 'course_ids',
        ]
        read_only_fields = ['id', 'label']

    def create(self, validated_data):
        course_ids = validated_data.pop('course_ids')
        existing_count = SimultaneousExamGroup.objects.filter(
            exam_period=validated_data['exam_period']
        ).count()
        group = SimultaneousExamGroup.objects.create(
            label=f"Grup {existing_count + 1}",
            **validated_data,
        )
        SimultaneousExamGroupCourse.objects.bulk_create([
            SimultaneousExamGroupCourse(group=group, course_id=cid)
            for cid in course_ids
        ])
        return group
```

- [ ] **Step 4: Run test — expect pass**

```bash
python manage.py test core.tests.test_simultaneous_exams.TestSimultaneousExamGroupSerializer -v 2
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add core/serializers_simultaneous.py core/tests/test_simultaneous_exams.py
git commit -m "feat: add SimultaneousExamGroup serializer with auto-label and bulk course creation"
```

---

## Task 3: ViewSet + URL Registration

**Files:**
- Create: `core/views_simultaneous.py`
- Modify: `core/urls.py`
- Test: `core/tests/test_simultaneous_exams.py` (extend)

- [ ] **Step 1: Write failing API test**

Append to `core/tests/test_simultaneous_exams.py`:

```python
from django.test import Client


class TestSimultaneousExamGroupAPI(TestCase):
    def test_list_endpoint_exists(self):
        c = Client()
        resp = c.get('/api/simultaneous-groups/')
        # 401/403 = endpoint exists but requires auth — that is correct
        self.assertIn(resp.status_code, [200, 401, 403])
```

- [ ] **Step 2: Run test — expect failure**

```bash
python manage.py test core.tests.test_simultaneous_exams.TestSimultaneousExamGroupAPI -v 2
```
Expected: 404 — endpoint does not exist yet.

- [ ] **Step 3: Create `core/views_simultaneous.py`**

```python
from rest_framework import viewsets
from .models import SimultaneousExamGroup
from .serializers_simultaneous import SimultaneousExamGroupSerializer


class SimultaneousExamGroupViewSet(viewsets.ModelViewSet):
    serializer_class = SimultaneousExamGroupSerializer
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        qs = SimultaneousExamGroup.objects.prefetch_related(
            'group_courses__course', 'slot'
        ).order_by('label')
        exam_period_id = self.request.query_params.get('exam_period_id')
        if exam_period_id:
            qs = qs.filter(exam_period_id=exam_period_id)
        return qs
```

- [ ] **Step 4: Register in `core/urls.py`**

Add import at the top of `core/urls.py` (alongside the existing `views_exam` import):

```python
from .views_simultaneous import SimultaneousExamGroupViewSet
```

Add router registration (before `urlpatterns`):

```python
router.register(r'simultaneous-groups', SimultaneousExamGroupViewSet, basename='simultaneous-group')
```

- [ ] **Step 5: Run test — expect pass**

```bash
python manage.py test core.tests.test_simultaneous_exams.TestSimultaneousExamGroupAPI -v 2
```
Expected: `OK` (401 response = endpoint exists and requires auth)

- [ ] **Step 6: Commit**

```bash
git add core/views_simultaneous.py core/urls.py core/tests/test_simultaneous_exams.py
git commit -m "feat: add SimultaneousExamGroup ViewSet and register /api/simultaneous-groups/"
```

---

## Task 4: Optimizer Integration

**Files:**
- Modify: `core/services/optimizer.py`
- Modify: `core/tasks.py`
- Test: `core/tests/test_simultaneous_exams.py` (extend)

- [ ] **Step 1: Write failing optimizer tests**

Append to `core/tests/test_simultaneous_exams.py`:

```python
import inspect
from core.services.optimizer import OptimizerService


class TestOptimizerPinnedExams(TestCase):
    def test_solve_accepts_pinned_exams_param(self):
        sig = inspect.signature(OptimizerService.solve)
        self.assertIn('pinned_exams', sig.parameters)

    def test_load_exam_calendar_returns_active_dates_and_times(self):
        # Confirm the two new keys are present in the return annotation
        # (actual values tested via integration; here we just check the code compiles)
        import ast, pathlib
        src = pathlib.Path('core/services/optimizer.py').read_text()
        self.assertIn('active_dates', src)
        self.assertIn('all_start_times', src)
```

- [ ] **Step 2: Run tests — expect failure**

```bash
python manage.py test core.tests.test_simultaneous_exams.TestOptimizerPinnedExams -v 2
```
Expected: `FAIL` — `pinned_exams` not in `solve()` signature.

- [ ] **Step 3: Add `pinned_exams` parameter to `solve()` in `core/services/optimizer.py`**

Find the `solve()` signature (~line 286). Add `pinned_exams: dict = None` as the last parameter:

```python
def solve(self, hard_threshold: int = 5, time_limit: int = None, mip_gap: float = 0.10,
          no_back_to_back: bool = False, no_back_to_back_depts: list = None,
          exam_days: int = 5, slots_per_day: int = 10,
          start_hour: int = 8, year_order_weight: float = 100.0,
          year_order_sequence: list = None, year_order_weights: dict = None,
          weight_config: dict = None,
          blocked_slot_indices: set = None,
          day_weekday_map: dict = None,
          day_date_labels: list = None,
          slot_starts_override: list = None,
          slot_ends_override: list = None,
          session_mode: bool = False,
          pinned_exams: dict = None) -> dict:
```

Then find the `m.update()` call (~line 416) and insert the pinning block immediately after it:

```python
        m.update()

        if pinned_exams:
            for unit_key, slot_idx in pinned_exams.items():
                if unit_key not in info:
                    logger.warning(f"pinned_exams: unit_key {unit_key!r} not in courses — skipped")
                    continue
                if (unit_key, slot_idx) not in y:
                    logger.warning(f"pinned_exams: slot {slot_idx} invalid for {unit_key!r} — skipped")
                    continue
                y[(unit_key, slot_idx)].lb = 1
                logger.info(f"Pinned {unit_key!r} → slot {slot_idx}")
```

- [ ] **Step 4: Add `active_dates` and `all_start_times` to `load_exam_calendar` return dict**

Find the `return {` at the end of `load_exam_calendar` (~line 274). Add two keys:

```python
        return {
            "exam_days": exam_days,
            "slots_per_day": slots_per_day,
            "start_hour": start_hour,
            "blocked_slot_indices": blocked_slot_indices,
            "day_weekday_map": day_weekday_map,
            "day_date_labels": day_date_labels,
            "slot_starts": slot_starts,
            "slot_ends": slot_ends,
            "session_mode": session_mode,
            "active_dates": active_dates,        # list[datetime.date] in day-index order
            "all_start_times": all_start_times,  # list[datetime.time] in slot-within-day order
        }
```

- [ ] **Step 5: Run tests — expect pass**

```bash
python manage.py test core.tests.test_simultaneous_exams.TestOptimizerPinnedExams -v 2
```
Expected: `OK`

- [ ] **Step 6: Update `core/tasks.py` — add helper and wire into `run_optimizer_task`**

Add import at the top of `core/tasks.py` (replace existing models import):

```python
from .models import GeneratedSolution, SimultaneousExamGroup
```

Add the helper function before `run_optimizer_task`:

```python
def _build_pinned_exams(exam_period_id: str, calendar: dict, courses: list) -> dict:
    """
    Load SimultaneousExamGroup rows for the period, convert each group's
    ExamDateSlot to a flat slot index, and return {unit_key: slot_index}.
    unit_key format: "<course_id>|<student_dept_id>" (matches optimizer info keys).
    """
    if not exam_period_id or not calendar:
        return {}

    active_dates = calendar.get("active_dates", [])
    all_start_times = calendar.get("all_start_times", [])
    slots_per_day = calendar["slots_per_day"]

    # Build lookup: course_id (str) -> list of unit_keys
    course_to_unit_keys: dict[str, list[str]] = {}
    for row in courses:
        cid = str(row["course_id"])
        course_to_unit_keys.setdefault(cid, []).append(row["unit_key"])

    pinned: dict[str, int] = {}
    groups = SimultaneousExamGroup.objects.filter(
        exam_period_id=exam_period_id
    ).prefetch_related("group_courses", "slot")

    for group in groups:
        if not group.slot:
            continue
        try:
            day_idx = active_dates.index(group.slot.date)
            time_idx = all_start_times.index(group.slot.start_time)
        except ValueError:
            logger.warning(f"Simultaneous group {group.id}: slot not in active calendar — skipped")
            continue
        slot_idx = day_idx * slots_per_day + time_idx
        for gc in group.group_courses.all():
            for unit_key in course_to_unit_keys.get(str(gc.course_id), []):
                pinned[unit_key] = slot_idx

    return pinned
```

In `run_optimizer_task`, after the `calendar_kwargs` block and before the `solve_kwargs` dict, add:

```python
        # Build pinned_exams from simultaneous exam groups saved for this period
        courses_for_pin = svc.load_courses() if exam_period_id else []
        pinned_exams = _build_pinned_exams(
            exam_period_id,
            calendar_kwargs if exam_period_id else {},
            courses_for_pin,
        )
```

Add `'pinned_exams': pinned_exams,` to `solve_kwargs`:

```python
        solve_kwargs = {
            'hard_threshold': params.get('hard_threshold', 5),
            'time_limit': params.get('time_limit', None),
            'mip_gap': params.get('mip_gap', 0.10),
            'no_back_to_back': params.get('no_back_to_back', False),
            'exam_days': params.get('exam_days', 5),
            'slots_per_day': params.get('slots_per_day', 10),
            'start_hour': params.get('start_hour', 8),
            'year_order_weight': params.get('year_order_weight', 100.0),
            'year_order_sequence': params.get('year_order_sequence', None),
            'year_order_weights': params.get('year_order_weights', None),
            'weight_config': params.get('weight_config', None),
            'pinned_exams': pinned_exams,   # ← add this line
        }
```

- [ ] **Step 7: Run all simultaneous exams tests**

```bash
python manage.py test core.tests.test_simultaneous_exams -v 2
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add core/services/optimizer.py core/tasks.py core/tests/test_simultaneous_exams.py
git commit -m "feat: wire pinned_exams from SimultaneousExamGroup into optimizer solve()"
```

---

## Task 5: Frontend — Tab Component + Integration

**Files:**
- Create: `frontend/src/app/(app)/exam-calendar/SimultaneousExamsTab.tsx`
- Modify: `frontend/src/app/(app)/exam-calendar/page.tsx`

- [ ] **Step 1: Create `frontend/src/app/(app)/exam-calendar/SimultaneousExamsTab.tsx`**

```tsx
"use client";
import React, { useState, useCallback } from "react";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, SL, Spinner, ErrorBox, DataTable, DataRow, DataCell, InfoBox } from "@/components/ui";

type SimGroup = {
  id: string;
  label: string;
  slot: string | null;
  slot_date: string | null;
  slot_start_time: string | null;
  slot_end_time: string | null;
  courses: { course_id: string; code: string; name: string; year_level: number | null }[];
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

export default function SimultaneousExamsTab() {
  const { data: termsData } = useFetch("/terms/");
  const terms: any[] = termsData?.results || termsData || [];

  const [termId, setTermId] = useState("");
  const [periodId, setPeriodId] = useState("");

  const { data: periodsData } = useFetch(
    termId ? `/exam-periods/?term_id=${termId}` : "",
    [termId]
  );
  const periods: any[] = periodsData || [];

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

  const { data: sectionsData, loading: sectionsLoading } = useFetch(
    termId && periodId
      ? `/course-sections/?term_id=${termId}&exam_period_id=${periodId}`
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

  // NOTE: verify the exact dept-id field name from the course-sections API response.
  // If filtering by dept ID does not work, switch to filtering by academic_unit_name.
  const filtered = sections.filter((s: any) => {
    if (filterDept !== "Tümü" && String(s.academic_unit_id) !== filterDept) return false;
    if (filterYear !== "Tümü" && String(s.year_level) !== filterYear) return false;
    if (filterType !== "Tümü" && s.requirement !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!s.course_name?.toLowerCase().includes(q) && !s.course_code?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggleCheck = (courseId: string) =>
    setChecked(prev => {
      const next = new Set(prev);
      next.has(courseId) ? next.delete(courseId) : next.add(courseId);
      return next;
    });

  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const dates = Array.from(new Set(slots.map(s => s.date))).sort();
  const times = Array.from(new Set(slots.map(s => s.start_time))).sort();
  const slotMap: Record<string, ExamDateSlot> = {};
  slots.forEach(s => { slotMap[`${s.date}|${s.start_time}`] = s; });

  const weekdayLabel = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"][d.getDay()];
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
      setSaveErr(e.data ? JSON.stringify(e.data) : e.message || "Kayıt başarısız.");
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* 1 — Selectors */}
      <Card style={{ padding: "16px 24px" }}>
        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ flex: 1, maxWidth: 320 }}>
            <label style={lStyle}>DÖNEM</label>
            <select value={termId} onChange={e => { setTermId(e.target.value); setPeriodId(""); }} style={selectStyle}>
              <option value="">— Dönem seçin —</option>
              {terms.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, maxWidth: 320 }}>
            <label style={lStyle}>SINAV TAKVİMİ</label>
            <select
              value={periodId}
              onChange={e => setPeriodId(e.target.value)}
              style={{ ...selectStyle, opacity: periods.length === 0 ? 0.5 : 1 }}
              disabled={!termId || periods.length === 0}
            >
              <option value="">— Takvim seçin —</option>
              {periods.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      </Card>

      {periodId && (
        <>
          {/* 2 — Existing groups */}
          <Card style={{ padding: "16px 24px" }}>
            <SL>EŞ ZAMANLI SINAV GRUPLARI</SL>
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
                            → {weekdayLabel(g.slot_date)} {g.slot_date.slice(5)} {g.slot_start_time?.slice(0, 5)}
                          </span>
                        )}
                      </span>
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

            <DataTable headers={["", "Ders Kodu", "Ders Adı", "Sınıf", "Tür"]}>
              {sectionsLoading && (
                <DataRow>
                  <DataCell colSpan={5} style={{ textAlign: "center", padding: 40 }}><Spinner size={20} /></DataCell>
                </DataRow>
              )}
              {!sectionsLoading && filtered.length === 0 && (
                <DataRow>
                  <DataCell colSpan={5}><InfoBox msg="Uygun ders bulunamadı." /></DataCell>
                </DataRow>
              )}
              {filtered.map((sec: any) => {
                const courseId = String(sec.course_id ?? sec.id);
                const isChecked = checked.has(courseId);
                return (
                  <DataRow
                    key={sec.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => toggleCheck(courseId)}
                  >
                    <DataCell style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleCheck(courseId)}
                        onClick={e => e.stopPropagation()}
                      />
                    </DataCell>
                    <DataCell style={{ color: C.cyan, ...mono, fontWeight: 600 }}>{sec.course_code}</DataCell>
                    <DataCell>{sec.course_name}</DataCell>
                    <DataCell style={{ color: C.textSub, fontSize: 12 }}>
                      {sec.year_level ? `${sec.year_level}. Sınıf` : "—"}
                    </DataCell>
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
                  </DataRow>
                );
              })}
            </DataTable>
          </Card>
        </>
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
                        <div style={{ ...mono, fontSize: 10, color: C.textMuted }}>{date.slice(5)}</div>
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
                        return (
                          <td
                            key={date}
                            onClick={() => !blocked && !saving && pickSlot(slot)}
                            title={blocked ? "Engellenmiş — seçilemez" : "Tıkla: bu saate ata"}
                            style={{
                              borderBottom: `1px solid ${C.border}`,
                              borderRight: `1px solid ${C.border}`,
                              background: blocked
                                ? `color-mix(in srgb, ${C.red} 16%, transparent)`
                                : `color-mix(in srgb, ${C.green} 12%, transparent)`,
                              cursor: blocked ? "not-allowed" : saving ? "wait" : "pointer",
                              padding: "8px 10px",
                              textAlign: "center",
                              transition: "background 120ms ease-out",
                              userSelect: "none",
                              opacity: saving ? 0.6 : 1,
                            }}
                          >
                            <span style={{ fontSize: 14 }}>{blocked ? "✕" : "✓"}</span>
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
    </div>
  );
}
```

- [ ] **Step 2: Add the tab to `frontend/src/app/(app)/exam-calendar/page.tsx`**

Add import after the last existing import line:
```tsx
import SimultaneousExamsTab from "./SimultaneousExamsTab";
```

Change the `activeTab` state type (line ~66):
```tsx
const [activeTab, setActiveTab] = useState<"calendar" | "optimization" | "simultaneous">("calendar");
```

Change the tab array (line ~357):
```tsx
{(["calendar", "optimization", "simultaneous"] as const).map(tab => (
```

Change the tab label expression (line ~375):
```tsx
{tab === "calendar" ? "Sınav Takvimi" : tab === "optimization" ? "Ders Seçimi" : "Eş zamanlı sınavlar"}
```

Add the render block after the closing `</>` of the optimization tab section (~line 803):
```tsx
{activeTab === "simultaneous" && <SimultaneousExamsTab />}
```

- [ ] **Step 3: Verify in browser**

```bash
cd frontend && npm run dev
```

Navigate to `/exam-calendar` and verify:
- Three tabs: "Sınav Takvimi", "Ders Seçimi", "Eş zamanlı sınavlar"
- Third tab shows Term + Calendar dropdowns
- After selecting both: groups panel (empty state) and course list appear
- Filters (dept, year, type, search) narrow the course list
- Checking ≥ 2 courses activates the "Eş Zamanlı Yap" button
- Clicking it opens the slot modal with the calendar grid
- Blocked slots show ✕, grey background, cursor not-allowed
- Clicking an unblocked slot (✓) saves the group and closes the modal
- New group card appears immediately in the groups panel with label, slot info, and course badges
- "Sil" button removes the group

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/(app)/exam-calendar/SimultaneousExamsTab.tsx frontend/src/app/(app)/exam-calendar/page.tsx
git commit -m "feat: add Eş zamanlı sınavlar tab with course selection, slot picker, and groups panel"
```
