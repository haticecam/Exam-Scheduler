"""Single source of truth for per-course and per-group exam duration in minutes.

Mirrors the rule in core/services/optimizer.py:344-354. Imported by the
SimultaneousExamGroupSerializer validator and by the optimizer's duration loop.
"""
import math
from typing import Iterable, Mapping


def course_exam_duration_minutes(
    *,
    weekly_hours_lecture,
    exam_duration_minutes,
    slot_duration_minutes: int,
    session_mode: bool,
) -> int:
    """Return the exam duration in minutes for a single course.

    Rules (matches optimizer.py:344-354):
      - session_mode=True  -> exam fills exactly one ExamDateSlot.
      - explicit exam_duration_minutes -> round up to nearest 30 minutes.
      - else weekly_hours_lecture-based fallback: 4+ -> 180, 3 -> 120, else -> 60.
    """
    if session_mode:
        return slot_duration_minutes
    if exam_duration_minutes:
        return int(math.ceil(exam_duration_minutes / 30) * 30)
    hours = weekly_hours_lecture or 0
    if hours >= 4:
        return 180
    if hours == 3:
        return 120
    return 60


def group_exam_duration_minutes(
    courses: Iterable,
    *,
    slot_duration_minutes: int,
    session_mode: bool,
) -> int:
    """Return the duration in minutes of a simultaneous exam group (max of its courses).

    `courses` is an iterable of mappings or objects each exposing
    `weekly_hours_lecture` and `exam_duration_minutes` (either as dict keys or attrs).
    """
    def _get(c, key):
        if isinstance(c, Mapping):
            return c.get(key)
        return getattr(c, key, None)

    durations = [
        course_exam_duration_minutes(
            weekly_hours_lecture=_get(c, "weekly_hours_lecture"),
            exam_duration_minutes=_get(c, "exam_duration_minutes"),
            slot_duration_minutes=slot_duration_minutes,
            session_mode=session_mode,
        )
        for c in courses
    ]
    return max(durations) if durations else 0
