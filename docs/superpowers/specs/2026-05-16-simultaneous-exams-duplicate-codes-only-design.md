# Simultaneous Exams — Restrict Course List to Cross-Department Duplicates

**Date:** 2026-05-16
**Branch:** llm-exam_calendar-fix
**Status:** Approved

---

## Summary

The "DERS SEÇİMİ" list inside the "Eş zamanlı sınavlar" subsection of the "Sınav Takvimi" tab currently shows every course section included in the optimization. This is the wrong dataset for the feature: a simultaneous-exam group only makes sense for course codes that are shared across departments (e.g. a `MATH 101` taught both by CENG and by EE that must be scheduled in the same slot).

This change restricts that list to course sections whose `course_code` appears in 2+ different departments, and sorts them by code so duplicates are visually adjacent. No backend, API, or database changes are required.

---

## Scope

**In scope**
- Single frontend file: `frontend/src/app/(app)/exam-calendar/SimultaneousExamsTab.tsx`
- The "DERS SEÇİMİ" (course selection) card inside `SimultaneousExamsTab` — section 3 in the existing layout.

**Out of scope**
- Backend filtering, API changes, new endpoints.
- Changes to optimizer behavior or data model.
- Deduping sections that share `(course_code, academic_unit)` — one row per `CourseSection` is preserved.
- Renaming the section/card title or adding new helper text beyond the empty-state message.
- Changes to the "EŞ ZAMANLI SINAV GRUPLARI" listing or the slot picker modal.

---

## Behavior

### Duplicate detection

A `course_code` is treated as a **cross-department duplicate** if, across all sections that are NOT excluded from the optimization, it appears under 2+ distinct `academic_unit_id` values.

- Excluded sections (`excluded_from_optimization === true`) are ignored for both detection and display. They are already hidden by the existing filter at line 99 of `SimultaneousExamsTab.tsx`.
- Sections missing `course_code` or `academic_unit_id` are skipped during detection (defensive guard; should not occur with current data).
- Multiple sections of the same catalog course inside one department contribute only one department-id to the set (`Set` semantics), so they do not falsely promote a code to "duplicate".

### Filter order

Duplicate detection runs **first**, against the full non-excluded section set. The user's Bölüm / Yıl / Tür / Arama filters are applied **on top** of the duplicate-restricted set.

Implication: filtering by `Bölüm = CENG` still shows the CENG row of any course code that also exists in another department — it does not collapse the list to empty.

### Display

- Per-section row layout (current behavior) is preserved — one row per `CourseSection`.
- Rows are sorted by `course_code` ascending (stable, locale-aware), so duplicates cluster.
- No grouping headers, separators, or visual treatments beyond what exists today.
- All existing filters (Bölüm, Yıl, Tür, Arama) remain above the table unchanged.
- The "Eş Zamanlı Yap" button continues to require ≥ 2 checked courses.

### Empty state

The current empty-state message inside this section is the generic `"Uygun ders bulunamadı."`. After this change, the empty state may also mean "no course codes are shared across 2+ departments", so the message becomes more specific:

> `Bölümler arası aynı koda sahip ders bulunamadı.`

This replaces the existing message only inside this `SimultaneousExamsTab`. Other tabs that use the same generic `InfoBox` string are unaffected.

---

## Implementation Sketch

Within `SimultaneousExamsTab.tsx`, immediately above the existing `filtered = sections.filter(...)` block:

```ts
const duplicateCodes = React.useMemo(() => {
  const byCode = new Map<string, Set<string>>();
  for (const s of sections) {
    if (s.excluded_from_optimization) continue;
    if (!s.course_code || !s.academic_unit_id) continue;
    let depts = byCode.get(s.course_code);
    if (!depts) { depts = new Set(); byCode.set(s.course_code, depts); }
    depts.add(String(s.academic_unit_id));
  }
  const out = new Set<string>();
  for (const [code, depts] of byCode) {
    if (depts.size >= 2) out.add(code);
  }
  return out;
}, [sections]);
```

Then in the existing `filtered` chain:

```ts
const filtered = sections
  .filter((s: any) => {
    if (s.excluded_from_optimization) return false;
    if (!duplicateCodes.has(s.course_code)) return false;
    // …existing dept/year/type/search guards…
    return true;
  })
  .sort((a: any, b: any) =>
    String(a.course_code ?? "").localeCompare(String(b.course_code ?? ""))
  );
```

The empty-state `<InfoBox msg="Uygun ders bulunamadı." />` inside this tab is replaced with:

```tsx
<InfoBox msg="Bölümler arası aynı koda sahip ders bulunamadı." />
```

No other component, prop, or hook needs to change.

---

## Data Contracts

The change relies on fields already returned by `GET /course-sections/?term_id=X&exam_period_id=Y` via `CourseSectionSerializer`:

- `course_code` — `course.code`
- `academic_unit_id` — `course.academic_unit_id`
- `excluded_from_optimization` — boolean, per exam-period

No new fields, no schema changes.

---

## Edge Cases

| Case | Behavior |
|------|----------|
| Code exists in 1 department only (any number of sections) | Hidden from the list. |
| Code exists in 2+ departments | All non-excluded sections of that code show, regardless of dept filter (subject to user filters). |
| Code exists in 2 departments, one is excluded for this exam period | Detection sees only 1 dept → code is no longer a duplicate → hidden entirely. |
| Code exists in 2 departments, several sections per dept | All sections shown (per-section rows); checkbox-by-`course_id` still groups them logically. |
| Empty sections array (no data loaded) | Empty list with the new empty-state message; same loading spinner behavior. |

---

## Testing Plan

Manual verification with the dev server running and the "Eş zamanlı sınavlar" tab open:

1. **Cross-dept duplicate visible.** Pick a course code present in two departments (e.g. `MATH 101` in CENG and EE). Both rows appear, adjacent to each other due to sort.
2. **Single-dept code hidden.** A course code that exists only in one department does not appear in the list.
3. **Dept filter narrows, does not erase.** With `Bölüm = CENG`, the CENG row of `MATH 101` still appears (the EE row is filtered out by Bölüm, not by duplicate detection).
4. **Exclusion removes duplicate status.** If the only EE section of `MATH 101` is excluded from optimization for the current period, `MATH 101` disappears from the list entirely (since CENG is now the only dept).
5. **Empty state.** When no cross-dept duplicate codes exist (e.g. an exam period with single-dept courses only), the message reads `Bölümler arası aynı koda sahip ders bulunamadı.`
6. **Selection still works.** Selecting checkboxes on at least two rows of different course codes enables the "Eş Zamanlı Yap" button; the slot picker modal and POST flow are unchanged.

---

## Risks

- **Performance:** `sections` is at most a few thousand rows per term; one `Map` pass + one `Set` build + one sort is negligible.
- **Hiding legitimate use cases:** A course code that is genuinely unique to one department but the user wants to group with a different code is not supported by this UI. That was never supported by the prior list-everything view either — the current behavior already restricts groups to "exact same time slot for selected courses", and listing every course was misleading. If a real use case for single-dept simultaneous groups appears, revisit the filter rule rather than reverting.

---

## Out of Scope (Possible Follow-ups)

- Section-row dedup (one row per `(code, dept)`) — the per-section layout is preserved as-is.
- Backend-side filtering of the `/course-sections/` endpoint for this tab. Frontend filtering keeps the endpoint single-purpose; only this one tab is affected.
- Visual grouping headers, color-coding by code, or a "shared with N departments" badge.
