"""Lightweight audit trail mixin for the financial viewsets."""

from __future__ import annotations

from decimal import Decimal

from .models import AuditLog


def _serialise(value):
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "pk"):
        return value.pk
    return value


class AuditedModelMixin:
    """Records create / update / delete against AuditLog.

    Set ``audit_fields`` on the viewset to limit what is captured; by default
    the validated payload is stored.
    """

    audit_fields: tuple[str, ...] | None = None

    def _log(self, action: str, instance, changes: dict | None = None) -> None:
        user = getattr(self.request, "user", None)
        AuditLog.objects.create(
            actor=user if getattr(user, "is_authenticated", False) else None,
            action=action,
            model_name=instance.__class__.__name__,
            object_id=str(getattr(instance, "pk", "") or ""),
            object_label=str(instance)[:255],
            changes={key: _serialise(value) for key, value in (changes or {}).items()},
        )

    def perform_create(self, serializer):
        instance = serializer.save()
        self._log(AuditLog.Action.CREATE, instance, serializer.validated_data)

    def perform_update(self, serializer):
        before = {
            field: getattr(serializer.instance, field, None)
            for field in serializer.validated_data
        }
        instance = serializer.save()
        changes = {
            field: {"from": _serialise(before.get(field)), "to": _serialise(value)}
            for field, value in serializer.validated_data.items()
            if _serialise(before.get(field)) != _serialise(value)
        }
        self._log(AuditLog.Action.UPDATE, instance, changes)

    def perform_destroy(self, instance):
        self._log(AuditLog.Action.DELETE, instance)
        instance.delete()
