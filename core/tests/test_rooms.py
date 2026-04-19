import pytest
from django.core.management import call_command
from core.models import Organization, Resource


@pytest.fixture
def org(db):
    return Organization.objects.create(name="Test University")


@pytest.mark.django_db
def test_seed_rooms_creates_24_resources(org):
    """seed_rooms must create exactly 24 EXAM_ROOM Resource records for the org."""
    call_command('seed_rooms', org_id=str(org.id))
    count = Resource.objects.filter(organization=org, type='EXAM_ROOM', is_active=True).count()
    assert count == 24


@pytest.mark.django_db
def test_seed_rooms_is_idempotent(org):
    """Running seed_rooms twice must not create duplicate rooms."""
    call_command('seed_rooms', org_id=str(org.id))
    call_command('seed_rooms', org_id=str(org.id))
    count = Resource.objects.filter(organization=org, type='EXAM_ROOM').count()
    assert count == 24


@pytest.mark.django_db
def test_seed_rooms_correct_capacity(org):
    """CZ08-09 room capacity must be 44 (132 // 3)."""
    call_command('seed_rooms', org_id=str(org.id))
    room = Resource.objects.get(organization=org, name='CZ08-09', type='EXAM_ROOM')
    assert room.capacity == 44  # 132 // 3


@pytest.mark.django_db
def test_seed_rooms_missing_org_raises(db):
    """seed_rooms with an unknown org_id must raise CommandError."""
    import uuid
    from django.core.management.base import CommandError
    with pytest.raises((CommandError, Organization.DoesNotExist)):
        call_command('seed_rooms', org_id=str(uuid.uuid4()))
