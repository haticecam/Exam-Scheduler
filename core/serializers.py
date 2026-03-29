from rest_framework import serializers
from .models import Organization, CourseCatalog, AcademicUnit, Term, Student

class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ['id', 'name', 'domain', 'subscription_plan', 'config', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

class CourseCatalogSerializer(serializers.ModelSerializer):
    class Meta:
        model = CourseCatalog
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']

class AcademicUnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = AcademicUnit
        fields = '__all__'
        read_only_fields = ['id', 'deleted_at']

class TermSerializer(serializers.ModelSerializer):
    class Meta:
        model = Term
        fields = '__all__'
        read_only_fields = ['id']

class StudentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Student
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']
