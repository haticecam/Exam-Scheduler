import io
import pytest
import openpyxl
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client
from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token

from core.models import Organization, Resource
from core.services.room_loader import RoomLoaderService, RoomLoadError, RoomRow


# ── helpers ──────────────────────────────────────────────────────────────────

HEADER = ["Oda Adı", "Kapasite", "Tür", "Sınav Kapasitesi"]


def make_xlsx(rows: list[list]) -> bytes:
    """Build an in-memory XLSX from a list of rows (first row = header)."""
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def xlsx_upload(name: str, rows: list[list]) -> SimpleUploadedFile:
    return SimpleUploadedFile(
        name,
        make_xlsx([HEADER] + rows),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


# ── service-level tests ─────────────────────────────────────────────────────

def test_service_parses_happy_path():
    data = make_xlsx([
        HEADER,
        ["B101", 60, "Derslik", 30],
        ["LAB1", 24, "Laboratuvar", None],
        ["AMFI-A", 300, "Amfi", None],
    ])
    rows = RoomLoaderService().parse(data)
    assert isinstance(rows, list)
    assert len(rows) == 3
    assert rows[0] == RoomRow(name="B101", capacity=60, type="CLASSROOM", exam_capacity=30)
    assert rows[1] == RoomRow(name="LAB1", capacity=24, type="LAB", exam_capacity=None)
    assert rows[2] == RoomRow(name="AMFI-A", capacity=300, type="AMPHITHEATER", exam_capacity=None)


def test_service_rejects_invalid_xlsx():
    with pytest.raises(RoomLoadError, match="Geçersiz Excel dosyası"):
        RoomLoaderService().parse(b"this is not xlsx")


def test_service_rejects_missing_columns():
    data = make_xlsx([
        ["Oda Adı", "Kapasite", "Sınav Kapasitesi"],
        ["B101", 60, 30],
    ])
    with pytest.raises(RoomLoadError, match="Eksik sütun"):
        RoomLoaderService().parse(data)


def test_service_rejects_invalid_type_value():
    data = make_xlsx([
        HEADER,
        ["B101", 60, "kantin", 30],
    ])
    with pytest.raises(RoomLoadError, match="Geçersiz tür: kantin"):
        RoomLoaderService().parse(data)


def test_service_rejects_non_numeric_capacity():
    data = make_xlsx([
        HEADER,
        ["B101", "elli", "Derslik", 30],
    ])
    with pytest.raises(RoomLoadError, match="Kapasite geçerli bir sayı"):
        RoomLoaderService().parse(data)


def test_service_rejects_empty_name():
    data = make_xlsx([
        HEADER,
        ["", 60, "Derslik", 30],
    ])
    with pytest.raises(RoomLoadError, match="Oda adı boş olamaz"):
        RoomLoaderService().parse(data)


def test_service_rejects_bad_exam_capacity_when_present():
    data = make_xlsx([
        HEADER,
        ["B101", 60, "Derslik", "abc"],
    ])
    with pytest.raises(RoomLoadError, match="Sınav kapasitesi geçerli bir sayı"):
        RoomLoaderService().parse(data)


def test_service_rejects_empty_file():
    data = make_xlsx([HEADER])
    with pytest.raises(RoomLoadError, match="hiçbir veri satırı bulunamadı"):
        RoomLoaderService().parse(data)


def test_service_skips_empty_rows_keeps_valid():
    data = make_xlsx([
        HEADER,
        ["B101", 60, "Derslik", 30],
        [None, None, None, None],
        ["", "", "", ""],
        ["B102", 40, "Derslik", None],
    ])
    rows = RoomLoaderService().parse(data)
    assert len(rows) == 2
    assert [r.name for r in rows] == ["B101", "B102"]


def test_service_accepts_headers_case_insensitive():
    data = make_xlsx([
        ["oda adı", "KAPASİTE", "tür", "Sınav kapasitesi"],
        ["B101", 60, "DERSLIK", 30],
    ])
    rows = RoomLoaderService().parse(data)
    assert rows[0].type == "CLASSROOM"


def test_service_accepts_type_case_insensitive():
    data = make_xlsx([
        HEADER,
        ["B101", 60, "DERSLIK", 30],
        ["LAB1", 24, "laboratuvar", None],
        ["AMFI-A", 300, "Amfi", None],
    ])
    rows = RoomLoaderService().parse(data)
    assert [r.type for r in rows] == ["CLASSROOM", "LAB", "AMPHITHEATER"]


def test_service_aggregates_row_errors():
    data = make_xlsx([
        HEADER,
        ["B101", "bad", "Derslik", 30],
        ["", 60, "Derslik", 30],
        ["B102", 40, "Kantin", None],
    ])
    with pytest.raises(RoomLoadError) as exc:
        RoomLoaderService().parse(data)
    msg = str(exc.value)
    assert "Satır 2" in msg
    assert "Satır 3" in msg
    assert "Satır 4" in msg


# ── HTTP-level tests ────────────────────────────────────────────────────────

@pytest.fixture
def auth_client(db):
    user = User.objects.create_user(username="roomtester", password="pass")
    token = Token.objects.create(user=user)
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Token {token.key}"
    return c


@pytest.fixture
def org(db):
    return Organization.objects.create(name="Test University")


UPLOAD_URL = "/api/resources/upload/"


@pytest.mark.django_db
def test_upload_happy_path_creates_rooms(auth_client, org):
    f = xlsx_upload("rooms.xlsx", [
        ["B101", 60, "Derslik", 30],
        ["LAB1", 24, "Laboratuvar", None],
        ["AMFI-A", 300, "Amfi", None],
    ])
    res = auth_client.post(UPLOAD_URL, {"file": f}, format="multipart")
    assert res.status_code == 200, res.content
    body = res.json()
    assert body["created"] == 3
    assert set(body["rooms"]) == {"B101", "LAB1", "AMFI-A"}

    rooms = {r.name: r for r in Resource.objects.filter(organization=org)}
    assert rooms["B101"].type == "CLASSROOM" and rooms["B101"].exam_capacity == 30
    assert rooms["LAB1"].type == "LAB" and rooms["LAB1"].exam_capacity is None
    assert rooms["AMFI-A"].type == "AMPHITHEATER" and rooms["AMFI-A"].exam_capacity == 100  # 300 // 3
    assert rooms["B101"].availability == {"allowed_days": None, "allowed_unit_ids": None}


@pytest.mark.django_db
def test_upload_rejects_missing_file(auth_client, org):
    res = auth_client.post(UPLOAD_URL, {}, format="multipart")
    assert res.status_code == 400
    assert "Excel dosyası yükleyin" in res.json()["error"]
    assert Resource.objects.count() == 0


@pytest.mark.django_db
def test_upload_rejects_duplicate_against_db(auth_client, org):
    Resource.objects.create(
        organization=org, name="B101", type="CLASSROOM",
        capacity=60, exam_capacity=30, is_active=True,
    )
    f = xlsx_upload("rooms.xlsx", [
        ["B101", 60, "Derslik", 30],
        ["B102", 40, "Derslik", None],
    ])
    res = auth_client.post(UPLOAD_URL, {"file": f}, format="multipart")
    assert res.status_code == 400
    body = res.json()
    assert "B101" in body["duplicate_names"]
    assert "yükleme iptal edildi" in body["error"]
    assert Resource.objects.filter(organization=org).count() == 1


@pytest.mark.django_db
def test_upload_rejects_within_file_duplicate(auth_client, org):
    f = xlsx_upload("rooms.xlsx", [
        ["B101", 60, "Derslik", 30],
        ["B101", 40, "Derslik", 20],
    ])
    res = auth_client.post(UPLOAD_URL, {"file": f}, format="multipart")
    assert res.status_code == 400
    assert "B101" in res.json()["duplicate_names"]
    assert Resource.objects.count() == 0


@pytest.mark.django_db
def test_upload_rejects_row_error_no_rooms_created(auth_client, org):
    f = xlsx_upload("rooms.xlsx", [
        ["B101", 60, "Derslik", 30],
        ["B102", "bad", "Derslik", None],
    ])
    res = auth_client.post(UPLOAD_URL, {"file": f}, format="multipart")
    assert res.status_code == 400
    assert "Kapasite" in res.json()["error"]
    assert Resource.objects.count() == 0


@pytest.mark.django_db
def test_upload_auto_calcs_exam_capacity_when_blank(auth_client, org):
    f = xlsx_upload("rooms.xlsx", [
        ["DERS1", 80, "Derslik", None],
        ["LAB1", 24, "Laboratuvar", None],
        ["AMFI1", 150, "Amfi", None],
    ])
    res = auth_client.post(UPLOAD_URL, {"file": f}, format="multipart")
    assert res.status_code == 200, res.content
    rooms = {r.name: r for r in Resource.objects.filter(organization=org)}
    assert rooms["DERS1"].exam_capacity == 40
    assert rooms["LAB1"].exam_capacity is None
    assert rooms["AMFI1"].exam_capacity == 50


@pytest.mark.django_db
def test_upload_explicit_exam_capacity_overrides_auto(auth_client, org):
    f = xlsx_upload("rooms.xlsx", [
        ["DERS1", 80, "Derslik", 99],
    ])
    res = auth_client.post(UPLOAD_URL, {"file": f}, format="multipart")
    assert res.status_code == 200
    room = Resource.objects.get(organization=org, name="DERS1")
    assert room.exam_capacity == 99
