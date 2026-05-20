# Auto-Exclude Zero-Enrollment Sections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Sınav Takvimi → Ders Seçimi tab, sections with zero enrollments should appear with the exclusion toggle locked ON, reflecting the optimizer's existing behavior (it already filters `HAVING COUNT(DISTINCT student) > 0`).

**Architecture:** `excluded_from_optimization` becomes a derived field in `CourseSectionSerializer`: it returns `True` when an explicit `ExamPeriodSectionExclusion` row exists *or* when the annotated `enrollment_count` is 0. The toggle endpoint rejects writes against zero-enrollment sections so the UI cannot pollute the exclusion table. The frontend disables the toggle for those rows and shows a Turkish tooltip explaining the auto-exclusion.

**Tech Stack:** Django REST Framework (Python), Django ORM, Next.js / React (TypeScript), pytest + APIClient.

**Spec:** `docs/superpowers/specs/2026-05-20-zero-enrollment-auto-exclude-design.md`

---

## File Structure

- Modify: `core/serializers.py` — derive `excluded_from_optimization` from `enrollment_count`.
- Modify: `core/views/exam.py` — `ExamPeriodViewSet.toggle_exclusion` rejects zero-enrollment sections.
- Modify: `frontend/src/app/(app)/exam-calendar/page.tsx` — disable toggle, filter bulk targets, fix bulk-checkbox `allExcluded` predicates.
- Create: `core/tests/test_exam_period_exclusion.py` — API tests for serializer derivation + toggle guard.

---

## Task 1: Serializer derives exclusion from zero enrollment (backend, TDD)

**Files:**
- Test: `core/tests/test_exam_period_exclusion.py` (create)
- Modify: `core/serializers.py:84-85`

- [ ] **Step 1: Write the failing test file**

Create `core/tests/test_exam_period_exclusion.py`:

```python
import datetime
import pytest
from rest_framework.test import APIClient
from django.contrib.auth.models import User as DjangoUser
from rest_framework.authtoken.models import Token
from core.models import (
    CourseSection, ExamPeriod, ExamPeriodSectionExclusion, Enrollment
)


@pytest.fixture
def api_client(db):
    user = DjangoUser.objects.create_user("excluder", password="pass")
    token = Token.objects.create(user=user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return client


@pytest.fixture
def period(active_term):
    return ExamPeriod.objects.create(
        term=active_term,
        name="Final Exams",
        exam_type="FINAL",
        start_date=datetime.date(2025, 6, 1),
        end_date=datetime.date(2025, 6, 2),
    )


@pytest.fixture
def empty_section(active_term, course):
    # Section with zero enrollments
    return CourseSection.objects.create(
        term=active_term, course=course, section_code="EMPTY",
        max_enrollment=50,
    )


@pytest.mark.django_db
def test_zero_enrollment_section_is_auto_excluded(api_client, empty_section, period):
    res = api_client.get(
        f"/api/course-sections/?term_id={empty_section.term_id}"
        f"&exam_period_id={period.id}&include_empty=true"
    )
    assert res.status_code == 200
    payload = res.data.get("results", res.data)
    rows = [r for r in payload if r["id"] == str(empty_section.id)]
    assert len(rows) == 1
    assert rows[0]["enrollment_count"] == 0
    assert rows[0]["excluded_from_optimization"] is True
    # And no DB exclusion row was implicitly created
    assert ExamPeriodSectionExclusion.objects.filter(
        exam_period=period, course_section=empty_section
    ).count() == 0


@pytest.mark.django_db
def test_enrolled_section_without_exclusion_is_not_excluded(
    api_client, section, enrollment, period
):
    res = api_client.get(
        f"/api/course-sections/?term_id={section.term_id}"
        f"&exam_period_id={period.id}"
    )
    assert res.status_code == 200
    payload = res.data.get("results", res.data)
    rows = [r for r in payload if r["id"] == str(section.id)]
    assert len(rows) == 1
    assert rows[0]["enrollment_count"] == 1
    assert rows[0]["excluded_from_optimization"] is False


@pytest.mark.django_db
def test_enrolled_section_with_explicit_exclusion_is_excluded(
    api_client, section, enrollment, period
):
    ExamPeriodSectionExclusion.objects.create(
        exam_period=period, course_section=section
    )
    res = api_client.get(
        f"/api/course-sections/?term_id={section.term_id}"
        f"&exam_period_id={period.id}"
    )
    assert res.status_code == 200
    payload = res.data.get("results", res.data)
    rows = [r for r in payload if r["id"] == str(section.id)]
    assert len(rows) == 1
    assert rows[0]["excluded_from_optimization"] is True
```

- [ ] **Step 2: Run the new tests and confirm the zero-enrollment test fails**

Run: `pytest core/tests/test_exam_period_exclusion.py -v`

Expected:
- `test_zero_enrollment_section_is_auto_excluded` **FAILS** with `assert False is True` (current serializer returns `False` for the empty section).
- `test_enrolled_section_without_exclusion_is_not_excluded` **PASSES**.
- `test_enrolled_section_with_explicit_exclusion_is_excluded` **PASSES**.

If `test_enrolled_section_without_exclusion_is_not_excluded` doesn't pass, stop — your fixture chain is wrong and the rest of the plan will be unreliable. Do not proceed.

- [ ] **Step 3: Modify the serializer**

In `core/serializers.py`, replace the `get_excluded_from_optimization` method (currently at lines 84-85):

```python
    def get_excluded_from_optimization(self, obj):
        if getattr(obj, 'enrollment_count', 0) == 0:
            return True
        return getattr(obj, 'excluded_from_optimization', False)
```

The `enrollment_count` attribute is already annotated by `CourseSectionViewSet.get_queryset` at `core/views/catalog.py:125-127` (`enrollment_count=Count('enrollments')`), so it is available on every serialized object.

- [ ] **Step 4: Run the tests and verify all pass**

Run: `pytest core/tests/test_exam_period_exclusion.py -v`

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add core/serializers.py core/tests/test_exam_period_exclusion.py
git commit -m "feat(catalog): auto-exclude zero-enrollment sections in serializer"
```

---

## Task 2: Toggle endpoint rejects zero-enrollment sections (backend, TDD)

**Files:**
- Modify: `core/tests/test_exam_period_exclusion.py` (append tests)
- Modify: `core/views/exam.py:93-110` (`toggle_exclusion` action)

- [ ] **Step 1: Append the failing tests**

Append to `core/tests/test_exam_period_exclusion.py`:

```python
@pytest.mark.django_db
def test_toggle_rejects_zero_enrollment_section(api_client, empty_section, period):
    res = api_client.post(
        f"/api/exam-periods/{period.id}/toggle-exclusion/",
        {"section_id": str(empty_section.id)},
        format="json",
    )
    assert res.status_code == 400
    assert "Kayıtlı öğrencisi olmayan" in res.data.get("error", "")
    assert ExamPeriodSectionExclusion.objects.filter(
        exam_period=period, course_section=empty_section
    ).count() == 0


@pytest.mark.django_db
def test_toggle_still_works_for_enrolled_section(api_client, section, enrollment, period):
    res = api_client.post(
        f"/api/exam-periods/{period.id}/toggle-exclusion/",
        {"section_id": str(section.id)},
        format="json",
    )
    assert res.status_code == 200
    assert res.data["excluded"] is True
    assert ExamPeriodSectionExclusion.objects.filter(
        exam_period=period, course_section=section
    ).count() == 1

    # Toggle again -> deletes
    res = api_client.post(
        f"/api/exam-periods/{period.id}/toggle-exclusion/",
        {"section_id": str(section.id)},
        format="json",
    )
    assert res.status_code == 200
    assert res.data["excluded"] is False
    assert ExamPeriodSectionExclusion.objects.filter(
        exam_period=period, course_section=section
    ).count() == 0
```

- [ ] **Step 2: Run the new tests and confirm the rejection test fails**

Run: `pytest core/tests/test_exam_period_exclusion.py -v`

Expected:
- `test_toggle_rejects_zero_enrollment_section` **FAILS** with `assert 200 == 400` (endpoint currently accepts the toggle and creates a redundant row).
- `test_toggle_still_works_for_enrolled_section` **PASSES**.

- [ ] **Step 3: Add the guard to the view**

In `core/views/exam.py`, modify the `toggle_exclusion` action. The current code is at lines 93-110. Replace it with:

```python
    @action(detail=True, methods=["post"], url_path="toggle-exclusion")
    def toggle_exclusion(self, request, pk=None):
        period = self.get_object()
        section_id = request.data.get("section_id")
        if not section_id:
            return Response({"error": "section_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            section = CourseSection.objects.get(id=section_id)
        except CourseSection.DoesNotExist:
            return Response({"error": "Section not found"}, status=status.HTTP_404_NOT_FOUND)
        if section.enrollments.count() == 0:
            return Response(
                {"error": "Kayıtlı öğrencisi olmayan dersler otomatik olarak hariç tutulur."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        exclusion = ExamPeriodSectionExclusion.objects.filter(exam_period=period, course_section=section).first()
        if exclusion:
            exclusion.delete()
            excluded = False
        else:
            ExamPeriodSectionExclusion.objects.create(exam_period=period, course_section=section)
            excluded = True
        return Response({"excluded": excluded, "section_id": str(section_id)})
```

The guard uses `section.enrollments.count()` (no term filter) to match how `CourseSectionViewSet.get_queryset` annotates `enrollment_count` — guarantees that what the UI shows and what the API enforces stay aligned.

- [ ] **Step 4: Run the tests and verify all pass**

Run: `pytest core/tests/test_exam_period_exclusion.py -v`

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add core/views/exam.py core/tests/test_exam_period_exclusion.py
git commit -m "feat(exam-period): reject toggle-exclusion for zero-enrollment sections"
```

---

## Task 3: Frontend disables toggle and filters bulk targets

**Files:**
- Modify: `frontend/src/app/(app)/exam-calendar/page.tsx:318-321` (eligibility computations)
- Modify: `frontend/src/app/(app)/exam-calendar/page.tsx:352-370` (`bulkToggle`)
- Modify: `frontend/src/app/(app)/exam-calendar/page.tsx:926-957` (toggle button JSX)

This task has no automated UI tests (the project has no UI test harness for this page). Verification is manual in Task 4. Keep the diff tight.

- [ ] **Step 1: Update the bulk-checkbox eligibility predicates**

Open `frontend/src/app/(app)/exam-calendar/page.tsx`. Find this block around lines 318-321:

```ts
  const gradSections = sections.filter(isGradProject);
  const industrialSections = sections.filter(isIndustrialPractice);
  const allGradExcluded = gradSections.length > 0 && gradSections.every((s: any) => s.excluded_from_optimization);
  const allIndustrialExcluded = industrialSections.length > 0 && industrialSections.every((s: any) => s.excluded_from_optimization);
```

Replace with:

```ts
  const hasEnrollments = (s: any) => (s.enrollment_count ?? 0) > 0;
  const gradSections = sections.filter(isGradProject);
  const industrialSections = sections.filter(isIndustrialPractice);
  const eligibleGradSections = gradSections.filter(hasEnrollments);
  const eligibleIndustrialSections = industrialSections.filter(hasEnrollments);
  const allGradExcluded =
    eligibleGradSections.length > 0 &&
    eligibleGradSections.every((s: any) => s.excluded_from_optimization);
  const allIndustrialExcluded =
    eligibleIndustrialSections.length > 0 &&
    eligibleIndustrialSections.every((s: any) => s.excluded_from_optimization);
```

Why: zero-enrollment sections always read as `excluded_from_optimization: true` from the backend, so without filtering them out the "all excluded" predicate becomes trivially true on first load — the checkbox would appear pre-checked even when no real exclusion has been made.

- [ ] **Step 2: Update `bulkToggle` to skip zero-enrollment sections**

Find the `bulkToggle` function around lines 352-370. Replace it with:

```ts
  const bulkToggle = async (matchingSections: any[], allExcluded: boolean, key: string) => {
    if (!optPeriodId) return;
    setBulkLoading(key);
    setToggleError(null);
    const eligible = matchingSections.filter((s: any) => (s.enrollment_count ?? 0) > 0);
    const targets = allExcluded
      ? eligible
      : eligible.filter((s: any) => !s.excluded_from_optimization);
    try {
      await Promise.all(
        targets.map((s: any) =>
          api.post(`/exam-periods/${optPeriodId}/toggle-exclusion/`, { section_id: s.id })
        )
      );
      refetchSections();
    } catch (err: any) {
      setToggleError(err.message || "Hariç tutma değiştirilemedi.");
    }
    setBulkLoading(null);
  };
```

Why: the backend now returns 400 for zero-enrollment sections; without this filter `Promise.all` would reject and the bulk action would surface a confusing error even though the visible state is already correct.

- [ ] **Step 3: Update bulk-checkbox label counts to use eligible sets**

Find the two bulk-toggle labels around lines 819-846. They display `({gradSections.length})` and `({industrialSections.length})`. Change those to the eligible counts so the count matches what the action will actually touch.

Replace `gradSections.length === 0 || bulkLoading !== null` (in the `cursor` and `disabled` props of the first label) with `eligibleGradSections.length === 0 || bulkLoading !== null`. Replace `opacity: gradSections.length === 0 ? 0.4 : 1` with `opacity: eligibleGradSections.length === 0 ? 0.4 : 1`. Replace the inner `{gradSections.length > 0 && <span style={{ color: C.textMuted, marginLeft: 4 }}>({gradSections.length})</span>}` with `{eligibleGradSections.length > 0 && <span style={{ color: C.textMuted, marginLeft: 4 }}>({eligibleGradSections.length})</span>}`. Then pass `eligibleGradSections` (not `gradSections`) into the `bulkToggle` call: `onChange={() => bulkToggle(eligibleGradSections, allGradExcluded, "grad")}`.

Do the same renames for the industrial label: `industrialSections` → `eligibleIndustrialSections` in the four spots in that block, and `bulkToggle(eligibleIndustrialSections, allIndustrialExcluded, "industrial")` in `onChange`.

After the edit the first label should look like:

```tsx
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px", alignItems: "center" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: eligibleGradSections.length === 0 || bulkLoading !== null ? "not-allowed" : "pointer", userSelect: "none", opacity: eligibleGradSections.length === 0 ? 0.4 : 1 }}>
                  <input
                    type="checkbox"
                    checked={allGradExcluded}
                    disabled={eligibleGradSections.length === 0 || bulkLoading !== null}
                    onChange={() => bulkToggle(eligibleGradSections, allGradExcluded, "grad")}
                    style={{ width: 15, height: 15, cursor: "inherit", accentColor: C.accent, flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 12, color: C.textMuted, ...mono }}>
                    Bitirme Projesi derslerini hariç tut
                    {eligibleGradSections.length > 0 && <span style={{ color: C.textMuted, marginLeft: 4 }}>({eligibleGradSections.length})</span>}
                    {bulkLoading === "grad" && <span style={{ marginLeft: 6 }}>…</span>}
                  </span>
                </label>
```

And industrial likewise.

- [ ] **Step 4: Disable the row-level toggle for zero-enrollment sections**

Find the row toggle button around lines 926-957. Replace the `<button …>` element with:

```tsx
                  <DataCell>
                    <button
                      type="button"
                      title={
                        (sec.enrollment_count ?? 0) === 0
                          ? "Kayıtlı öğrencisi olmadığı için otomatik olarak hariç tutulmuştur"
                          : !optPeriodId
                          ? "Hariç tutmak için önce bir sınav takvimi seçin"
                          : undefined
                      }
                      disabled={
                        togglingId === sec.id ||
                        !optPeriodId ||
                        (sec.enrollment_count ?? 0) === 0
                      }
                      onClick={() => toggleExclusion(sec)}
                      style={{
                        width: 36,
                        height: 20,
                        borderRadius: 10,
                        background: sec.excluded_from_optimization ? C.red : C.border,
                        border: "none",
                        cursor:
                          togglingId === sec.id || (sec.enrollment_count ?? 0) === 0
                            ? "not-allowed"
                            : "pointer",
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
```

Because the backend now reports `excluded_from_optimization: true` for these rows, the toggle visually reads ON and the existing row-level `opacity: sec.excluded_from_optimization ? 0.4 : 1` styling (line 893) applies without further change.

- [ ] **Step 5: Type-check the frontend**

Run from the `frontend/` directory:

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/(app)/exam-calendar/page.tsx"
git commit -m "feat(exam-calendar): lock toggle for zero-enrollment sections in Ders Secimi"
```

---

## Task 4: Manual verification + close-out

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite for the affected area**

Run: `pytest core/tests/test_exam_period_exclusion.py core/tests/test_exam_calendar.py core/tests/test_serializers.py -v`

Expected: all green. If anything other than the new file fails, you've regressed something — read the failure and fix before declaring success.

- [ ] **Step 2: Run the dev server and exercise the UI**

Start the backend and frontend in two terminals using whatever the project README documents (typically `python manage.py runserver` and `npm run dev` from `frontend/`).

Open the Sınav Takvimi page in the browser, choose the active term and an exam period, switch to the **Ders Seçimi** tab, and verify:

1. A known zero-enrollment row (per the project memory, CENG's `CALCULUS I`) appears with:
   - `Öğrenci Sayısı` column = 0
   - `Hariç Tut` toggle visibly ON (red background, handle on the right)
   - Row opacity reduced (0.4)
   - Hovering the toggle shows the tooltip `Kayıtlı öğrencisi olmadığı için otomatik olarak hariç tutulmuştur`
   - Clicking the toggle does nothing (it is `disabled`)
2. An enrolled row toggles normally — clicking flips the visual state, a refetch confirms the change persisted, clicking again flips back.
3. The `Bitirme Projesi` and `Staj` bulk checkboxes show a count that matches only enrolled sections in those categories (not zero-enrollment graduation entries).
4. Toggling the bulk checkboxes does not produce a 400 error in the network panel.

- [ ] **Step 3: Sanity-check the optimizer**

Trigger an optimizer run for the period (use whatever the project UI exposes, typically the Optimizasyon tab → "Çalıştır"). Verify the run produces the same number of scheduled courses as before the change — this is a regression check that nothing accidentally affected `OptimizerService.load_courses`.

If counts differ, stop and investigate; the spec explicitly bans optimizer behavior changes.

- [ ] **Step 4: Final commit (only if any docs need updating)**

If steps 1-3 surfaced no issues, no further commit is needed. If you adjusted anything during verification, commit those follow-ups separately with a clear message.

---

## Self-review checklist (for the writer; do not include in execution)

- Spec section "Architecture" → Task 1 covers serializer derivation. ✓
- Spec section "Components → Backend (toggle endpoint)" → Task 2. ✓
- Spec section "Components → Frontend (toggle render + bulk)" → Task 3. ✓
- Spec section "Testing → unit/API tests (4 cases)" → Tasks 1+2 contain all four. ✓
- Spec section "Testing → manual verification" → Task 4 step 2. ✓
- Optimizer non-regression check → Task 4 step 3. ✓
- No `TBD`, `TODO`, or "implement later" anywhere in the steps. ✓
- File paths are exact; line ranges given where editing existing code. ✓
- All identifiers introduced (`hasEnrollments`, `eligibleGradSections`, `eligibleIndustrialSections`) are used consistently in later steps. ✓
