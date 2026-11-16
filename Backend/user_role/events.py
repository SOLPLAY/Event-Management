"""User role - events catalogue (feature 1), registration (feature 2), event details (feature 3).

Endpoints (all need a signed-in User):
    GET  /user/me                          - the signed-in user's name
    GET  /user/events                      - published events (upcoming first, then past)
    GET  /user/events/{event_id}           - one event with its sessions, fee and registration state
    POST /user/events/{event_id}/register  - register the signed-in user for the event

The other tabs of the event page live in event_tabs.py (hospitality, accommodation, results)
and payments.py (payment details and payment proof). They are mounted on this router below,
so main.py only needs to include this one router.

Registration rules:
    * Only a Published event that has not ended can be registered for.
    * A user can register once per event (the database also enforces this).
    * Free event (fee = 0)  -> registration is "Confirmed" straight away.
    * Paid event  (fee > 0) -> registration is "Pending"; the user then goes to the payment page,
      submits proof of payment, and an organiser verifies it (which makes it "Confirmed").
    * The person registered is always the signed-in user - nothing in the request can change that.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException

from auth_tokens import AuthenticatedUser, get_current_user
from event_management import supabase
from user_role.common import (
    EVENT_COLUMNS,
    STATUS_CONFIRMED,
    STATUS_PENDING,
    VISIBLE_STATUSES,
    error_code,
    fee_json,
    full_name,
    get_visible_event,
    is_missing_object,
    logger,
    my_registration,
    parse_date,
    phase_of,
    read_fee,
    registration_open,
    require_user,
    status_label,
)

router = APIRouter(prefix="/user", tags=["User"])


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
        name = full_name(people_by_id.get(row["person_id"], {}))
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
        start = parse_date(event.get("start_date"))
        end = parse_date(event.get("end_date"))
        registration = registration_by_event.get(event_id)
        cards.append(
            {
                "event_id": event_id,
                "name": event.get("name") or "Untitled event",
                "type": type_row.get("category") or event.get("type") or "Event",
                "description": type_row.get("description") or "",
                "start_date": start.isoformat() if start else None,
                "end_date": end.isoformat() if end else None,
                "event_status": status_label(event.get("event_status")),
                "phase": phase_of(start, end, event.get("event_status") or ""),
                "organizers": organizers_by_event.get(event_id, []),
                "my_registration": {"status": registration["status"]} if registration else None,
            }
        )
    return cards


def _registration_summary(event_id: int, person_id: int, basic: dict) -> dict:
    """status + amount paid + the state of the latest payment submission (if any)."""
    summary = {**basic, "fee_paid": None, "payment_status": None}
    registration = my_registration(event_id, person_id)
    if not registration:
        return summary
    summary["status"] = registration["status"]
    summary["fee_paid"] = registration.get("fee_paid")
    try:
        latest = (
            supabase.table("payment_submission")
            .select("payment_id, status")
            .eq("registration_id", registration["registration_id"])
            .eq("is_delete", False)
            .order("payment_id", desc=True)
            .limit(1)
            .execute()
            .data
        )
        summary["payment_status"] = latest[0]["status"] if latest else None
    except Exception as error:
        if not is_missing_object(error):
            raise
        logger.warning("payment_submission table is missing - run the feature 3 SQL migration")
    return summary


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
    require_user(user)
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
            "name": full_name(person) or user.username,
            "email_id": person.get("email_id"),
        },
    }


@router.get("/events")
def list_events(user: AuthenticatedUser = Depends(get_current_user)):
    require_user(user)
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
    require_user(user)
    try:
        event = get_visible_event(event_id)
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
        fee = read_fee(event_id)
        if card["my_registration"]:
            card["my_registration"] = _registration_summary(event_id, user.person_id, card["my_registration"])
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
            "fee": fee_json(fee),
            "registration_open": registration_open(event),
        },
    }


@router.post("/events/{event_id}/register", status_code=201)
def register_for_event(event_id: int, user: AuthenticatedUser = Depends(get_current_user)):
    """Register the signed-in user for an event. Takes no request body on purpose."""
    require_user(user)
    today = date.today().isoformat()

    try:
        event = get_visible_event(event_id)
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        if not registration_open(event):
            raise HTTPException(status_code=409, detail="Registration is closed for this event")

        fee = read_fee(event_id)
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
                if error_code(error) == "23505":  # two clicks / two tabs at the same moment
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
        message = "You are registered. Complete the payment to confirm your place."

    return {
        "success": True,
        "data": {
            "registration_id": registration.get("registration_id"),
            "event_id": event_id,
            "status": status,
            "fee": fee_json(fee),
            "message": message,
            # tells the page where to go next: paid events continue to the payment page
            "next_step": "payment" if status == STATUS_PENDING else None,
        },
    }


# Other tabs of the event page (hospitality, accommodation, results, payment).
from user_role.event_tabs import router as _event_tabs_router  # noqa: E402
from user_role.payments import router as _payments_router  # noqa: E402

router.include_router(_event_tabs_router)
router.include_router(_payments_router)
