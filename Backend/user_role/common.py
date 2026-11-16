"""Helpers shared by the User role modules (events, event_tabs, payments)."""
import logging
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException

from auth_tokens import AuthenticatedUser
from event_management import supabase

logger = logging.getLogger("user_role")

# Login roles that may use the /user endpoints (compared case-insensitively).
USER_ROLES = {"user", "users"}

# event_status values a User may see. "Publish" is the legacy spelling that the
# rest of the code base still tolerates.
VISIBLE_STATUSES = ["Published", "Publish", "Completed"]

EVENT_COLUMNS = "event_id, name, type, start_date, end_date, event_status"

# registration.status values written by this module
STATUS_CONFIRMED = "Confirmed"
STATUS_PENDING = "Pending"

# PostgREST / Postgres error codes meaning "that table or column does not exist (yet)"
MISSING_OBJECT_CODES = {"42P01", "42703", "PGRST204", "PGRST205"}


def require_user(user: AuthenticatedUser) -> None:
    if user.role.strip().casefold() not in USER_ROLES:
        raise HTTPException(status_code=403, detail="You are not allowed to perform this action")


def parse_date(value) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def phase_of(start: date | None, end: date | None, status: str) -> str:
    """Upcoming / Ongoing / Ended, worked out from the dates (never written to the DB)."""
    if status.strip().casefold() == "completed":
        return "Ended"
    today = date.today()
    if end and end < today:
        return "Ended"
    if start and start > today:
        return "Upcoming"
    return "Ongoing"


def full_name(person: dict) -> str:
    return " ".join(p for p in (person.get("first_name"), person.get("last_name")) if p)


def status_label(status: str | None) -> str:
    return "Completed" if (status or "").strip().casefold() == "completed" else "Published"


def is_completed(event: dict) -> bool:
    return status_label(event.get("event_status")) == "Completed"


def event_phase(event: dict) -> str:
    return phase_of(
        parse_date(event.get("start_date")),
        parse_date(event.get("end_date")),
        event.get("event_status") or "",
    )


def registration_open(event: dict) -> bool:
    """Registration is open while the event is Published and has not ended."""
    return status_label(event.get("event_status")) == "Published" and event_phase(event) != "Ended"


def error_code(error: Exception) -> str:
    return str(getattr(error, "code", "") or "")


def is_missing_object(error: Exception) -> bool:
    return error_code(error) in MISSING_OBJECT_CODES


def fee_json(fee: Decimal | None):
    """Fee as a JSON number (None = not configured)."""
    if fee is None:
        return None
    return int(fee) if fee == fee.to_integral_value() else float(fee)


def read_fee(event_id: int) -> Decimal | None:
    """The event's registration fee. 0 means free.

    Returns None when the fee cannot be trusted: the event.fee column does not exist yet
    (migration not run) or the stored value is invalid. Callers must not treat None as free.
    """
    try:
        rows = (
            supabase.table("event")
            .select("fee")
            .eq("event_id", event_id)
            .limit(1)
            .execute()
            .data
        )
    except Exception as error:
        if is_missing_object(error):
            logger.warning("event.fee column is missing - run the feature 2 SQL migration")
            return None
        raise

    value = rows[0].get("fee") if rows else None
    if value is None:
        return None  # never guess "free"
    try:
        fee = Decimal(str(value))
    except InvalidOperation:
        logger.warning("event %s has an invalid fee value: %r", event_id, value)
        return None
    return fee if fee >= 0 else None


def get_visible_event(event_id: int) -> dict | None:
    """A non-deleted event that a User is allowed to see, or None."""
    events = (
        supabase.table("event")
        .select(EVENT_COLUMNS)
        .eq("event_id", event_id)
        .in_("event_status", VISIBLE_STATUSES)
        .eq("is_delete", False)
        .limit(1)
        .execute()
        .data
    )
    return events[0] if events else None


def visible_event_or_404(event_id: int) -> dict:
    event = get_visible_event(event_id)
    if not event:
        # Same answer for "does not exist" and "not published yet".
        raise HTTPException(status_code=404, detail="Event not found")
    return event


def my_registration(event_id: int, person_id: int) -> dict | None:
    """The signed-in user's live registration for an event, or None."""
    rows = (
        supabase.table("registration")
        .select("registration_id, status, fee_paid")
        .eq("event_id", event_id)
        .eq("person_id", person_id)
        .eq("is_delete", False)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None
