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


# --- Registration ---

@pytest.mark.django_db
def test_register_creates_user_and_returns_token(client):
    response = client.post('/api/auth/register/', data={
        'username': 'newuser',
        'email': 'new@example.com',
        'password': 'StrongPass123!',
        'password2': 'StrongPass123!',
    }, content_type='application/json')
    assert response.status_code == 201
    assert 'token' in response.json()
    assert User.objects.filter(username='newuser').exists()


@pytest.mark.django_db
def test_register_rejects_duplicate_username(client):
    User.objects.create_user('existing', 'e@e.com', 'pass')
    response = client.post('/api/auth/register/', data={
        'username': 'existing',
        'email': 'other@example.com',
        'password': 'StrongPass123!',
        'password2': 'StrongPass123!',
    }, content_type='application/json')
    assert response.status_code == 400


@pytest.mark.django_db
def test_register_rejects_password_mismatch(client):
    response = client.post('/api/auth/register/', data={
        'username': 'user2',
        'email': 'u2@example.com',
        'password': 'StrongPass123!',
        'password2': 'Different!',
    }, content_type='application/json')
    assert response.status_code == 400


# --- Password Reset ---

@pytest.mark.django_db
def test_reset_request_returns_200_for_existing_email(client):
    User.objects.create_user('resetuser', 'reset@example.com', 'OldPass123!')
    response = client.post('/api/auth/password-reset/', data={
        'email': 'reset@example.com',
    }, content_type='application/json')
    assert response.status_code == 200
    data = response.json()
    assert 'uid' in data
    assert 'token' in data


@pytest.mark.django_db
def test_reset_request_returns_200_for_unknown_email(client):
    response = client.post('/api/auth/password-reset/', data={
        'email': 'nobody@example.com',
    }, content_type='application/json')
    assert response.status_code == 200


@pytest.mark.django_db
def test_reset_confirm_sets_new_password(client):
    from django.contrib.auth.tokens import default_token_generator
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode
    user = User.objects.create_user('resetuser2', 'r2@example.com', 'OldPass123!')
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    response = client.post('/api/auth/password-reset/confirm/', data={
        'uid': uid,
        'token': token,
        'new_password': 'NewPass456!',
    }, content_type='application/json')
    assert response.status_code == 200
    user.refresh_from_db()
    assert user.check_password('NewPass456!')


@pytest.mark.django_db
def test_reset_confirm_rejects_invalid_token(client):
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode
    user = User.objects.create_user('resetuser3', 'r3@example.com', 'OldPass123!')
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    response = client.post('/api/auth/password-reset/confirm/', data={
        'uid': uid,
        'token': 'invalid-token',
        'new_password': 'NewPass456!',
    }, content_type='application/json')
    assert response.status_code == 400
