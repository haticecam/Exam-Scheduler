import pytest
from django.test import Client
from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
from core.models import Organization, Term, AcademicUnit, CourseCatalog, CourseSection, Student


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def auth_client(db):
    user = User.objects.create_user(username='viewtester', password='pass')
    token = Token.objects.create(user=user)
    c = Client()
    c.defaults['HTTP_AUTHORIZATION'] = f'Token {token.key}'
    return c


@pytest.fixture
def org(db):
    return Organization.objects.create(name="Test University", subscription_plan="Free")


@pytest.fixture
def active_term(org):
    return Term.objects.create(organization=org, name="Fall 2025", status="Active")


# --- Student upload endpoint ---

@pytest.mark.django_db
def test_student_upload_requires_file(auth_client, org, active_term):
    response = auth_client.post(f'/api/students/', data={'term_id': str(active_term.id)}, format='multipart')
    assert response.status_code == 400
    assert 'file' in response.json().get('error', '').lower() or 'csv' in response.json().get('error', '').lower()


@pytest.mark.django_db
def test_student_upload_requires_term_id(auth_client, org, active_term):
    import io
    f = io.BytesIO(b"Student Identifier,Program Name,Year Level,Course Code,Section Label,Retaker\n")
    f.name = 'enrollments.csv'
    response = auth_client.post('/api/students/', data={'file': f})
    assert response.status_code == 400
    assert 'term_id' in response.json().get('error', '').lower()


@pytest.mark.django_db
def test_student_upload_rejects_nonexistent_term(auth_client, org):
    import io, uuid
    f = io.BytesIO(b"Student Identifier,Program Name,Year Level,Course Code,Section Label,Retaker\n")
    f.name = 'enrollments.csv'
    response = auth_client.post('/api/students/', data={'file': f, 'term_id': str(uuid.uuid4())})
    assert response.status_code == 400


# --- Simulate students endpoint ---

@pytest.mark.django_db
def test_simulate_requires_term_id(auth_client, org, active_term):
    response = auth_client.post('/api/simulateStudents/', data={}, content_type='application/json')
    assert response.status_code == 400
    assert 'term_id' in response.json().get('error', '').lower()


@pytest.mark.django_db
def test_simulate_rejects_nonexistent_term(auth_client, org):
    import uuid
    response = auth_client.post(
        '/api/simulateStudents/',
        data={'term_id': str(uuid.uuid4())},
        content_type='application/json'
    )
    assert response.status_code == 400


# --- delete_all scoping ---

@pytest.mark.django_db
def test_delete_all_courses_requires_org_id(auth_client):
    response = auth_client.delete('/api/courses/deleteAll/')
    assert response.status_code == 400
    assert 'org_id' in response.json().get('error', '').lower()


@pytest.mark.django_db
def test_delete_all_students_requires_org_id(auth_client):
    response = auth_client.delete('/api/students/deleteAll/')
    assert response.status_code == 400
    assert 'org_id' in response.json().get('error', '').lower()


@pytest.mark.django_db
def test_delete_all_courses_scoped_to_org(auth_client, org, active_term):
    """delete_all must not touch another org's data."""
    other_org = Organization.objects.create(name="Other University")
    dept = AcademicUnit.objects.create(organization=other_org, name="CS", type="Department")
    CourseCatalog.objects.create(
        organization=other_org, academic_unit=dept,
        code="CS101", name="Intro to CS"
    )

    response = auth_client.delete(f'/api/courses/deleteAll/?org_id={org.id}')
    assert response.status_code == 200
    assert CourseCatalog.objects.filter(organization=other_org).count() == 1


# --- Admin registration ---

def test_admin_models_registered():
    from django.contrib import admin
    registered = [m.__name__ for m in admin.site._registry.keys()]
    for model_name in ['Organization', 'Term', 'AcademicUnit', 'CourseCatalog',
                       'CourseSection', 'GeneratedSolution', 'Student']:
        assert model_name in registered, f"{model_name} not registered in admin"
