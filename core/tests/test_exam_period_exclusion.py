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
    return CourseSection.objects.create(
        term=active_term, course=course, section_code="EMPTY",
        max_enrollment=50,
    )


def _rows_for(res, section_id):
    payload = res.data if isinstance(res.data, list) else res.data.get("results", [])
    return [r for r in payload if r["id"] == str(section_id)]


@pytest.mark.django_db
def test_zero_enrollment_section_is_auto_excluded(api_client, empty_section, period):
    res = api_client.get(
        f"/api/course-sections/?term_id={empty_section.term_id}"
        f"&exam_period_id={period.id}&include_empty=true"
    )
    assert res.status_code == 200
    rows = _rows_for(res, empty_section.id)
    assert len(rows) == 1
    assert rows[0]["enrollment_count"] == 0
    assert rows[0]["excluded_from_optimization"] is True
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
    rows = _rows_for(res, section.id)
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
    rows = _rows_for(res, section.id)
    assert len(rows) == 1
    assert rows[0]["excluded_from_optimization"] is True


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
