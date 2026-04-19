import pytest
from django.test import Client
from core.models import (
    Organization, Term, AcademicUnit, CourseCatalog, CourseSection,
    StudentGroup, Student, Enrollment
)

@pytest.fixture
def client(db):
    return Client()

@pytest.fixture
def setup_cross_dept_conflict(db):
    """Two courses from different depts that share a student."""
    org = Organization.objects.create(name="Test Uni")
    term = Term.objects.create(organization=org, name="Fall 2025", status="Active")
    dept_cs = AcademicUnit.objects.create(organization=org, name="CS", type="Department")
    dept_math = AcademicUnit.objects.create(organization=org, name="Math", type="Department")
    sg = StudentGroup.objects.create(organization=org, academic_unit=dept_cs, year_level=1, name="CS Y1")

    course_cs = CourseCatalog.objects.create(
        organization=org, academic_unit=dept_cs, code="CS101", name="Intro CS",
        year_level=1, requirement="COMPULSORY"
    )
    course_math = CourseCatalog.objects.create(
        organization=org, academic_unit=dept_math, code="MATH101", name="Calculus",
        year_level=1, requirement="COMPULSORY"
    )
    sec_cs = CourseSection.objects.create(term=term, course=course_cs, section_code="A", max_enrollment=50)
    sec_math = CourseSection.objects.create(term=term, course=course_math, section_code="A", max_enrollment=50)

    student = Student.objects.create(organization=org, student_group=sg, year_level=1, identifier="S001")
    Enrollment.objects.create(student=student, section=sec_cs, term=term)
    Enrollment.objects.create(student=student, section=sec_math, term=term)

    return {"dept_cs_id": str(dept_cs.id), "dept_math_id": str(dept_math.id)}


@pytest.mark.django_db
@pytest.mark.skip(reason="requires PostgreSQL — uses ::text casting")
def test_conflict_filter_shows_cross_dept_pairs(client, setup_cross_dept_conflict):
    """Filtering by dept_cs_id must return the CS<->Math conflict, not hide it."""
    dept_cs_id = setup_cross_dept_conflict["dept_cs_id"]
    response = client.get(f'/api/students/getConflicts/?department_id={dept_cs_id}')
    assert response.status_code == 200
    conflicts = response.json()['conflicts']
    assert len(conflicts) >= 1, "Cross-dept conflict should be visible when filtering by one dept"
    codes = {(c['course_a_code'], c['course_b_code']) for c in conflicts}
    assert ('CS101', 'MATH101') in codes or ('MATH101', 'CS101') in codes


@pytest.mark.django_db
@pytest.mark.skip(reason="requires PostgreSQL — uses ::text casting")
def test_conflict_filter_without_dept_shows_all(client, setup_cross_dept_conflict):
    """Without department_id filter, all conflict pairs are returned."""
    response = client.get('/api/students/getConflicts/')
    assert response.status_code == 200
    assert response.json()['total'] >= 1
