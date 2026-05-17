import csv
import io
import re
from dataclasses import dataclass
from typing import Optional

from django.db import transaction

from ..models import (
    Organization, Term, AcademicUnit, Instructor,
    StudentGroup, CourseCatalog, CourseSection
)

@dataclass
class CourseRow:
    course_name: str
    course_code: str  # required — never empty after validation
    capacity: Optional[int]
    program: str
    instructor: str
    is_compulsory: bool
    year_level: int
    weekly_hours: int
    weekly_hours_lab: int = 0
    section_number: str = "1"

    @staticmethod
    def from_dict(d: dict) -> "Optional[CourseRow]":
        def _int(v: str, default: int = 0) -> int:
            try:
                return int(str(v).strip())
            except (ValueError, TypeError):
                return default

        def _get(turkish_key: str, english_key: str, default: str = "") -> str:
            return str(d.get(turkish_key) or d.get(english_key) or default).strip()

        # Skip inactive rows (Aktif column present and not active)
        aktif_raw = _get("Aktif", "")
        if aktif_raw and aktif_raw not in ("1", "True", "true", "__1"):
            return None

        # Capacity: "107/999" → 107 (enrolled count); plain int also works
        capacity_raw = _get("Kontenjan", "Capacity")
        try:
            capacity = int(capacity_raw.split("/")[0])
        except (ValueError, AttributeError):
            capacity = None

        mandatory_raw = _get("Zor.", "Mandatory")
        is_compulsory = mandatory_raw in ("1", "True", "true", "Yes", "yes", "__1")

        section_number = _get("Şube", "Section", "1") or "1"

        return CourseRow(
            course_name=_get("Ders Adı", "Course Name"),
            course_code=_get("Ders Kodu", "Course Code"),
            capacity=capacity,
            program=_get("Program", "Program"),
            instructor=_get("Öğretim Elemanı", "Instructor"),
            is_compulsory=is_compulsory,
            year_level=_int(_get("Sınıf", "Year"), default=1),
            weekly_hours=_int(_get("T", "T-hours"), default=0),
            weekly_hours_lab=_int(_get("U", "U-hours"), default=0),
            section_number=section_number,
        )

def slugify(text: str, max_len: int = 32) -> str:
    text = text.upper().strip()
    text = re.sub(r'\.{2,}$', '', text)
    text = re.sub(r'[^A-Z0-9\s]', ' ', text)
    text = re.sub(r'\s+', '_', text.strip())
    return text[:max_len]

def make_unit_code(program_name: str) -> str:
    return slugify(program_name, max_len=24)

def _extract_title(name: str) -> str:
    titles = ["Prof.Dr.", "Doç.Dr.", "Dr. Öğr. Üyesi", "Arş.Gör.Dr.",
              "Arş.Gör.", "Öğr.Gör.Dr.", "Öğr.Gör.", "Dr."]
    for t in titles:
        if name.startswith(t):
            return t
    return ""

def _row_name(d: dict) -> str:
    return d.get("Ders Adı", "") or d.get("Course Name", "")

def _rows_from_csv_text(file_content: str) -> list:
    lines = file_content.splitlines()
    header = lines[0] if lines else ""
    if "\t" in header:
        delimiter = "\t"
    elif ";" in header:
        delimiter = ";"
    else:
        delimiter = ","
    reader = csv.DictReader(lines, delimiter=delimiter)
    rows = [CourseRow.from_dict(r) for r in reader if _row_name(r).strip()]
    return [r for r in rows if r is not None]

def _rows_from_xlsx_bytes(raw: bytes) -> list:
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    ws = wb.active
    all_rows = list(ws.iter_rows(values_only=True))
    wb.close()

    if not all_rows:
        return []

    header = [str(c).strip() if c is not None else "" for c in all_rows[0]]
    result = []
    for row in all_rows[1:]:
        d = {header[i]: (str(row[i]).strip() if i < len(row) and row[i] is not None else "")
             for i in range(len(header))}
        if _row_name(d).strip():
            row = CourseRow.from_dict(d)
            if row is not None:
                result.append(row)
    return result

class CourseLoaderService:

    def process_file(self, raw: bytes, filename: str, term_id: str) -> dict:
        """Unified entry point — accepts .xlsx or .csv/.tsv bytes."""
        if filename.lower().endswith(".xlsx"):
            try:
                rows = _rows_from_xlsx_bytes(raw)
            except Exception as e:
                return {"error": f"XLSX dosyası okunamadı: {str(e)}"}
        else:
            try:
                file_content = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                try:
                    file_content = raw.decode("latin-1")
                except UnicodeDecodeError:
                    return {"error": "Dosya kodlaması okunamadı. Lütfen UTF-8 formatında kaydedin."}
            rows = _rows_from_csv_text(file_content)

        return self._validate_and_process(rows, term_id)

    def process_csv(self, file_content: str, term_id: str) -> dict:
        """CSV string entry point — kept for backward compatibility with tests."""
        rows = _rows_from_csv_text(file_content)
        return self._validate_and_process(rows, term_id)

    def _validate_and_process(self, rows: list, term_id: str) -> dict:
        if not rows:
            return {"error": "CSV is empty or missing 'Course Name' header"}

        missing_code = [r.course_name for r in rows if not r.course_code]
        if missing_code:
            names = ", ".join(missing_code[:5])
            return {"error": f"'Course Code' is required for every row. Missing for: {names}"}

        try:
            term = Term.objects.get(id=term_id)
            org = term.organization
        except Term.DoesNotExist:
            return {"error": "Term not found. Create a valid Term first."}

        try:
            with transaction.atomic():
                return self._process_rows(rows, org, term)
        except Exception as e:
            return {"error": f"Processing failed and was rolled back: {str(e)}"}

    def _process_rows(self, rows, org, term):
        # 1. Academic Units map
        unit_map = {}
        for r in rows:
            if r.program not in unit_map:
                unit, _ = AcademicUnit.objects.get_or_create(
                    organization=org, name=r.program,
                    defaults={"type": "Department", "scheduling_config": {"code": make_unit_code(r.program)}}
                )
                unit_map[r.program] = unit

        # 2. Instructors map
        instr_map = {}
        for r in rows:
            key = (unit_map[r.program].id, r.instructor)
            if key not in instr_map:
                name = r.instructor.strip() or "Unknown Instructor"
                title = _extract_title(name)
                instr, _ = Instructor.objects.get_or_create(
                    academic_unit_id=key[0], name=name,
                    defaults={"title": title or None, "contract_type": "Full-Time"}
                )
                instr_map[key] = instr

        # 3. Student Groups
        sg_seen = set()
        for r in rows:
            key = (unit_map[r.program].id, r.year_level)
            if key not in sg_seen:
                StudentGroup.objects.get_or_create(
                    organization=org, academic_unit_id=key[0], year_level=key[1],
                    defaults={"name": f"{r.program} Year {key[1]}", "size_estimate": None}
                )
                sg_seen.add(key)

        # 4. Course Catalog — use course_code directly from file
        course_map = {}
        for r in rows:
            unit_id = unit_map[r.program].id
            key = (unit_id, r.course_code)
            if key not in course_map:
                req = "COMPULSORY" if r.is_compulsory else "ELECTIVE"
                course, _ = CourseCatalog.objects.get_or_create(
                    organization=org, academic_unit_id=unit_id, code=r.course_code,
                    defaults={
                        "name": r.course_name,
                        "year_level": r.year_level,
                        "weekly_hours_lecture": r.weekly_hours,
                        "weekly_hours_lab": r.weekly_hours_lab,
                        "requirement": req,
                    }
                )
                course_map[key] = course

        # 5. Course Sections
        sections_created = 0
        for r in rows:
            unit_id = unit_map[r.program].id
            course = course_map[(unit_id, r.course_code)]
            instr = instr_map[(unit_id, r.instructor)]

            max_enroll = r.capacity or (999 if r.is_compulsory else 80)

            CourseSection.objects.get_or_create(
                term=term, course=course, section_code=r.section_number, instructor=instr,
                defaults={"max_enrollment": max_enroll, "version": 1}
            )
            sections_created += 1

        return {
            "success": True,
            "message": f"Successfully processed {len(rows)} course rows. Created {sections_created} sections."
        }
