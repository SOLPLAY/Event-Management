from fastapi import APIRouter, Depends, HTTPException

from auth_tokens import AuthenticatedUser, get_current_user
from event_management import (
    EVENT_COLUMNS,
    EventDetails,
    _audit_fields,
    _event_cards,
    _get_owned_event,
    _normalize_status,
    _require_role,
    _save_event_type,
    supabase,
)

router = APIRouter(prefix="/event-management", tags=["Event Organizer"])


@router.get("/organizer/events")
def get_organizer_events(user: AuthenticatedUser = Depends(get_current_user)):
    _require_role(user, "Event Organizer")
    try:
        links = (
            supabase.table("event_organizer")
            .select("event_id")
            .eq("person_id", user.person_id)
            .eq("is_delete", False)
            .execute()
            .data
        )
        event_ids = list({link["event_id"] for link in links})
        events = []
        if event_ids:
            events = (
                supabase.table("event")
                .select(EVENT_COLUMNS)
                .in_("event_id", event_ids)
                .eq("is_delete", False)
                .order("start_date")
                .execute()
                .data
            )
        cards = _event_cards(events)
        return {"success": True, "count": len(cards), "data": cards}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="Failed to fetch your events") from error


@router.post("/organizer/events", status_code=201)
def create_event(
    details: EventDetails,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    event_id = None
    try:
        inserted = (
            supabase.table("event")
            .insert(
                {
                    "name": details.name,
                    "type": details.type,
                    "start_date": details.start_date.isoformat(),
                    "end_date": details.end_date.isoformat(),
                    "event_status": "Pending",
                    "is_delete": False,
                    "created_by": user.username,
                }
            )
            .execute()
            .data
        )
        if not inserted:
            raise RuntimeError("The event insert returned no record")
        event_id = inserted[0]["event_id"]
        (
            supabase.table("event_organizer")
            .insert(
                {
                    "event_id": event_id,
                    "person_id": user.person_id,
                    "role": "Event Organizer",
                    "is_delete": False,
                    "created_by": user.username,
                }
            )
            .execute()
        )
        _save_event_type(event_id, details.type, details.description, user.username)
        return {"success": True, "data": _event_cards(inserted)[0]}
    except HTTPException:
        raise
    except Exception as error:
        if event_id is not None:
            try:
                supabase.table("event").update({"is_delete": True}).eq(
                    "event_id", event_id
                ).execute()
            except Exception as cleanup_error:
                raise HTTPException(
                    status_code=500,
                    detail="Event creation failed and the incomplete event could not be removed",
                ) from cleanup_error
        raise HTTPException(status_code=500, detail="Failed to create event") from error


@router.put("/organizer/events/{event_id}")
def update_event(
    event_id: int,
    details: EventDetails,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        event = _get_owned_event(event_id, user)
        current_status = _normalize_status(event.get("event_status"))
        if current_status not in {"Pending", "Rejected"}:
            raise HTTPException(
                status_code=409,
                detail="Only pending or rejected events can be edited",
            )

        resubmitted_status = "Pending" if current_status == "Rejected" else current_status
        updated = (
            supabase.table("event")
            .update(
                {
                    "name": details.name,
                    "type": details.type,
                    "start_date": details.start_date.isoformat(),
                    "end_date": details.end_date.isoformat(),
                    "event_status": resubmitted_status,
                    **_audit_fields(user.username),
                }
            )
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .eq("event_status", event.get("event_status"))
            .execute()
            .data
        )
        if not updated:
            raise HTTPException(
                status_code=409,
                detail="The event changed while it was being edited; refresh and try again",
            )
        _save_event_type(event_id, details.type, details.description, user.username)
        return {"success": True, "data": updated}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="Failed to update event") from error


@router.delete("/organizer/events/{event_id}")
def delete_event(
    event_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        event = _get_owned_event(event_id, user)
        if _normalize_status(event.get("event_status")) in {"Published", "Completed"}:
            raise HTTPException(
                status_code=409,
                detail="Published or completed events can no longer be deleted",
            )
        deleted = (
            supabase.table("event")
            .update({"is_delete": True, **_audit_fields(user.username)})
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .eq("event_status", event.get("event_status"))
            .execute()
            .data
        )
        if not deleted:
            raise HTTPException(
                status_code=409,
                detail="The event changed while it was being deleted; refresh and try again",
            )
        return {"success": True, "message": "Event deleted"}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="Failed to delete event") from error


@router.post("/organizer/events/{event_id}/publish")
def publish_event(
    event_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        event = _get_owned_event(event_id, user)
        if _normalize_status(event.get("event_status")) != "Approved":
            raise HTTPException(
                status_code=409,
                detail="Only approved events can be published",
            )
        updated = (
            supabase.table("event")
            .update({"event_status": "Published", **_audit_fields(user.username)})
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .eq("event_status", event.get("event_status"))
            .execute()
            .data
        )
        if not updated:
            raise HTTPException(
                status_code=409,
                detail="The event changed while it was being published; refresh and try again",
            )
        return {"success": True, "data": updated}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="Failed to publish event") from error
