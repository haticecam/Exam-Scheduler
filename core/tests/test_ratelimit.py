import pytest
from unittest.mock import patch
from django.test import Client
from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
from core.models import Organization, Term, GeneratedSolution


@pytest.fixture
def client(db):
    return Client()


@pytest.fixture
def auth_header(db):
    user = User.objects.create_user(username='ratelimit_tester', password='pass')
    token = Token.objects.create(user=user)
    return {'HTTP_AUTHORIZATION': f'Token {token.key}'}


@pytest.fixture
def org_and_term(db):
    org = Organization.objects.create(name="Rate Limit Uni")
    term = Term.objects.create(organization=org, name="Fall 2025", status="Active")
    return org, term


def _make_pending(term):
    return GeneratedSolution.objects.create(
        term=term, name="test", status='PENDING', parameters={}
    )


@pytest.mark.django_db
def test_optimizer_run_succeeds_below_limit(client, auth_header, org_and_term):
    """First run for a term returns 202 (under the limit)."""
    _, term = org_and_term
    with patch('core.tasks.run_optimizer_task.delay'):
        response = client.post(
            '/api/optimize/run/',
            data={
                'term_id': str(term.id),
                'exam_days': 5,
                'slots_per_day': 8,
                'start_hour': 8,
            },
            content_type='application/json',
            **auth_header
        )
    assert response.status_code == 202


@pytest.mark.django_db
def test_optimizer_run_blocked_at_limit(client, auth_header, org_and_term):
    """Once 3 PENDING/PROCESSING solutions exist for a term, return 429."""
    _, term = org_and_term
    _make_pending(term)
    _make_pending(term)
    _make_pending(term)

    response = client.post(
        '/api/optimize/run/',
        data={
            'term_id': str(term.id),
            'exam_days': 5,
            'slots_per_day': 8,
            'start_hour': 8,
        },
        content_type='application/json',
        **auth_header
    )
    assert response.status_code == 429
    assert 'active' in response.json().get('error', '').lower()


@pytest.mark.django_db
def test_optimizer_run_unblocked_after_completion(client, auth_header, org_and_term):
    """Completed solutions don't count toward the limit."""
    _, term = org_and_term
    GeneratedSolution.objects.create(term=term, name="done", status='OPTIMAL', parameters={})
    GeneratedSolution.objects.create(term=term, name="done2", status='FAILED', parameters={})
    GeneratedSolution.objects.create(term=term, name="done3", status='INFEASIBLE', parameters={})

    with patch('core.tasks.run_optimizer_task.delay'):
        response = client.post(
            '/api/optimize/run/',
            data={
                'term_id': str(term.id),
                'exam_days': 5,
                'slots_per_day': 8,
                'start_hour': 8,
            },
            content_type='application/json',
            **auth_header
        )
    assert response.status_code == 202
