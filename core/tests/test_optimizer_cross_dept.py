"""
Regression test for cross-department single-section courses.

A single CourseCatalog row offered by ONE department, but enrolled by students
from MULTIPLE departments (e.g., CENG463 with both CENG and SENG students),
becomes TWO unit_keys in load_courses(). Without the same-course-same-slot
constraint, the solver places them in different slots and the same physical
exam appears twice on the calendar.

This test exercises the pure grouping helper that the constraint loop uses.
End-to-end verification runs against Postgres (load_courses() uses Postgres-
specific SQL casts and cannot execute on the SQLite test DB).
"""
from core.services.optimizer import _group_unit_keys_by_course


def test_groups_units_sharing_same_course():
    info = {
        "courseA|deptCENG": {"course_id": "courseA"},
        "courseA|deptSENG": {"course_id": "courseA"},
        "courseB|deptCENG": {"course_id": "courseB"},
    }
    groups = _group_unit_keys_by_course(info)
    assert sorted(groups["courseA"]) == ["courseA|deptCENG", "courseA|deptSENG"]
    assert groups["courseB"] == ["courseB|deptCENG"]


def test_returns_empty_for_no_units():
    assert _group_unit_keys_by_course({}) == {}


def test_single_unit_per_course_yields_singleton_lists():
    info = {
        "courseA|d1": {"course_id": "courseA"},
        "courseB|d2": {"course_id": "courseB"},
    }
    groups = _group_unit_keys_by_course(info)
    assert groups == {"courseA": ["courseA|d1"], "courseB": ["courseB|d2"]}
