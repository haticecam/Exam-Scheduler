import json
import pytest
from django.test import Client
from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
from django.core.management import call_command
from core.models import Organization, Resource


@pytest.fixture
def auth_client(db):
    user = User.objects.create_user(username='roomtester', password='pass')
    token = Token.objects.create(user=user)
    c = Client()
    c.defaults['HTTP_AUTHORIZATION'] = f'Token {token.key}'
    return c


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
    """CZ08-09 full_capacity must be 132; exam_capacity must be 44."""
    call_command('seed_rooms', org_id=str(org.id))
    room = Resource.objects.get(organization=org, name='CZ08-09', type='CLASSROOM')
    assert room.full_capacity == 132
    assert room.exam_capacity == 44


@pytest.mark.django_db
def test_seed_rooms_missing_org_raises(db):
    """seed_rooms with an unknown org_id must raise CommandError."""
    import uuid
    from django.core.management.base import CommandError
    with pytest.raises((CommandError, Organization.DoesNotExist)):
        call_command('seed_rooms', org_id=str(uuid.uuid4()))


from core.services.optimizer import OptimizerService
from core.models import Term, TermResource, AcademicUnit


@pytest.mark.django_db
def test_optimizer_loads_rooms_from_db(org):
    """OptimizerService.load_rooms() must return rooms seeded into the Resource table."""
    term = Term.objects.create(organization=org, name='Fall 2025', status='Active')
    call_command('seed_rooms', org_id=str(org.id))

    svc = OptimizerService(term_id=str(term.id))
    rooms = svc.load_rooms()

    assert len(rooms) == 24
    assert 'CZ08-09' in rooms
    assert rooms['CZ08-09']['capacity'] == 44  # 132 // 3 (shift capacity)
    assert rooms['CZ08-09']['available_days'] == 127
    assert rooms['CZ08-09']['restricted_to_units'] == []


@pytest.mark.django_db
def test_optimizer_raises_when_no_rooms(org):
    """OptimizerService.load_rooms() must raise ValueError if no rooms in DB."""
    term = Term.objects.create(organization=org, name='Fall 2025', status='Active')

    svc = OptimizerService(term_id=str(term.id))
    with pytest.raises(ValueError, match="No active CLASSROOM resources"):
        svc.load_rooms()


# ── Task 1: Resource dual-capacity fields ────────────────────────────────────

@pytest.mark.django_db
def test_resource_has_full_and_exam_capacity(org):
    """Resource must expose full_capacity and exam_capacity as separate fields."""
    room = Resource.objects.create(
        organization=org,
        name="TEST-01",
        type="CLASSROOM",
        full_capacity=90,
        exam_capacity=30,
        is_active=True,
    )
    loaded = Resource.objects.get(pk=room.pk)
    assert loaded.full_capacity == 90
    assert loaded.exam_capacity == 30


# ── Task 2: TermResource model ───────────────────────────────────────────────

@pytest.fixture
def term(db, org):
    return Term.objects.create(organization=org, name='Fall 2026', status='Planning')


@pytest.fixture
def room(db, org):
    return Resource.objects.create(
        organization=org, name='A101', type='CLASSROOM',
        full_capacity=90, exam_capacity=30, is_active=True,
    )


@pytest.mark.django_db
def test_term_resource_created_with_overrides(org, term, room):
    """TermResource can override capacity for a specific term."""
    tr = TermResource.objects.create(
        resource=room, term=term,
        full_capacity=60, exam_capacity=20, available_days=31, is_active=True,
    )
    loaded = TermResource.objects.get(pk=tr.pk)
    assert loaded.full_capacity == 60
    assert loaded.exam_capacity == 20
    assert loaded.available_days == 31


@pytest.mark.django_db
def test_term_resource_unit_restriction(org, term, room):
    """TermResource.restricted_to_units M2M works correctly."""
    unit = AcademicUnit.objects.create(organization=org, name='CS Dept', type='Department')
    tr = TermResource.objects.create(resource=room, term=term, is_active=True)
    tr.restricted_to_units.add(unit)
    assert tr.restricted_to_units.filter(pk=unit.pk).exists()


@pytest.mark.django_db
def test_term_resource_unique_constraint(org, term, room):
    """Only one TermResource may exist per (resource, term) pair."""
    from django.db import IntegrityError
    TermResource.objects.create(resource=room, term=term, is_active=True)
    with pytest.raises(IntegrityError):
        TermResource.objects.create(resource=room, term=term, is_active=False)


# ── Task 3: Serializer tests ─────────────────────────────────────────────────

@pytest.mark.django_db
def test_resource_serializer_exposes_both_capacities(org, room):
    """ResourceSerializer must include full_capacity and exam_capacity."""
    from core.serializers import ResourceSerializer
    data = ResourceSerializer(room).data
    assert 'full_capacity' in data
    assert 'exam_capacity' in data
    assert 'capacity' not in data


@pytest.mark.django_db
def test_term_resource_serializer_round_trip(org, term, room):
    """TermResourceSerializer must create and return a TermResource."""
    from core.serializers import TermResourceSerializer
    payload = {
        'resource': str(room.id),
        'term': str(term.id),
        'full_capacity': 50,
        'exam_capacity': 17,
        'available_days': 31,
        'is_active': True,
        'restricted_to_units': [],
    }
    s = TermResourceSerializer(data=payload)
    assert s.is_valid(), s.errors
    obj = s.save()
    assert obj.exam_capacity == 17
    assert obj.available_days == 31


# ── Task 5: seed_rooms sets both capacities ──────────────────────────────────

@pytest.mark.django_db
def test_seed_rooms_sets_exam_capacity(org):
    """seed_rooms must populate exam_capacity = full_capacity // 3."""
    call_command('seed_rooms', org_id=str(org.id))
    room = Resource.objects.get(organization=org, name='CZ08-09')
    assert room.full_capacity == 132
    assert room.exam_capacity == 44  # 132 // 3


# ── Task 6: Optimizer load_rooms() uses TermResource ─────────────────────────

@pytest.mark.django_db
def test_optimizer_uses_term_resource_exam_capacity(org):
    """load_rooms() uses TermResource.exam_capacity override when one exists."""
    term = Term.objects.create(organization=org, name='Fall 2026', status='Active')
    call_command('seed_rooms', org_id=str(org.id))
    base_room = Resource.objects.get(organization=org, name='CZ08-09')
    TermResource.objects.create(resource=base_room, term=term, exam_capacity=50, is_active=True)
    rooms = OptimizerService(term_id=str(term.id)).load_rooms()
    assert rooms['CZ08-09']['capacity'] == 50


@pytest.mark.django_db
def test_optimizer_falls_back_to_resource_when_no_term_resource(org):
    """load_rooms() falls back to Resource.exam_capacity when no TermResource exists."""
    term = Term.objects.create(organization=org, name='Fall 2026', status='Active')
    call_command('seed_rooms', org_id=str(org.id))
    rooms = OptimizerService(term_id=str(term.id)).load_rooms()
    assert rooms['CZ08-09']['capacity'] == 44  # Resource.exam_capacity


@pytest.mark.django_db
def test_optimizer_excludes_inactive_term_resources(org):
    """load_rooms() must exclude rooms where TermResource.is_active=False."""
    term = Term.objects.create(organization=org, name='Fall 2026', status='Active')
    call_command('seed_rooms', org_id=str(org.id))
    base_room = Resource.objects.get(organization=org, name='CZ08-09')
    TermResource.objects.create(resource=base_room, term=term, is_active=False)
    rooms = OptimizerService(term_id=str(term.id)).load_rooms()
    assert 'CZ08-09' not in rooms


@pytest.mark.django_db
def test_load_rooms_returns_available_days(org):
    """load_rooms() exposes available_days from TermResource (Mon-Fri = 31)."""
    term = Term.objects.create(organization=org, name='Fall 2026', status='Active')
    call_command('seed_rooms', org_id=str(org.id))
    base_room = Resource.objects.get(organization=org, name='CZ08-09')
    TermResource.objects.create(resource=base_room, term=term, is_active=True, available_days=31)
    rooms = OptimizerService(term_id=str(term.id)).load_rooms()
    assert rooms['CZ08-09']['available_days'] == 31


@pytest.mark.django_db
def test_load_rooms_returns_restricted_to_units(org):
    """load_rooms() exposes restricted_to_units UUIDs from TermResource."""
    from core.models import AcademicUnit
    term = Term.objects.create(organization=org, name='Fall 2026', status='Active')
    call_command('seed_rooms', org_id=str(org.id))
    unit = AcademicUnit.objects.create(organization=org, name='CS Dept', type='DEPARTMENT')
    base_room = Resource.objects.get(organization=org, name='CZ08-09')
    tr = TermResource.objects.create(resource=base_room, term=term, is_active=True)
    tr.restricted_to_units.add(unit)
    rooms = OptimizerService(term_id=str(term.id)).load_rooms()
    assert str(unit.id) in rooms['CZ08-09']['restricted_to_units']


# ── Task 4: TermResource API endpoints ───────────────────────────────────────

@pytest.mark.django_db
def test_term_resource_list_endpoint(auth_client, org, term, room):
    """GET /api/term-resources/?term=<id> returns only records for that term."""
    TermResource.objects.create(resource=room, term=term, is_active=True)
    response = auth_client.get(f'/api/term-resources/?term={term.id}')
    assert response.status_code == 200
    body = response.json()
    results = body.get('results', body) if isinstance(body, dict) else body
    assert len(results) == 1
    assert results[0]['resource'] == str(room.id)


@pytest.mark.django_db
def test_term_resource_create_endpoint(auth_client, org, term, room):
    """POST /api/term-resources/ creates a TermResource."""
    payload = {
        'resource': str(room.id),
        'term': str(term.id),
        'full_capacity': 60,
        'exam_capacity': 20,
        'available_days': 31,
        'is_active': True,
        'restricted_to_units': [],
    }
    response = auth_client.post('/api/term-resources/', data=json.dumps(payload), content_type='application/json')
    assert response.status_code == 201
    data = response.json()
    assert data['exam_capacity'] == 20
    assert data['effective_exam_capacity'] == 20
