import random
import uuid
import logging
import io
import csv
from collections import defaultdict
from dataclasses import dataclass, field

from ..models import (
    Organization, Term, StudentGroup, AcademicUnit,
    CourseSection, Student, Enrollment
)

logger = logging.getLogger(__name__)

ENROLLMENT_RULES = {
    1: dict(all_compulsory=True, dept_elective=0),
    2: dict(all_compulsory=True, dept_elective=0),
    3: dict(all_compulsory=True, dept_elective=1),
    4: dict(all_compulsory=True, dept_elective=4),
}

RETAKER_RATES = {
    1: {2: 0.15, 3: 0.07},
    2: {3: 0.12, 4: 0.05},
    3: {4: 0.10},
}
RETAKER_COURSES_PER_STUDENT = 2

@dataclass
class SimulatorStats:
    students_created: int = 0
    enrollments_created: int = 0
    retaker_enrollments: int = 0
    sections_with_no_students: int = 0
    students_with_no_courses: int = 0
    warnings: list = field(default_factory=list)

class StudentSimulatorService:
    def __init__(self, org_id: str, term_id: str, academic_unit_id: str = None, cohort_size: int = 80, seed: int = 42):
        self.org_id = org_id
        self.term_id = term_id
        self.academic_unit_id = academic_unit_id
        self.fallback_cohort_size = cohort_size
        self.stats = SimulatorStats()
        random.seed(seed)
        
        self.org = Organization.objects.get(id=org_id)
        self.term = Term.objects.get(id=term_id)

    def run(self):
        logger.info(f"Starting student simulation for term: {self.term.name}")
        
        pool = self.generate_students()
        course_map, section_capacity, section_metadata = self.generate_enrollments(pool)
        self.generate_retaker_enrollments(pool, course_map, section_metadata)

        # Generate CSV output
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Student Identifier", "Program Name", "Year Level", "Course Code", "Section Label", "Retaker"])
        
        for p in self.simulated_enrollments:
            writer.writerow([
                p['student_identifier'],
                p['program_name'],
                p['year_level'],
                p['course_code'],
                p['section_label'],
                "1" if p.get('is_retaker') else "0"
            ])

        return output.getvalue()

    def generate_students(self):
        groups = StudentGroup.objects.filter(organization=self.org, year_level__isnull=False).select_related('academic_unit')
        
        if self.academic_unit_id:
            groups = groups.filter(academic_unit_id=self.academic_unit_id)
            
        if not groups.exists():
            return {}

        pool = {}
        self.simulated_students_meta = {}

        for g in groups:
            unit_id = str(g.academic_unit.id) if g.academic_unit else "None"
            program_name = g.academic_unit.name if g.academic_unit else "Unknown Program"
            unit_code = "UNIT"
            if g.academic_unit and g.academic_unit.scheduling_config:
                unit_code = g.academic_unit.scheduling_config.get("code", "UNIT")[:12]
            
            n = g.size_estimate if g.size_estimate else self.fallback_cohort_size
            key = (unit_id, g.year_level)
            pool[key] = []

            for i in range(n):
                sid = str(uuid.uuid4())
                pool[key].append(sid)
                identifier = f"{unit_code}-{g.year_level}-{i+1:04d}"
                self.simulated_students_meta[sid] = {
                    "identifier": identifier,
                    "program_name": program_name,
                    "year_level": g.year_level
                }

        self.stats.students_created += len(self.simulated_students_meta)
        return pool

    def load_course_section_map(self):
        sections = CourseSection.objects.filter(
            term=self.term, 
            course__year_level__isnull=False, 
            course__requirement__isnull=False
        ).select_related('course', 'course__academic_unit')

        course_map = defaultdict(lambda: defaultdict(list))
        section_capacity = {}
        section_metadata = {}

        for sec in sections:
            yl = sec.course.year_level
            req = sec.course.requirement.upper() if sec.course.requirement else ""
            unit_id = str(sec.course.academic_unit.id) if getattr(sec.course, 'academic_unit', None) else "None"
            
            sid = str(sec.id)
            key = (unit_id, yl, req)
            course_map[key][str(sec.course.id)].append(sid)
            section_capacity[sid] = sec.max_enrollment or 9999
            section_metadata[sid] = {
                "course_code": sec.course.code,
                "section_label": sec.section_code
            }

        return course_map, section_capacity, section_metadata

    def generate_enrollments(self, pool):
        course_map, section_capacity, section_metadata = self.load_course_section_map()
        section_enrollment_count = defaultdict(int)
        self.simulated_enrollments = []
        
        def has_capacity(sid):
            return section_enrollment_count[sid] < section_capacity.get(sid, 9999)

        def choose_section(sections):
            available = [s for s in sections if has_capacity(s)]
            return random.choice(available) if available else None

        enrollments_to_create = []

        for (unit_id, year_level), student_ids in pool.items():
            rule = ENROLLMENT_RULES.get(year_level)
            if not rule:
                self.stats.warnings.append(f"No rule for year_level={year_level}.")
                continue

            for student_id in student_ids:
                selected_sections = []
                
                if rule.get("all_compulsory"):
                    compulsory = course_map.get((unit_id, year_level, "COMPULSORY"), {})
                    for course_id, sections in compulsory.items():
                        sid = choose_section(sections)
                        if sid:
                            selected_sections.append(sid)
                
                n_dept = rule.get("dept_elective", 0)
                if n_dept > 0:
                    electives = course_map.get((unit_id, year_level, "ELECTIVE"), {})
                    available_courses = [
                        cid for cid, secs in electives.items()
                        if any(has_capacity(s) for s in secs)
                    ]
                    chosen_courses = random.sample(
                        available_courses, min(n_dept, len(available_courses))
                    )
                    for course_id in chosen_courses:
                        sid = choose_section(electives[course_id])
                        if sid:
                            selected_sections.append(sid)

                if not selected_sections:
                    self.stats.students_with_no_courses += 1
                    continue
                
                for sid in selected_sections:
                    section_enrollment_count[sid] += 1
                    s_meta = self.simulated_students_meta[student_id]
                    sec_meta = section_metadata[sid]
                    self.simulated_enrollments.append({
                        "student_identifier": s_meta["identifier"],
                        "program_name": s_meta["program_name"],
                        "year_level": s_meta["year_level"],
                        "course_code": sec_meta["course_code"],
                        "section_label": sec_meta["section_label"],
                        "is_retaker": False
                    })

        self.stats.enrollments_created += len(self.simulated_enrollments)
        return course_map, section_capacity, section_metadata

    def generate_retaker_enrollments(self, pool, course_map, section_metadata):
        for course_year, source_rates in RETAKER_RATES.items():
            for student_year, rate in source_rates.items():
                for (unit_id, yr), student_ids in pool.items():
                    if yr != student_year:
                        continue
                    
                    compulsory = course_map.get((unit_id, course_year, "COMPULSORY"), {})
                    if not compulsory:
                        continue
                    
                    n_retakers = round(len(student_ids) * rate)
                    if n_retakers == 0:
                        continue
                    
                    retakers = random.sample(student_ids, min(n_retakers, len(student_ids)))
                    
                    for student_id in retakers:
                        n_c = random.randint(1, RETAKER_COURSES_PER_STUDENT)
                        courses = random.sample(
                            list(compulsory.keys()),
                            min(n_c, len(compulsory))
                        )
                        for course_id in courses:
                            section_id = random.choice(compulsory[course_id])
                            self.stats.retaker_enrollments += 1
                            self.stats.enrollments_created += 1
                            
                            s_meta = self.simulated_students_meta[student_id]
                            sec_meta = section_metadata[section_id]
                            self.simulated_enrollments.append({
                                "student_identifier": s_meta["identifier"],
                                "program_name": s_meta["program_name"],
                                "year_level": s_meta["year_level"],
                                "course_code": sec_meta["course_code"],
                                "section_label": sec_meta["section_label"],
                                "is_retaker": True
                            })
