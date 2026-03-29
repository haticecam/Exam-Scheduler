import csv
import re
import uuid
import json
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

from ..models import (
    Organization, Term, AcademicUnit, Instructor,
    StudentGroup, CourseCatalog, CourseSection
)

@dataclass
class CourseRow:
    course_name: str
    capacity: Optional[int]
    program: str
    instructor: str
    is_compulsory: bool
    year_level: int
    weekly_hours: int

    @staticmethod
    def from_dict(d: dict) -> "CourseRow":
        def _int(v: str, default: int = 0) -> int:
            try:
                return int(str(v).strip())
            except (ValueError, TypeError):
                return default

        capacity_raw = str(d.get("Capacity", "")).strip()
        try:
            capacity = int(capacity_raw)
        except ValueError:
            capacity = None

        return CourseRow(
            course_name=str(d.get("Course Name", "")).strip(),
            capacity=capacity,
            program=str(d.get("Program", "")).strip(),
            instructor=str(d.get("Instructor", "")).strip(),
            is_compulsory=str(d.get("Mandatory", "")).strip() == "__1",
            year_level=_int(d.get("Year"), default=1),
            weekly_hours=_int(d.get("T-hours"), default=0),
        )

def slugify(text: str, max_len: int = 32) -> str:
    text = text.upper().strip()
    text = re.sub(r'\.{2,}$', '', text)
    text = re.sub(r'[^A-Z0-9\s]', ' ', text)
    text = re.sub(r'\s+', '_', text.strip())
    return text[:max_len]

def make_course_code(course_name: str) -> str:
    words = re.sub(r'[^A-Z0-9\s]', ' ', course_name.upper()).split()
    return '_'.join(words[:4])[:32]

def make_unit_code(program_name: str) -> str:
    return slugify(program_name, max_len=24)

def _extract_title(name: str) -> str:
    titles = ["Prof.Dr.", "Doç.Dr.", "Dr. Öğr. Üyesi", "Arş.Gör.Dr.",
              "Arş.Gör.", "Öğr.Gör.Dr.", "Öğr.Gör.", "Dr."]
    for t in titles:
        if name.startswith(t):
            return t
    return ""

class CourseLoaderService:
    def process_csv(self, file_content: str, term_id: str):
        reader = csv.DictReader(file_content.splitlines())
        rows = [CourseRow.from_dict(r) for r in reader if r.get("Course Name", "").strip()]

        if not rows:
            return {"error": "CSV is empty or missing 'Course Name' header"}

        try:
            term = Term.objects.get(id=term_id)
            org = term.organization
        except Term.DoesNotExist:
            return {"error": "Belirtilen Dönem (Term) bulunamadı. Lütfen önce geçerli bir Term oluşturun."}

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

        # 4. Course Catalog
        course_map = {}
        for r in rows:
            unit_id = unit_map[r.program].id
            code = make_course_code(r.course_name)
            key = (unit_id, code)
            if key not in course_map:
                req = "COMPULSORY" if r.is_compulsory else "ELECTIVE"
                course, _ = CourseCatalog.objects.get_or_create(
                    organization=org, academic_unit_id=unit_id, code=code,
                    defaults={"name": r.course_name, "year_level": r.year_level, 
                              "weekly_hours_lecture": r.weekly_hours, "requirement": req}
                )
                course_map[key] = course

        # 5. Course Sections
        section_counter = defaultdict(int)
        sections_created = 0
        for r in rows:
            unit_id = unit_map[r.program].id
            code = make_course_code(r.course_name)
            course = course_map[(unit_id, code)]
            instr = instr_map[(unit_id, r.instructor)]

            section_counter[(unit_id, course.id)] += 1
            n = section_counter[(unit_id, course.id)]
            if n <= 26:
                section_label = chr(64 + n)
            else:
                section_label = chr(64 + (n - 1) // 26) + chr(64 + (n - 1) % 26 + 1)

            max_enroll = 999 if r.is_compulsory else (r.capacity or 80)
            
            CourseSection.objects.get_or_create(
                term=term, course=course, section_code=section_label, instructor=instr,
                defaults={"max_enrollment": max_enroll, "version": 1}
            )
            sections_created += 1

        return {
            "success": True,
            "message": f"Successfully processed {len(rows)} course rows. Created {sections_created} sections."
        }
