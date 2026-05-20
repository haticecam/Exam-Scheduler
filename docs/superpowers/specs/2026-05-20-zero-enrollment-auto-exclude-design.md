# Auto-exclude zero-enrollment sections from Ders Seçimi

**Date:** 2026-05-20
**Status:** Approved
**Scope:** UX refinement on the Sınav Takvimi → Ders Seçimi tab

## Problem

The `CourseCatalog` schema has one row per (course, department). For shared courses like CALCULUS I, every department that lists it gets a catalog row, but all 681 students typically enroll through a single section (e.g. Matematik's), leaving the other departments' sections with `enrollment_count = 0`.

Commit `0e3e28b` ("show all catalog courses in Ders Seçimi") intentionally exposes these zero-enrollment sections so users do not perceive courses as missing. The side effect is that the exclusion toggle becomes misleading: the optimizer already skips them (`HAVING COUNT(DISTINCT e.student_id) > 0` in `OptimizerService.load_courses`), so flipping the toggle changes nothing observable.

The user expectation (this spec): a zero-enrollment section should display as auto-excluded with a locked toggle, so the UI matches reality.

## Non-goals

- No change to optimizer behavior. It already filters by enrollment.
- No automatic creation of `ExamPeriodSectionExclusion` rows. Enrollment count remains the source of truth — if enrollments arrive later, the section flips back to "included" without any cleanup.
- No change to the include-empty fetch behavior. Sections remain visible in the table.
- No change to "Eş zamanlı sınavlar" tab logic.

## Architecture

Treat `excluded_from_optimization` as a *derived* value in the serializer. The DB still stores explicit exclusions in `ExamPeriodSectionExclusion`, but the serialized field returns `True` whenever either condition holds:

1. An explicit `ExamPeriodSectionExclusion` row exists for (section, exam_period). (Existing behavior, annotated via `Exists()` in `CourseSectionViewSet.get_queryset`.)
2. `enrollment_count == 0`. (New.)

The toggle endpoint rejects writes against zero-enrollment sections so the UI cannot pollute the exclusion table with redundant rows, and so API consumers get a clear error instead of a silent no-op.

The frontend disables the toggle for zero-enrollment rows and surfaces a tooltip explaining why.

## Components

### Backend — `core/serializers.py`

`CourseSectionSerializer.get_excluded_from_optimization`:

```python
def get_excluded_from_optimization(self, obj):
    if getattr(obj, 'enrollment_count', 0) == 0:
        return True
    return getattr(obj, 'excluded_from_optimization', False)
```

The `enrollment_count` attribute is already populated by the queryset annotation in `CourseSectionViewSet.get_queryset` (`core/views/catalog.py:125-127`). No queryset change required.

### Backend — `core/views/exam.py` — `ExamPeriodViewSet.toggle_exclusion`

Before creating/deleting the `ExamPeriodSectionExclusion` row, count the section's enrollments:

```python
if section.enrollments.count() == 0:
    return Response(
        {"error": "Kayıtlı öğrencisi olmayan dersler otomatik olarak hariç tutulur."},
        status=status.HTTP_400_BAD_REQUEST,
    )
```

Use the unfiltered `enrollments` count to match how `CourseSectionViewSet.get_queryset` annotates `enrollment_count` (`Count('enrollments')` with no term filter). Because a section is bound to one term via FK, this is unambiguous in practice; matching the annotation guarantees the API rejection and the displayed count never disagree.

### Frontend — `frontend/src/app/(app)/exam-calendar/page.tsx`

Toggle render (around line 926-957): extend the `disabled` predicate and add a tooltip branch:

```tsx
const isZeroEnroll = (sec.enrollment_count ?? 0) === 0;
// ...
<button
  type="button"
  title={
    isZeroEnroll
      ? "Kayıtlı öğrencisi olmadığı için otomatik olarak hariç tutulmuştur"
      : !optPeriodId
      ? "Hariç tutmak için önce bir sınav takvimi seçin"
      : undefined
  }
  disabled={togglingId === sec.id || !optPeriodId || isZeroEnroll}
  onClick={() => toggleExclusion(sec)}
  style={{ /* unchanged; cursor: "not-allowed" applies via disabled */ }}
>
```

Because the backend now reports `excluded_from_optimization: true` for these sections, the toggle visually reads ON and the row already inherits the existing `opacity: 0.4` styling.

`bulkToggle` (line 352): when computing `targets`, filter out zero-enrollment sections so the keyword bulk actions ("Bitirme Projesi", "Staj") never POST a redundant toggle:

```ts
const eligible = matchingSections.filter((s: any) => (s.enrollment_count ?? 0) > 0);
const targets = allExcluded
  ? eligible
  : eligible.filter((s: any) => !s.excluded_from_optimization);
```

The `allExcluded` predicate (line 320-321) is also updated to ignore zero-enrollment sections, otherwise the checkbox could appear unchecked when every eligible section is already excluded:

```ts
const eligibleGrad = gradSections.filter((s: any) => (s.enrollment_count ?? 0) > 0);
const allGradExcluded =
  eligibleGrad.length > 0 && eligibleGrad.every((s: any) => s.excluded_from_optimization);
```

(Same shape for `allIndustrialExcluded`.)

## Data flow

1. User opens Ders Seçimi for an exam period.
2. Frontend fetches `/course-sections/?term_id=...&exam_period_id=...&include_empty=true`.
3. Backend annotates each section with `enrollment_count` and an `Exists()`-based `excluded_from_optimization`, then the serializer overrides the latter to `True` when count is zero.
4. Frontend renders the table; zero-enrollment rows show the toggle locked ON with the auto-exclude tooltip.
5. If a user attempts to call `toggle-exclusion` against a zero-enrollment section (bypassing the disabled button), the backend returns 400 with a Turkish error message.

## Error handling

- Toggle API rejection for zero-enrollment is a 400 with a Turkish-language `error` field, consistent with the page's existing `toggleError` surface.
- No new error states in the frontend: the disabled button prevents the call in practice; the tooltip explains why.
- If `enrollment_count` is missing from the response (e.g. older cached payload), the `?? 0` fallback treats the section as zero-enrollment — fail-safe toward the auto-excluded state.

## Testing

### Unit / API tests

Add to `core/tests/test_catalog_api.py` (or nearest existing API test module):

1. **Serializer derives exclusion from zero enrollment.** Create a section with `enrollment_count = 0` and no `ExamPeriodSectionExclusion` row. GET `/course-sections/?include_empty=true&exam_period_id=<id>` and assert the section appears with `excluded_from_optimization: true`.
2. **Explicit exclusion still works for enrolled sections.** Section with enrollments and an `ExamPeriodSectionExclusion` row returns `excluded_from_optimization: true`. Without the exclusion row, returns `false`.
3. **Toggle endpoint rejects zero-enrollment.** POST `/exam-periods/<id>/toggle-exclusion/` with a zero-enrollment section_id returns 400; `ExamPeriodSectionExclusion.objects.count()` is unchanged.
4. **Toggle endpoint still works for enrolled sections.** Same endpoint with an enrolled section creates and then deletes the exclusion row as today.

### Manual verification

Per `superpowers:verification-before-completion`:

- Open Ders Seçimi for the active term/period. Find a known zero-enrollment row (per memory: CENG's CALCULUS I). Confirm toggle is locked ON, row opacity is 0.4, tooltip on hover reads the Turkish auto-exclude message.
- Toggle a non-zero section off and on; confirm DB exclusion row created/removed.
- Click the "Bitirme Projesi derslerini hariç tut" bulk checkbox; confirm no API calls fire for any zero-enrollment graduation sections.
- Run the optimizer for the period; confirm result is unchanged (sanity check that we did not accidentally affect optimizer behavior).
