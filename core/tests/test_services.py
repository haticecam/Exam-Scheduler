import pytest
from unittest.mock import patch
from django.test import TestCase
from core.models import (
    Organization, Term, AcademicUnit, CourseCatalog, CourseSection,
    StudentGroup, Student, Enrollment
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
        "Course Name,Capacity,Program,Instructor,Mandatory,Year,T-hours\n"
        "Calculus I,50,Math,Dr. Smith,__1,1,4\n"
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
        "Course Name,Capacity,Program,Instructor,Mandatory,Year,T-hours\n"
        "Calculus I,50,Computer Engineering,Dr. Smith,__1,1,4\n"
        "Physics I,40,Computer Engineering,Dr. Jones,,1,3\n"
    )
    from core.services.course_loader import CourseLoaderService
    service = CourseLoaderService()
    result = service.process_csv(csv_data, term_id=str(active_term.id))

    assert result.get("success") is True
    assert AcademicUnit.objects.filter(organization=org, name="Computer Engineering").exists()
    assert CourseCatalog.objects.filter(organization=org).count() == 2
    assert CourseSection.objects.filter(term=active_term).count() == 2


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
        self.assertIn("PARAM_YEAR_ORDER_WEIGHT", bp)
        schema = bp["PARAM_YEAR_ORDER_WEIGHT"]["param_schema"]
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
        ok, _ = validate_parameter("PARAM_YEAR_ORDER_WEIGHT", 5.0)
        self.assertFalse(ok)
        ok, _ = validate_parameter("PARAM_YEAR_ORDER_WEIGHT", 600.0)
        self.assertFalse(ok)
        ok, _ = validate_parameter("PARAM_YEAR_ORDER_WEIGHT", 10.0)
        self.assertTrue(ok)
        ok, _ = validate_parameter("PARAM_YEAR_ORDER_WEIGHT", 500.0)
        self.assertTrue(ok)

    def test_build_optimizer_kwargs_includes_year_ordering(self):
        from core.services.constraint_library import build_optimizer_kwargs
        kwargs = build_optimizer_kwargs({
            "PARAM_YEAR_ORDERING": True,
            "PARAM_YEAR_ORDER_WEIGHT": 200.0,
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
        self.assertIn("PARAM_YEAR_ORDER_WEIGHT", ctx)


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
