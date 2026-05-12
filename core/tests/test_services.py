import pytest
from unittest.mock import patch
from django.test import TestCase
from core.models import (
    Organization, Term, AcademicUnit, CourseCatalog, CourseSection,
    StudentGroup, Student, Enrollment, ExamPeriod, ExamDateSlot,
)


@pytest.fixture
def org(db):
    return Organization.objects.create(name="Test University", subscription_plan="Free")


@pytest.fixture
def active_term(org):
    return Term.objects.create(organization=org, name="Fall 2025", status="Active")


# --- CourseLoaderService ---

@pytest.mark.django_db
def test_course_loader_atomic_rollback_on_error(org, active_term):
    """If CourseLoaderService fails midway, no partial data should be committed."""
    csv_data = (
        "Course Code,Course Name,Capacity,Program,Instructor,Mandatory,Year,T-hours\n"
        "CALC1,Calculus I,50,Math,Dr. Smith,1,1,4\n"
    )
    from core.services.course_loader import CourseLoaderService

    with patch('core.services.course_loader.CourseSection.objects.get_or_create',
               side_effect=Exception("simulated DB failure")):
        service = CourseLoaderService()
        result = service.process_csv(csv_data, term_id=str(active_term.id))

    # Atomic: no partial data should persist
    assert AcademicUnit.objects.filter(organization=org, name="Math").count() == 0
    assert "error" in result


@pytest.mark.django_db
def test_course_loader_success(org, active_term):
    """CourseLoaderService processes a valid CSV and creates the expected records."""
    csv_data = (
        "Course Code,Course Name,Capacity,Program,Instructor,Mandatory,Year,T-hours\n"
        "CE101,Calculus I,50,Computer Engineering,Dr. Smith,1,1,4\n"
        "CE102,Physics I,40,Computer Engineering,Dr. Jones,,1,3\n"
    )
    from core.services.course_loader import CourseLoaderService
    service = CourseLoaderService()
    result = service.process_csv(csv_data, term_id=str(active_term.id))

    assert result.get("success") is True
    assert AcademicUnit.objects.filter(organization=org, name="Computer Engineering").exists()
    assert CourseCatalog.objects.filter(organization=org).count() == 2
    assert CourseSection.objects.filter(term=active_term).count() == 2


@pytest.mark.django_db
def test_course_loader_rejects_missing_course_code(org, active_term):
    """Rows without a Course Code must be rejected — no auto-generation allowed."""
    csv_data = (
        "Course Code,Course Name,Capacity,Program,Instructor,Mandatory,Year,T-hours\n"
        ",Calculus I,50,Math,Dr. Smith,1,1,4\n"
    )
    from core.services.course_loader import CourseLoaderService
    result = CourseLoaderService().process_csv(csv_data, term_id=str(active_term.id))
    assert "error" in result
    assert CourseCatalog.objects.filter(organization=org).count() == 0


@pytest.mark.django_db
def test_course_loader_uses_csv_course_code(org, active_term):
    """The course code stored in the DB must match exactly what is in the CSV."""
    csv_data = (
        "Course Code,Course Name,Capacity,Program,Instructor,Mandatory,Year,T-hours\n"
        "CS101,Calculus I,50,Math,Dr. Smith,1,1,4\n"
    )
    from core.services.course_loader import CourseLoaderService
    result = CourseLoaderService().process_csv(csv_data, term_id=str(active_term.id))
    assert result.get("success") is True
    course = CourseCatalog.objects.get(organization=org)
    assert course.code == "CS101"


# --- DemoUpdaterService ---

@pytest.mark.django_db
def test_demo_updater_uses_bulk_update(org):
    """DemoUpdaterService must use bulk_update, not per-row save()."""
    dept = AcademicUnit.objects.create(organization=org, name="Bilgisayar Müh.", type="Department")
    StudentGroup.objects.create(organization=org, academic_unit=dept, year_level=1, name="CS Y1")
    StudentGroup.objects.create(organization=org, academic_unit=dept, year_level=2, name="CS Y2")

    csv_data = (
        "Ders Adı_14190;Sınıf_14190;Kon_14190;Program_14190\n"
        "Calculus I;1;50/999;Bilgisayar Müh.\n"
        "Physics I;2;45/999;Bilgisayar Müh.\n"
    )
    from core.services.demo_updater import DemoUpdaterService
    service = DemoUpdaterService()

    with patch.object(StudentGroup, 'save', wraps=StudentGroup.save) as mock_save:
        result = service.process_csv(csv_data)
        assert mock_save.call_count == 0, (
            f"Expected bulk_update (no .save() calls), got {mock_save.call_count}"
        )

    assert result.get("success") is True
    # Verify the sizes were actually updated
    g1 = StudentGroup.objects.get(academic_unit=dept, year_level=1)
    assert g1.size_estimate is not None and g1.size_estimate > 0


@pytest.mark.django_db
def test_demo_updater_skips_graduation_courses(org):
    """Graduation courses must be excluded from cohort size estimation."""
    dept = AcademicUnit.objects.create(organization=org, name="Test Dept", type="Department")
    StudentGroup.objects.create(organization=org, academic_unit=dept, year_level=4, name="TD Y4")

    csv_data = (
        "Ders Adı_14190;Sınıf_14190;Kon_14190;Program_14190\n"
        "Graduation Project;4;30/999;Test Dept\n"
    )
    from core.services.demo_updater import DemoUpdaterService
    result = DemoUpdaterService().process_csv(csv_data)

    # Should report no valid data found
    assert "error" in result


class YearOrderingBlueprintTests(TestCase):

    def test_weight_year_order_in_library(self):
        from core.services.constraint_library import get_blueprint_map
        bp = get_blueprint_map()
        self.assertIn("PARAM_YEAR_ORDER_WEIGHT", bp)
        schema = bp["PARAM_YEAR_ORDER_WEIGHT"]["param_schema"]
        self.assertEqual(schema["type"], "number")
        self.assertEqual(schema["minimum"], 10.0)
        self.assertEqual(schema["maximum"], 500.0)
        self.assertEqual(schema["default"], 100.0)
        self.assertEqual(schema["optimizer_kwarg"], "year_order_weight")

    def test_year_order_sequence_in_library(self):
        from core.services.constraint_library import get_blueprint_map
        bp = get_blueprint_map()
        self.assertIn("PARAM_YEAR_ORDER_SEQUENCE", bp)
        schema = bp["PARAM_YEAR_ORDER_SEQUENCE"]["param_schema"]
        self.assertEqual(schema["type"], "array")
        self.assertIsNone(schema["default"])
        self.assertEqual(schema["optimizer_kwarg"], "year_order_sequence")

    def test_weight_year_order_validation_rejects_out_of_range(self):
        from core.services.constraint_library import validate_parameter
        ok, _ = validate_parameter("PARAM_YEAR_ORDER_WEIGHT", 5.0)
        self.assertFalse(ok)
        ok, _ = validate_parameter("PARAM_YEAR_ORDER_WEIGHT", 600.0)
        self.assertFalse(ok)
        ok, _ = validate_parameter("PARAM_YEAR_ORDER_WEIGHT", 10.0)
        self.assertTrue(ok)
        ok, _ = validate_parameter("PARAM_YEAR_ORDER_WEIGHT", 500.0)
        self.assertTrue(ok)

    def test_year_order_sequence_validation_accepts_list(self):
        from core.services.constraint_library import validate_parameter
        ok, err = validate_parameter("PARAM_YEAR_ORDER_SEQUENCE", [4, 1])
        self.assertTrue(ok, err)

    def test_build_optimizer_kwargs_includes_sequence(self):
        from core.services.constraint_library import build_optimizer_kwargs
        kwargs = build_optimizer_kwargs({
            "PARAM_YEAR_ORDER_SEQUENCE": [4, 1],
            "PARAM_YEAR_ORDER_WEIGHT": 200.0,
        })
        self.assertEqual(kwargs["year_order_sequence"], [4, 1])
        self.assertEqual(kwargs["year_order_weight"], 200.0)

    def test_defaults_include_year_order_weight(self):
        from core.services.constraint_library import get_optimizer_defaults
        defaults = get_optimizer_defaults()
        self.assertNotIn("year_ordering", defaults)
        self.assertIn("year_order_weight", defaults)
        self.assertEqual(defaults["year_order_weight"], 100.0)
        self.assertIn("year_order_sequence", defaults)
        self.assertIsNone(defaults["year_order_sequence"])

    def test_llm_context_includes_year_order_params(self):
        from core.services.constraint_library import generate_llm_context
        ctx = generate_llm_context()
        self.assertNotIn("PARAM_YEAR_ORDERING", ctx)
        self.assertIn("PARAM_YEAR_ORDER_WEIGHT", ctx)
        self.assertIn("PARAM_YEAR_ORDER_SEQUENCE", ctx)


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

    def test_empty_input_returns_empty(self):
        from core.services.optimizer import compute_year_bands
        bands = compute_year_bands([], 10)
        self.assertEqual(bands, {})


# --- load_exam_calendar ---

import datetime


@pytest.fixture
def period_with_slots(db):
    org = Organization.objects.create(name="Test Uni")
    term = Term.objects.create(organization=org, name="Fall 2025", status="Active")
    period = ExamPeriod.objects.create(
        term=term, name="Finals", exam_type="FINAL",
        start_date=datetime.date(2025, 6, 2),  # Monday
        end_date=datetime.date(2025, 6, 4),    # Wednesday (3 active days)
    )
    # Day 0 (Mon 2025-06-02): 2 slots — slot 0 available, slot 1 blocked
    ExamDateSlot.objects.bulk_create([
        ExamDateSlot(exam_period=period, date=datetime.date(2025, 6, 2),
                     start_time=datetime.time(8, 30), end_time=datetime.time(9, 0),
                     label="08:30-09:00", is_blocked=False),
        ExamDateSlot(exam_period=period, date=datetime.date(2025, 6, 2),
                     start_time=datetime.time(9, 0), end_time=datetime.time(9, 30),
                     label="09:00-09:30", is_blocked=True),
        # Day 1 (Tue 2025-06-03): 2 slots available
        ExamDateSlot(exam_period=period, date=datetime.date(2025, 6, 3),
                     start_time=datetime.time(8, 30), end_time=datetime.time(9, 0),
                     label="08:30-09:00", is_blocked=False),
        ExamDateSlot(exam_period=period, date=datetime.date(2025, 6, 3),
                     start_time=datetime.time(9, 0), end_time=datetime.time(9, 30),
                     label="09:00-09:30", is_blocked=False),
        # Day 2 (Wed 2025-06-04): all slots blocked → not an active day
        ExamDateSlot(exam_period=period, date=datetime.date(2025, 6, 4),
                     start_time=datetime.time(8, 30), end_time=datetime.time(9, 0),
                     label="08:30-09:00", is_blocked=True),
        ExamDateSlot(exam_period=period, date=datetime.date(2025, 6, 4),
                     start_time=datetime.time(9, 0), end_time=datetime.time(9, 30),
                     label="09:00-09:30", is_blocked=True),
    ])
    return period


@pytest.mark.django_db
def test_load_exam_calendar_active_days(period_with_slots):
    from core.services.optimizer import OptimizerService
    term_id = str(period_with_slots.term_id)
    svc = OptimizerService(term_id=term_id)
    cal = svc.load_exam_calendar(str(period_with_slots.id))
    # Only Mon and Tue are active (Wed is fully blocked)
    assert cal["exam_days"] == 2


@pytest.mark.django_db
def test_load_exam_calendar_slots_per_day(period_with_slots):
    from core.services.optimizer import OptimizerService
    svc = OptimizerService(term_id=str(period_with_slots.term_id))
    cal = svc.load_exam_calendar(str(period_with_slots.id))
    assert cal["slots_per_day"] == 2


@pytest.mark.django_db
def test_load_exam_calendar_blocked_indices(period_with_slots):
    from core.services.optimizer import OptimizerService
    svc = OptimizerService(term_id=str(period_with_slots.term_id))
    cal = svc.load_exam_calendar(str(period_with_slots.id))
    # Day 0 slot 1 (index 1) is blocked; day 1 has none blocked
    assert 1 in cal["blocked_slot_indices"]
    assert 0 not in cal["blocked_slot_indices"]


@pytest.mark.django_db
def test_load_exam_calendar_day_weekday_map(period_with_slots):
    from core.services.optimizer import OptimizerService
    svc = OptimizerService(term_id=str(period_with_slots.term_id))
    cal = svc.load_exam_calendar(str(period_with_slots.id))
    # 2025-06-02 is Monday, 2025-06-03 is Tuesday
    assert cal["day_weekday_map"][0] == "Mon"
    assert cal["day_weekday_map"][1] == "Tue"


@pytest.mark.django_db
def test_load_exam_calendar_raises_for_unknown_period(db):
    import uuid
    from core.services.optimizer import OptimizerService
    org = Organization.objects.create(name="X")
    term = Term.objects.create(organization=org, name="T", status="Active")
    svc = OptimizerService(term_id=str(term.id))
    with pytest.raises(ValueError, match="not found"):
        svc.load_exam_calendar(str(uuid.uuid4()))
