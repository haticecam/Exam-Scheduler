import uuid
import django.db.models.deletion
from django.db import migrations, models


def copy_capacity_to_new_fields(apps, schema_editor):
    Resource = apps.get_model('core', 'Resource')
    for r in Resource.objects.all():
        r.full_capacity = r.capacity
        r.exam_capacity = r.capacity // 3 if r.capacity is not None else None
        r.save(update_fields=['full_capacity', 'exam_capacity'])


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0001_initial'),
    ]

    operations = [
        # ── Resource: add new capacity fields ─────────────────────────────
        migrations.AddField(
            model_name='resource',
            name='full_capacity',
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='resource',
            name='exam_capacity',
            field=models.IntegerField(blank=True, null=True),
        ),
        # Copy existing capacity data before removing the column
        migrations.RunPython(copy_capacity_to_new_fields, migrations.RunPython.noop),
        # Remove old columns
        migrations.RemoveField(model_name='resource', name='capacity'),
        migrations.RemoveField(model_name='resource', name='availability'),

        # ── TermResource: new model ────────────────────────────────────────
        migrations.CreateModel(
            name='TermResource',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('full_capacity', models.IntegerField(blank=True, null=True)),
                ('exam_capacity', models.IntegerField(blank=True, null=True)),
                ('available_days', models.IntegerField(default=127)),
                ('is_active', models.BooleanField(default=True)),
                ('notes', models.TextField(blank=True, default='')),
                ('resource', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='term_configs',
                    to='core.resource',
                )),
                ('term', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='room_configs',
                    to='core.term',
                )),
                ('restricted_to_units', models.ManyToManyField(
                    blank=True,
                    db_table='term_resource_restricted_units',
                    related_name='restricted_rooms',
                    to='core.academicunit',
                )),
            ],
            options={'db_table': 'term_resource'},
        ),
        migrations.AddConstraint(
            model_name='termresource',
            constraint=models.UniqueConstraint(fields=['resource', 'term'], name='uq_resource_term'),
        ),
    ]
