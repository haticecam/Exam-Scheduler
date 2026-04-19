import io
import pytest
import openpyxl
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client
from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token

from core.models import (
    Organization, Term, AcademicUnit, CourseCatalog,
    CourseSection, Student, Enrollment, StudentGroup
)
from core.services.enrollment_loader import XlsxEnrollmentLoaderService


# ── helpers ───────────────────────────────────────────────────────────────────

def make_xlsx(rows: list[list]) -> bytes:
    """Build an in-memory XLSX file from a list of rows."""
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


HEADER = ['Öğrenci No', 'Program', 'Sınıf', 'Danışman', 'A.Tipi']


def xlsx_file(name: str, rows: list[list]) -> SimpleUploadedFile:
    return SimpleUploadedFile(
        name,
        make_xlsx([HEADER] + rows),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def auth_client(db):
    user = User.objects.create_user(username='xlsxtester', password='pass')
    token = Token.objects.create(user=user)
    c = Client()
    c.defaults['HTTP_AUTHORIZATION'] = f'Token {token.key}'
    return c


@pytest.fixture
def base_data(db):
    org = Organization.objects.create(name="Test University")
    term = Term.objects.create(organization=org, name="Fall 2025", status="Active")
    dept = AcademicUnit.objects.create(
        organization=org, name="BİLGİSAYAR MÜH", type="Department"
    )
    course = CourseCatalog.objects.create(
        organization=org, academic_unit=dept,
        code="CENG113", name="Intro to CS",
        year_level=1, requirement="COMPULSORY"
    )
    section = CourseSection.objects.create(
        term=term, course=course, section_code="A", max_enrollment=100
    )
    return {"org": org, "term": term, "dept": dept, "course": course, "section": section}


# ── service-level tests ───────────────────────────────────────────────────────

@pytest.mark.django_db
def test_service_creates_students_and_enrollments(base_data):
    """process_files creates Students and Enrollments for valid rows."""
    xlsx_bytes = make_xlsx([
        HEADER,
        ['24050141033', 'BİLGİSAYAR MÜH', 1, 'Arş.Gör. TEST', 'Alttan FF'],
        ['25050141006', 'BİLGİSAYAR MÜH', 1, 'Arş.Gör. TEST', 'Alttan FF'],
    ])
    svc = XlsxEnrollmentLoaderService()
    result = svc.process_files(
        [('CENG113.xlsx', xlsx_bytes)],
        str(base_data['term'].id)
    )
    assert 'error' not in result
    assert result['files_processed'] == 1
    file_result = result['results'][0]
    assert file_result['students_created'] == 2
    assert file_result['enrollments_created'] == 2
    assert Student.objects.filter(organization=base_data['org']).count() == 2
    assert Enrollment.objects.filter(section=base_data['section']).count() == 2


@pytest.mark.django_db
def test_service_normalizes_trailing_period_in_program(base_data):
    """Program name 'BİLGİSAYAR MÜH.' (with period) must match AcademicUnit 'BİLGİSAYAR MÜH'."""
    xlsx_bytes = make_xlsx([
        HEADER,
        ['24050141033', 'BİLGİSAYAR MÜH.', 1, 'Arş.Gör. TEST', 'Alttan FF'],
    ])
    svc = XlsxEnrollmentLoaderService()
    result = svc.process_files(
        [('CENG113.xlsx', xlsx_bytes)],
        str(base_data['term'].id)
    )
    assert 'error' not in result['results'][0]
    assert result['results'][0]['students_created'] == 1


@pytest.mark.django_db
def test_service_unknown_course_code_returns_error(base_data):
    """If filename doesn't match any CourseSection, result contains an error for that file."""
    xlsx_bytes = make_xlsx([
        HEADER,
        ['24050141033', 'BİLGİSAYAR MÜH', 1, 'Arş.Gör. TEST', 'Alttan FF'],
    ])
    svc = XlsxEnrollmentLoaderService()
    result = svc.process_files(
        [('NOTEXIST999.xlsx', xlsx_bytes)],
        str(base_data['term'].id)
    )
    assert result['files_processed'] == 1
    assert 'error' in result['results'][0]
    assert 'NOTEXIST999' in result['results'][0]['error']


@pytest.mark.django_db
def test_service_unknown_program_returns_error(base_data):
    """If a row's Program doesn't match any AcademicUnit, the whole file returns an error."""
    xlsx_bytes = make_xlsx([
        HEADER,
        ['24050141033', 'UNKNOWN DEPT', 1, 'Arş.Gör. TEST', 'Alttan FF'],
    ])
    svc = XlsxEnrollmentLoaderService()
    result = svc.process_files(
        [('CENG113.xlsx', xlsx_bytes)],
        str(base_data['term'].id)
    )
    assert 'error' in result['results'][0]
    assert 'UNKNOWN DEPT' in result['results'][0]['error']


@pytest.mark.django_db
def test_service_is_idempotent(base_data):
    """Uploading the same file twice creates no duplicate students or enrollments."""
    xlsx_bytes = make_xlsx([
        HEADER,
        ['24050141033', 'BİLGİSAYAR MÜH', 1, 'Arş.Gör. TEST', 'Alttan FF'],
    ])
    svc = XlsxEnrollmentLoaderService()
    svc.process_files([('CENG113.xlsx', xlsx_bytes)], str(base_data['term'].id))
    svc.process_files([('CENG113.xlsx', xlsx_bytes)], str(base_data['term'].id))

    assert Student.objects.filter(organization=base_data['org']).count() == 1
    assert Enrollment.objects.filter(section=base_data['section']).count() == 1


# ── endpoint tests ────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_upload_xlsx_endpoint_returns_201(auth_client, base_data):
    """Valid upload returns HTTP 201 with a summary."""
    f = xlsx_file('CENG113.xlsx', [
        ['24050141033', 'BİLGİSAYAR MÜH', 1, 'Arş.Gör. TEST', 'Alttan FF'],
    ])
    response = auth_client.post(
        '/api/students/upload-xlsx/',
        data={'term_id': str(base_data['term'].id), 'files': [f]},
    )
    assert response.status_code == 201
    body = response.json()
    assert body['files_processed'] == 1
    assert body['results'][0]['enrollments_created'] == 1


@pytest.mark.django_db
def test_upload_xlsx_endpoint_missing_term_id(auth_client, base_data):
    """Missing term_id returns 400."""
    f = xlsx_file('CENG113.xlsx', [
        ['24050141033', 'BİLGİSAYAR MÜH', 1, 'Arş.Gör. TEST', 'Alttan FF'],
    ])
    response = auth_client.post(
        '/api/students/upload-xlsx/',
        data={'files': [f]},
    )
    assert response.status_code == 400
    assert 'term_id' in response.json().get('error', '').lower()


@pytest.mark.django_db
def test_upload_xlsx_endpoint_missing_files(auth_client, base_data):
    """Missing files returns 400."""
    response = auth_client.post(
        '/api/students/upload-xlsx/',
        data={'term_id': str(base_data['term'].id)},
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_upload_xlsx_endpoint_requires_auth(base_data):
    """Unauthenticated request returns 401."""
    client = Client()
    f = xlsx_file('CENG113.xlsx', [
        ['24050141033', 'BİLGİSAYAR MÜH', 1, 'Arş.Gör. TEST', 'Alttan FF'],
    ])
    response = client.post(
        '/api/students/upload-xlsx/',
        data={'term_id': str(base_data['term'].id), 'files': [f]},
    )
    assert response.status_code == 401
