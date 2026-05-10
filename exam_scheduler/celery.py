import os
from celery import Celery
from celery.signals import worker_ready

# set the default Django settings module for the 'celery' program.
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'exam_scheduler.settings')

app = Celery('exam_scheduler')

# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
# - namespace='CELERY' means all celery-related configuration keys
#   should have a `CELERY_` prefix.
app.config_from_object('django.conf:settings', namespace='CELERY')

# Load task modules from all registered Django app configs.
app.autodiscover_tasks()


@worker_ready.connect
def sweep_orphaned_solutions(sender, **kwargs):
    """Mark any PROCESSING/PENDING solutions as FAILED on worker startup.

    If a worker was killed mid-task (OOM, restart, deploy) the DB row stays
    at PROCESSING forever because the task never gets to update it. Sweeping
    on startup ensures the UI reflects reality after every restart.
    """
    import logging
    from core.models import GeneratedSolution
    updated = GeneratedSolution.objects.filter(
        status__in=('PROCESSING', 'PENDING')
    ).update(
        status='FAILED',
        error_message='Task orphaned: Celery worker restarted while task was running.',
    )
    if updated:
        logging.getLogger(__name__).warning(
            f"Swept {updated} orphaned PROCESSING/PENDING solution(s) to FAILED on worker startup."
        )
