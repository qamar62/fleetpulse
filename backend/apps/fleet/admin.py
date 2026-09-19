from django.contrib import admin
from django.utils.html import format_html

from .models import (
    AuditLog,
    DailyEarning,
    Driver,
    Expense,
    ImportBatch,
    ImportRowIssue,
    PayrollSettlement,
    Vehicle,
)


class VehicleInline(admin.TabularInline):
    model = Vehicle
    extra = 0
    fields = ("make", "model", "plate_number", "status")
    show_change_link = True


@admin.register(Driver)
class DriverAdmin(admin.ModelAdmin):
    list_display = ("name", "phone", "status", "joined_at", "vehicle_list")
    list_filter = ("status", "joined_at")
    search_fields = ("name", "phone", "email", "license_number")
    inlines = [VehicleInline]
    date_hierarchy = "joined_at"

    @admin.display(description="Vehicles")
    def vehicle_list(self, obj):
        return ", ".join(v.plate_number for v in obj.vehicles.all()) or "—"


@admin.register(Vehicle)
class VehicleAdmin(admin.ModelAdmin):
    list_display = ("plate_number", "make", "model", "year", "status", "assigned_driver")
    list_filter = ("status", "make")
    search_fields = ("plate_number", "make", "model", "assigned_driver__name")
    autocomplete_fields = ("assigned_driver",)


@admin.register(DailyEarning)
class DailyEarningAdmin(admin.ModelAdmin):
    list_display = (
        "date", "driver", "vehicle", "careem", "uber", "bolt", "yango", "cash", "total_display",
    )
    list_filter = ("date", "driver", "vehicle")
    search_fields = ("driver__name", "vehicle__plate_number", "notes")
    autocomplete_fields = ("driver", "vehicle")
    date_hierarchy = "date"
    readonly_fields = ("total_income", "created_at", "updated_at")
    list_select_related = ("driver", "vehicle")

    @admin.display(description="Total income", ordering="total_income")
    def total_display(self, obj):
        return format_html("<strong>{}</strong>", obj.total_income)


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ("date", "category", "amount", "driver", "vehicle", "payment_method")
    list_filter = ("category", "payment_method", "date")
    search_fields = ("description", "reference", "driver__name", "vehicle__plate_number")
    autocomplete_fields = ("driver", "vehicle")
    date_hierarchy = "date"
    list_select_related = ("driver", "vehicle")


@admin.register(PayrollSettlement)
class PayrollSettlementAdmin(admin.ModelAdmin):
    list_display = (
        "period", "driver", "salary", "advance", "other_deductions", "rent",
        "paid_amount", "balance",
    )
    list_filter = ("period", "driver")
    search_fields = ("driver__name", "notes")
    autocomplete_fields = ("driver",)
    readonly_fields = ("balance", "created_at", "updated_at")
    date_hierarchy = "period"


class ImportRowIssueInline(admin.TabularInline):
    model = ImportRowIssue
    extra = 0
    can_delete = False
    readonly_fields = ("row_number", "column", "level", "code", "message")


@admin.register(ImportBatch)
class ImportBatchAdmin(admin.ModelAdmin):
    list_display = (
        "filename", "status", "total_rows", "imported_rows", "updated_rows",
        "failed_rows", "created_at",
    )
    list_filter = ("status", "created_at")
    search_fields = ("filename",)
    readonly_fields = tuple(
        field.name for field in ImportBatch._meta.fields if field.name != "id"
    )
    inlines = [ImportRowIssueInline]


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "actor", "action", "model_name", "object_label")
    list_filter = ("action", "model_name", "created_at")
    search_fields = ("object_label", "model_name")
    readonly_fields = tuple(field.name for field in AuditLog._meta.fields)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


admin.site.site_header = "FleetPulse administration"
admin.site.site_title = "FleetPulse"
admin.site.index_title = "Driver income & fleet finance"
