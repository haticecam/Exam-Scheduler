"""
LLM Feedback Service for Infeasibility Diagnosis.

When the Gurobi solver returns INFEASIBLE, this service takes the IIS
diagnostics and uses GPT-4o to:
  1. Explain WHY the schedule is infeasible in plain English
  2. Propose specific, minimal parameter relaxations from the static library
  3. Rank suggestions from least to most disruptive

The LLM can ONLY suggest changes to parameters in the constraint library —
it cannot propose new constraints or modifications to hard constraints.
"""

import json
import logging
import os
from openai import OpenAI

from .constraint_library import generate_llm_context, get_blueprint_map

logger = logging.getLogger(__name__)


DIAGNOSIS_FUNCTION = {
    "name": "diagnose_infeasibility",
    "description": (
        "Analyze solver infeasibility diagnostics and propose minimal "
        "parameter relaxations to achieve feasibility."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "explanation": {
                "type": "string",
                "description": (
                    "A clear, non-technical explanation of why the schedule "
                    "is infeasible. Written for a university administrator, "
                    "not a mathematician. 2-4 sentences."
                ),
            },
            "root_causes": {
                "type": "array",
                "description": "The identified root causes of infeasibility, ranked by likelihood.",
                "items": {
                    "type": "object",
                    "properties": {
                        "cause": {
                            "type": "string",
                            "description": "Brief description of the root cause.",
                        },
                        "constraint_type": {
                            "type": "string",
                            "description": "Which IIS constraint group this relates to (hard, cap, room_busy, no_btb, one_start).",
                        },
                        "severity": {
                            "type": "string",
                            "enum": ["high", "medium", "low"],
                            "description": "How much this contributes to infeasibility.",
                        },
                    },
                    "required": ["cause", "constraint_type", "severity"],
                },
            },
            "suggestions": {
                "type": "array",
                "description": (
                    "Proposed parameter changes to resolve infeasibility, "
                    "ordered from LEAST disruptive to most disruptive."
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "code": {
                            "type": "string",
                            "description": "The blueprint code from the constraint library.",
                        },
                        "current_value": {
                            "description": "The current value of this parameter.",
                        },
                        "suggested_value": {
                            "description": "The proposed new value.",
                        },
                        "reason": {
                            "type": "string",
                            "description": "Why this change would help resolve infeasibility.",
                        },
                        "impact": {
                            "type": "string",
                            "description": "What trade-off this change introduces (e.g., 'longer exam period').",
                        },
                        "priority": {
                            "type": "integer",
                            "description": "1 = try first (least disruptive), 2 = try second, etc.",
                        },
                    },
                    "required": ["code", "suggested_value", "reason", "impact", "priority"],
                },
            },
            "combined_recommendation": {
                "type": "string",
                "description": (
                    "A single recommended action plan combining the most "
                    "effective suggestions. 1-2 sentences, actionable."
                ),
            },
        },
        "required": ["explanation", "root_causes", "suggestions", "combined_recommendation"],
    },
}


def _build_diagnosis_prompt(diagnostics: dict, parameters: dict) -> str:
    library_context = generate_llm_context()

    return f"""You are an AI assistant for a university exam scheduling system.
The Gurobi MILP solver has returned INFEASIBLE — meaning it could not find
any valid exam schedule with the given constraints and parameters.

Your job is to:
1. Analyze the IIS (Irreducible Inconsistent Subsystem) diagnostics
2. Explain the problem in plain, non-technical English
3. Propose MINIMAL parameter relaxations from the constraint library
4. Order suggestions from least disruptive to most disruptive

CRITICAL RULES:
1. You can ONLY suggest changes to parameters in the constraint library below.
2. NEVER suggest removing or weakening hard constraints entirely.
3. Prefer small incremental changes over dramatic ones.
4. If multiple small changes together would work, suggest that combination.
5. Always explain the trade-off of each suggestion.

{library_context}

The parameters that were used for this failed run:
{json.dumps(parameters, indent=2)}

Analyze the diagnostics below and call the diagnose_infeasibility function."""


class LLMFeedbackService:
    """
    Interprets solver infeasibility diagnostics using GPT-4o and
    proposes parameter relaxations from the constraint library.
    """

    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError(
                "OPENAI_API_KEY environment variable is not set. "
                "Please add it to your .env file."
            )
        self.client = OpenAI(api_key=api_key)
        self.model = os.getenv("OPENAI_MODEL", "gpt-4o")

    def diagnose(self, solution) -> dict:
        """
        Analyze an infeasible GeneratedSolution and return LLM-powered
        diagnosis with suggested fixes.

        Args:
            solution: A GeneratedSolution instance with status INFEASIBLE
                and solver_metadata containing diagnostics.

        Returns:
            {
                "success": True/False,
                "explanation": "...",
                "root_causes": [...],
                "suggestions": [...],
                "combined_recommendation": "...",
                "error": None or "error message"
            }
        """
        metadata = solution.solver_metadata or {}
        diagnostics = metadata.get("diagnostics", {})
        parameters = solution.parameters or {}

        if not diagnostics:
            return {
                "success": False,
                "explanation": "",
                "root_causes": [],
                "suggestions": [],
                "combined_recommendation": "",
                "error": "No diagnostics data available for this solution.",
            }

        system_prompt = _build_diagnosis_prompt(diagnostics, parameters)

        user_message = f"""The solver returned INFEASIBLE. Here are the diagnostics:

Summary: {diagnostics.get('summary', 'No summary available')}

Model Statistics:
{json.dumps(diagnostics.get('model_stats', {}), indent=2)}

IIS Constraint Groups (conflicting constraints):
{json.dumps(diagnostics.get('iis_constraints', []), indent=2)}

Current Recommendations (from solver):
{json.dumps(diagnostics.get('recommendations', []), indent=2)}

IIS Error (if any): {diagnostics.get('iis_error', 'None')}

Please analyze this and propose minimal parameter changes to achieve feasibility."""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                functions=[DIAGNOSIS_FUNCTION],
                function_call={"name": "diagnose_infeasibility"},
                temperature=0.2,
            )
        except Exception as e:
            logger.error(f"OpenAI API call failed during diagnosis: {e}")
            return {
                "success": False,
                "explanation": "",
                "root_causes": [],
                "suggestions": [],
                "combined_recommendation": "",
                "error": f"LLM API call failed: {str(e)}",
            }

        message = response.choices[0].message

        if not message.function_call:
            return {
                "success": False,
                "explanation": message.content or "",
                "root_causes": [],
                "suggestions": [],
                "combined_recommendation": "",
                "error": "LLM did not return structured diagnosis.",
            }

        try:
            result = json.loads(message.function_call.arguments)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse LLM diagnosis response: {e}")
            return {
                "success": False,
                "explanation": "",
                "root_causes": [],
                "suggestions": [],
                "combined_recommendation": "",
                "error": f"Failed to parse LLM response: {str(e)}",
            }

        blueprint_map = get_blueprint_map()
        valid_suggestions = []
        for suggestion in result.get("suggestions", []):
            if suggestion.get("code") in blueprint_map:
                valid_suggestions.append(suggestion)
            else:
                logger.warning(f"LLM suggested unknown code: {suggestion.get('code')}")

        return {
            "success": True,
            "explanation": result.get("explanation", ""),
            "root_causes": result.get("root_causes", []),
            "suggestions": valid_suggestions,
            "combined_recommendation": result.get("combined_recommendation", ""),
            "error": None,
        }
