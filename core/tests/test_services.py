import pytest
from unittest.mock import patch
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
