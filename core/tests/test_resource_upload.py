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
