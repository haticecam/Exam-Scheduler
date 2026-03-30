from celery import shared_task
import gurobipy as gp
from gurobipy import GRB
import logging
import traceback
from .models import GeneratedSolution
from .services.optimizer import OptimizerService

logger = logging.getLogger(__name__)

@shared_task
def dummy_gurobi_task():
    """
    A dummy Celery task to test that Gurobi is correctly installed and licensed
    inside the celery worker process.
    """
    try:
        # Create a simple Gurobi environment/model to verify license configuration
        env = gp.Env(empty=True)
        env.start()
        
        m = gp.Model("dummy_test", env=env)
        x = m.addVar(vtype=GRB.BINARY, name="x")
        m.setObjective(x, GRB.MAXIMIZE)
        m.addConstr(x <= 1, "c0")
        m.optimize()
        
        obj_val = m.ObjVal
        logger.info(f"Dummy Gurobi Task completed successfully. Obj: {obj_val}")
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
            time_limit=params.get('time_limit', 300),
            mip_gap=params.get('mip_gap', 0.10),
            no_back_to_back=params.get('no_back_to_back', False),
            exam_days=params.get('exam_days', 5),
            slots_per_day=params.get('slots_per_day', 10),
            start_hour=params.get('start_hour', 8)
        )
        
        solution.status = result.get('status', 'COMPLETED').upper()
        solution.detailed_schedule = result.get('schedule', [])
        solution.detailed_penalties = result.get('penalties', [])
        
        metadata = result.get('stats', {})
        if result.get('diagnostics'):
            metadata['diagnostics'] = result['diagnostics']
        solution.solver_metadata = metadata
        
        solution.score = result.get('stats', {}).get('total_penalty')
        solution.save()
        
        logger.info(f"Optimizer completed successfully. Status: {solution.status}")
        return {"status": solution.status, "score": solution.score}
        
    except Exception as e:
        logger.error(f"Optimization failed for {solution_id}: {str(e)}\n{traceback.format_exc()}")
        solution = GeneratedSolution.objects.filter(id=solution_id).first()
        if solution:
            solution.status = 'FAILED'
            solution.error_message = str(e) + "\n" + traceback.format_exc()
            solution.save()
        raise e
