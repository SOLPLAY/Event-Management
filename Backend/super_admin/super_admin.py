from fastapi import APIRouter, Depends, HTTPException

from auth_tokens import AuthenticatedUser, get_current_user
from event_management import (
    EVENT_COLUMNS,
    EventDecision,
    _audit_fields,
    _event_cards,
    _get_event,
    _normalize_status,
    _require_role,
    supabase,
)

router = APIRouter(prefix="/event-management", tags=["Super Admin"])


@router.get("/super-admin/events")
def get_all_events(user: AuthenticatedUser = Depends(get_current_user)):
    _require_role(user, "Super Admin")
    try:
        events = (
            supabase.table("event")
            .select(EVENT_COLUMNS)
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
        raise HTTPException(status_code=500, detail="Failed to fetch events") from error


@router.patch("/super-admin/events/{event_id}/decision")
def decide_event(
    event_id: int,
    decision: EventDecision,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Super Admin")
    try:
        event = _get_event(event_id)
        if _normalize_status(event.get("event_status")) != "Pending":
            raise HTTPException(
                status_code=409,
                detail="Only events pending approval can be approved or rejected",
            )

        updated = (
            supabase.table("event")
            .update({"event_status": decision.decision, **_audit_fields(user.username)})
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .eq("event_status", event.get("event_status"))
            .execute()
            .data
        )
        if not updated:
            raise HTTPException(
                status_code=409,
                detail="The event changed while it was being reviewed; refresh and try again",
            )
        return {"success": True, "data": updated}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="Failed to update event decision") from error
