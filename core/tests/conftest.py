import pytest
from core.models import (
    Organization, Term, AcademicUnit, CourseCatalog, CourseSection,
    StudentGroup, Student, Enrollment, Instructor
)


@pytest.fixture
def org(db):
    return Organization.objects.create(name="Test University", subscription_plan="Free")


@pytest.fixture
def active_term(org):
    return Term.objects.create(organization=org, name="Fall 2025", status="Active")


@pytest.fixture
def dept(org):
    return AcademicUnit.objects.create(
        organization=org, name="Computer Engineering", type="Department",
        scheduling_config={"code": "CS"}
    )


@pytest.fixture
def instructor(dept):
    return Instructor.objects.create(academic_unit=dept, name="Dr. Test")


@pytest.fixture
def course(org, dept):
    return CourseCatalog.objects.create(
        organization=org, academic_unit=dept,
        code="CALC_I", name="Calculus I",
        year_level=1, weekly_hours_lecture=4, requirement="COMPULSORY"
    )


@pytest.fixture
def student_group(org, dept):
    return StudentGroup.objects.create(
        organization=org, academic_unit=dept,
        year_level=1, name="CS Year 1", size_estimate=40
    )


@pytest.fixture
def section(active_term, course, instructor):
    return CourseSection.objects.create(
        term=active_term, course=course, section_code="A",
        instructor=instructor, max_enrollment=50
    )


@pytest.fixture
def student(org, student_group):
    return Student.objects.create(
        organization=org, student_group=student_group,
        year_level=1, identifier="CS-1-0001"
    )


@pytest.fixture
def enrollment(student, section, active_term):
    return Enrollment.objects.create(student=student, section=section, term=active_term)
