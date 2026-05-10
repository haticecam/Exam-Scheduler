import uuid
from django.db import models

# 1. ENUM TYPES
class SubscriptionPlan(models.TextChoices):
    FREE = 'Free', 'Free'
    PRO = 'Pro', 'Pro'
    ENTERPRISE = 'Enterprise', 'Enterprise'

class TargetEntity(models.TextChoices):
    ROOM = 'Room', 'Room'
    COURSE = 'Course', 'Course'
    INSTRUCTOR = 'Instructor', 'Instructor'

class DataType(models.TextChoices):
    BOOLEAN = 'Boolean', 'Boolean'
    NUMBER = 'Number', 'Number'
    SELECT = 'Select', 'Select'

class UnitType(models.TextChoices):
    CAMPUS = 'Campus', 'Campus'
    FACULTY = 'Faculty', 'Faculty'
    DEPARTMENT = 'Department', 'Department'

class TermStatus(models.TextChoices):
    PLANNING = 'Planning', 'Planning'
    ACTIVE = 'Active', 'Active'
    ARCHIVED = 'Archived', 'Archived'

class Modality(models.TextChoices):
    IN_PERSON = 'In-Person', 'In-Person'
    ONLINE_SYNC = 'Online-Sync', 'Online-Sync'
    ONLINE_ASYNC = 'Online-Async', 'Online-Async'
    HYBRID = 'Hybrid', 'Hybrid'

class RoomType(models.TextChoices):
    CLASSROOM = 'CLASSROOM', 'CLASSROOM'
    LAB = 'LAB', 'LAB'
    AMPHITHEATER = 'AMPHITHEATER', 'AMPHITHEATER'
    SEMINAR = 'SEMINAR', 'SEMINAR'
    OTHER = 'OTHER', 'OTHER'

class TimeslotKind(models.TextChoices):
    LECTURE = 'LECTURE', 'LECTURE'
    LAB = 'LAB', 'LAB'
    EXAM = 'EXAM', 'EXAM'

class MeetingPattern(models.TextChoices):
    EVERY_WEEK = 'EVERY_WEEK', 'EVERY_WEEK'
    ODD_WEEKS = 'ODD_WEEKS', 'ODD_WEEKS'
    EVEN_WEEKS = 'EVEN_WEEKS', 'EVEN_WEEKS'

class ExamType(models.TextChoices):
    MIDTERM = 'MIDTERM', 'MIDTERM'
    FINAL = 'FINAL', 'FINAL'
    MAKEUP = 'MAKEUP', 'MAKEUP'
    QUIZ = 'QUIZ', 'QUIZ'
    OTHER = 'OTHER', 'OTHER'

class PrerequisiteType(models.TextChoices):
    PREREQUISITE = 'PREREQUISITE', 'PREREQUISITE'
    COREQUISITE = 'COREQUISITE', 'COREQUISITE'

class CourseRequirementType(models.TextChoices):
    COMPULSORY = 'COMPULSORY', 'COMPULSORY'
    ELECTIVE = 'ELECTIVE', 'ELECTIVE'
    TECHNICAL_ELECTIVE = 'TECHNICAL_ELECTIVE', 'TECHNICAL_ELECTIVE'
    AREA_ELECTIVE = 'AREA_ELECTIVE', 'AREA_ELECTIVE'
    UNIVERSITY_ELECTIVE = 'UNIVERSITY_ELECTIVE', 'UNIVERSITY_ELECTIVE'

class SolutionType(models.TextChoices):
    COURSE_SCHEDULE = 'CourseSchedule', 'CourseSchedule'
    EXAM_SCHEDULE = 'ExamSchedule', 'ExamSchedule'


# 2. ORGANIZATION & SYSTEM STRUCTURE  (Schema 1)
class Organization(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    domain = models.CharField(max_length=255, null=True, blank=True)
    subscription_plan = models.CharField(max_length=20, choices=SubscriptionPlan.choices, default=SubscriptionPlan.FREE)
    config = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'organization'

class AcademicUnit(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='academic_units')
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='children')
    name = models.CharField(max_length=255)
    type = models.CharField(max_length=20, choices=UnitType.choices)
    is_locked = models.BooleanField(default=False)
    scheduling_config = models.JSONField(default=dict, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'academic_unit'

class User(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='users')
    email = models.EmailField()
    roles = models.JSONField(default=list, blank=True)
    academic_unit = models.ForeignKey(AcademicUnit, null=True, blank=True, on_delete=models.SET_NULL, related_name='users')
    metadata = models.JSONField(default=dict, blank=True)
    last_login = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'user'
        constraints = [
            models.UniqueConstraint(fields=['organization', 'email'], name='uq_org_email')
        ]

class AttributeDefinition(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='attribute_definitions')
    target_entity = models.CharField(max_length=50, choices=TargetEntity.choices)
    key = models.CharField(max_length=255)
    label = models.CharField(max_length=255, null=True, blank=True)
    data_type = models.CharField(max_length=50, choices=DataType.choices)
    options = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'attribute_definition'

class Term(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='terms')
    name = models.CharField(max_length=255)
    date_range = models.CharField(max_length=255, null=True, blank=True)
    status = models.CharField(max_length=20, choices=TermStatus.choices, default=TermStatus.PLANNING)
    class Meta:
        db_table = 'term'


# 3. TIME GRID
class TimeGridTemplate(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='time_grid_templates')
    name = models.CharField(max_length=255)
    is_default = models.BooleanField(default=False)

    class Meta:
        db_table = 'time_grid_template'

class TimeSlot(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(TimeGridTemplate, on_delete=models.CASCADE, related_name='time_slots')
    day_mask = models.IntegerField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    label = models.CharField(max_length=255, null=True, blank=True)
    kind = models.CharField(max_length=20, choices=TimeslotKind.choices, default=TimeslotKind.LECTURE)
    is_excluded = models.BooleanField(default=False)

    class Meta:
        db_table = 'time_slot'


# 4. RESOURCES, INSTRUCTORS, COURSES
class Resource(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='resources')
    name = models.CharField(max_length=255)
    type = models.CharField(max_length=50)
    full_capacity = models.IntegerField(null=True, blank=True)
    exam_capacity = models.IntegerField(null=True, blank=True)
    attributes = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'resource'
        indexes = [
            models.Index(fields=['attributes'], name='ix_resource_attributes')
        ]


class TermResource(models.Model):
    """Per-term configuration for a room. Overrides Resource defaults for a single term."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    resource = models.ForeignKey(Resource, on_delete=models.CASCADE, related_name='term_configs')
    term = models.ForeignKey(Term, on_delete=models.CASCADE, related_name='room_configs')
    # Nullable overrides — null means "use Resource default"
    full_capacity = models.IntegerField(null=True, blank=True)
    exam_capacity = models.IntegerField(null=True, blank=True)
    # Bitmask: bit 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun. 127=all days (no restriction).
    available_days = models.IntegerField(default=127)
    # Empty = no restriction; non-empty = only these units may use this room
    restricted_to_units = models.ManyToManyField(
        AcademicUnit,
        blank=True,
        related_name='restricted_rooms',
        db_table='term_resource_restricted_units',
    )
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True, default='')

    class Meta:
        db_table = 'term_resource'
        constraints = [
            models.UniqueConstraint(fields=['resource', 'term'], name='uq_resource_term')
        ]

class Instructor(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='instructors')
    academic_unit = models.ForeignKey(AcademicUnit, on_delete=models.CASCADE, related_name='instructors')
    name = models.CharField(max_length=255)
    title = models.CharField(max_length=255, null=True, blank=True)
    contract_type = models.CharField(max_length=255, null=True, blank=True)
    availability_exceptions = models.JSONField(default=dict, blank=True)
    attributes = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = 'instructor'
        indexes = [
            models.Index(fields=['availability_exceptions'], name='ix_instructor_exceptions')
        ]

class StudentGroup(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='student_groups')
    academic_unit = models.ForeignKey(AcademicUnit, null=True, blank=True, on_delete=models.SET_NULL, related_name='student_groups')
    name = models.CharField(max_length=255)
    size_estimate = models.IntegerField(null=True, blank=True)
    year_level = models.IntegerField(null=True, blank=True)

    class Meta:
        db_table = 'student_group'

class CourseCatalog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='courses')
    academic_unit = models.ForeignKey(AcademicUnit, null=True, blank=True, on_delete=models.SET_NULL, related_name='courses')
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=255)
    year_level = models.SmallIntegerField(null=True, blank=True)
    weekly_hours_lecture = models.SmallIntegerField(null=True, blank=True)
    weekly_hours_lab = models.SmallIntegerField(default=0)
    requirement = models.CharField(max_length=50, choices=CourseRequirementType.choices, null=True, blank=True)
    default_credits = models.DecimalField(max_digits=3, decimal_places=1, null=True, blank=True)
    attributes = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'course_catalog'

class CoursePrerequisite(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    course = models.ForeignKey(CourseCatalog, on_delete=models.CASCADE, related_name='requisites_for')
    prerequisite = models.ForeignKey(CourseCatalog, on_delete=models.RESTRICT, related_name='prerequisite_of')
    type = models.CharField(max_length=20, choices=PrerequisiteType.choices, default=PrerequisiteType.PREREQUISITE)

    class Meta:
        db_table = 'course_prerequisite'
        constraints = [
            models.UniqueConstraint(fields=['course', 'prerequisite'], name='uq_course_prereq'),
            models.CheckConstraint(condition=~models.Q(course=models.F('prerequisite')), name='chk_no_self_prereq')
        ]

class CourseSection(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    term = models.ForeignKey(Term, on_delete=models.CASCADE, related_name='course_sections')
    course = models.ForeignKey(CourseCatalog, on_delete=models.CASCADE, related_name='sections')
    parent_section = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='child_sections')
    instructor = models.ForeignKey(Instructor, null=True, blank=True, on_delete=models.SET_NULL, related_name='sections')
    max_enrollment = models.IntegerField(null=True, blank=True)
    section_code = models.CharField(max_length=50, null=True, blank=True)
    attributes = models.JSONField(default=dict, blank=True)
    version = models.IntegerField(default=1)
    student_groups = models.ManyToManyField(StudentGroup, related_name='sections', blank=True, db_table='coursesection_student_groups')

    class Meta:
        db_table = 'course_section'

class SectionMeeting(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    section = models.ForeignKey(CourseSection, on_delete=models.CASCADE, related_name='meetings')
    duration_minutes = models.IntegerField()
    modality = models.CharField(max_length=20, choices=Modality.choices)
    pattern = models.CharField(max_length=20, choices=MeetingPattern.choices, default=MeetingPattern.EVERY_WEEK)
    required_resources = models.JSONField(default=dict, blank=True)
    is_fixed = models.BooleanField(default=False)

    class Meta:
        db_table = 'section_meeting'


# 5. SOLVER ENGINE
class ConstraintBlueprint(models.Model):
    code = models.CharField(max_length=255, primary_key=True)
    description = models.TextField(null=True, blank=True)
    param_schema = models.JSONField(null=True, blank=True)

    class Meta:
        db_table = 'constraint_blueprint'

class ScenarioConstraint(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    scenario_id = models.UUIDField(null=True, blank=True)
    term = models.ForeignKey(Term, null=True, blank=True, on_delete=models.CASCADE, related_name='scenario_constraints')
    blueprint_code = models.ForeignKey(ConstraintBlueprint, on_delete=models.CASCADE)
    target_scope = models.JSONField(default=dict, blank=True)
    parameters = models.JSONField(default=dict, blank=True)
    weight = models.IntegerField(default=0)
    is_enabled = models.BooleanField(default=True)

    class Meta:
        db_table = 'scenario_constraint'

class GeneratedSolution(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    term = models.ForeignKey(Term, on_delete=models.CASCADE, related_name='generated_solutions', null=True)
    name = models.CharField(max_length=255, null=True, blank=True)
    solution_type = models.CharField(max_length=20, choices=SolutionType.choices, default=SolutionType.COURSE_SCHEDULE)
    
    # Execution Tracking
    status = models.CharField(max_length=50, default='PENDING') # PENDING, PROCESSING, COMPLETED, FAILED, INFEASIBLE
    celery_task_id = models.CharField(max_length=255, null=True, blank=True)
    
    # Input
    parameters = models.JSONField(default=dict, blank=True)
    
    # Output metrics
    score = models.FloatField(null=True, blank=True)
    solver_metadata = models.JSONField(default=dict, blank=True)
    
    # Full Result Data
    detailed_schedule = models.JSONField(default=list, blank=True)
    detailed_penalties = models.JSONField(default=list, blank=True)
    error_message = models.TextField(null=True, blank=True)
    
    is_published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'generated_solution'

class Assignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    solution = models.ForeignKey(GeneratedSolution, on_delete=models.CASCADE, related_name='assignments')
    meeting = models.ForeignKey(SectionMeeting, on_delete=models.CASCADE, related_name='assignments')
    resource = models.ForeignKey(Resource, null=True, blank=True, on_delete=models.SET_NULL, related_name='assignments')
    time_slot = models.ForeignKey(TimeSlot, null=True, blank=True, on_delete=models.SET_NULL, related_name='assignments')
    date = models.DateField(null=True, blank=True)
    is_locked = models.BooleanField(default=False)

    class Meta:
        db_table = 'assignment'


# 6. EXAM SCHEDULING
class ExamPeriod(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    term = models.ForeignKey(Term, on_delete=models.CASCADE, related_name='exam_periods')
    name = models.CharField(max_length=255)
    exam_type = models.CharField(max_length=20, choices=ExamType.choices)
    start_date = models.DateField()
    end_date = models.DateField()
    config = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = 'exam_period'

class ExamDateSlot(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    exam_period = models.ForeignKey(ExamPeriod, on_delete=models.CASCADE, related_name='date_slots')
    date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    label = models.CharField(max_length=255, null=True, blank=True)
    is_blocked = models.BooleanField(default=False)

    class Meta:
        db_table = 'exam_date_slot'

class Exam(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    exam_period = models.ForeignKey(ExamPeriod, on_delete=models.CASCADE, related_name='exams')
    exam_type = models.CharField(max_length=20, choices=ExamType.choices)
    duration_minutes = models.IntegerField()
    is_common = models.BooleanField(default=False)
    attributes = models.JSONField(default=dict, blank=True)
    sections = models.ManyToManyField(CourseSection, related_name='exams', db_table='exam_sections')

    class Meta:
        db_table = 'exam'

class ExamAssignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    solution = models.ForeignKey(GeneratedSolution, on_delete=models.CASCADE, related_name='exam_assignments')
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name='assignments')
    exam_date_slot = models.ForeignKey(ExamDateSlot, on_delete=models.CASCADE, related_name='assignments')
    resource = models.ForeignKey(Resource, null=True, blank=True, on_delete=models.SET_NULL, related_name='exam_assignments')
    is_locked = models.BooleanField(default=False)

    class Meta:
        db_table = 'exam_assignment'

class ExamInvigilator(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    exam_assignment = models.ForeignKey(ExamAssignment, on_delete=models.CASCADE, related_name='invigilators')
    instructor = models.ForeignKey(Instructor, on_delete=models.CASCADE, related_name='invigilators')
    role = models.CharField(max_length=50, default='Invigilator')

    class Meta:
        db_table = 'exam_invigilator'


# 7. STUDENT & ENROLLMENT DATA
class Student(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='students')
    student_group = models.ForeignKey(StudentGroup, null=True, blank=True, on_delete=models.SET_NULL, related_name='students')
    year_level = models.SmallIntegerField(null=True, blank=True)
    identifier = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        db_table = 'student'

class Enrollment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='enrollments')
    section = models.ForeignKey(CourseSection, on_delete=models.CASCADE, related_name='enrollments')
    term = models.ForeignKey(Term, on_delete=models.CASCADE, related_name='enrollments')

    class Meta:
        db_table = 'enrollment'
        constraints = [
            models.UniqueConstraint(fields=['student', 'section'], name='uq_student_section')
        ]
        indexes = [
            models.Index(fields=['section'], name='ix_enrollment_section'),
            models.Index(fields=['student'], name='ix_enrollment_student')
        ]
