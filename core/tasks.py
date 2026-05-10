from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded
import logging
import traceback
from .models import GeneratedSolution
from .services.optimizer import OptimizerService

logger = logging.getLogger(__name__)


@shared_task
def dummy_gurobi_task():
    """Test that Gurobi is correctly installed and licensed in the Celery worker."""
    try:
        import gurobipy as gp
        from gurobipy import GRB
        import os

        env = gp.Env(empty=True)
        wls_access = os.getenv("GRB_WLSACCESSID")
        wls_secret = os.getenv("GRB_WLSSECRET")
        license_id = os.getenv("GRB_LICENSEID")
        if wls_access and wls_secret and license_id:
            env.setParam("WLSACCESSID", wls_access)
            env.setParam("WLSSECRET", wls_secret)
            env.setParam("LICENSEID", int(license_id))
        env.setParam("OutputFlag", 0)
        env.start()
        m = gp.Model("dummy_test", env=env)
        x = m.addVar(vtype=GRB.BINARY, name="x")
        m.setObjective(x, GRB.MAXIMIZE)
        m.addConstr(x <= 1, "c0")
        m.optimize()
        obj_val = m.ObjVal
        logger.info(f"Dummy Gurobi Task completed. Obj: {obj_val}")
        return {"status": "success", "objective": obj_val}
    except Exception as e:
        logger.error(f"Gurobi Task failed: {str(e)}")
        return {"status": "error", "message": str(e)}


@shared_task(bind=True)
def run_optimizer_task(self, solution_id: str):
    logger.info(f"Starting optimizer task for solution {solution_id}")
    try:
        solution = GeneratedSolution.objects.get(id=solution_id)
        solution.status = 'PROCESSING'
        solution.celery_task_id = self.request.id
        solution.save()

        svc = OptimizerService(term_id=str(solution.term_id))
        params = solution.parameters

        result = svc.solve(
            hard_threshold=params.get('hard_threshold', 5),
            time_limit=params.get('time_limit', None),
            mip_gap=params.get('mip_gap', 0.10),
            no_back_to_back=params.get('no_back_to_back', False),
            exam_days=params.get('exam_days', 5),
            slots_per_day=params.get('slots_per_day', 10),
            start_hour=params.get('start_hour', 8),
            year_order_weight=params.get('year_order_weight', 100.0),
            year_order_sequence=params.get('year_order_sequence', None),
            year_order_weights=params.get('year_order_weights', None),
            weight_config=params.get('weight_config', None),
        )

        raw_status = result.get('status', 'completed')
        # Normalize to uppercase, replace spaces/parens → underscores for consistency
        status_normalized = (
            raw_status.upper()
            .replace('(', '')
            .replace(')', '')
            .replace(' ', '_')
        )
        solution.status = status_normalized
        solution.detailed_schedule = result.get('schedule', [])
        solution.detailed_penalties = result.get('penalties', [])

        metadata = result.get('stats', {})
        if result.get('diagnostics'):
            metadata['diagnostics'] = result['diagnostics']
        solution.solver_metadata = metadata
        solution.score = result.get('stats', {}).get('total_penalty')
        solution.save()

        logger.info(f"Optimizer done. Status: {solution.status}")
        return {"status": solution.status, "score": solution.score}

    except SoftTimeLimitExceeded:
        logger.error(f"Celery soft time limit exceeded for solution {solution_id}")
        solution = GeneratedSolution.objects.filter(id=solution_id).first()
        if solution:
            solution.status = 'FAILED'
            solution.error_message = "Task killed by Celery soft time limit (total wall time exceeded)."
            solution.save()
        raise

    except Exception as e:
        logger.error(f"Optimization failed for {solution_id}: {str(e)}\n{traceback.format_exc()}")
        solution = GeneratedSolution.objects.filter(id=solution_id).first()
        if solution:
            solution.status = 'FAILED'
            solution.error_message = str(e) + "\n" + traceback.format_exc()
            solution.save()
        raise e
