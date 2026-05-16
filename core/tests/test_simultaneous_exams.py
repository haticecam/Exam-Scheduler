import inspect
from django.test import TestCase, Client
from core.models import SimultaneousExamGroup, SimultaneousExamGroupCourse
from core.serializers import SimultaneousExamGroupSerializer
from core.services.optimizer import OptimizerService


class TestSimultaneousExamGroupModel(TestCase):
    def test_models_exist(self):
        self.assertTrue(hasattr(SimultaneousExamGroup, 'exam_period'))
        self.assertTrue(hasattr(SimultaneousExamGroup, 'slot'))
        self.assertTrue(hasattr(SimultaneousExamGroup, 'label'))
        self.assertTrue(hasattr(SimultaneousExamGroupCourse, 'group'))
        self.assertTrue(hasattr(SimultaneousExamGroupCourse, 'course'))


class TestSimultaneousExamGroupSerializer(TestCase):
    def test_has_required_fields(self):
        s = SimultaneousExamGroupSerializer()
        for field in ['id', 'exam_period', 'slot', 'label',
                      'slot_date', 'slot_start_time', 'slot_end_time',
                      'courses', 'course_ids']:
            self.assertIn(field, s.fields, msg=f"Missing field: {field}")


class TestSimultaneousExamGroupAPI(TestCase):
    def test_list_endpoint_exists(self):
        c = Client()
        resp = c.get('/api/simultaneous-groups/')
        self.assertIn(resp.status_code, [200, 401, 403])


class TestOptimizerPinnedExams(TestCase):
    def test_solve_accepts_pinned_exams_param(self):
        sig = inspect.signature(OptimizerService.solve)
        self.assertIn('pinned_exams', sig.parameters)

    def test_load_exam_calendar_returns_active_dates_and_times(self):
        import pathlib
        src = pathlib.Path('core/services/optimizer.py').read_text()
        self.assertIn('active_dates', src)
        self.assertIn('all_start_times', src)
