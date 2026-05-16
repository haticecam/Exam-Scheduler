import datetime
import logging

from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema, inline_serializer, OpenApiExample
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import AcademicUnit, GeneratedSolution
from ..serializers import LLMConfigureRequestSerializer, LLMConfirmRequestSerializer, LLMDiagnoseRequestSerializer

logger = logging.getLogger(__name__)


class LLMConfigureView(APIView):
    @extend_schema(
        tags=['LLM Integration'],
        request=LLMConfigureRequestSerializer,
        responses={
            200: inline_serializer(
                name='LLMConfigureResponse',
                fields={
                    'success': serializers.BooleanField(),
                    'summary': serializers.CharField(),
                    'changes': serializers.ListField(child=serializers.DictField()),
                    'warnings': serializers.ListField(child=serializers.CharField()),
                    'proposed_params': serializers.DictField(),
                    'optimizer_kwargs': serializers.DictField(),
                    'weight_config': serializers.DictField(),
                },
            ),
            422: inline_serializer(
                name='LLMConfigureErrorResponse',
                fields={
                    'success': serializers.BooleanField(default=False),
                    'error': serializers.CharField(),
                    'summary': serializers.CharField(),
                    'warnings': serializers.ListField(child=serializers.CharField()),
                },
            ),
            503: inline_serializer(
                name='LLMServiceUnavailable',
                fields={'error': serializers.CharField()},
            ),
        },
        description=(
            'Send a natural language scheduling preference to GPT-4o.\n\n'
            'The LLM maps the request to validated constraint parameters from the static library. '
            'Returns proposed changes for admin review — does **not** trigger the optimizer.\n\n'
            '**Example messages:**\n'
            '- "Spread exams over 10 days with 3 slots per day"\n'
            '- "Increase the penalty for mandatory course conflicts"\n'
            '- "No back-to-back exams, start at 09:00"'
        ),
        examples=[
            OpenApiExample(
                'Simple scheduling request',
                value={
                    'message': 'Spread exams over 10 days with 3 slots per day, starting at 09:00',
                    'term_id': 'b976d91a-1828-46d5-ab13-c52216f8b030',
                },
                request_only=True,
            ),
        ],
    )
    def post(self, request):
        serializer = LLMConfigureRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user_message = data["message"]
        conversation_history = data.get("conversation_history", [])

        from ..services.constraint_library import get_blueprint_map, get_optimizer_defaults, get_weight_defaults
        current_params = {}
        defaults = get_optimizer_defaults()
        weight_defaults = get_weight_defaults()
        blueprint_map = get_blueprint_map()

        for code, bp in blueprint_map.items():
            schema = bp["param_schema"]
            if bp["category"] == "SOLVER_PARAM":
                kwarg = schema["optimizer_kwarg"]
                if kwarg in defaults:
                    current_params[code] = defaults[kwarg]
            elif bp["category"] == "SOFT_WEIGHT":
                wkey = schema["weight_key"]
                if wkey in weight_defaults:
                    current_params[code] = weight_defaults[wkey]

        try:
            from ..services.llm_mapper import LLMMapperService
            mapper = LLMMapperService()
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        department_names = list(
            AcademicUnit.objects.values_list('name', flat=True).order_by('name')
        )

        result = mapper.map_preferences(
            user_input=user_message,
            current_params=current_params,
            conversation_history=conversation_history,
            department_names=department_names or None,
        )

        if not result["success"]:
            return Response(
                {
                    "success": False,
                    "error": result["error"],
                    "summary": result.get("summary", ""),
                    "warnings": result.get("warnings", []),
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        return Response({
            "success": True,
            "is_scheduling_request": result.get("is_scheduling_request", True),
            "summary": result["summary"],
            "changes": result["changes"],
            "warnings": result["warnings"],
            "proposed_params": result["proposed_params"],
            "optimizer_kwargs": result["optimizer_kwargs"],
            "weight_config": result["weight_config"],
        })


class LLMConfirmView(APIView):
    @extend_schema(
        tags=['LLM Integration'],
        request=LLMConfirmRequestSerializer,
        responses={
            202: inline_serializer(
                name='LLMConfirmResponse',
                fields={
                    'message': serializers.CharField(),
                    'solution_id': serializers.UUIDField(),
                    'parameters_applied': serializers.DictField(),
                    'weight_config_applied': serializers.DictField(),
                },
            ),
            400: inline_serializer(
                name='LLMConfirmErrorResponse',
                fields={
                    'error': serializers.CharField(),
                    'details': serializers.DictField(),
                },
            ),
        },
        description=(
            'Confirm the proposed parameters from /api/llm/configure/ and trigger the optimizer.\n\n'
            'Pass the `proposed_params` dict returned by the configure step. '
            'The system validates them again, creates a GeneratedSolution, '
            'and dispatches a Celery task to run Gurobi.\n\n'
            'Poll /api/optimize/{solution_id}/result/ for completion.'
        ),
    )
    def post(self, request):
        serializer = LLMConfirmRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        term_id = data["term_id"]
        proposed_params = data["proposed_params"]

        from ..services.constraint_library import build_optimizer_kwargs, build_weight_config, validate_all_parameters

        is_valid, errors = validate_all_parameters(proposed_params)
        if not is_valid:
            return Response(
                {"error": "Parameter validation failed", "details": errors},
                status=status.HTTP_400_BAD_REQUEST,
            )

        optimizer_kwargs = build_optimizer_kwargs(proposed_params)
        weight_config = build_weight_config(proposed_params)

        solution = GeneratedSolution.objects.create(
            term_id=term_id,
            name=data.get("name", f"LLM-Gen-{datetime.date.today()}"),
            parameters={
                **optimizer_kwargs,
                "weight_config": weight_config,
                "llm_proposed_params": proposed_params,
            },
            status="PENDING",
        )

        from ..tasks import run_optimizer_task
        run_optimizer_task.delay(str(solution.id))

        return Response(
            {
                "message": "Optimization started with LLM-configured parameters.",
                "solution_id": str(solution.id),
                "parameters_applied": optimizer_kwargs,
                "weight_config_applied": weight_config,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class LLMLibraryView(APIView):
    @extend_schema(
        tags=['LLM Integration'],
        responses={
            200: inline_serializer(
                name='LLMLibraryResponse',
                fields={
                    'source': serializers.ChoiceField(choices=['database', 'in_memory']),
                    'count': serializers.IntegerField(),
                    'blueprints': serializers.ListField(child=serializers.DictField()),
                },
            ),
        },
        description=(
            'Returns the full static constraint library.\n\n'
            'Each blueprint includes its code, description, category, and param_schema. '
            'The LLM uses this library to map natural language to valid parameters.'
        ),
    )
    def get(self, request):
        from ..models import ConstraintBlueprint
        blueprints = ConstraintBlueprint.objects.all()

        if not blueprints.exists():
            from ..services.constraint_library import BLUEPRINT_DEFINITIONS
            return Response({
                "source": "in_memory",
                "count": len(BLUEPRINT_DEFINITIONS),
                "blueprints": BLUEPRINT_DEFINITIONS,
            })

        result = [
            {"code": bp.code, "description": bp.description, "param_schema": bp.param_schema}
            for bp in blueprints
        ]

        return Response({
            "source": "database",
            "count": len(result),
            "blueprints": result,
        })


class LLMDiagnoseView(APIView):
    @extend_schema(
        tags=['LLM Integration'],
        request=LLMDiagnoseRequestSerializer,
        responses={
            200: inline_serializer(
                name='LLMDiagnoseResponse',
                fields={
                    'success': serializers.BooleanField(),
                    'solution_id': serializers.UUIDField(),
                    'parameters_used': serializers.DictField(),
                    'explanation': serializers.CharField(),
                    'root_causes': serializers.ListField(child=serializers.DictField()),
                    'suggestions': serializers.ListField(child=serializers.DictField()),
                    'combined_recommendation': serializers.CharField(),
                },
            ),
            400: inline_serializer(
                name='LLMDiagnoseNotInfeasible',
                fields={
                    'error': serializers.CharField(),
                    'solution_id': serializers.UUIDField(),
                    'status': serializers.CharField(),
                },
            ),
            422: inline_serializer(
                name='LLMDiagnoseErrorResponse',
                fields={
                    'success': serializers.BooleanField(default=False),
                    'error': serializers.CharField(),
                    'solution_id': serializers.UUIDField(),
                },
            ),
        },
        description=(
            'Diagnose why an optimizer run was INFEASIBLE.\n\n'
            'Pass the `solution_id` of a failed run. GPT-4o analyzes the Gurobi IIS '
            'diagnostics and returns a plain-English explanation, ranked root causes, '
            'actionable suggestions, and a combined recommendation.\n\n'
            'Feed the suggestions back into /api/llm/configure/ or /api/llm/confirm/ to retry.'
        ),
        examples=[
            OpenApiExample(
                'Diagnose an infeasible solution',
                value={'solution_id': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'},
                request_only=True,
            ),
        ],
    )
    def post(self, request):
        serializer = LLMDiagnoseRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        solution_id = data["solution_id"]
        solution = get_object_or_404(GeneratedSolution, id=solution_id)

        if solution.status.upper() != "INFEASIBLE":
            return Response(
                {
                    "error": f"Solution status is '{solution.status}', not INFEASIBLE. "
                             "Diagnosis is only available for infeasible solutions.",
                    "solution_id": str(solution.id),
                    "status": solution.status,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            from ..services.llm_feedback import LLMFeedbackService
            feedback = LLMFeedbackService()
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        result = feedback.diagnose(solution)

        if not result["success"]:
            return Response(
                {
                    "success": False,
                    "error": result["error"],
                    "solution_id": str(solution.id),
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        return Response({
            "success": True,
            "solution_id": str(solution.id),
            "parameters_used": solution.parameters,
            "explanation": result["explanation"],
            "root_causes": result["root_causes"],
            "suggestions": result["suggestions"],
            "combined_recommendation": result["combined_recommendation"],
        })
