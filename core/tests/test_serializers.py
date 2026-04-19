import pytest
import uuid
from core.serializers import StudentSerializer, OptimizeRequestSerializer


@pytest.mark.django_db
def test_student_serializer_has_no_nonexistent_fields():
    """StudentSerializer must not reference fields that don't exist on Student."""
    s = StudentSerializer()
    field_names = list(s.fields.keys())
    assert 'created_at' not in field_names
    assert 'updated_at' not in field_names
    assert 'id' in field_names


def test_tasks_module_importable_without_gurobi(monkeypatch):
    """core.tasks must be importable even if gurobipy is missing."""
    import sys
    import importlib

    # Simulate gurobipy being absent
    original = sys.modules.get('gurobipy', 'NOT_SET')
    sys.modules['gurobipy'] = None  # type: ignore
    try:
        if 'core.tasks' in sys.modules:
            del sys.modules['core.tasks']
        import core.tasks  # noqa: F401 — must not raise
    except TypeError:
        # None module raises TypeError on attribute access, not ImportError
        # which is expected — the module itself imported fine
        pass
    except ImportError:
        pytest.fail("core.tasks raised ImportError at import time without gurobipy")
    finally:
        if original == 'NOT_SET':
            sys.modules.pop('gurobipy', None)
        else:
            sys.modules['gurobipy'] = original


def test_optimize_serializer_rejects_negative_exam_days():
    s = OptimizeRequestSerializer(data={
        'term_id': str(uuid.uuid4()),
        'exam_days': -1,
        'slots_per_day': 10,
        'start_hour': 8,
    })
    assert not s.is_valid()
    assert 'exam_days' in s.errors


def test_optimize_serializer_rejects_start_hour_out_of_range():
    s = OptimizeRequestSerializer(data={
        'term_id': str(uuid.uuid4()),
        'exam_days': 5,
        'slots_per_day': 10,
        'start_hour': 25,
    })
    assert not s.is_valid()
    assert 'start_hour' in s.errors


def test_optimize_serializer_rejects_overflow_slots():
    """start_hour + slots_per_day must not exceed 24."""
    s = OptimizeRequestSerializer(data={
        'term_id': str(uuid.uuid4()),
        'exam_days': 5,
        'slots_per_day': 20,
        'start_hour': 8,
    })
    assert not s.is_valid()


def test_optimize_serializer_accepts_valid_data():
    s = OptimizeRequestSerializer(data={
        'term_id': str(uuid.uuid4()),
        'exam_days': 10,
        'slots_per_day': 8,
        'start_hour': 9,
        'hard_threshold': 5,
        'time_limit': 300,
        'mip_gap': 0.1,
        'no_back_to_back': False,
    })
    assert s.is_valid(), s.errors
