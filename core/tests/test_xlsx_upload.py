import io
import unicodedata
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
HEADER_SUFFIXED = ['Öğrenci No_14190', 'Adı_14190', 'Soyadı_14190', 'Program_14190', 'Sınıf_14190', 'A.Tipi_14190']


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
def test_service_unknown_program_rows_are_skipped_with_count(base_data):
    """Rows whose Program doesn't match any AcademicUnit are skipped (not enrolled), but
    the count of such unique students is preserved in the result so the UI can surface it."""
    xlsx_bytes = make_xlsx([
        HEADER,
        ['24050141033', 'BİLGİSAYAR MÜH', 1, 'Arş.Gör. TEST', 'Alttan FF'],
        ['STU00099', 'UNKNOWN DEPT', 1, 'Arş.Gör. TEST', 'Alttan FF'],
        ['STU00100', 'UNKNOWN DEPT', 1, 'Arş.Gör. TEST', 'Alttan FF'],
        ['STU00101', 'ANOTHER UNKNOWN', 2, 'Arş.Gör. TEST', 'Alttan FF'],
    ])
    svc = XlsxEnrollmentLoaderService()
    result = svc.process_files(
        [('CENG113.xlsx', xlsx_bytes)],
        str(base_data['term'].id)
    )
    file_result = result['results'][0]
    assert 'error' not in file_result, file_result.get('error')
    assert file_result['students_created'] == 1
    assert file_result['enrollments_created'] == 1
    assert file_result['skipped_unknown_program_students'] == 3
    assert file_result['unknown_programs_breakdown'] == {
        'UNKNOWN DEPT': 2,
        'ANOTHER UNKNOWN': 1,
    }
    assert Student.objects.filter(organization=base_data['org']).count() == 1
    assert Enrollment.objects.filter(section=base_data['section']).count() == 1


@pytest.mark.django_db
def test_service_all_unknown_programs_loads_nothing(base_data):
    """If every row's Program is unknown, no students/enrollments are created
    but the file does not error and counts are reported."""
    xlsx_bytes = make_xlsx([
        HEADER,
        ['STU00099', 'UNKNOWN DEPT', 1, 'Arş.Gör. TEST', 'Alttan FF'],
    ])
    svc = XlsxEnrollmentLoaderService()
    result = svc.process_files(
        [('CENG113.xlsx', xlsx_bytes)],
        str(base_data['term'].id)
    )
    file_result = result['results'][0]
    assert 'error' not in file_result
    assert file_result['students_created'] == 0
    assert file_result['enrollments_created'] == 0
    assert file_result['skipped_unknown_program_students'] == 1
    assert file_result['unknown_programs_breakdown'] == {'UNKNOWN DEPT': 1}


@pytest.mark.django_db
def test_service_routes_file_to_dominant_program_section(base_data):
    """Each XLSX file represents one CourseSection's roster (the folder it
    originated from). When a course has sections in multiple depts, the file's
    target section is the one owned by the dominant Program among its rows.
    Cross-faculty (minor) students whose Program differs still land in the
    same section, because the file == the classroom, not the home dept."""
    other_dept = AcademicUnit.objects.create(
        organization=base_data['org'], name="MAKİNE MÜH", type="Department"
    )
    course_other = CourseCatalog.objects.create(
        organization=base_data['org'], academic_unit=other_dept,
        code="TİT101", name="Atatürk İlkeleri", year_level=1, requirement="COMPULSORY"
    )
    section_other = CourseSection.objects.create(
        term=base_data['term'], course=course_other, section_code="A", max_enrollment=100
    )
    course_ceng = CourseCatalog.objects.create(
        organization=base_data['org'], academic_unit=base_data['dept'],
        code="TİT101", name="Atatürk İlkeleri", year_level=1, requirement="COMPULSORY"
    )
    section_ceng = CourseSection.objects.create(
        term=base_data['term'], course=course_ceng, section_code="A", max_enrollment=100
    )

    xlsx_bytes = make_xlsx([
        HEADER,
        ['STU_C1', 'BİLGİSAYAR MÜH', 1, 'X', 'Zorunlu'],
        ['STU_C2', 'BİLGİSAYAR MÜH', 1, 'X', 'Zorunlu'],
        ['STU_C3', 'BİLGİSAYAR MÜH', 1, 'X', 'Zorunlu'],
        ['STU_M1', 'MAKİNE MÜH',     1, 'X', 'Zorunlu'],
    ])
    svc = XlsxEnrollmentLoaderService()
    result = svc.process_files(
        [('TİT101.xlsx', xlsx_bytes)],
        str(base_data['term'].id)
    )
    file_result = result['results'][0]
    assert 'error' not in file_result, file_result.get('error')
    assert file_result['enrollments_created'] == 4
    assert file_result['target_section_owner'] == 'BİLGİSAYAR MÜH'
    assert Enrollment.objects.filter(section=section_ceng).count() == 4
    assert Enrollment.objects.filter(section=section_other).count() == 0


@pytest.mark.django_db
def test_service_two_files_route_to_their_respective_dept_sections(base_data):
    """Two files with the same course code but rows dominated by different
    Programs should land in different sections."""
    other_dept = AcademicUnit.objects.create(
        organization=base_data['org'], name="MAKİNE MÜH", type="Department"
    )
    course_other = CourseCatalog.objects.create(
        organization=base_data['org'], academic_unit=other_dept,
        code="TİT101", name="Atatürk İlkeleri", year_level=1, requirement="COMPULSORY"
    )
    section_other = CourseSection.objects.create(
        term=base_data['term'], course=course_other, section_code="A", max_enrollment=100
    )
    course_ceng = CourseCatalog.objects.create(
        organization=base_data['org'], academic_unit=base_data['dept'],
        code="TİT101", name="Atatürk İlkeleri", year_level=1, requirement="COMPULSORY"
    )
    section_ceng = CourseSection.objects.create(
        term=base_data['term'], course=course_ceng, section_code="A", max_enrollment=100
    )

    ceng_file = make_xlsx([
        HEADER,
        ['STU_C1', 'BİLGİSAYAR MÜH', 1, 'X', 'Zorunlu'],
        ['STU_C2', 'BİLGİSAYAR MÜH', 1, 'X', 'Zorunlu'],
    ])
    makine_file = make_xlsx([
        HEADER,
        ['STU_M1', 'MAKİNE MÜH', 1, 'X', 'Zorunlu'],
        ['STU_M2', 'MAKİNE MÜH', 1, 'X', 'Zorunlu'],
        ['STU_M3', 'MAKİNE MÜH', 1, 'X', 'Zorunlu'],
    ])
    svc = XlsxEnrollmentLoaderService()
    svc.process_files(
        [('TİT101.xlsx', ceng_file), ('TİT101.xlsx', makine_file)],
        str(base_data['term'].id)
    )
    assert Enrollment.objects.filter(section=section_ceng).count() == 2
    assert Enrollment.objects.filter(section=section_other).count() == 3


@pytest.mark.django_db
def test_service_falls_back_to_rowcount_when_no_dominant_program_has_section(base_data):
    """When no row's Program owns a section for this course but the file's row
    count uniquely matches one section's max_enrollment (from catalog
    'Kontenjan'), use that section as the file's target."""
    AcademicUnit.objects.create(
        organization=base_data['org'], name="MATEMATIK", type="Department"
    )
    other_dept = AcademicUnit.objects.create(
        organization=base_data['org'], name="MAKİNE MÜH", type="Department"
    )
    course_other = CourseCatalog.objects.create(
        organization=base_data['org'], academic_unit=other_dept,
        code="TİT101", name="Atatürk İlkeleri", year_level=1, requirement="COMPULSORY"
    )
    section_other = CourseSection.objects.create(
        term=base_data['term'], course=course_other, section_code="A", max_enrollment=100
    )
    course_ceng = CourseCatalog.objects.create(
        organization=base_data['org'], academic_unit=base_data['dept'],
        code="TİT101", name="Atatürk İlkeleri", year_level=1, requirement="COMPULSORY"
    )
    section_ceng = CourseSection.objects.create(
        term=base_data['term'], course=course_ceng, section_code="A", max_enrollment=3
    )

    # All 3 rows are MATEMATIK (no MATEMATIK section exists), but row count
    # uniquely matches section_ceng.max_enrollment=3.
    xlsx_bytes = make_xlsx([
        HEADER,
        ['STU_X1', 'MATEMATIK', 1, 'X', 'Zorunlu'],
        ['STU_X2', 'MATEMATIK', 1, 'X', 'Zorunlu'],
        ['STU_X3', 'MATEMATIK', 1, 'X', 'Zorunlu'],
    ])
    svc = XlsxEnrollmentLoaderService()
    result = svc.process_files(
        [('TİT101.xlsx', xlsx_bytes)],
        str(base_data['term'].id)
    )
    fr = result['results'][0]
    assert 'error' not in fr, fr.get('error')
    assert fr['enrollments_created'] == 3
    assert Enrollment.objects.filter(section=section_ceng).count() == 3


@pytest.mark.django_db
def test_service_strips_trailing_dots_in_filename(base_data):
    """Filenames like 'CENG113...xlsx' from inconsistent exports should still
    derive course code 'CENG113'."""
    xlsx_bytes = make_xlsx([
        HEADER,
        ['STU1', 'BİLGİSAYAR MÜH', 1, 'X', 'Zorunlu'],
    ])
    svc = XlsxEnrollmentLoaderService()
    result = svc.process_files(
        [('CENG113...xlsx', xlsx_bytes)],
        str(base_data['term'].id)
    )
    fr = result['results'][0]
    assert 'error' not in fr, fr.get('error')
    assert fr['course_code'] == 'CENG113'
    assert fr['enrollments_created'] == 1


@pytest.mark.django_db
def test_service_recovers_mojibake_filename(base_data):
    """Filenames mis-decoded as cp437 (e.g. `TI╠çT101.xlsx` for `TİT101.xlsx`)
    must be canonicalized before deriving the course code, so enrollments still
    land in the correct CourseSection."""
    course = CourseCatalog.objects.create(
        organization=base_data['org'], academic_unit=base_data['dept'],
        code="TİT101", name="Atatürk İlkeleri", year_level=1, requirement="COMPULSORY"
    )
    section = CourseSection.objects.create(
        term=base_data['term'], course=course, section_code="A", max_enrollment=100
    )
    mojibake_name = "TİT101.xlsx".encode('utf-8').decode('utf-8')
    mojibake_name = unicodedata.normalize('NFD', mojibake_name).encode('utf-8').decode('cp437')
    assert mojibake_name == 'TI╠çT101.xlsx', f"sanity check on mojibake construction: got {mojibake_name!r}"

    xlsx_bytes = make_xlsx([
        HEADER,
        ['24050141033', 'BİLGİSAYAR MÜH', 1, 'Arş.Gör. TEST', 'Zorunlu'],
        ['25050141006', 'BİLGİSAYAR MÜH', 1, 'Arş.Gör. TEST', 'Zorunlu'],
    ])
    svc = XlsxEnrollmentLoaderService()
    result = svc.process_files(
        [(mojibake_name, xlsx_bytes)],
        str(base_data['term'].id)
    )
    file_result = result['results'][0]
    assert 'error' not in file_result, file_result.get('error')
    assert file_result['course_code'] == 'TİT101'
    assert file_result['students_created'] == 2
    assert file_result['enrollments_created'] == 2
    assert Enrollment.objects.filter(section=section).count() == 2


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
def test_service_handles_suffixed_column_names(base_data):
    """Columns named 'Öğrenci No_14190', 'Program_14190', 'Sınıf_14190' are resolved correctly."""
    # Row order: Öğrenci No, Adı, Soyadı, Program, Sınıf, A.Tipi
    xlsx_bytes = make_xlsx([
        HEADER_SUFFIXED,
        ['STU02665', 'Hürdoğan', 'Bilge', 'BİLGİSAYAR MÜH', 3, 'Zorunlu'],
        ['STU02314', 'Soykut',   'Ergül', 'BİLGİSAYAR MÜH', 4, 'Zorunlu'],
    ])
    svc = XlsxEnrollmentLoaderService()
    result = svc.process_files(
        [('CENG113.xlsx', xlsx_bytes)],
        str(base_data['term'].id)
    )
    assert 'error' not in result
    file_result = result['results'][0]
    assert 'error' not in file_result, file_result.get('error')
    assert file_result['students_created'] == 2
    assert file_result['enrollments_created'] == 2


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
