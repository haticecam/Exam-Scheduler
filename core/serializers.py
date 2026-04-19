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
        fields = ['id', 'organization', 'student_group', 'year_level', 'identifier']
        read_only_fields = ['id']

class OptimizeRequestSerializer(serializers.Serializer):
    term_id = serializers.UUIDField(help_text="Zorunlu Dönem ID")
    name = serializers.CharField(max_length=255, required=False, help_text="Bu çözüme vermek istediğiniz etiket adı (Örn: Güz 2025 Test 1)")
    hard_threshold = serializers.IntegerField(default=5, help_text="Ortak öğrenci sayısı bundan fazlaysa Hard Conflict sayılır.")
    time_limit = serializers.IntegerField(default=300, help_text="Gurobi saniye cinsinden bekleme süresi")
    mip_gap = serializers.FloatField(default=0.10, help_text="MIP gap tolerance (0.10 => 10%)")
    no_back_to_back = serializers.BooleanField(default=False, help_text="Aynı dönemdeki aynı bölüm derslerini arka arkaya vermeyi engelle (TRUE ise Hard Constraint olur)")
    exam_days = serializers.IntegerField(default=5, help_text="Sınavların yayılacağı toplam gün sayısı (Örn: 5, 10, 14)")
    slots_per_day = serializers.IntegerField(default=10, help_text="Her gün içindeki 1 saatlik aktif slot sayısı (Örn: 10)")
    start_hour = serializers.IntegerField(default=8, help_text="Sınav mesaisi başlangıç saati (Örn: 8 girilirse 08:30'da başlar)")

class SimulateStudentsRequestSerializer(serializers.Serializer):
    term_id = serializers.UUIDField(required=True, help_text="Term ID to simulate for.")
    academic_unit_id = serializers.UUIDField(required=False, help_text="Optional: filter to a single department.")
