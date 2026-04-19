from django.contrib import admin
from django.urls import path, include
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.authtoken.views import ObtainAuthToken
from rest_framework.permissions import AllowAny


class PublicSpectacularAPIView(SpectacularAPIView):
    permission_classes = [AllowAny]


class PublicSpectacularSwaggerView(SpectacularSwaggerView):
    permission_classes = [AllowAny]


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('core.urls')),
    path('api/auth/token/', ObtainAuthToken.as_view(), name='auth-token'),
    path('api/schema/', PublicSpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', PublicSpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
]
