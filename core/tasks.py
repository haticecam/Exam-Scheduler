from celery import shared_task
import gurobipy as gp
from gurobipy import GRB
import logging

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
