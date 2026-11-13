"""User role - events catalogue (feature 1) and event registration (feature 2).

Endpoints (all need a signed-in User):
    GET  /user/me                          - the signed-in user's name
    GET  /user/events                      - published events (upcoming first, then past)
    GET  /user/events/{event_id}           - one event with its sessions, fee and registration state
    POST /user/events/{event_id}/register  - register the signed-in user for the event

Registration rules:
    * Only a Published event that has not ended can be registered for.
    * A user can register once per event (the database also enforces this).
    * Free event (fee = 0)  -> registration is "Confirmed" straight away.
    * Paid event  (fee > 0) -> registration is "Pending" until the payment is verified
      (payment itself is a later feature).
    * The person registered is always the signed-in user - nothing in the request can change that.
"""
import logging
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException

from auth_tokens import AuthenticatedUser, get_current_user
from event_management import supabase

logger = logging.getLogger("user_role")

router = APIRouter(prefix="/user", tags=["User"])

# Login roles that may use these endpoints (compared case-insensitively).
USER_ROLES = {"user", "users"}

# event_status values a User may see. "Publish" is the legacy spelling that the
# rest of the code base still tolerates.
VISIBLE_STATUSES = ["Published", "Publish", "Completed"]

EVENT_COLUMNS = "event_id, name, type, start_date, end_date, event_status"

# registration.status values written by this module
STATUS_CONFIRMED = "Confirmed"
STATUS_PENDING = "Pending"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _require_user(user: AuthenticatedUser) -> None:
    if user.role.strip().casefold() not in USER_ROLES:
        raise HTTPException(status_code=403, detail="You are not allowed to perform this action")


def _parse_date(value) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _phase(start: date | None, end: date | None, status: str) -> str:
    """Upcoming / Ongoing / Ended, worked out from the dates (never written to the DB)."""
    if status.strip().casefold() == "completed":
        return "Ended"
    today = date.today()
    if end and end < today:
        return "Ended"
    if start and start > today:
        return "Upcoming"
    return "Ongoing"


def _full_name(person: dict) -> str:
    return " ".join(p for p in (person.get("first_name"), person.get("last_name")) if p)


def _status_label(status: str | None) -> str:
    return "Completed" if (status or "").strip().casefold() == "completed" else "Published"


def _registration_open(event: dict) -> bool:
    """Registration is open while the event is Published and has not ended."""
    start = _parse_date(event.get("start_date"))
    end = _parse_date(event.get("end_date"))
    status = event.get("event_status") or ""
    return _status_label(status) == "Published" and _phase(start, end, status) != "Ended"


def _error_code(error: Exception) -> str:
    return str(getattr(error, "code", "") or "")


def _fee_json(fee: Decimal | None):
    """Fee as a JSON number (None = not configured)."""
    if fee is None:
        return None
    return int(fee) if fee == fee.to_integral_value() else float(fee)


def _read_fee(event_id: int) -> Decimal | None:
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
        if _error_code(error) in {"42703", "PGRST204"}:  # undefined column
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


def _get_visible_event(event_id: int) -> dict | None:
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


def _build_cards(events: list[dict], person_id: int) -> list[dict]:
    """Attach description, organisers and the caller's own registration to each event."""
    if not events:
        return []

    event_ids = [event["event_id"] for event in events]

    type_rows = (
        supabase.table("event_type")
        .select("event_id, category, description")
        .in_("event_id", event_ids)
        .eq("is_delete", False)
        .execute()
        .data
    )
    type_by_event = {row["event_id"]: row for row in type_rows}

    organizer_rows = (
        supabase.table("event_organizer")
        .select("event_id, person_id")
        .in_("event_id", event_ids)
        .eq("is_delete", False)
        .execute()
        .data
    )
    organizer_ids = list({row["person_id"] for row in organizer_rows})
    people_by_id: dict[int, dict] = {}
    if organizer_ids:
        # Only names are read - never email or phone.
        people = (
            supabase.table("person")
            .select("person_id, first_name, last_name")
            .in_("person_id", organizer_ids)
            .execute()
            .data
        )
        people_by_id = {person["person_id"]: person for person in people}

    organizers_by_event: dict[int, list[str]] = {}
    for row in organizer_rows:
        name = _full_name(people_by_id.get(row["person_id"], {}))
        if name:
            organizers_by_event.setdefault(row["event_id"], []).append(name)

    registration_rows = (
        supabase.table("registration")
        .select("event_id, status")
        .in_("event_id", event_ids)
        .eq("person_id", person_id)
        .eq("is_delete", False)
        .execute()
        .data
    )
    registration_by_event = {row["event_id"]: row for row in registration_rows}

    cards = []
    for event in events:
        event_id = event["event_id"]
        type_row = type_by_event.get(event_id, {})
        start = _parse_date(event.get("start_date"))
        end = _parse_date(event.get("end_date"))
        registration = registration_by_event.get(event_id)
        cards.append(
            {
                "event_id": event_id,
                "name": event.get("name") or "Untitled event",
                "type": type_row.get("category") or event.get("type") or "Event",
                "description": type_row.get("description") or "",
                "start_date": start.isoformat() if start else None,
                "end_date": end.isoformat() if end else None,
                "event_status": _status_label(event.get("event_status")),
                "phase": _phase(start, end, event.get("event_status") or ""),
                "organizers": organizers_by_event.get(event_id, []),
                "my_registration": {"status": registration["status"]} if registration else None,
            }
        )
    return cards


def _order_cards(cards: list[dict]) -> list[dict]:
    """Upcoming/ongoing events soonest first, then ended events newest first."""
    current = [card for card in cards if card["phase"] != "Ended"]
    ended = [card for card in cards if card["phase"] == "Ended"]
    current.sort(key=lambda card: card["start_date"] or "")
    ended.sort(key=lambda card: card["start_date"] or "", reverse=True)
    return current + ended


# ---------------------------------------------------------------------------
# endpoints
# ---------------------------------------------------------------------------

@router.get("/me")
def get_me(user: AuthenticatedUser = Depends(get_current_user)):
    _require_user(user)
    try:
        rows = (
            supabase.table("person")
            .select("person_id, first_name, last_name, email_id")
            .eq("person_id", user.person_id)
            .limit(1)
            .execute()
            .data
        )
    except Exception:
        logger.exception("Could not load profile for person_id=%s", user.person_id)
        raise HTTPException(status_code=500, detail="Unable to load your profile right now")

    person = rows[0] if rows else {}
    return {
        "success": True,
        "data": {
            "person_id": user.person_id,
            "username": user.username,
            "name": _full_name(person) or user.username,
            "email_id": person.get("email_id"),
        },
    }


@router.get("/events")
def list_events(user: AuthenticatedUser = Depends(get_current_user)):
    _require_user(user)
    try:
        events = (
            supabase.table("event")
            .select(EVENT_COLUMNS)
            .in_("event_status", VISIBLE_STATUSES)
            .eq("is_delete", False)
            .execute()
            .data
        )
        cards = _build_cards(events, user.person_id)
    except Exception:
        logger.exception("Could not list events for person_id=%s", user.person_id)
        raise HTTPException(status_code=500, detail="Unable to load events right now")

    cards = _order_cards(cards)
    return {"success": True, "count": len(cards), "data": cards}


@router.get("/events/{event_id}")
def get_event(event_id: int, user: AuthenticatedUser = Depends(get_current_user)):
    _require_user(user)
    try:
        event = _get_visible_event(event_id)
        if not event:
            # Same answer for "does not exist" and "not published yet".
            raise HTTPException(status_code=404, detail="Event not found")

        card = _build_cards([event], user.person_id)[0]
        sessions = (
            supabase.table("session")
            .select("session_id, session_title, speaker_name, start_time, end_time, venue")
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .order("start_time")
            .execute()
            .data
        )
        fee = _read_fee(event_id)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Could not load event %s for person_id=%s", event_id, user.person_id)
        raise HTTPException(status_code=500, detail="Unable to load this event right now")

    return {
        "success": True,
        "data": {
            **card,
            "sessions": sessions,
            "fee": _fee_json(fee),
            "registration_open": _registration_open(event),
        },
    }


@router.post("/events/{event_id}/register", status_code=201)
def register_for_event(event_id: int, user: AuthenticatedUser = Depends(get_current_user)):
    """Register the signed-in user for an event. Takes no request body on purpose."""
    _require_user(user)
    today = date.today().isoformat()

    try:
        event = _get_visible_event(event_id)
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        if not _registration_open(event):
            raise HTTPException(status_code=409, detail="Registration is closed for this event")

        fee = _read_fee(event_id)
        if fee is None:
            raise HTTPException(
                status_code=503,
                detail="The registration fee for this event is not set up yet. Please contact the organiser.",
            )
        status = STATUS_CONFIRMED if fee == 0 else STATUS_PENDING

        # Includes soft-deleted rows, because (event_id, person_id) is unique in the database.
        existing = (
            supabase.table("registration")
            .select("registration_id, is_delete")
            .eq("event_id", event_id)
            .eq("person_id", user.person_id)
            .limit(1)
            .execute()
            .data
        )

        already = HTTPException(status_code=409, detail="You are already registered for this event")

        if existing and not existing[0].get("is_delete"):
            raise already

        if existing:
            # An earlier registration was removed; bring it back instead of inserting a duplicate.
            rows = (
                supabase.table("registration")
                .update(
                    {
                        "is_delete": False,
                        "status": status,
                        "fee_paid": 0,
                        "registration_date": today,
                        "updated_by": user.username,
                        "updated_date": today,
                    }
                )
                .eq("registration_id", existing[0]["registration_id"])
                .eq("is_delete", True)
                .execute()
                .data
            )
            if not rows:
                raise already  # another request restored it first
            registration = rows[0]
        else:
            try:
                rows = (
                    supabase.table("registration")
                    .insert(
                        {
                            "event_id": event_id,
                            "person_id": user.person_id,
                            "status": status,
                            "fee_paid": 0,
                            "created_by": user.username,
                        }
                    )
                    .execute()
                    .data
                )
            except Exception as error:
                if _error_code(error) == "23505":  # two clicks / two tabs at the same moment
                    raise already
                raise
            if not rows:
                raise RuntimeError("registration insert returned no row")
            registration = rows[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Could not register person_id=%s for event %s", user.person_id, event_id)
        raise HTTPException(status_code=500, detail="Unable to complete your registration right now")

    if status == STATUS_CONFIRMED:
        message = "You are registered for this event."
    else:
        message = "You are registered. Your registration stays pending until your payment is verified."

    return {
        "success": True,
        "data": {
            "registration_id": registration.get("registration_id"),
            "event_id": event_id,
            "status": status,
            "fee": _fee_json(fee),
            "message": message,
        },
    }
