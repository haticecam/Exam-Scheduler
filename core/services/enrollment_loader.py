import csv
import uuid
from collections import defaultdict
from ..models import Organization, Term, AcademicUnit, StudentGroup, CourseSection, Student, Enrollment

class EnrollmentLoaderService:
    def process_csv(self, file_content: str, term_id: str, org_id: str):
        # Handle BOM if present
        if file_content.startswith('\ufeff'):
            file_content = file_content[1:]
            
        reader = csv.DictReader(file_content.splitlines())
        rows = list(reader)
        if not rows:
            return {"error": "CSV is empty"}
            
        term = Term.objects.get(id=term_id)
        org = Organization.objects.get(id=org_id)
        
        # 1. Resolve Academic Units and Student Groups
        unit_map = {u.name: u.id for u in AcademicUnit.objects.filter(organization=org)}
        
        # Determine unique student identifiers to create
        student_records = {} # identifier -> dict
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
        # To map course/section quickly:
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
