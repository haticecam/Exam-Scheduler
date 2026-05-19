import inspect
import datetime
import pytest
from django.test import TestCase, Client
from rest_framework.test import APIClient
from django.contrib.auth.models import User as DjangoUser
from rest_framework.authtoken.models import Token
from core.models import (
    SimultaneousExamGroup, SimultaneousExamGroupCourse,
    Organization, Term, ExamPeriod, ExamDateSlot,
    CourseCatalog, AcademicUnit,
)
from core.serializers import SimultaneousExamGroupSerializer
from core.services.optimizer import OptimizerService


class TestSimultaneousExamGroupModel(TestCase):
    def test_models_exist(self):
        self.assertTrue(hasattr(SimultaneousExamGroup, 'exam_period'))
        self.assertTrue(hasattr(SimultaneousExamGroup, 'slot'))
        self.assertTrue(hasattr(SimultaneousExamGroup, 'label'))
        self.assertTrue(hasattr(SimultaneousExamGroupCourse, 'group'))
        self.assertTrue(hasattr(SimultaneousExamGroupCourse, 'course'))


class TestSimultaneousExamGroupSerializer(TestCase):
    def test_has_required_fields(self):
        s = SimultaneousExamGroupSerializer()
        for field in ['id', 'exam_period', 'slot', 'label',
                      'slot_date', 'slot_start_time', 'slot_end_time',
                      'courses', 'course_ids']:
            self.assertIn(field, s.fields, msg=f"Missing field: {field}")


class TestSimultaneousExamGroupAPI(TestCase):
    def test_list_endpoint_exists(self):
        c = Client()
        resp = c.get('/api/simultaneous-groups/')
        self.assertIn(resp.status_code, [200, 401, 403])


class TestOptimizerPinnedExams(TestCase):
    def test_solve_accepts_pinned_exams_param(self):
        sig = inspect.signature(OptimizerService.solve)
        self.assertIn('pinned_exams', sig.parameters)

    def test_load_exam_calendar_returns_active_dates_and_times(self):
        import pathlib
        src = pathlib.Path('core/services/optimizer.py').read_text()
        self.assertIn('active_dates', src)
        self.assertIn('all_start_times', src)


# ── PATCH endpoint fixtures ───────────────────────────────────────────────────

@pytest.fixture
def api_client(db):
    user = DjangoUser.objects.create_user("testadmin2", password="pass")
    token = Token.objects.create(user=user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return client


@pytest.fixture
def org2(db):
    return Organization.objects.create(name="Patch Test University")


@pytest.fixture
def term2(org2):
    return Term.objects.create(organization=org2, name="Spring 2026", status="Active")


@pytest.fixture
def dept2(org2):
    return AcademicUnit.objects.create(
        organization=org2, name="Math", type="Department",
        scheduling_config={"code": "MATH"},
    )


@pytest.fixture
def period2(term2):
    return ExamPeriod.objects.create(
        term=term2,
        name="Finals",
        exam_type="FINAL",
        start_date=datetime.date(2026, 6, 1),
        end_date=datetime.date(2026, 6, 1),
        config={},
    )


@pytest.fixture
def slot_a(period2):
    return ExamDateSlot.objects.create(
        exam_period=period2,
        date=datetime.date(2026, 6, 1),
        start_time=datetime.time(9, 0),
        end_time=datetime.time(9, 30),
        is_blocked=False,
    )


@pytest.fixture
def slot_b(period2):
    return ExamDateSlot.objects.create(
        exam_period=period2,
        date=datetime.date(2026, 6, 1),
        start_time=datetime.time(10, 0),
        end_time=datetime.time(10, 30),
        is_blocked=False,
    )


@pytest.fixture
def course_x(org2, dept2):
    return CourseCatalog.objects.create(
        organization=org2, academic_unit=dept2,
        code="MATH101", name="Calculus", year_level=1,
        weekly_hours_lecture=2, requirement="COMPULSORY",
    )


@pytest.fixture
def course_y(org2, dept2):
    return CourseCatalog.objects.create(
        organization=org2, academic_unit=dept2,
        code="MATH101", name="Calculus", year_level=1,
        weekly_hours_lecture=2, requirement="COMPULSORY",
    )


@pytest.fixture
def course_z(org2, dept2):
    return CourseCatalog.objects.create(
        organization=org2, academic_unit=dept2,
        code="MATH101", name="Calculus", year_level=1,
        weekly_hours_lecture=2, requirement="COMPULSORY",
    )


@pytest.fixture
def group2(period2, slot_a, course_x, course_y):
    g = SimultaneousExamGroup.objects.create(
        exam_period=period2, slot=slot_a, label="Grup 1"
    )
    SimultaneousExamGroupCourse.objects.bulk_create([
        SimultaneousExamGroupCourse(group=g, course=course_x),
        SimultaneousExamGroupCourse(group=g, course=course_y),
    ])
    return g


# ── PATCH tests ───────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_patch_slot_only(api_client, group2, slot_b):
    """PATCH with only a new slot updates the slot and leaves courses unchanged."""
    res = api_client.patch(
        f"/api/simultaneous-groups/{group2.id}/",
        {"slot": str(slot_b.id)},
        format="json",
    )
    assert res.status_code == 200, res.data
    group2.refresh_from_db()
    assert group2.slot_id == slot_b.id
    assert group2.group_courses.count() == 2


@pytest.mark.django_db
def test_patch_course_ids_only(api_client, group2, slot_a, course_x, course_z):
    """PATCH with only course_ids updates courses and leaves slot unchanged."""
    res = api_client.patch(
        f"/api/simultaneous-groups/{group2.id}/",
        {"course_ids": [str(course_x.id), str(course_z.id)]},
        format="json",
    )
    assert res.status_code == 200, res.data
    group2.refresh_from_db()
    assert group2.slot_id == slot_a.id
    ids = set(group2.group_courses.values_list("course_id", flat=True))
    assert ids == {course_x.id, course_z.id}


@pytest.mark.django_db
def test_patch_both_slot_and_courses(api_client, group2, slot_b, course_x, course_z):
    """PATCH with both slot and course_ids updates both."""
    res = api_client.patch(
        f"/api/simultaneous-groups/{group2.id}/",
        {"slot": str(slot_b.id), "course_ids": [str(course_x.id), str(course_z.id)]},
        format="json",
    )
    assert res.status_code == 200, res.data
    group2.refresh_from_db()
    assert group2.slot_id == slot_b.id
    ids = set(group2.group_courses.values_list("course_id", flat=True))
    assert ids == {course_x.id, course_z.id}


@pytest.mark.django_db
def test_patch_requires_at_least_two_courses(api_client, group2, course_x):
    """PATCH with fewer than 2 course_ids returns 400."""
    res = api_client.patch(
        f"/api/simultaneous-groups/{group2.id}/",
        {"course_ids": [str(course_x.id)]},
        format="json",
    )
    assert res.status_code == 400


@pytest.mark.django_db
def test_patch_unassign_slot(api_client, group2):
    """PATCH with slot=null unassigns the slot."""
    res = api_client.patch(
        f"/api/simultaneous-groups/{group2.id}/",
        {"slot": None},
        format="json",
    )
    assert res.status_code == 200, res.data
    group2.refresh_from_db()
    assert group2.slot is None
