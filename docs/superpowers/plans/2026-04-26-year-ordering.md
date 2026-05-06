# Year-Based Day Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the optimizer to softly prefer scheduling lower year-level exams earlier in the exam week and higher year-level exams later, configurable via natural language through the LLM assistant.

**Architecture:** Add two new constraint blueprints (`PARAM_YEAR_ORDERING` boolean, `WEIGHT_YEAR_ORDER` float) to the static constraint library, then wire them into the Gurobi optimizer as linear penalty terms added directly to the objective function — no new binary variables needed. When `year_ordering=True`, the optimizer divides the exam days into equal-width bands (one per distinct year level found in the term's data) and adds `weight * y[(c, s)]` to the objective for every out-of-band slot `s` for each course unit `c`. This nudges the solver toward the preferred ordering without risking infeasibility.

**Tech Stack:** Python, Gurobi (`gurobipy`), Django, existing `constraint_library.py` and `optimizer.py` patterns.

---

## File Map

| File | Change |
|------|--------|
| `core/services/constraint_library.py` | Add `PARAM_YEAR_ORDERING` and `WEIGHT_YEAR_ORDER` blueprints to `BLUEPRINT_DEFINITIONS` |
| `core/services/optimizer.py` | Add `compute_year_bands` helper; extend `solve()` signature and objective |
| `core/tests/test_services.py` | Add `YearOrderingBlueprintTests` and `YearBandComputationTests` |

---

### Task 1: Add blueprints to the constraint library

**Files:**
- Modify: `core/services/constraint_library.py`

- [ ] **Step 1: Write failing tests first**

In `core/tests/test_services.py`, add this class at the bottom of the file:

```python
class YearOrderingBlueprintTests(TestCase):

    def test_param_year_ordering_in_library(self):
        from core.services.constraint_library import get_blueprint_map
        bp = get_blueprint_map()
        self.assertIn("PARAM_YEAR_ORDERING", bp)
        schema = bp["PARAM_YEAR_ORDERING"]["param_schema"]
        self.assertEqual(schema["type"], "boolean")
        self.assertFalse(schema["default"])
        self.assertEqual(schema["optimizer_kwarg"], "year_ordering")

    def test_weight_year_order_in_library(self):
        from core.services.constraint_library import get_blueprint_map
        bp = get_blueprint_map()
        self.assertIn("WEIGHT_YEAR_ORDER", bp)
        schema = bp["WEIGHT_YEAR_ORDER"]["param_schema"]
        self.assertEqual(schema["type"], "number")
        self.assertEqual(schema["minimum"], 10.0)
        self.assertEqual(schema["maximum"], 500.0)
        self.assertEqual(schema["default"], 100.0)
        self.assertEqual(schema["optimizer_kwarg"], "year_order_weight")

    def test_year_ordering_validation_accepts_boolean(self):
        from core.services.constraint_library import validate_parameter
        ok, err = validate_parameter("PARAM_YEAR_ORDERING", True)
        self.assertTrue(ok, err)
        ok, err = validate_parameter("PARAM_YEAR_ORDERING", False)
        self.assertTrue(ok, err)

    def test_weight_year_order_validation_rejects_out_of_range(self):
        from core.services.constraint_library import validate_parameter
        ok, _ = validate_parameter("WEIGHT_YEAR_ORDER", 5.0)
        self.assertFalse(ok)
        ok, _ = validate_parameter("WEIGHT_YEAR_ORDER", 600.0)
        self.assertFalse(ok)

    def test_build_optimizer_kwargs_includes_year_ordering(self):
        from core.services.constraint_library import build_optimizer_kwargs
        kwargs = build_optimizer_kwargs({
            "PARAM_YEAR_ORDERING": True,
            "WEIGHT_YEAR_ORDER": 200.0,
        })
        self.assertTrue(kwargs["year_ordering"])
        self.assertEqual(kwargs["year_order_weight"], 200.0)

    def test_defaults_include_year_ordering(self):
        from core.services.constraint_library import get_optimizer_defaults
        defaults = get_optimizer_defaults()
        self.assertIn("year_ordering", defaults)
        self.assertFalse(defaults["year_ordering"])
        self.assertIn("year_order_weight", defaults)
        self.assertEqual(defaults["year_order_weight"], 100.0)

    def test_llm_context_includes_year_ordering(self):
        from core.services.constraint_library import generate_llm_context
        ctx = generate_llm_context()
        self.assertIn("PARAM_YEAR_ORDERING", ctx)
        self.assertIn("WEIGHT_YEAR_ORDER", ctx)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd C:\Exam-Scheduler
python manage.py test core.tests.test_services.YearOrderingBlueprintTests --verbosity=2
```

Expected: 7 failures — blueprints don't exist yet.

- [ ] **Step 3: Add the two blueprints to `BLUEPRINT_DEFINITIONS`**

In `core/services/constraint_library.py`, find the existing `PARAM_MIP_GAP` entry (the last entry in the `SOLVER_PARAM` section). Add the two new entries immediately after it, before the `# CATEGORY 2: SOFT CONSTRAINT WEIGHTS` comment block:

```python
    {
        "code": "PARAM_YEAR_ORDERING",
        "category": "SOLVER_PARAM",
        "description": (
            "When enabled, the optimizer softly prefers scheduling lower year-level "
            "exams earlier in the exam week and higher year-level exams later. "
            "Year 1 exams are nudged toward the first day band, year 2 toward the "
            "second, and so on. This is a soft preference — it will not cause "
            "infeasibility but adds a penalty whenever an exam lands outside its "
            "preferred day band."
        ),
        "param_schema": {
            "type": "boolean",
            "default": False,
            "optimizer_kwarg": "year_ordering",
            "examples": [
                {"input": "Put first-year exams at the start of the exam week", "value": True},
                {"input": "Order exams by year level across the exam period", "value": True},
                {"input": "Don't apply any year-based ordering", "value": False},
            ],
        },
    },
    {
        "code": "WEIGHT_YEAR_ORDER",
        "category": "SOLVER_PARAM",
        "description": (
            "Controls how strongly the optimizer enforces year-based day ordering "
            "when PARAM_YEAR_ORDERING is enabled. Higher values push the solver "
            "harder to place exams in their preferred day band, at the cost of "
            "potentially accepting more student conflicts. Lower values treat the "
            "ordering as a gentle nudge."
        ),
        "param_schema": {
            "type": "number",
            "minimum": 10.0,
            "maximum": 500.0,
            "default": 100.0,
            "optimizer_kwarg": "year_order_weight",
            "examples": [
                {"input": "Strict year ordering, override other preferences", "value": 400.0},
                {"input": "Gentle year ordering, don't hurt student conflicts", "value": 30.0},
                {"input": "Moderate year ordering preference", "value": 100.0},
            ],
        },
    },
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
python manage.py test core.tests.test_services.YearOrderingBlueprintTests --verbosity=2
```

Expected: all 7 PASS.

---

### Task 2: Add year-band logic to the optimizer

**Files:**
- Modify: `core/services/optimizer.py`

- [ ] **Step 1: Write failing tests for the band computation**

In `core/tests/test_services.py`, add a second class at the bottom:

```python
class YearBandComputationTests(TestCase):

    def test_four_years_ten_days(self):
        from core.services.optimizer import compute_year_bands
        bands = compute_year_bands([1, 2, 3, 4], 10)
        self.assertEqual(bands[1], (0, 2))
        self.assertEqual(bands[2], (2, 5))
        self.assertEqual(bands[3], (5, 7))
        self.assertEqual(bands[4], (7, 10))

    def test_two_years_six_days(self):
        from core.services.optimizer import compute_year_bands
        bands = compute_year_bands([1, 2], 6)
        self.assertEqual(bands[1], (0, 3))
        self.assertEqual(bands[2], (3, 6))

    def test_single_year_returns_empty(self):
        from core.services.optimizer import compute_year_bands
        bands = compute_year_bands([1, 1, 1], 10)
        self.assertEqual(bands, {})

    def test_duplicate_levels_deduplicated(self):
        from core.services.optimizer import compute_year_bands
        bands = compute_year_bands([2, 1, 2, 1, 3], 9)
        self.assertEqual(set(bands.keys()), {1, 2, 3})

    def test_last_band_always_reaches_exam_days(self):
        from core.services.optimizer import compute_year_bands
        bands = compute_year_bands([1, 2, 3], 7)
        self.assertEqual(bands[3][1], 7)

    def test_bands_are_contiguous(self):
        from core.services.optimizer import compute_year_bands
        bands = compute_year_bands([1, 2, 3, 4], 10)
        levels = sorted(bands.keys())
        for a, b in zip(levels, levels[1:]):
            self.assertEqual(bands[a][1], bands[b][0])
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
python manage.py test core.tests.test_services.YearBandComputationTests --verbosity=2
```

Expected: ImportError — `compute_year_bands` doesn't exist yet.

- [ ] **Step 3: Add `compute_year_bands` helper to `optimizer.py`**

In `core/services/optimizer.py`, add this function at module level, before the `OptimizerService` class definition:

```python
def compute_year_bands(year_levels: list, exam_days: int) -> dict:
    """
    Divide exam_days into equal-width bands, one per distinct year level.
    Returns {year_level: (day_start_inclusive, day_end_exclusive)}.
    Returns empty dict if fewer than 2 distinct year levels.
    """
    levels = sorted(set(year_levels))
    n = len(levels)
    if n < 2:
        return {}
    band_size = exam_days / n
    bands = {}
    for i, yr in enumerate(levels):
        day_start = int(i * band_size)
        day_end = int((i + 1) * band_size) if i < n - 1 else exam_days
        bands[yr] = (day_start, day_end)
    return bands
```

- [ ] **Step 4: Run band tests to confirm they pass**

```bash
python manage.py test core.tests.test_services.YearBandComputationTests --verbosity=2
```

Expected: all 6 PASS.

- [ ] **Step 5: Extend `solve()` signature**

Find the `solve` method signature (currently line 127):

```python
    def solve(self, hard_threshold: int = 5, time_limit: int = 300, mip_gap: float = 0.10,
              no_back_to_back: bool = False, exam_days: int = 5, slots_per_day: int = 10,
              start_hour: int = 8) -> dict:
```

Replace with:

```python
    def solve(self, hard_threshold: int = 5, time_limit: int = 300, mip_gap: float = 0.10,
              no_back_to_back: bool = False, exam_days: int = 5, slots_per_day: int = 10,
              start_hour: int = 8, year_ordering: bool = False,
              year_order_weight: float = 100.0) -> dict:
```

- [ ] **Step 6: Add year-band computation inside `solve()`**

Find this existing block in `solve()`:

```python
        groups = defaultdict(list)
        for c in C:
            groups[(info[c]["student_dept"], info[c]["year_level"])].append(c)
```

Immediately after that block, add:

```python
        year_band = {}
        if year_ordering:
            all_year_levels = [
                info[c]["year_level"] for c in C
                if info[c].get("year_level") is not None
            ]
            year_band = compute_year_bands(all_year_levels, exam_days)
```

- [ ] **Step 7: Add year-order penalty terms**

Find the `# B. Daily Spread Penalty` section and its closing loop. Immediately after the `daily_spread_vars` loop ends, add:

```python
        # C. Year-Band Ordering Preference (linear penalty on existing y variables)
        year_order_terms = []
        if year_ordering and year_band:
            for c in C:
                yr = info[c].get("year_level")
                if yr is None or yr not in year_band:
                    continue
                preferred_start, preferred_end = year_band[yr]
                for s in valid_starts(c):
                    if (c, s) not in y:
                        continue
                    if not (preferred_start <= s // slots_per_day < preferred_end):
                        year_order_terms.append(year_order_weight * y[(c, s)])
```

- [ ] **Step 8: Add year-order terms to the objective**

Find the existing `m.setObjective(...)` call:

```python
        m.setObjective(
            quicksum(cv["weight"] * cv["var"] for cv in conflict_vars) +
            quicksum(dv["weight"] * dv["var"] for dv in daily_spread_vars) +
            minimize_rooms_used,
            GRB.MINIMIZE)
```

Replace with:

```python
        m.setObjective(
            quicksum(cv["weight"] * cv["var"] for cv in conflict_vars) +
            quicksum(dv["weight"] * dv["var"] for dv in daily_spread_vars) +
            (quicksum(year_order_terms) if year_order_terms else 0) +
            minimize_rooms_used,
            GRB.MINIMIZE)
```

- [ ] **Step 9: Run all new tests together**

```bash
python manage.py test core.tests.test_services.YearOrderingBlueprintTests core.tests.test_services.YearBandComputationTests --verbosity=2
```

Expected: all 13 tests PASS.
