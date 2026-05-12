import datetime
import pytest
from rest_framework.test import APIClient
from django.contrib.auth.models import User as DjangoUser
from rest_framework.authtoken.models import Token
from core.models import Organization, Term, ExamPeriod, ExamDateSlot


@pytest.fixture
def api_client(db):
    user = DjangoUser.objects.create_user("testadmin", password="pass")
    token = Token.objects.create(user=user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return client


@pytest.fixture
def org(db):
    return Organization.objects.create(name="Test University")


@pytest.fixture
def term(org):
    return Term.objects.create(organization=org, name="Fall 2025", status="Active")


@pytest.fixture
def period(term):
    return ExamPeriod.objects.create(
        term=term,
        name="Final Exams",
        exam_type="FINAL",
        start_date=datetime.date(2025, 6, 1),
        end_date=datetime.date(2025, 6, 2),
    )


@pytest.mark.django_db
def test_create_exam_period(api_client, term):
    res = api_client.post("/api/exam-periods/", {
        "term": str(term.id),
        "name": "Finals",
        "exam_type": "FINAL",
        "start_date": "2025-06-01",
        "end_date": "2025-06-14",
    })
    assert res.status_code == 201
    assert ExamPeriod.objects.count() == 1


@pytest.mark.django_db
def test_generate_slots_auto_30min(api_client, period):
    # 08:30 to 18:00 = 570 min / 30 = 19 slots per day; 2 days = 38 total
    res = api_client.post(f"/api/exam-periods/{period.id}/generate-slots/", {
        "day_start": "08:30",
        "day_end": "18:00",
    })
    assert res.status_code == 201
    assert res.data["created"] == 38
    assert res.data["slot_mode"] == "30min"
    assert ExamDateSlot.objects.filter(exam_period=period).count() == 38


@pytest.mark.django_db
def test_generate_slots_manual_sessions(api_client, period):
    # 2 sessions per day × 2 days = 4 total
    res = api_client.post(f"/api/exam-periods/{period.id}/generate-slots/", {
        "slots": [
            {"start": "09:00", "end": "12:00", "label": "Sabah"},
            {"start": "14:00", "end": "17:00", "label": "Öğleden Sonra"},
        ]
    }, format="json")
    assert res.status_code == 201
    assert res.data["created"] == 4
    assert res.data["slot_mode"] == "session"
    slots = ExamDateSlot.objects.filter(exam_period=period).order_by("date", "start_time")
    assert slots.count() == 4
    assert slots.first().label == "Sabah"
    assert str(slots.first().start_time) == "09:00:00"


@pytest.mark.django_db
def test_generate_slots_replaces_existing(api_client, period):
    api_client.post(f"/api/exam-periods/{period.id}/generate-slots/", {"day_start": "08:30", "day_end": "18:00"})
    api_client.post(f"/api/exam-periods/{period.id}/generate-slots/", {"day_start": "09:00", "day_end": "17:00"})
    # 09:00 to 17:00 = 480 min / 30 = 16 slots per day; 2 days = 32
    assert ExamDateSlot.objects.filter(exam_period=period).count() == 32


@pytest.mark.django_db
def test_generate_slots_rejects_missing_params(api_client, period):
    res = api_client.post(f"/api/exam-periods/{period.id}/generate-slots/", {})
    assert res.status_code == 400


@pytest.mark.django_db
def test_block_single_slot(api_client, period):
    slot = ExamDateSlot.objects.create(
        exam_period=period,
        date=datetime.date(2025, 6, 1),
        start_time=datetime.time(8, 30),
        end_time=datetime.time(9, 0),
        label="08:30-09:00",
        is_blocked=False,
    )
    res = api_client.patch(f"/api/exam-date-slots/{slot.id}/", {"is_blocked": True})
    assert res.status_code == 200
    slot.refresh_from_db()
    assert slot.is_blocked is True


@pytest.mark.django_db
def test_toggle_day_blocks_all_slots(api_client, period):
    for i in range(3):
        ExamDateSlot.objects.create(
            exam_period=period,
            date=datetime.date(2025, 6, 1),
            start_time=datetime.time(8 + i, 30),
            end_time=datetime.time(9 + i, 0),
            label=f"slot{i}",
            is_blocked=False,
        )
    res = api_client.post(f"/api/exam-periods/{period.id}/toggle-day/", {
        "date": "2025-06-01",
        "blocked": True,
    })
    assert res.status_code == 200
    assert ExamDateSlot.objects.filter(exam_period=period, is_blocked=True).count() == 3


@pytest.mark.django_db
def test_list_periods_filtered_by_term(api_client, term, period):
    other_org = Organization.objects.create(name="Other Uni")
    other_term = Term.objects.create(organization=other_org, name="Other", status="Planning")
    ExamPeriod.objects.create(term=other_term, name="Other Finals", exam_type="MIDTERM",
                               start_date=datetime.date(2025, 5, 1), end_date=datetime.date(2025, 5, 5))
    res = api_client.get(f"/api/exam-periods/?term_id={term.id}")
    assert res.status_code == 200
    assert len(res.data) == 1
    assert res.data[0]["name"] == "Final Exams"
