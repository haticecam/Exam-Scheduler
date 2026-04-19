from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token


class Command(BaseCommand):
    help = "Create the first superuser and print their API token. Safe to run multiple times."

    def add_arguments(self, parser):
        parser.add_argument('--username', default='admin', help='Admin username (default: admin)')
        parser.add_argument('--password', default='adminpass123', help='Admin password')
        parser.add_argument('--email', default='admin@example.com', help='Admin email')

    def handle(self, *args, **options):
        username = options['username']
        password = options['password']
        email = options['email']

        user, created = User.objects.get_or_create(
            username=username,
            defaults={'email': email, 'is_staff': True, 'is_superuser': True}
        )
        if created:
            user.set_password(password)
            user.save()
            self.stdout.write(self.style.SUCCESS(f"Created superuser '{username}'"))
        else:
            self.stdout.write(f"Superuser '{username}' already exists")

        token, _ = Token.objects.get_or_create(user=user)
        self.stdout.write(self.style.SUCCESS(f"\nAPI Token: {token.key}"))
        self.stdout.write("Use it as:  Authorization: Token <key>")
