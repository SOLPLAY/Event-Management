from datetime import datetime
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

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
    service_supabase,
    supabase,
)

router = APIRouter(prefix="/event-management", tags=["Event Organizer"])
logger = logging.getLogger(__name__)


class SessionDetails(BaseModel):
    session_title: str = Field(min_length=1, max_length=250)
    speaker_name: str | None = None
    start_time: datetime
    end_time: datetime
    venue: str | None = None

    @model_validator(mode="after")
    def validate_session(self):
        self.session_title = self.session_title.strip()
        if not self.session_title:
            raise ValueError("Session title is required")
        if self.speaker_name is not None:
            self.speaker_name = self.speaker_name.strip() or None
        if self.venue is not None:
            self.venue = self.venue.strip() or None
        if (self.start_time.utcoffset() is None) != (self.end_time.utcoffset() is None):
            raise ValueError("Both session times must either include a timezone or omit it")
        if self.start_time >= self.end_time:
            raise ValueError("Session start time must be before its end time")
        return self


class AccommodationApproval(BaseModel):
    room_id: int = Field(gt=0)


class EvaluationCreate(BaseModel):
    registration_id: int = Field(gt=0)
    score: float | None = None
    feedback_rating: int | None = Field(default=None, strict=True)
    certificate_issued: bool = False


class EvaluationUpdate(BaseModel):
    score: float | None = None
    feedback_rating: int | None = Field(default=None, strict=True)
    certificate_issued: bool


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


@router.get("/organizer/events/{event_id}/hospitality")
def get_event_hospitality(
    event_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event(event_id, user)
        records = (
            supabase.table("hospitality")
            .select(
                "hospitality_id, event_id, meal_type, service_date, "
                "head_count, vendor_name"
            )
            .eq("event_id", event_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .order("service_date")
            .execute()
            .data
        )
        return {"success": True, "count": len(records), "data": records}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch hospitality details",
        ) from error


@router.get("/organizer/events/{event_id}/registrations")
def get_event_registrations(
    event_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        event = _get_owned_event(event_id, user)
        registrations = (
            supabase.table("registration")
            .select(
                "registration_id, person_id, registration_date, status, fee_paid"
            )
            .eq("event_id", event_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .order("registration_date", desc=True)
            .execute()
            .data
        )

        person_ids = list({registration["person_id"] for registration in registrations})
        people_by_id = {}
        if person_ids:
            people = (
                supabase.table("person")
                .select("person_id, first_name, last_name")
                .in_("person_id", person_ids)
                .execute()
                .data
            )
            people_by_id = {person["person_id"]: person for person in people}

        records = []
        for registration in registrations:
            person = people_by_id.get(registration["person_id"], {})
            full_name = " ".join(
                part
                for part in (person.get("first_name"), person.get("last_name"))
                if part
            )
            records.append(
                {
                    **registration,
                    "person_name": full_name or f"Person {registration['person_id']}",
                }
            )

        return {
            "success": True,
            "count": len(records),
            "event_fee": event.get("fee", 0),
            "data": records,
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch event registrations",
        ) from error


@router.get("/organizer/events/{event_id}/sessions")
def get_event_sessions(
    event_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event(event_id, user)
        sessions = (
            supabase.table("session")
            .select(
                "session_id, session_title, speaker_name, start_time, end_time, venue"
            )
            .eq("event_id", event_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .order("start_time")
            .execute()
            .data
        )
        return {"success": True, "count": len(sessions), "data": sessions}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch event sessions",
        ) from error


@router.post("/organizer/events/{event_id}/sessions", status_code=201)
def create_event_session(
    event_id: int,
    details: SessionDetails,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event(event_id, user)
        now = datetime.now()
        inserted = (
            supabase.table("session")
            .insert(
                {
                    **details.model_dump(mode="json"),
                    "event_id": event_id,
                    "is_delete": False,
                    "created_by": user.username,
                    "created_date": now.date().isoformat(),
                    "created_time": now.time().replace(microsecond=0).isoformat(),
                }
            )
            .execute()
            .data
        )
        if not inserted:
            raise RuntimeError("The session insert returned no record")
        return {"success": True, "data": inserted[0]}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="Failed to create event session",
        ) from error


@router.put("/organizer/events/{event_id}/sessions/{session_id}")
def update_event_session(
    event_id: int,
    session_id: int,
    details: SessionDetails,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event(event_id, user)
        update_data = {
            **details.model_dump(mode="json"),
            **_audit_fields(user.username),
        }
        updated = (
            supabase.table("session")
            .update(update_data)
            .eq("event_id", event_id)
            .eq("session_id", session_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
        if not updated:
            raise HTTPException(status_code=404, detail="Active event session not found")
        return {"success": True, "data": updated[0]}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="Failed to update event session",
        ) from error


@router.delete("/organizer/events/{event_id}/sessions/{session_id}")
def delete_event_session(
    event_id: int,
    session_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event(event_id, user)
        deleted = (
            supabase.table("session")
            .update({"is_delete": True, **_audit_fields(user.username)})
            .eq("event_id", event_id)
            .eq("session_id", session_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
        if not deleted:
            raise HTTPException(status_code=404, detail="Active event session not found")
        return {"success": True, "message": "Event session deleted"}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="Failed to delete event session",
        ) from error


@router.get("/organizer/events/{event_id}/accommodation")
def get_event_accommodation(
    event_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event(event_id, user)
        registrations = (
            supabase.table("registration")
            .select("registration_id, person_id")
            .eq("event_id", event_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
        registration_by_id = {
            registration["registration_id"]: registration
            for registration in registrations
        }
        registration_ids = list(registration_by_id)
        accommodations = []
        if registration_ids:
            accommodations = (
                supabase.table("accommodation")
                .select(
                    "accommodation_id, registration_id, request_status, room_id, "
                    "building_name, room_number, check_in_date, check_out_date"
                )
                .in_("registration_id", registration_ids)
                .or_("is_delete.eq.false,is_delete.is.null")
                .order("check_in_date")
                .execute()
                .data
            )

        pending_requests = [
            record
            for record in accommodations
            if record.get("request_status") == "Pending"
            and record.get("check_in_date")
            and record.get("check_out_date")
        ]
        rooms = []
        approved_occupancies = []
        if pending_requests:
            if service_supabase is None:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "Room availability is not configured. Set "
                        "SUPABASE_SERVICE_ROLE_KEY in Backend/.env and restart the API."
                    ),
                )
            rooms = (
                service_supabase.table("room")
                .select("room_id, building_name, room_number, capacity")
                .eq("is_active", True)
                .order("building_name")
                .order("room_number")
                .execute()
                .data
            )
            room_ids = [room["room_id"] for room in rooms]
            if room_ids:
                first_check_in = min(
                    str(record["check_in_date"])[:10] for record in pending_requests
                )
                final_check_out = max(
                    str(record["check_out_date"])[:10] for record in pending_requests
                )
                approved_occupancies = (
                    service_supabase.table("accommodation")
                    .select(
                        "accommodation_id, room_id, check_in_date, check_out_date"
                    )
                    .in_("room_id", room_ids)
                    .eq("request_status", "Approved")
                    .or_("is_delete.eq.false,is_delete.is.null")
                    .lt("check_in_date", final_check_out)
                    .gt("check_out_date", first_check_in)
                    .execute()
                    .data
                )

        person_ids = list(
            {
                registration_by_id[record["registration_id"]]["person_id"]
                for record in accommodations
            }
        )
        people_by_id = {}
        if person_ids:
            people = (
                supabase.table("person")
                .select("person_id, first_name, last_name")
                .in_("person_id", person_ids)
                .execute()
                .data
            )
            people_by_id = {person["person_id"]: person for person in people}

        def available_rooms_for(accommodation):
            if (
                accommodation.get("request_status") != "Pending"
                or not accommodation.get("check_in_date")
                or not accommodation.get("check_out_date")
            ):
                return []

            available_rooms = []
            for room in rooms:
                occupied_beds = sum(
                    1
                    for occupied in approved_occupancies
                    if occupied["room_id"] == room["room_id"]
                    and occupied["accommodation_id"] != accommodation["accommodation_id"]
                    and str(occupied["check_in_date"])[:10]
                    < str(accommodation["check_out_date"])[:10]
                    and str(occupied["check_out_date"])[:10]
                    > str(accommodation["check_in_date"])[:10]
                )
                available_beds = room["capacity"] - occupied_beds
                if available_beds > 0:
                    available_rooms.append({**room, "available_beds": available_beds})
            return available_rooms

        records = []
        for accommodation in accommodations:
            registration = registration_by_id[accommodation["registration_id"]]
            person = people_by_id.get(registration["person_id"], {})
            full_name = " ".join(
                part
                for part in (person.get("first_name"), person.get("last_name"))
                if part
            )
            records.append(
                {
                    **accommodation,
                    "person_name": full_name or f"Person {registration['person_id']}",
                    "available_rooms": available_rooms_for(accommodation),
                }
            )

        return {
            "success": True,
            "count": len(records),
            "active_room_count": len(rooms) if pending_requests else None,
            "data": records,
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch event accommodation",
        ) from error


def _get_owned_accommodation_request(
    event_id: int,
    accommodation_id: int,
    user: AuthenticatedUser,
) -> dict:
    _get_owned_event(event_id, user)
    rows = (
        supabase.table("accommodation")
        .select("accommodation_id, registration_id, request_status")
        .eq("accommodation_id", accommodation_id)
        .or_("is_delete.eq.false,is_delete.is.null")
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Accommodation request not found")

    registrations = (
        supabase.table("registration")
        .select("registration_id")
        .eq("registration_id", rows[0]["registration_id"])
        .eq("event_id", event_id)
        .eq("is_delete", False)
        .limit(1)
        .execute()
        .data
    )
    if not registrations:
        raise HTTPException(status_code=404, detail="Accommodation request not found")
    return rows[0]


@router.post(
    "/organizer/events/{event_id}/accommodation/{accommodation_id}/approve"
)
def approve_event_accommodation(
    event_id: int,
    accommodation_id: int,
    approval: AccommodationApproval,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_accommodation_request(event_id, accommodation_id, user)
        if service_supabase is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Accommodation approval is not configured. Set "
                    "SUPABASE_SERVICE_ROLE_KEY in Backend/.env and restart the API."
                ),
            )
        result = (
            service_supabase.rpc(
                "approve_accommodation_request",
                {
                    "p_accommodation_id": accommodation_id,
                    "p_room_id": approval.room_id,
                    "p_updated_by": user.username,
                },
            )
            .execute()
            .data
        )
        if not result:
            raise RuntimeError("The accommodation approval returned no record")
        return {"success": True, "data": result[0]}
    except HTTPException:
        raise
    except Exception as error:
        code = str(getattr(error, "code", "") or "")
        if code == "P1001":
            raise HTTPException(
                status_code=404,
                detail="Accommodation request not found",
            ) from error
        if code == "P1005":
            raise HTTPException(
                status_code=422,
                detail="The accommodation request has invalid stay dates",
            ) from error
        if code in {"P1002", "P1003", "P1004"}:
            raise HTTPException(
                status_code=409,
                detail=str(error),
            ) from error
        raise HTTPException(
            status_code=500,
            detail="Failed to approve accommodation request",
        ) from error


@router.post(
    "/organizer/events/{event_id}/accommodation/{accommodation_id}/reject"
)
def reject_event_accommodation(
    event_id: int,
    accommodation_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        request = _get_owned_accommodation_request(event_id, accommodation_id, user)
        if request.get("request_status") != "Pending":
            raise HTTPException(
                status_code=409,
                detail="Only pending accommodation requests can be rejected",
            )
        updated = (
            supabase.table("accommodation")
            .update(
                {
                    "request_status": "Rejected",
                    "room_id": None,
                    "building_name": None,
                    "room_number": None,
                    **_audit_fields(user.username),
                }
            )
            .eq("accommodation_id", accommodation_id)
            .eq("request_status", "Pending")
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
        if not updated:
            raise HTTPException(
                status_code=409,
                detail="The accommodation request changed; refresh and try again",
            )
        return {"success": True, "data": updated[0]}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="Failed to reject accommodation request",
        ) from error


@router.get("/organizer/events/{event_id}/advertisements")
def get_event_advertisements(
    event_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event(event_id, user)
        advertisements = (
            supabase.table("advertisement")
            .select("ad_id, platform, target_audience, publish_date")
            .eq("event_id", event_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .order("publish_date")
            .execute()
            .data
        )
        return {
            "success": True,
            "count": len(advertisements),
            "data": advertisements,
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch event advertisements",
        ) from error


@router.get("/organizer/events/{event_id}/evaluations")
def get_event_evaluations(
    event_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event(event_id, user)
        registrations = (
            supabase.table("registration")
            .select("registration_id, person_id")
            .eq("event_id", event_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
        registration_by_id = {
            registration["registration_id"]: registration
            for registration in registrations
        }
        registration_ids = list(registration_by_id)
        evaluations = []
        if registration_ids:
            evaluations = (
                supabase.table("evaluation")
                .select(
                    "evaluation_id, registration_id, score, feedback_rating, "
                    "certificate_issued"
                )
                .eq("event_id", event_id)
                .in_("registration_id", registration_ids)
                .or_("is_delete.eq.false,is_delete.is.null")
                .execute()
                .data
            )

        person_ids = list(
            {
                registration_by_id[evaluation["registration_id"]]["person_id"]
                for evaluation in evaluations
            }
        )
        people_by_id = {}
        if person_ids:
            people = (
                supabase.table("person")
                .select("person_id, first_name, last_name")
                .in_("person_id", person_ids)
                .execute()
                .data
            )
            people_by_id = {person["person_id"]: person for person in people}

        records = []
        for evaluation in evaluations:
            registration = registration_by_id[evaluation["registration_id"]]
            person = people_by_id.get(registration["person_id"], {})
            full_name = " ".join(
                part
                for part in (person.get("first_name"), person.get("last_name"))
                if part
            )
            records.append(
                {
                    **evaluation,
                    "person_name": full_name or f"Person {registration['person_id']}",
                }
            )

        return {"success": True, "count": len(records), "data": records}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch event evaluations",
        ) from error


@router.post("/organizer/events/{event_id}/evaluations", status_code=201)
def create_event_evaluation(
    event_id: int,
    details: EvaluationCreate,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event(event_id, user)
        registrations = (
            supabase.table("registration")
            .select("registration_id")
            .eq("event_id", event_id)
            .eq("registration_id", details.registration_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .limit(1)
            .execute()
            .data
        )
        if not registrations:
            raise HTTPException(status_code=404, detail="Active event registration not found")

        existing = (
            supabase.table("evaluation")
            .select("evaluation_id")
            .eq("event_id", event_id)
            .eq("registration_id", details.registration_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .limit(1)
            .execute()
            .data
        )
        if existing:
            raise HTTPException(
                status_code=409,
                detail="An evaluation already exists for this registration",
            )

        now = datetime.now()
        inserted = (
            supabase.table("evaluation")
            .insert(
                {
                    **details.model_dump(),
                    "event_id": event_id,
                    "is_delete": False,
                    "created_by": user.username,
                    "created_date": now.date().isoformat(),
                    "created_time": now.time().replace(microsecond=0).isoformat(),
                }
            )
            .execute()
            .data
        )
        if not inserted:
            raise RuntimeError("The evaluation insert returned no record")
        return {"success": True, "data": inserted[0]}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Failed to create event evaluation for event %s", event_id)
        raise HTTPException(
            status_code=500,
            detail="Failed to create event evaluation",
        ) from error


def _get_owned_event_evaluation(
    event_id: int,
    evaluation_id: int,
    user: AuthenticatedUser,
) -> None:
    _get_owned_event(event_id, user)
    evaluations = (
        supabase.table("evaluation")
        .select("evaluation_id")
        .eq("event_id", event_id)
        .eq("evaluation_id", evaluation_id)
        .or_("is_delete.eq.false,is_delete.is.null")
        .limit(1)
        .execute()
        .data
    )
    if not evaluations:
        raise HTTPException(status_code=404, detail="Active event evaluation not found")


@router.put("/organizer/events/{event_id}/evaluations/{evaluation_id}")
def update_event_evaluation(
    event_id: int,
    evaluation_id: int,
    details: EvaluationUpdate,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event_evaluation(event_id, evaluation_id, user)
        updated = (
            supabase.table("evaluation")
            .update({**details.model_dump(), **_audit_fields(user.username)})
            .eq("event_id", event_id)
            .eq("evaluation_id", evaluation_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
        if not updated:
            raise HTTPException(status_code=404, detail="Active event evaluation not found")
        return {"success": True, "data": updated[0]}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception(
            "Failed to update event evaluation %s for event %s",
            evaluation_id,
            event_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to update event evaluation",
        ) from error


@router.delete("/organizer/events/{event_id}/evaluations/{evaluation_id}")
def delete_event_evaluation(
    event_id: int,
    evaluation_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event_evaluation(event_id, evaluation_id, user)
        deleted = (
            supabase.table("evaluation")
            .update({"is_delete": True, **_audit_fields(user.username)})
            .eq("event_id", event_id)
            .eq("evaluation_id", evaluation_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
        if not deleted:
            raise HTTPException(status_code=404, detail="Active event evaluation not found")
        return {"success": True, "message": "Event evaluation deleted"}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="Failed to delete event evaluation",
        ) from error


@router.get("/organizer/events/{event_id}/report")
def get_event_report(
    event_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event(event_id, user)
        reports = (
            supabase.table("event_report")
            .select(
                "report_id, summary_text, total_attendees, "
                "photographs_url, report_date"
            )
            .eq("event_id", event_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .limit(1)
            .execute()
            .data
        )
        return {
            "success": True,
            "data": reports[0] if reports else None,
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch the event report",
        ) from error


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
