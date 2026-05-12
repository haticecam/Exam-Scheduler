from django.db import migrations, models


def backfill_exam_capacity(apps, schema_editor):
    Resource = apps.get_model('core', 'Resource')
    for resource in Resource.objects.filter(capacity__isnull=False, exam_capacity__isnull=True):
        if resource.type == 'CLASSROOM':
            resource.exam_capacity = resource.capacity // 2
        elif resource.type == 'AMPHITHEATER':
            resource.exam_capacity = resource.capacity // 3
        else:
            continue
        resource.save(update_fields=['exam_capacity'])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='resource',
            name='exam_capacity',
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.RunPython(backfill_exam_capacity, migrations.RunPython.noop),
    ]
