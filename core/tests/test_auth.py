import pytest
from django.test import Client
from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token


@pytest.fixture
def client(db):
    return Client()


@pytest.fixture
def auth_user(db):
    user = User.objects.create_user(username='testadmin', password='testpass123')
    token = Token.objects.create(user=user)
    return user, token


@pytest.mark.django_db
def test_unauthenticated_request_returns_401(client):
    """Any protected endpoint must return 401 without a token."""
    response = client.get('/api/organizations/')
    assert response.status_code == 401


@pytest.mark.django_db
def test_authenticated_request_returns_200(client, auth_user):
    """A valid token in the Authorization header grants access."""
    _, token = auth_user
    response = client.get(
        '/api/organizations/',
        HTTP_AUTHORIZATION=f'Token {token.key}'
    )
    assert response.status_code == 200


@pytest.mark.django_db
def test_token_endpoint_returns_token_for_valid_credentials(client, auth_user):
    """POST /api/auth/token/ with valid credentials returns a token."""
    user, token = auth_user
    response = client.post(
        '/api/auth/token/',
        data={'username': 'testadmin', 'password': 'testpass123'},
        content_type='application/json'
    )
    assert response.status_code == 200
    assert 'token' in response.json()
    assert response.json()['token'] == token.key


@pytest.mark.django_db
def test_token_endpoint_rejects_bad_credentials(client, db):
    """POST /api/auth/token/ with wrong password returns 400."""
    response = client.post(
        '/api/auth/token/',
        data={'username': 'nobody', 'password': 'wrong'},
        content_type='application/json'
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_status_endpoint_is_public(client):
    """GET /api/status/ must be accessible without a token (health check)."""
    response = client.get('/api/status/')
    assert response.status_code == 200


@pytest.mark.django_db
def test_swagger_is_public(client):
    """GET /api/docs/ must be accessible without a token."""
    response = client.get('/api/docs/')
    assert response.status_code == 200
