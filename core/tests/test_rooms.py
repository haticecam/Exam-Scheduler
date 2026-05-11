import pytest
from django.core.management import call_command
from core.models import Organization, Resource


@pytest.fixture
def org(db):
    return Organization.objects.create(name="Test University")


@pytest.mark.django_db
def test_seed_rooms_creates_24_resources(org):
    """seed_rooms must create exactly 24 CLASSROOM Resource records for the org."""
    call_command('seed_rooms', org_id=str(org.id))
    count = Resource.objects.filter(organization=org, type='CLASSROOM', is_active=True).count()
    assert count == 24


@pytest.mark.django_db
def test_seed_rooms_is_idempotent(org):
    """Running seed_rooms twice must not create duplicate rooms."""
    call_command('seed_rooms', org_id=str(org.id))
    call_command('seed_rooms', org_id=str(org.id))
    count = Resource.objects.filter(organization=org, type='CLASSROOM').count()
    assert count == 24


@pytest.mark.django_db
def test_seed_rooms_correct_capacity(org):
    """CZ08-09 room capacity must be 132 (real capacity, not divided)."""
    call_command('seed_rooms', org_id=str(org.id))
    room = Resource.objects.get(organization=org, name='CZ08-09', type='CLASSROOM')
    assert room.capacity == 132


@pytest.mark.django_db
def test_seed_rooms_missing_org_raises(db):
    """seed_rooms with an unknown org_id must raise CommandError."""
    import uuid
    from django.core.management.base import CommandError
    with pytest.raises((CommandError, Organization.DoesNotExist)):
        call_command('seed_rooms', org_id=str(uuid.uuid4()))


from core.services.optimizer import OptimizerService
from core.models import Term


@pytest.mark.django_db
def test_optimizer_loads_rooms_from_db(org):
    """OptimizerService.load_rooms() must return rooms seeded into the Resource table."""
    term = Term.objects.create(organization=org, name='Fall 2025', status='Active')
    call_command('seed_rooms', org_id=str(org.id))

    svc = OptimizerService(term_id=str(term.id))
    rooms = svc.load_rooms()

    assert len(rooms) == 24
    assert 'CZ08-09' in rooms
    assert rooms['CZ08-09'] == 66  # 132 // 2 (exam_capacity for CLASSROOM)


@pytest.mark.django_db
def test_optimizer_raises_when_no_rooms(org):
    """OptimizerService.load_rooms() must raise ValueError if no rooms in DB."""
    term = Term.objects.create(organization=org, name='Fall 2025', status='Active')

    svc = OptimizerService(term_id=str(term.id))
    with pytest.raises(ValueError, match="No active exam rooms"):
        svc.load_rooms()


# ── Exam Capacity: model defaults via seed_rooms ────────────────────────

@pytest.mark.django_db
def test_seed_rooms_sets_exam_capacity_classroom(org):
    """seed_rooms must set exam_capacity = capacity // 2 for CLASSROOM rooms."""
    call_command('seed_rooms', org_id=str(org.id))
    room = Resource.objects.get(organization=org, name='CZ08-09', type='CLASSROOM')
    assert room.exam_capacity == 66  # 132 // 2


@pytest.mark.django_db
def test_seed_rooms_correct_capacity_unchanged(org):
    """seed_rooms must not change the raw capacity field."""
    call_command('seed_rooms', org_id=str(org.id))
    room = Resource.objects.get(organization=org, name='CZ08-09', type='CLASSROOM')
    assert room.capacity == 132


# ── Exam Capacity: serializer auto-calc ────────────────────────────────

from core.serializers import ResourceSerializer


@pytest.mark.django_db
def test_serializer_auto_calc_exam_capacity_classroom(org):
    """ResourceSerializer.create() must set exam_capacity = capacity // 2 for CLASSROOM."""
    data = {
        'organization': str(org.id),
        'name': 'TEST-CLASS',
        'type': 'CLASSROOM',
        'capacity': 100,
    }
    serializer = ResourceSerializer(data=data)
    assert serializer.is_valid(), serializer.errors
    instance = serializer.save()
    assert instance.exam_capacity == 50  # 100 // 2


@pytest.mark.django_db
def test_serializer_auto_calc_exam_capacity_amphitheater(org):
    """ResourceSerializer.create() must set exam_capacity = capacity // 3 for AMPHITHEATER."""
    data = {
        'organization': str(org.id),
        'name': 'TEST-AMFI',
        'type': 'AMPHITHEATER',
        'capacity': 120,
    }
    serializer = ResourceSerializer(data=data)
    assert serializer.is_valid(), serializer.errors
    instance = serializer.save()
    assert instance.exam_capacity == 40  # 120 // 3


@pytest.mark.django_db
def test_serializer_explicit_exam_capacity_overrides_default(org):
    """Explicitly providing exam_capacity must bypass the auto-calculation."""
    data = {
        'organization': str(org.id),
        'name': 'TEST-OVERRIDE',
        'type': 'CLASSROOM',
        'capacity': 100,
        'exam_capacity': 99,
    }
    serializer = ResourceSerializer(data=data)
    assert serializer.is_valid(), serializer.errors
    instance = serializer.save()
    assert instance.exam_capacity == 99


# ── Exam Capacity: optimizer ────────────────────────────────────────────

@pytest.mark.django_db
def test_optimizer_uses_exam_capacity_field(org):
    """OptimizerService.load_rooms() must return exam_capacity values, not capacity // 3."""
    term = Term.objects.create(organization=org, name='Fall 2025', status='Active')
    call_command('seed_rooms', org_id=str(org.id))

    svc = OptimizerService(term_id=str(term.id))
    rooms = svc.load_rooms()

    # CZ08-09 has capacity=132; exam_capacity should be 132 // 2 = 66, NOT 132 // 3 = 44
    assert rooms['CZ08-09'] == 66
