import csv
import io
import unicodedata
import uuid
from collections import defaultdict

from django.db import transaction

from ..models import Organization, Term, AcademicUnit, StudentGroup, CourseSection, Student, Enrollment

class EnrollmentLoaderService:
    def process_csv(self, file_content: str, term_id: str, org_id: str):
        if file_content.startswith('\ufeff'):
            file_content = file_content[1:]

        reader = csv.DictReader(file_content.splitlines())
        rows = list(reader)
        if not rows:
            return {"error": "CSV is empty"}

        try:
            with transaction.atomic():
                return self._load(rows, term_id, org_id)
        except Exception as e:
            return {"error": f"Enrollment load failed and was rolled back: {str(e)}"}

    def _load(self, rows, term_id, org_id):
        term = Term.objects.get(id=term_id)
        org = Organization.objects.get(id=org_id)

        # 1. Resolve Academic Units and Student Groups
        unit_map = {u.name: u.id for u in AcademicUnit.objects.filter(organization=org)}

        # Determine unique student identifiers to create
        student_records = {}  # identifier -> dict
        for r in rows:
            sid = r.get("Student Identifier")
            if not sid:
                continue
            if sid not in student_records:
                student_records[sid] = {
                    "program": r.get("Program Name"),
                    "year_level": int(r.get("Year Level", 1)),
                }

        # create missing groups
        group_map = {}
        for u_name, u_id in unit_map.items():
            for g in StudentGroup.objects.filter(academic_unit_id=u_id):
                group_map[(u_name, g.year_level)] = g

        missing_groups = set()
        for rec in student_records.values():
            key = (rec["program"], rec["year_level"])
            if key not in group_map and key not in missing_groups:
                unit_id = unit_map.get(rec["program"])
                if unit_id:
                    StudentGroup.objects.get_or_create(
                        organization=org, academic_unit_id=unit_id, year_level=rec["year_level"],
                        defaults={"name": f"{rec['program']} Year {rec['year_level']}", "size_estimate": None}
                    )
                missing_groups.add(key)

        # refresh group map
        for u_name, u_id in unit_map.items():
            for g in StudentGroup.objects.filter(academic_unit_id=u_id):
                group_map[(u_name, g.year_level)] = g

        # 2. Bulk Create Students
        existing_students = set(Student.objects.filter(organization=org).values_list('identifier', flat=True))
        students_to_create = []
        for sid, rec in student_records.items():
            if sid not in existing_students:
                key = (rec["program"], rec["year_level"])
                sg = group_map.get(key)
                if sg:
                    students_to_create.append(
                        Student(id=uuid.uuid4(), organization=org, student_group=sg, year_level=rec["year_level"], identifier=sid)
                    )
        if students_to_create:
            Student.objects.bulk_create(students_to_create, ignore_conflicts=True)

        student_id_map = {s.identifier: s.id for s in Student.objects.filter(organization=org, identifier__in=student_records.keys())}

        # 3. Create Enrollments
        sections = CourseSection.objects.filter(term=term).select_related('course')
        sec_map = {(sec.course.code, sec.section_code): sec.id for sec in sections}

        enrollments_to_create = []
        for r in rows:
            sid = r.get("Student Identifier")
            ccode = r.get("Course Code")
            slabel = r.get("Section Label")

            student_id = student_id_map.get(sid)
            section_id = sec_map.get((ccode, slabel))

            if student_id and section_id:
                enrollments_to_create.append(
                    Enrollment(student_id=student_id, section_id=section_id, term_id=term.id)
                )

        if enrollments_to_create:
            Enrollment.objects.bulk_create(enrollments_to_create, ignore_conflicts=True)


        return {
            "success": True,
            "message": f"Successfully loaded {len(student_records)} students and {len(enrollments_to_create)} enrollments."
        }


class XlsxEnrollmentLoaderService:
    """
    Loads student enrollments from XLSX files exported by the university system.
    Each file is named after the course code (e.g. CENG113.xlsx).
    Required columns: Öğrenci No, Program, Sınıf, Danışman, A.Tipi
    """

    def process_files(self, files: list[tuple[str, bytes]], term_id: str) -> dict:
        """
        files: list of (filename, file_bytes) tuples.
        Returns: {"files_processed": N, "results": [...per-file dicts...]}
        """
        try:
            term = Term.objects.select_related('organization').get(id=term_id)
        except Term.DoesNotExist:
            return {"error": "Term not found."}

        org = term.organization
        results = []
        for filename, file_bytes in files:
            results.append(self._process_one_file(filename, file_bytes, term, org))

        return {"files_processed": len(files), "results": results}

    @staticmethod
    def _normalize(name: str) -> str:
        return name.strip().rstrip('.,').upper()

    @staticmethod
    def _canonicalize_filename(filename: str) -> str:
        # Some uploads arrive with names whose UTF-8 bytes (NFD) were re-decoded
        # as cp437 upstream (`TİT101.xlsx` → `TI╠çT101.xlsx`). Round-tripping
        # cp437 → utf-8 reverses that; we then NFC-normalize so the recovered
        # name matches DB course codes stored in NFC.
        candidate = filename
        try:
            recovered = filename.encode('cp437').decode('utf-8')
        except (UnicodeEncodeError, UnicodeDecodeError):
            recovered = None
        if recovered and '�' not in recovered and recovered != filename:
            candidate = recovered
        return unicodedata.normalize('NFC', candidate)

    @staticmethod
    def _find_col_idx(header: list[str], prefix: str) -> int | None:
        for i, col in enumerate(header):
            if col == prefix or col.startswith(prefix + '_'):
                return i
        return None

    def _process_one_file(self, filename: str, file_bytes: bytes, term, org) -> dict:
        import openpyxl

        canonical_name = self._canonicalize_filename(filename)
        course_code = canonical_name.rsplit('.', 1)[0]

        sections = list(
            CourseSection.objects.select_related('course')
            .filter(term=term, course__code=course_code)
            .order_by('section_code')
        )
        if not sections:
            return {
                "file": filename,
                "error": f"No CourseSection found for course code '{course_code}' in this term."
            }
        section = sections[0]

        unit_map = {
            self._normalize(u.name): u
            for u in AcademicUnit.objects.filter(organization=org)
        }

        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        wb.close()

        if not rows:
            return {"file": filename, "error": "XLSX file is empty."}

        header = [str(c).strip() if c is not None else '' for c in rows[0]]
        idx_student = self._find_col_idx(header, 'Öğrenci No')
        idx_program = self._find_col_idx(header, 'Program')
        idx_year    = self._find_col_idx(header, 'Sınıf')
        missing = [
            name for name, idx in [
                ('Öğrenci No', idx_student),
                ('Program', idx_program),
                ('Sınıf', idx_year),
            ]
            if idx is None
        ]
        if missing:
            return {"file": filename, "error": f"Missing required column(s): {missing}"}

        try:
            with transaction.atomic():
                return self._load_rows(
                    rows[1:], idx_student, idx_program, idx_year,
                    section, term, org, unit_map, filename
                )
        except Exception as exc:
            return {"file": filename, "error": f"Load failed and was rolled back: {exc}"}

    def _load_rows(self, data_rows, idx_student, idx_program, idx_year,
                   section, term, org, unit_map, filename) -> dict:
        unknown_students_by_program: dict[str, set[str]] = defaultdict(set)
        student_infos: dict[str, dict] = {}

        for row in data_rows:
            if not row or row[idx_student] is None:
                continue
            identifier   = str(row[idx_student]).strip()
            program_raw  = str(row[idx_program]).strip() if row[idx_program] else ''
            program_norm = self._normalize(program_raw)
            try:
                year_level = int(row[idx_year])
            except (TypeError, ValueError):
                year_level = 1

            unit = unit_map.get(program_norm)
            if unit is None:
                unknown_students_by_program[program_raw or '<EMPTY>'].add(identifier)
                continue

            student_infos[identifier] = {'unit': unit, 'year_level': year_level}

        unknown_breakdown = {p: len(ids) for p, ids in unknown_students_by_program.items()}
        unknown_students_total = sum(unknown_breakdown.values())

        if not student_infos:
            return {
                "file": filename,
                "course_code": section.course.code,
                "students_created": 0,
                "enrollments_created": 0,
                "skipped_unknown_program_students": unknown_students_total,
                "unknown_programs_breakdown": unknown_breakdown,
                "warning": "No valid rows with a known program were found in this file.",
            }

        group_map: dict[tuple, StudentGroup] = {}
        for info in student_infos.values():
            key = (info['unit'].id, info['year_level'])
            if key not in group_map:
                sg, _ = StudentGroup.objects.get_or_create(
                    organization=org,
                    academic_unit=info['unit'],
                    year_level=info['year_level'],
                    defaults={
                        'name': f"{info['unit'].name} Year {info['year_level']}",
                        'size_estimate': None
                    }
                )
                group_map[key] = sg

        existing_students = {
            s.identifier: s
            for s in Student.objects.filter(
                organization=org, identifier__in=student_infos.keys()
            )
        }

        to_create = [
            Student(
                id=uuid.uuid4(),
                organization=org,
                student_group=group_map[(info['unit'].id, info['year_level'])],
                year_level=info['year_level'],
                identifier=identifier,
            )
            for identifier, info in student_infos.items()
            if identifier not in existing_students
        ]
        if to_create:
            Student.objects.bulk_create(to_create, ignore_conflicts=True)

        student_map = {
            s.identifier: s
            for s in Student.objects.filter(
                organization=org, identifier__in=student_infos.keys()
            )
        }

        group_counts: dict[tuple, int] = defaultdict(int)
        for info in student_infos.values():
            group_counts[(info['unit'].id, info['year_level'])] += 1

        groups_to_update = []
        for key, count in group_counts.items():
            sg = group_map[key]
            sg.size_estimate = count
            groups_to_update.append(sg)
        if groups_to_update:
            StudentGroup.objects.bulk_update(groups_to_update, ['size_estimate'])

        already_enrolled = set(
            Enrollment.objects.filter(section=section, term=term)
            .values_list('student_id', flat=True)
        )

        enrollments_to_create = [
            Enrollment(student=student_map[identifier], section=section, term=term)
            for identifier in student_infos
            if identifier in student_map and student_map[identifier].id not in already_enrolled
        ]
        if enrollments_to_create:
            Enrollment.objects.bulk_create(enrollments_to_create, ignore_conflicts=True)

        return {
            "file": filename,
            "course_code": section.course.code,
            "students_created": len(to_create),
            "enrollments_created": len(enrollments_to_create),
            "skipped_unknown_program_students": unknown_students_total,
            "unknown_programs_breakdown": unknown_breakdown,
        }
