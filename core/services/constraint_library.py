"""
Static Constraint Library for LLM-Guided Exam Scheduling.

This module defines every tunable parameter the LLM is allowed to modify.
Each blueprint maps to a concrete optimizer knob with validated ranges.
The LLM can ONLY output references to these blueprints — it cannot invent
new constraints or parameters, eliminating hallucination risk.

Categories:
    SOLVER_PARAM   – direct optimizer arguments (exam_days, hard_threshold, …)
    SOFT_WEIGHT    – penalty weights that shape schedule quality
    SCOPE_FILTER   – per-department / per-year overrides
"""

BLUEPRINT_DEFINITIONS = [
    # ═══════════════════════════════════════════════════════════════
    #  CATEGORY 1: SOLVER PARAMETERS
    #  These map 1-to-1 to OptimizerService.solve() arguments.
    # ═══════════════════════════════════════════════════════════════
    {
        "code": "PARAM_HARD_THRESHOLD",
        "category": "SOLVER_PARAM",
        "description": (
            "The minimum number of shared students between two exams that "
            "triggers a hard conflict (those exams CANNOT be in the same slot). "
            "Lower values are stricter (fewer overlaps allowed), higher values "
            "are more relaxed (only large overlaps blocked)."
        ),
        "param_schema": {
            "type": "integer",
            "minimum": 0,
            "maximum": 50,
            "default": 5,
            "optimizer_kwarg": "hard_threshold",
            "examples": [
                {"input": "Be stricter about conflicts", "value": 3},
                {"input": "Allow more flexibility with overlaps", "value": 10},
                {"input": "Only block the biggest conflicts", "value": 20},
            ],
        },
    },
    {
        "code": "PARAM_EXAM_DAYS",
        "category": "SOLVER_PARAM",
        "description": (
            "Total number of days over which exams are spread. More days "
            "means fewer exams per day and fewer conflicts, but extends the "
            "exam period."
        ),
        "param_schema": {
            "type": "integer",
            "minimum": 3,
            "maximum": 14,
            "default": 5,
            "optimizer_kwarg": "exam_days",
            "examples": [
                {"input": "Spread exams over more days", "value": 7},
                {"input": "Compress the exam period", "value": 3},
                {"input": "Use two full weeks", "value": 10},
            ],
        },
    },
    {
        "code": "PARAM_SLOTS_PER_DAY",
        "category": "SOLVER_PARAM",
        "description": (
            "Number of 1-hour exam slots available each day. More slots "
            "per day means more scheduling flexibility but longer exam days "
            "for students."
        ),
        "param_schema": {
            "type": "integer",
            "minimum": 4,
            "maximum": 14,
            "default": 10,
            "optimizer_kwarg": "slots_per_day",
            "examples": [
                {"input": "Shorter exam days", "value": 6},
                {"input": "Use the full day", "value": 12},
            ],
        },
    },
    {
        "code": "PARAM_START_HOUR",
        "category": "SOLVER_PARAM",
        "description": (
            "The hour at which the first exam slot begins each day. "
            "Exams start at this hour plus 30 minutes (e.g., 8 means 08:30)."
        ),
        "param_schema": {
            "type": "integer",
            "minimum": 7,
            "maximum": 11,
            "default": 8,
            "optimizer_kwarg": "start_hour",
            "examples": [
                {"input": "Start exams earlier", "value": 7},
                {"input": "Start at 10", "value": 10},
            ],
        },
    },
    {
        "code": "PARAM_NO_BACK_TO_BACK",
        "category": "SOLVER_PARAM",
        "description": (
            "When enabled, exams from the same department and year level "
            "cannot be scheduled in consecutive time slots. This is enforced "
            "as a hard constraint — it MUST be satisfied, which may make the "
            "problem harder to solve or even infeasible."
        ),
        "param_schema": {
            "type": "boolean",
            "default": False,
            "optimizer_kwarg": "no_back_to_back",
            "examples": [
                {"input": "Prevent back-to-back exams", "value": True},
                {"input": "Students should have breaks between exams", "value": True},
                {"input": "It's okay if exams are consecutive", "value": False},
            ],
        },
    },
    {
        "code": "PARAM_TIME_LIMIT",
        "category": "SOLVER_PARAM",
        "description": (
            "Maximum seconds the Gurobi solver is allowed to run. Longer "
            "limits may find better solutions but take more time."
        ),
        "param_schema": {
            "type": "integer",
            "minimum": 60,
            "maximum": 600,
            "default": 300,
            "optimizer_kwarg": "time_limit",
            "examples": [
                {"input": "Give the solver more time for a better result", "value": 600},
                {"input": "I need a quick result", "value": 120},
            ],
        },
    },
    {
        "code": "PARAM_MIP_GAP",
        "category": "SOLVER_PARAM",
        "description": (
            "Optimality gap tolerance as a decimal fraction. The solver "
            "stops when it proves the solution is within this percentage of "
            "optimal. Lower values demand better solutions but take longer."
        ),
        "param_schema": {
            "type": "number",
            "minimum": 0.01,
            "maximum": 0.30,
            "default": 0.10,
            "optimizer_kwarg": "mip_gap",
            "examples": [
                {"input": "I need the best possible schedule", "value": 0.02},
                {"input": "A good-enough solution is fine", "value": 0.15},
            ],
        },
    },
    {
        "code": "PARAM_YEAR_ORDERING",
        "category": "SOLVER_PARAM",
        "description": (
            "When enabled, the optimizer softly prefers scheduling lower year-level "
            "exams earlier in the exam week and higher year-level exams later. "
            "Year 1 exams are nudged toward the first day band, year 2 toward the "
            "second, and so on. This is a soft preference — it will not cause "
            "infeasibility but adds a penalty whenever an exam lands outside its "
            "preferred day band."
        ),
        "param_schema": {
            "type": "boolean",
            "default": False,
            "optimizer_kwarg": "year_ordering",
            "examples": [
                {"input": "Put first-year exams at the start of the exam week", "value": True},
                {"input": "Order exams by year level across the exam period", "value": True},
                {"input": "Don't apply any year-based ordering", "value": False},
            ],
        },
    },
    {
        "code": "PARAM_YEAR_ORDER_WEIGHT",
        "category": "SOLVER_PARAM",
        "description": (
            "Controls how strongly the optimizer enforces year-based day ordering "
            "when PARAM_YEAR_ORDERING is enabled. Higher values push the solver "
            "harder to place exams in their preferred day band, at the cost of "
            "potentially accepting more student conflicts. Lower values treat the "
            "ordering as a gentle nudge."
        ),
        "param_schema": {
            "type": "number",
            "minimum": 10.0,
            "maximum": 500.0,
            "default": 100.0,
            "optimizer_kwarg": "year_order_weight",
            "examples": [
                {"input": "Strict year ordering, override other preferences", "value": 400.0},
                {"input": "Gentle year ordering, don't hurt student conflicts", "value": 30.0},
                {"input": "Moderate year ordering preference", "value": 100.0},
            ],
        },
    },

    # ═══════════════════════════════════════════════════════════════
    #  CATEGORY 2: SOFT CONSTRAINT WEIGHTS
    #  These control how the optimizer penalizes student conflicts
    #  that fall below the hard threshold.
    # ═══════════════════════════════════════════════════════════════
    {
        "code": "WEIGHT_MANDATORY_MANDATORY",
        "category": "SOFT_WEIGHT",
        "description": (
            "Base penalty weight when two COMPULSORY courses overlap in the "
            "same time slot. Higher values make the optimizer try harder to "
            "separate mandatory course exams."
        ),
        "param_schema": {
            "type": "number",
            "minimum": 10.0,
            "maximum": 200.0,
            "default": 50.0,
            "weight_key": "BASE_W_MM",
            "examples": [
                {"input": "Mandatory exam overlaps are very bad", "value": 100.0},
                {"input": "Don't worry too much about mandatory overlaps", "value": 25.0},
            ],
        },
    },
    {
        "code": "WEIGHT_MANDATORY_ELECTIVE",
        "category": "SOFT_WEIGHT",
        "description": (
            "Base penalty weight when one COMPULSORY and one ELECTIVE course "
            "overlap. Typically lower than mandatory-mandatory since elective "
            "overlaps are less critical."
        ),
        "param_schema": {
            "type": "number",
            "minimum": 5.0,
            "maximum": 150.0,
            "default": 30.0,
            "weight_key": "BASE_W_ME",
            "examples": [
                {"input": "Protect students taking both mandatory and elective courses", "value": 60.0},
            ],
        },
    },
    {
        "code": "WEIGHT_ELECTIVE_ELECTIVE",
        "category": "SOFT_WEIGHT",
        "description": (
            "Base penalty weight when two ELECTIVE courses overlap. Usually "
            "the lowest weight since students choose electives knowing there "
            "may be conflicts."
        ),
        "param_schema": {
            "type": "number",
            "minimum": 1.0,
            "maximum": 100.0,
            "default": 15.0,
            "weight_key": "BASE_W_EE",
            "examples": [
                {"input": "Elective overlaps don't matter much", "value": 5.0},
                {"input": "Treat elective conflicts more seriously", "value": 40.0},
            ],
        },
    },
    {
        "code": "WEIGHT_YEAR_PROXIMITY",
        "category": "SOFT_WEIGHT",
        "description": (
            "Multiplier map based on the year-level difference between two "
            "overlapping courses. Same-year overlaps get the highest multiplier "
            "(worst penalty). Courses 3+ years apart get almost no penalty. "
            "The value is a JSON object mapping year-difference to multiplier."
        ),
        "param_schema": {
            "type": "object",
            "default": {"0": 20.0, "1": 10.0, "2": 3.0, "3": 1.0},
            "weight_key": "YEAR_DIFF_FACTOR",
            "properties": {
                "0": {"type": "number", "minimum": 1.0, "maximum": 50.0, "description": "Same year"},
                "1": {"type": "number", "minimum": 1.0, "maximum": 40.0, "description": "1 year apart"},
                "2": {"type": "number", "minimum": 0.5, "maximum": 20.0, "description": "2 years apart"},
                "3": {"type": "number", "minimum": 0.1, "maximum": 10.0, "description": "3+ years apart"},
            },
            "examples": [
                {"input": "Same-year conflicts are critical", "value": {"0": 40.0, "1": 10.0, "2": 3.0, "3": 1.0}},
                {"input": "Flatten year-based penalties", "value": {"0": 10.0, "1": 8.0, "2": 5.0, "3": 3.0}},
            ],
        },
    },

    # ═══════════════════════════════════════════════════════════════
    #  CATEGORY 3: SCOPE FILTERS
    #  These allow per-department or per-year overrides.
    # ═══════════════════════════════════════════════════════════════
    {
        "code": "SCOPE_DEPT_NO_BACK_TO_BACK",
        "category": "SCOPE_FILTER",
        "description": (
            "Apply no-back-to-back constraint only to a specific department, "
            "rather than globally. Requires specifying the department name."
        ),
        "param_schema": {
            "type": "object",
            "properties": {
                "department": {"type": "string", "description": "Department name to apply the rule to"},
                "enabled": {"type": "boolean", "default": True},
            },
            "required": ["department"],
            "scope_type": "department",
            "examples": [
                {"input": "Computer Science students shouldn't have back-to-back exams",
                 "value": {"department": "Computer Science", "enabled": True}},
            ],
        },
    },
    {
        "code": "SCOPE_YEAR_PRIORITY",
        "category": "SCOPE_FILTER",
        "description": (
            "Increase soft-constraint penalties for a specific year level, "
            "making the optimizer prioritize conflict-free schedules for "
            "that year. Useful for protecting 1st-year or graduating students."
        ),
        "param_schema": {
            "type": "object",
            "properties": {
                "year_level": {"type": "integer", "minimum": 1, "maximum": 6},
                "priority_multiplier": {
                    "type": "number",
                    "minimum": 1.0,
                    "maximum": 5.0,
                    "default": 2.0,
                    "description": "Multiply penalties for this year by this factor",
                },
            },
            "required": ["year_level"],
            "scope_type": "year",
            "examples": [
                {"input": "First-year students need a fair schedule", "value": {"year_level": 1, "priority_multiplier": 2.5}},
                {"input": "Prioritize graduating students", "value": {"year_level": 4, "priority_multiplier": 3.0}},
            ],
        },
    },
]


def get_blueprint_map() -> dict:
    """Return {code: blueprint_dict} for all defined blueprints."""
    return {bp["code"]: bp for bp in BLUEPRINT_DEFINITIONS}


def get_blueprints_by_category(category: str) -> list:
    """Return all blueprints in a given category."""
    return [bp for bp in BLUEPRINT_DEFINITIONS if bp["category"] == category]


def get_optimizer_defaults() -> dict:
    """
    Return a dict of {optimizer_kwarg: default_value} for all SOLVER_PARAM blueprints.
    """
    defaults = {}
    for bp in get_blueprints_by_category("SOLVER_PARAM"):
        schema = bp["param_schema"]
        defaults[schema["optimizer_kwarg"]] = schema["default"]
    return defaults


def get_weight_defaults() -> dict:
    """Return a dict of {weight_key: default_value} for all SOFT_WEIGHT blueprints."""
    defaults = {}
    for bp in get_blueprints_by_category("SOFT_WEIGHT"):
        schema = bp["param_schema"]
        defaults[schema["weight_key"]] = schema["default"]
    return defaults


def validate_parameter(code: str, value) -> tuple:
    """
    Validate a single parameter value against its blueprint schema.
    Returns (is_valid, error_message).
    """
    blueprint_map = get_blueprint_map()
    if code not in blueprint_map:
        return False, f"Unknown blueprint code: {code}"

    schema = blueprint_map[code]["param_schema"]
    expected_type = schema["type"]

    type_map = {
        "integer": int,
        "number": (int, float),
        "boolean": bool,
        "object": dict,
    }
    expected_python_type = type_map.get(expected_type)
    if expected_python_type and not isinstance(value, expected_python_type):
        return False, f"{code}: expected {expected_type}, got {type(value).__name__}"

    if expected_type in ("integer", "number"):
        if "minimum" in schema and value < schema["minimum"]:
            return False, f"{code}: value {value} is below minimum {schema['minimum']}"
        if "maximum" in schema and value > schema["maximum"]:
            return False, f"{code}: value {value} is above maximum {schema['maximum']}"

    return True, ""


def validate_all_parameters(params: dict) -> tuple:
    """
    Validate a dict of {blueprint_code: value} pairs.
    Returns (all_valid, list_of_errors).
    """
    errors = []
    for code, value in params.items():
        is_valid, error = validate_parameter(code, value)
        if not is_valid:
            errors.append(error)
    return len(errors) == 0, errors


def build_optimizer_kwargs(scenario_params: dict) -> dict:
    """
    Convert a dict of {blueprint_code: value} into the kwargs dict
    that OptimizerService expects. Starts with defaults and overlays overrides.
    """
    kwargs = get_optimizer_defaults()
    blueprint_map = get_blueprint_map()

    for code, value in scenario_params.items():
        if code not in blueprint_map:
            continue
        bp = blueprint_map[code]
        if bp["category"] != "SOLVER_PARAM":
            continue
        kwarg_name = bp["param_schema"]["optimizer_kwarg"]
        kwargs[kwarg_name] = value

    return kwargs


def build_weight_config(scenario_params: dict) -> dict:
    """
    Convert a dict of {blueprint_code: value} into the weight config dict.
    Starts with defaults and overlays overrides.
    """
    weights = get_weight_defaults()
    blueprint_map = get_blueprint_map()

    for code, value in scenario_params.items():
        if code not in blueprint_map:
            continue
        bp = blueprint_map[code]
        if bp["category"] != "SOFT_WEIGHT":
            continue
        weight_key = bp["param_schema"]["weight_key"]
        weights[weight_key] = value

    return weights


def generate_llm_context() -> str:
    """
    Generate a human-readable description of the full constraint library
    for inclusion in LLM system prompts.
    """
    lines = [
        "# Exam Scheduling Constraint Library",
        "",
        "You can ONLY set parameters from this library. Each parameter has a code,",
        "description, valid type, range, and default value.",
        "",
    ]

    for category_name, category_label in [
        ("SOLVER_PARAM", "Solver Parameters"),
        ("SOFT_WEIGHT", "Soft Constraint Weights"),
        ("SCOPE_FILTER", "Scope Filters (per-department/year overrides)"),
    ]:
        blueprints = get_blueprints_by_category(category_name)
        if not blueprints:
            continue

        lines.append(f"## {category_label}")
        lines.append("")

        for bp in blueprints:
            schema = bp["param_schema"]
            lines.append(f"### {bp['code']}")
            lines.append(f"  Description: {bp['description']}")
            lines.append(f"  Type: {schema['type']}")
            if "minimum" in schema:
                lines.append(f"  Range: {schema['minimum']} – {schema['maximum']}")
            if "default" in schema:
                lines.append(f"  Default: {schema['default']}")
            if "examples" in schema:
                lines.append("  Examples:")
                for ex in schema["examples"]:
                    lines.append(f"    \"{ex['input']}\" → {ex['value']}")
            lines.append("")

    return "\n".join(lines)
