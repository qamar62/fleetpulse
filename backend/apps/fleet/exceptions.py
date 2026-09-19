from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


def api_exception_handler(exc, context):
    """Turn database-level failures into clean 400s instead of 500s."""
    if isinstance(exc, DjangoValidationError):
        return Response(
            {"detail": "Validation failed.", "errors": exc.message_dict
             if hasattr(exc, "message_dict") else exc.messages},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if isinstance(exc, IntegrityError):
        message = str(exc)
        if "unique_daily_driver_vehicle" in message:
            detail = "An earning entry already exists for this date, driver and vehicle."
        elif "unique_driver_payroll_period" in message:
            detail = "A settlement already exists for this driver and period."
        elif "plate_number" in message:
            detail = "A vehicle with this plate number already exists."
        else:
            detail = "This change conflicts with an existing record."
        return Response({"detail": detail}, status=status.HTTP_400_BAD_REQUEST)

    return drf_exception_handler(exc, context)
