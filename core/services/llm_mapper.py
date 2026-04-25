"""
LLM Mapper Service for Exam Scheduling.

Takes natural language administrator preferences and maps them to
validated parameters from the static constraint library.

Uses OpenAI's structured output (function calling) to guarantee
the response matches the constraint library schema.

Flow:
    1. Admin types: "Spread exams over more days, prevent back-to-back"
    2. This service sends it to GPT-4o with the constraint library as context
    3. GPT-4o returns structured JSON: {"PARAM_EXAM_DAYS": 7, "PARAM_NO_BACK_TO_BACK": true}
    4. We validate against the library and return proposed changes + explanation
"""

import json
import logging
import os
from openai import OpenAI

from .constraint_library import (
    generate_llm_context,
    validate_all_parameters,
    build_optimizer_kwargs,
    build_weight_config,
    get_blueprint_map,
    get_optimizer_defaults,
    get_weight_defaults,
)

logger = logging.getLogger(__name__)


PARAMETER_MAPPING_FUNCTION = {
    "name": "set_scheduling_parameters",
    "description": (
        "Map the administrator's natural language preferences to concrete "
        "scheduling parameters from the constraint library. Only set parameters "
        "that the user explicitly or implicitly requested to change. "
        "Do NOT set parameters the user didn't mention. "
        "If the input is not related to exam scheduling at all, set "
        "is_scheduling_request=false and explain why in rejection_reason."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "is_scheduling_request": {
                "type": "boolean",
                "description": (
                    "Set to false if the user's input has nothing to do with "
                    "exam scheduling (e.g. random text, unrelated questions, "
                    "incoherent sentences). Set to true for any scheduling-related "
                    "request, even vague ones like 'make it better'."
                ),
            },
            "rejection_reason": {
                "type": "string",
                "description": (
                    "Required when is_scheduling_request=false. A 1-2 sentence "
                    "explanation in the same language as the user's input, telling "
                    "them their message wasn't about scheduling and what kind of "
                    "input is expected."
                ),
            },
            "changes": {
                "type": "array",
                "description": "List of parameter changes to apply. Empty when is_scheduling_request=false.",
                "items": {
                    "type": "object",
                    "properties": {
                        "code": {
                            "type": "string",
                            "description": "The blueprint code from the constraint library (e.g., PARAM_HARD_THRESHOLD).",
                        },
                        "value": {
                            "description": "The new value for this parameter. Must match the type and range defined in the library.",
                        },
                        "reason": {
                            "type": "string",
                            "description": "Brief explanation of why this parameter was changed based on the user's input.",
                        },
                    },
                    "required": ["code", "value", "reason"],
                },
            },
            "summary": {
                "type": "string",
                "description": (
                    "A 1-3 sentence human-readable summary of all proposed changes, "
                    "written for a non-technical administrator. "
                    "Empty string when is_scheduling_request=false."
                ),
            },
            "warnings": {
                "type": "array",
                "description": "Any warnings about potential issues (e.g., infeasibility risk).",
                "items": {"type": "string"},
            },
        },
        "required": ["is_scheduling_request", "changes", "summary"],
    },
}


def _build_system_prompt(current_params: dict = None) -> str:
    library_context = generate_llm_context()

    current_state = ""
    if current_params:
        current_state = (
            "\n\n## Current Parameter Values\n"
            "These are the parameters currently in effect. Only change what the user asks for.\n\n"
        )
        for code, value in current_params.items():
            current_state += f"  {code} = {value}\n"

    return f"""You are an AI assistant for a university exam scheduling system.
Your job is to translate natural language administrator preferences into
concrete scheduling parameters.

CRITICAL RULES:
1. You can ONLY use parameter codes from the constraint library below.
2. You MUST respect the type, minimum, and maximum for each parameter.
3. Only change parameters the user explicitly or implicitly asks to change.
4. If the user's request is ambiguous, pick a reasonable middle-ground value
   and explain your reasoning.
5. If the user asks for something impossible (e.g., "schedule all exams in 1 day"
   when minimum exam_days is 3), set the closest valid value and warn them.
6. Never invent new parameter codes or constraint types.
7. If the user's input is completely unrelated to exam scheduling (random text,
   questions about unrelated topics, greetings with no scheduling content,
   or incoherent sentences), set is_scheduling_request=false and provide a
   helpful rejection_reason in the same language as the user. Do NOT set any
   changes in this case — return an empty changes array.

{library_context}
{current_state}

When the user gives you their preferences, call the set_scheduling_parameters
function with the appropriate changes."""


class LLMMapperService:
    """
    Maps natural language scheduling preferences to validated parameters.
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

    def map_preferences(
        self,
        user_input: str,
        current_params: dict = None,
        conversation_history: list = None,
    ) -> dict:
        """
        Take natural language input and return validated parameter changes.

        Returns:
            {
                "success": True/False,
                "is_scheduling_request": True/False,  # False = input was not scheduling-related
                "changes": [...],
                "summary": "...",
                "warnings": [...],
                "proposed_params": {...},
                "optimizer_kwargs": {...},
                "weight_config": {...},
                "error": None or "error message"
            }
        """
        system_prompt = _build_system_prompt(current_params)

        messages = [{"role": "system", "content": system_prompt}]
        if conversation_history:
            messages.extend(conversation_history)
        messages.append({"role": "user", "content": user_input})

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                functions=[PARAMETER_MAPPING_FUNCTION],
                function_call={"name": "set_scheduling_parameters"},
                temperature=0.1,
            )
        except Exception as e:
            logger.error(f"OpenAI API call failed: {e}")
            return {
                "success": False,
                "changes": [],
                "summary": "",
                "warnings": [],
                "proposed_params": {},
                "optimizer_kwargs": {},
                "weight_config": {},
                "error": f"LLM API call failed: {str(e)}",
            }

        message = response.choices[0].message

        if not message.function_call:
            logger.warning("LLM did not return a function call")
            return {
                "success": False,
                "changes": [],
                "summary": message.content or "The LLM could not interpret your request.",
                "warnings": [],
                "proposed_params": {},
                "optimizer_kwargs": {},
                "weight_config": {},
                "error": "LLM did not return structured parameters.",
            }

        try:
            llm_output = json.loads(message.function_call.arguments)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse LLM response: {e}")
            return {
                "success": False,
                "changes": [],
                "summary": "",
                "warnings": [],
                "proposed_params": {},
                "optimizer_kwargs": {},
                "weight_config": {},
                "error": f"Failed to parse LLM response: {str(e)}",
            }

        # Rejection: input was not scheduling-related
        if not llm_output.get("is_scheduling_request", True):
            rejection_reason = llm_output.get(
                "rejection_reason",
                "Bu mesaj sınav çizelgeleme ile ilgili görünmüyor. "
                "Lütfen optimizer parametrelerini açıklayan bir mesaj girin.",
            )
            return {
                "success": True,
                "is_scheduling_request": False,
                "changes": [],
                "summary": rejection_reason,
                "warnings": [],
                "proposed_params": {},
                "optimizer_kwargs": {},
                "weight_config": {},
                "error": None,
            }

        changes = llm_output.get("changes", [])
        summary = llm_output.get("summary", "")
        warnings = llm_output.get("warnings", [])

        proposed_params = {change["code"]: change["value"] for change in changes}

        is_valid, validation_errors = validate_all_parameters(proposed_params)
        if not is_valid:
            warnings.extend([f"Validation error: {err}" for err in validation_errors])

            valid_params = {}
            valid_changes = []
            for change in changes:
                code = change["code"]
                single_valid, _ = validate_all_parameters({code: change["value"]})
                if single_valid:
                    valid_params[code] = change["value"]
                    valid_changes.append(change)

            proposed_params = valid_params
            changes = valid_changes

            if not proposed_params:
                return {
                    "success": False,
                    "changes": changes,
                    "summary": summary,
                    "warnings": warnings,
                    "proposed_params": {},
                    "optimizer_kwargs": {},
                    "weight_config": {},
                    "error": "All proposed parameters failed validation.",
                }

        optimizer_kwargs = build_optimizer_kwargs(proposed_params)
        weight_config = build_weight_config(proposed_params)

        return {
            "success": True,
            "is_scheduling_request": True,
            "changes": changes,
            "summary": summary,
            "warnings": warnings,
            "proposed_params": proposed_params,
            "optimizer_kwargs": optimizer_kwargs,
            "weight_config": weight_config,
            "error": None,
        }
