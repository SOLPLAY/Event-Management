from datetime import date, datetime
import logging
from decimal import Decimal, InvalidOperation
import re
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, model_validator

from auth_tokens import AuthenticatedUser, get_current_user
from event_management import (
    EVENT_COLUMNS,
    EventDetails,
    _auto_complete,
    _audit_fields,
    _event_cards,
    _get_owned_event,
    _normalize_status,
    _require_role,
    _save_event_type,
    service_supabase,
    supabase,
)
from user_role.common import is_missing_object

router = APIRouter(prefix="/event-management", tags=["Event Organizer"])
logger = logging.getLogger(__name__)
ADVERTISEMENT_BUCKET = "event-advertisements"
MAX_ADVERTISEMENT_MEDIA_BYTES = 50 * 1024 * 1024


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


class HospitalityDetails(BaseModel):
    meal_type: str = Field(min_length=1, max_length=100)
    service_date: date
    head_count: int = Field(ge=0)
    vendor_name: str = Field(default="", max_length=250)

    @model_validator(mode="after")
    def normalize_hospitality(self):
        self.meal_type = self.meal_type.strip()
        if not self.meal_type:
            raise ValueError("Meal type is required")
        self.vendor_name = self.vendor_name.strip()
        return self


class AdvertisementDetails(BaseModel):
    platform: str = Field(min_length=1, max_length=150)
    target_audience: str = Field(default="", max_length=500)
    publish_date: date

    @model_validator(mode="after")
    def normalize_advertisement(self):
        self.platform = self.platform.strip()
        self.target_audience = self.target_audience.strip()
        if not self.platform:
            raise ValueError("Platform is required")
        return self


class SponsorDetails(BaseModel):
    sponsor_name: str = Field(min_length=1, max_length=250)
    sponsorship_level: str = Field(default="Sponsor", min_length=1, max_length=100)
    contact_person: str | None = Field(default=None, max_length=250)
    contact_email: str | None = Field(default=None, max_length=320)
    contact_phone: str | None = Field(default=None, max_length=50)
    sponsorship_amount: Decimal | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def normalize_sponsor(self):
        self.sponsor_name = self.sponsor_name.strip()
        self.sponsorship_level = self.sponsorship_level.strip()
        if not self.sponsor_name or not self.sponsorship_level:
            raise ValueError("Sponsor name and sponsorship level are required")
        for field_name in ("contact_person", "contact_email", "contact_phone", "notes"):
            value = getattr(self, field_name)
            if value is not None:
                setattr(self, field_name, value.strip() or None)
        return self


class EvaluationCreate(BaseModel):
    registration_id: int = Field(gt=0)
    score: float | None = None
    feedback_rating: int | None = Field(default=None, strict=True)
    certificate_issued: bool = False


class EvaluationUpdate(BaseModel):
    score: float | None = None
    feedback_rating: int | None = Field(default=None, strict=True)
    certificate_issued: bool


class SessionAttendanceUpdate(BaseModel):
    attendance_status: Literal["Present", "Absent"]


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


def _get_owned_hospitality(
    event_id: int,
    hospitality_id: int,
    user: AuthenticatedUser,
) -> None:
    _get_owned_event(event_id, user)
    records = (
        supabase.table("hospitality")
        .select("hospitality_id")
        .eq("event_id", event_id)
        .eq("hospitality_id", hospitality_id)
        .or_("is_delete.eq.false,is_delete.is.null")
        .limit(1)
        .execute()
        .data
    )
    if not records:
        raise HTTPException(status_code=404, detail="Active hospitality record not found")


@router.post("/organizer/events/{event_id}/hospitality", status_code=201)
def create_event_hospitality(
    event_id: int,
    details: HospitalityDetails,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event(event_id, user)
        now = datetime.now()
        inserted = (
            supabase.table("hospitality")
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
            raise RuntimeError("The hospitality insert returned no record")
        return {"success": True, "data": inserted[0]}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Failed to create hospitality for event %s", event_id)
        raise HTTPException(
            status_code=500,
            detail="Failed to create hospitality details",
        ) from error


@router.put("/organizer/events/{event_id}/hospitality/{hospitality_id}")
def update_event_hospitality(
    event_id: int,
    hospitality_id: int,
    details: HospitalityDetails,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_hospitality(event_id, hospitality_id, user)
        updated = (
            supabase.table("hospitality")
            .update(
                {
                    **details.model_dump(mode="json"),
                    **_audit_fields(user.username),
                }
            )
            .eq("event_id", event_id)
            .eq("hospitality_id", hospitality_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
        if not updated:
            raise HTTPException(
                status_code=404,
                detail="Active hospitality record not found",
            )
        return {"success": True, "data": updated[0]}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception(
            "Failed to update hospitality %s for event %s",
            hospitality_id,
            event_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to update hospitality details",
        ) from error


@router.delete("/organizer/events/{event_id}/hospitality/{hospitality_id}")
def delete_event_hospitality(
    event_id: int,
    hospitality_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_hospitality(event_id, hospitality_id, user)
        deleted = (
            supabase.table("hospitality")
            .update({"is_delete": True, **_audit_fields(user.username)})
            .eq("event_id", event_id)
            .eq("hospitality_id", hospitality_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
        if not deleted:
            raise HTTPException(
                status_code=404,
                detail="Active hospitality record not found",
            )
        return {"success": True, "message": "Hospitality details deleted"}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception(
            "Failed to delete hospitality %s for event %s",
            hospitality_id,
            event_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to delete hospitality details",
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


def _get_owned_event_session(
    event_id: int,
    session_id: int,
    user: AuthenticatedUser,
) -> dict:
    _get_owned_event(event_id, user)
    sessions = (
        supabase.table("session")
        .select("session_id, session_title")
        .eq("event_id", event_id)
        .eq("session_id", session_id)
        .or_("is_delete.eq.false,is_delete.is.null")
        .limit(1)
        .execute()
        .data
    )
    if not sessions:
        raise HTTPException(status_code=404, detail="Active event session not found")
    return sessions[0]


@router.get("/organizer/events/{event_id}/sessions/{session_id}/attendance")
def get_session_attendance(
    event_id: int,
    session_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        session = _get_owned_event_session(event_id, session_id, user)
        if service_supabase is None:
            raise HTTPException(
                status_code=503,
                detail="Session attendance is not configured on the backend.",
            )

        registrations = (
            supabase.table("registration")
            .select("registration_id, person_id, registration_date, status")
            .eq("event_id", event_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .order("registration_date", desc=True)
            .execute()
            .data
        )
        registration_ids = [record["registration_id"] for record in registrations]
        attendance_by_registration = {}
        if registration_ids:
            attendance = (
                service_supabase.table("session_attendance")
                .select(
                    "attendance_id, registration_id, attendance_status, marked_by, marked_at"
                )
                .eq("session_id", session_id)
                .in_("registration_id", registration_ids)
                .execute()
                .data
            )
            attendance_by_registration = {
                record["registration_id"]: record for record in attendance
            }

        person_ids = list({record["person_id"] for record in registrations})
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
                    **attendance_by_registration.get(
                        registration["registration_id"],
                        {"attendance_status": None},
                    ),
                }
            )

        return {
            "success": True,
            "session": session,
            "count": len(records),
            "data": records,
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.exception(
            "Failed to fetch attendance for session %s in event %s",
            session_id,
            event_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch session attendance",
        ) from error


@router.put(
    "/organizer/events/{event_id}/sessions/{session_id}/attendance/{registration_id}"
)
def update_session_attendance(
    event_id: int,
    session_id: int,
    registration_id: int,
    details: SessionAttendanceUpdate,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event_session(event_id, session_id, user)
        if service_supabase is None:
            raise HTTPException(
                status_code=503,
                detail="Session attendance is not configured on the backend.",
            )

        registrations = (
            supabase.table("registration")
            .select("registration_id")
            .eq("event_id", event_id)
            .eq("registration_id", registration_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .limit(1)
            .execute()
            .data
        )
        if not registrations:
            raise HTTPException(
                status_code=404,
                detail="Active event registration not found",
            )

        now = datetime.now().astimezone().isoformat()
        updated = (
            service_supabase.table("session_attendance")
            .upsert(
                {
                    "session_id": session_id,
                    "registration_id": registration_id,
                    "attendance_status": details.attendance_status,
                    "marked_by": user.username,
                    "marked_at": now,
                    "updated_at": now,
                },
                on_conflict="session_id,registration_id",
            )
            .execute()
            .data
        )
        if not updated:
            raise RuntimeError("The session attendance update returned no record")
        return {"success": True, "data": updated[0]}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception(
            "Failed to update attendance for registration %s in session %s",
            registration_id,
            session_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to update session attendance",
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
            .select(
                "ad_id, platform, target_audience, publish_date, "
                "media_path, media_content_type, media_file_name"
            )
            .eq("event_id", event_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .order("publish_date")
            .execute()
            .data
        )
        media_paths = list(
            dict.fromkeys(
                row["media_path"]
                for row in advertisements
                if row.get("media_path")
            )
        )
        signed_urls = _advertisement_signed_urls(media_paths)
        for advertisement in advertisements:
            media_path = advertisement.get("media_path")
            advertisement["media_url"] = signed_urls.get(media_path)
            advertisement["media_error"] = (
                "The stored media file is missing or inaccessible."
                if media_path and not advertisement["media_url"]
                else None
            )
        return {
            "success": True,
            "count": len(advertisements),
            "data": advertisements,
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Failed to fetch advertisements for event %s", event_id)
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch event advertisements",
        ) from error


def _advertisement_signed_urls(
    paths: list[str],
    *,
    strict: bool = False,
) -> dict[str, str]:
    if not paths:
        return {}
    if service_supabase is None:
        if strict:
            raise HTTPException(
                status_code=503,
                detail="Advertisement media storage is not configured",
            )
        logger.warning("Cannot sign advertisement media: storage is not configured")
        return {}
    try:
        results = service_supabase.storage.from_(ADVERTISEMENT_BUCKET).create_signed_urls(
            paths,
            3600,
        )
    except Exception:
        if strict:
            raise
        logger.exception("Could not create signed URLs for advertisement media")
        return {}
    signed_urls = {}
    for result in results:
        signed_url = result.get("signedURL") or result.get("signedUrl")
        if result.get("error") or not result.get("path") or not signed_url:
            if strict:
                raise RuntimeError("Could not create a signed URL for advertisement media")
            logger.warning(
                "Could not create signed URL for advertisement media path %s: %s",
                result.get("path"),
                result.get("error") or "invalid signing response",
            )
            continue
        signed_urls[result["path"]] = signed_url
    return signed_urls


def _get_owned_advertisement(
    event_id: int,
    ad_id: int,
    user: AuthenticatedUser,
) -> dict:
    _get_owned_event(event_id, user)
    records = (
        supabase.table("advertisement")
        .select("ad_id, event_id, media_path, media_content_type, media_file_name")
        .eq("event_id", event_id)
        .eq("ad_id", ad_id)
        .or_("is_delete.eq.false,is_delete.is.null")
        .limit(1)
        .execute()
        .data
    )
    if not records:
        raise HTTPException(status_code=404, detail="Active advertisement not found")
    return records[0]


def _read_advertisement_upload(media: UploadFile) -> tuple[bytes, str, str, str]:
    data = media.file.read(MAX_ADVERTISEMENT_MEDIA_BYTES + 1)
    if len(data) > MAX_ADVERTISEMENT_MEDIA_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Image and video files must be 50 MB or smaller",
        )

    detected_type = None
    extension = None
    if data.startswith(b"\xff\xd8\xff"):
        detected_type, extension = "image/jpeg", "jpg"
    elif data.startswith(b"\x89PNG\r\n\x1a\n"):
        detected_type, extension = "image/png", "png"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        detected_type, extension = "image/webp", "webp"
    elif data.startswith((b"GIF87a", b"GIF89a")):
        detected_type, extension = "image/gif", "gif"
    elif len(data) >= 12 and data[4:8] == b"ftyp":
        brand = data[8:12]
        if brand == b"qt  ":
            detected_type, extension = "video/quicktime", "mov"
        elif brand in {b"isom", b"iso2", b"mp41", b"mp42", b"avc1", b"M4V ", b"dash"}:
            detected_type, extension = "video/mp4", "mp4"
    elif data.startswith(b"\x1a\x45\xdf\xa3"):
        detected_type, extension = "video/webm", "webm"

    if not detected_type:
        raise HTTPException(
            status_code=415,
            detail="Use a JPEG, PNG, WebP, GIF, MP4, WebM, or MOV file",
        )
    declared_type = (media.content_type or "").casefold()
    if declared_type not in ("", "application/octet-stream", detected_type):
        raise HTTPException(
            status_code=415,
            detail="The uploaded file type does not match its contents",
        )
    original_name = (media.filename or f"poster.{extension}").rsplit("/", 1)[-1]
    original_name = original_name.rsplit("\\", 1)[-1]
    original_name = re.sub(r"[\x00-\x1f\x7f]", "", original_name).strip()
    if not original_name:
        original_name = f"poster.{extension}"
    return data, detected_type, extension, original_name[:255]


@router.post("/organizer/events/{event_id}/advertisements", status_code=201)
def create_event_advertisement(
    event_id: int,
    details: AdvertisementDetails,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event(event_id, user)
        now = datetime.now()
        inserted = (
            supabase.table("advertisement")
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
            raise RuntimeError("The advertisement insert returned no record")
        return {"success": True, "data": inserted[0]}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Failed to create advertisement for event %s", event_id)
        raise HTTPException(
            status_code=500,
            detail="Failed to create event advertisement",
        ) from error


@router.put("/organizer/events/{event_id}/advertisements/{ad_id}")
def update_event_advertisement(
    event_id: int,
    ad_id: int,
    details: AdvertisementDetails,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_advertisement(event_id, ad_id, user)
        updated = (
            supabase.table("advertisement")
            .update(
                {
                    **details.model_dump(mode="json"),
                    **_audit_fields(user.username),
                }
            )
            .eq("event_id", event_id)
            .eq("ad_id", ad_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
        if not updated:
            raise HTTPException(status_code=404, detail="Active advertisement not found")
        return {"success": True, "data": updated[0]}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception(
            "Failed to update advertisement %s for event %s",
            ad_id,
            event_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to update event advertisement",
        ) from error


@router.delete("/organizer/events/{event_id}/advertisements/{ad_id}")
def delete_event_advertisement(
    event_id: int,
    ad_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        advertisement = _get_owned_advertisement(event_id, ad_id, user)
        if advertisement.get("media_path") and service_supabase is None:
            raise HTTPException(
                status_code=503,
                detail="Advertisement media storage is not configured",
            )
        deleted = (
            supabase.table("advertisement")
            .update({"is_delete": True, **_audit_fields(user.username)})
            .eq("event_id", event_id)
            .eq("ad_id", ad_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
        if not deleted:
            raise HTTPException(status_code=404, detail="Active advertisement not found")
        warning = None
        if advertisement.get("media_path"):
            try:
                service_supabase.storage.from_(ADVERTISEMENT_BUCKET).remove(
                    [advertisement["media_path"]]
                )
            except Exception:
                logger.exception(
                    "Advertisement %s was deleted, but its media cleanup failed",
                    ad_id,
                )
                warning = "Advertisement was deleted, but its stored media could not be removed."
        return {
            "success": True,
            "message": "Advertisement deleted",
            "warning": warning,
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.exception(
            "Failed to delete advertisement %s for event %s",
            ad_id,
            event_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to delete event advertisement",
        ) from error


@router.post("/organizer/events/{event_id}/advertisements/{ad_id}/media")
def upload_event_advertisement_media(
    event_id: int,
    ad_id: int,
    media: UploadFile = File(...),
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    uploaded_path = None
    try:
        advertisement = _get_owned_advertisement(event_id, ad_id, user)
        if service_supabase is None:
            raise HTTPException(
                status_code=503,
                detail="Advertisement media storage is not configured",
            )
        data, content_type, extension, original_name = _read_advertisement_upload(media)
        uploaded_path = f"{event_id}/{ad_id}/{uuid.uuid4().hex}.{extension}"
        service_supabase.storage.from_(ADVERTISEMENT_BUCKET).upload(
            uploaded_path,
            data,
            {"content-type": content_type},
        )
        signed_url = _advertisement_signed_urls([uploaded_path], strict=True).get(uploaded_path)
        if not signed_url:
            raise RuntimeError("The uploaded advertisement media could not be signed")
        updated = (
            supabase.table("advertisement")
            .update(
                {
                    "media_path": uploaded_path,
                    "media_content_type": content_type,
                    "media_file_name": original_name,
                    **_audit_fields(user.username),
                }
            )
            .eq("event_id", event_id)
            .eq("ad_id", ad_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
        if not updated:
            raise RuntimeError("The advertisement media update returned no record")
        old_path = advertisement.get("media_path")
        warning = None
        if old_path:
            try:
                service_supabase.storage.from_(ADVERTISEMENT_BUCKET).remove([old_path])
            except Exception:
                logger.warning("Failed to remove replaced advertisement media", exc_info=True)
                warning = "New media was saved, but the replaced file could not be removed."
        return {
            "success": True,
            "data": {
                **updated[0],
                "media_url": signed_url,
            },
            "warning": warning,
        }
    except HTTPException:
        if uploaded_path and service_supabase is not None:
            try:
                service_supabase.storage.from_(ADVERTISEMENT_BUCKET).remove([uploaded_path])
            except Exception:
                logger.warning("Failed to clean up rejected advertisement upload", exc_info=True)
        raise
    except Exception as error:
        if uploaded_path and service_supabase is not None:
            try:
                service_supabase.storage.from_(ADVERTISEMENT_BUCKET).remove([uploaded_path])
            except Exception:
                logger.warning("Failed to clean up incomplete advertisement upload", exc_info=True)
        logger.exception(
            "Failed to upload media for advertisement %s in event %s",
            ad_id,
            event_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to upload advertisement media",
        ) from error
    finally:
        media.file.close()


@router.delete("/organizer/events/{event_id}/advertisements/{ad_id}/media")
def delete_event_advertisement_media(
    event_id: int,
    ad_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        advertisement = _get_owned_advertisement(event_id, ad_id, user)
        path = advertisement.get("media_path")
        if not path:
            raise HTTPException(status_code=404, detail="Advertisement has no media file")
        if service_supabase is None:
            raise HTTPException(
                status_code=503,
                detail="Advertisement media storage is not configured",
            )
        updated = (
            supabase.table("advertisement")
            .update(
                {
                    "media_path": None,
                    "media_content_type": None,
                    "media_file_name": None,
                    **_audit_fields(user.username),
                }
            )
            .eq("event_id", event_id)
            .eq("ad_id", ad_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
        if not updated:
            raise RuntimeError("The advertisement media delete returned no record")
        try:
            service_supabase.storage.from_(ADVERTISEMENT_BUCKET).remove([path])
        except Exception:
            logger.exception(
                "Advertisement media metadata cleared, but file cleanup failed for %s",
                path,
            )
            return {
                "success": True,
                "message": "Advertisement media unlinked",
                "warning": "Media was unlinked, but its storage file could not be removed.",
            }
        return {"success": True, "message": "Advertisement media deleted", "warning": None}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception(
            "Failed to delete media for advertisement %s in event %s",
            ad_id,
            event_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to delete advertisement media",
        ) from error


def _sponsor_table():
    if service_supabase is None:
        raise HTTPException(
            status_code=503,
            detail="Sponsor storage is not configured",
        )
    return service_supabase.table("event_sponsor")


def _get_owned_sponsor(
    event_id: int,
    sponsor_id: int,
    user: AuthenticatedUser,
) -> None:
    _get_owned_event(event_id, user)
    sponsors = (
        _sponsor_table()
        .select("sponsor_id")
        .eq("event_id", event_id)
        .eq("sponsor_id", sponsor_id)
        .eq("is_delete", False)
        .limit(1)
        .execute()
        .data
    )
    if not sponsors:
        raise HTTPException(status_code=404, detail="Active event sponsor not found")


@router.get("/organizer/events/{event_id}/sponsors")
def get_event_sponsors(
    event_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event(event_id, user)
        sponsors = (
            _sponsor_table()
            .select(
                "sponsor_id, event_id, sponsor_name, sponsorship_level, "
                "contact_person, contact_email, contact_phone, "
                "sponsorship_amount, notes"
            )
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .order("sponsor_name")
            .execute()
            .data
        )
        return {"success": True, "count": len(sponsors), "data": sponsors}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Failed to fetch sponsors for event %s", event_id)
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch event sponsors",
        ) from error


@router.post("/organizer/events/{event_id}/sponsors", status_code=201)
def create_event_sponsor(
    event_id: int,
    details: SponsorDetails,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event(event_id, user)
        now = datetime.now()
        inserted = (
            _sponsor_table()
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
            raise RuntimeError("The sponsor insert returned no record")
        return {"success": True, "data": inserted[0]}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Failed to create sponsor for event %s", event_id)
        raise HTTPException(
            status_code=500,
            detail="Failed to create event sponsor",
        ) from error


@router.put("/organizer/events/{event_id}/sponsors/{sponsor_id}")
def update_event_sponsor(
    event_id: int,
    sponsor_id: int,
    details: SponsorDetails,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_sponsor(event_id, sponsor_id, user)
        updated = (
            _sponsor_table()
            .update(
                {
                    **details.model_dump(mode="json"),
                    **_audit_fields(user.username),
                }
            )
            .eq("event_id", event_id)
            .eq("sponsor_id", sponsor_id)
            .eq("is_delete", False)
            .execute()
            .data
        )
        if not updated:
            raise HTTPException(status_code=404, detail="Active event sponsor not found")
        return {"success": True, "data": updated[0]}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception(
            "Failed to update sponsor %s for event %s",
            sponsor_id,
            event_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to update event sponsor",
        ) from error


@router.delete("/organizer/events/{event_id}/sponsors/{sponsor_id}")
def delete_event_sponsor(
    event_id: int,
    sponsor_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_sponsor(event_id, sponsor_id, user)
        deleted = (
            _sponsor_table()
            .update({"is_delete": True, **_audit_fields(user.username)})
            .eq("event_id", event_id)
            .eq("sponsor_id", sponsor_id)
            .eq("is_delete", False)
            .execute()
            .data
        )
        if not deleted:
            raise HTTPException(status_code=404, detail="Active event sponsor not found")
        return {"success": True, "message": "Event sponsor deleted"}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception(
            "Failed to delete sponsor %s for event %s",
            sponsor_id,
            event_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to delete event sponsor",
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


def _evaluation_release_progress(event_id: int) -> tuple[int, int]:
    registrations = (
        supabase.table("registration")
        .select("registration_id")
        .eq("event_id", event_id)
        .eq("status", "Confirmed")
        .or_("is_delete.eq.false,is_delete.is.null")
        .execute()
        .data
    )
    registration_ids = [row["registration_id"] for row in registrations]
    evaluations = []
    if registration_ids:
        evaluations = (
            supabase.table("evaluation")
            .select("registration_id")
            .eq("event_id", event_id)
            .in_("registration_id", registration_ids)
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
    evaluated_ids = {row["registration_id"] for row in evaluations}
    return len(registrations), len(evaluated_ids)


@router.get("/organizer/events/{event_id}/evaluation-release")
def get_evaluation_release_status(
    event_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        event = _get_owned_event(event_id, user)
        _auto_complete([event])
        event_row = (
            supabase.table("event")
            .select("results_released_at")
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .limit(1)
            .execute()
            .data
        )
        if not event_row:
            raise HTTPException(status_code=404, detail="Event not found")
        confirmed_count, evaluated_count = _evaluation_release_progress(event_id)
        return {
            "success": True,
            "data": {
                "released_at": event_row[0].get("results_released_at"),
                "confirmed_count": confirmed_count,
                "evaluated_count": evaluated_count,
                "missing_count": max(confirmed_count - evaluated_count, 0),
                "event_status": event.get("event_status"),
            },
        }
    except HTTPException:
        raise
    except Exception as error:
        if is_missing_object(error):
            raise HTTPException(
                status_code=503,
                detail="Score publishing is not set up. Run Documentation/evaluation_score_release.sql in Supabase.",
            ) from error
        logger.exception("Failed to fetch evaluation release status for event %s", event_id)
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch evaluation release status",
        ) from error


@router.post("/organizer/events/{event_id}/evaluation-release")
def release_event_evaluations(
    event_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_role(user, "Event Organizer")
    try:
        _get_owned_event(event_id, user)
        confirmed_count, evaluated_count = _evaluation_release_progress(event_id)
        missing_count = confirmed_count - evaluated_count
        if missing_count:
            raise HTTPException(
                status_code=409,
                detail=f"{missing_count} confirmed participant(s) still need an evaluation",
            )
        released_at = datetime.now().astimezone().isoformat()
        updated = (
            supabase.table("event")
            .update(
                {
                    "results_released_at": released_at,
                    **_audit_fields(user.username),
                }
            )
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .execute()
            .data
        )
        if not updated:
            raise HTTPException(status_code=404, detail="Event not found")
        return {
            "success": True,
            "data": {
                "released_at": updated[0].get("results_released_at") or released_at,
                "confirmed_count": confirmed_count,
                "evaluated_count": evaluated_count,
            },
        }
    except HTTPException:
        raise
    except Exception as error:
        if is_missing_object(error):
            raise HTTPException(
                status_code=503,
                detail="Score publishing is not set up. Run Documentation/evaluation_score_release.sql in Supabase.",
            ) from error
        logger.exception("Failed to publish evaluation scores for event %s", event_id)
        raise HTTPException(
            status_code=500,
            detail="Failed to publish evaluation scores",
        ) from error


def _revoke_evaluation_release(event_id: int, user: AuthenticatedUser) -> None:
    (
        supabase.table("event")
        .update(
            {
                "results_released_at": None,
                **_audit_fields(user.username),
            }
        )
        .eq("event_id", event_id)
        .eq("is_delete", False)
        .execute()
    )


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

        _revoke_evaluation_release(event_id, user)
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
        _revoke_evaluation_release(event_id, user)
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
        _revoke_evaluation_release(event_id, user)
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
        event = _get_owned_event(event_id, user)
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
        registrations = (
            supabase.table("registration")
            .select("registration_id, status, fee_paid")
            .eq("event_id", event_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
        registration_ids = [record["registration_id"] for record in registrations]
        verified_payments = []
        if registration_ids:
            payment_client = service_supabase or supabase
            verified_payments = (
                payment_client.table("payment_submission")
                .select("amount")
                .in_("registration_id", registration_ids)
                .eq("status", "Verified")
                .execute()
                .data
            )
        sessions = (
            supabase.table("session")
            .select("session_id, speaker_name")
            .eq("event_id", event_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
        session_ids = [record["session_id"] for record in sessions]

        attendance = []
        if registration_ids and session_ids:
            if service_supabase is None:
                raise HTTPException(
                    status_code=503,
                    detail="Attendance statistics are not configured on the backend.",
                )
            attendance = (
                service_supabase.table("session_attendance")
                .select("session_id, registration_id, attendance_status")
                .in_("session_id", session_ids)
                .in_("registration_id", registration_ids)
                .execute()
                .data
            )

        evaluations = []
        if registration_ids:
            evaluations = (
                supabase.table("evaluation")
                .select(
                    "registration_id, score, feedback_rating, certificate_issued"
                )
                .eq("event_id", event_id)
                .in_("registration_id", registration_ids)
                .or_("is_delete.eq.false,is_delete.is.null")
                .execute()
                .data
            )

        sponsors = (
            _sponsor_table()
            .select("sponsor_id, sponsorship_level")
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .execute()
            .data
        )
        hospitality = (
            supabase.table("hospitality")
            .select("hospitality_id")
            .eq("event_id", event_id)
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )

        registration_status_counts: dict[str, int] = {}
        fee_paid_total = Decimal("0")
        for registration in registrations:
            status = str(registration.get("status") or "Unspecified").strip() or "Unspecified"
            registration_status_counts[status] = (
                registration_status_counts.get(status, 0) + 1
            )
            try:
                fee_paid_total += Decimal(str(registration.get("fee_paid") or 0))
            except (InvalidOperation, TypeError, ValueError):
                logger.warning(
                    "Ignoring invalid fee_paid value for a registration in event %s",
                    event_id,
                )

        fees_collected = Decimal("0")
        for payment in verified_payments:
            try:
                fees_collected += Decimal(str(payment.get("amount") or 0))
            except (InvalidOperation, TypeError, ValueError):
                logger.warning(
                    "Ignoring invalid verified payment amount for event %s",
                    event_id,
                )

        attendance_by_status = {"Present": 0, "Absent": 0}
        present_registration_ids = set()
        absent_registration_ids = set()
        marked_attendance_pairs = set()
        for record in attendance:
            status = str(record.get("attendance_status") or "").strip().casefold()
            if status not in {"present", "absent"}:
                continue
            label = status.capitalize()
            attendance_by_status[label] += 1
            marked_attendance_pairs.add(
                (record["session_id"], record["registration_id"])
            )
            if label == "Present":
                present_registration_ids.add(record["registration_id"])
            else:
                absent_registration_ids.add(record["registration_id"])
        total_attendance_slots = len(session_ids) * len(registration_ids)

        score_values = []
        feedback_rating_counts: dict[int, int] = {}
        certificates_issued = 0
        for evaluation in evaluations:
            if evaluation.get("certificate_issued"):
                certificates_issued += 1
            score = evaluation.get("score")
            if score is not None:
                try:
                    number = float(score)
                    if number == number and abs(number) != float("inf"):
                        score_values.append(number)
                except (TypeError, ValueError):
                    logger.warning(
                        "Ignoring invalid evaluation score for event %s",
                        event_id,
                    )
            rating = evaluation.get("feedback_rating")
            if rating is not None:
                try:
                    normalized_rating = int(rating)
                    feedback_rating_counts[normalized_rating] = (
                        feedback_rating_counts.get(normalized_rating, 0) + 1
                    )
                except (TypeError, ValueError):
                    logger.warning(
                        "Ignoring invalid feedback rating for event %s",
                        event_id,
                    )

        score_distribution = []
        if score_values:
            minimum_score = min(score_values)
            maximum_score = max(score_values)
            if minimum_score == maximum_score:
                score_distribution.append(
                    {"label": f"{minimum_score:g}", "count": len(score_values)}
                )
            else:
                bucket_count = 5
                bucket_width = (maximum_score - minimum_score) / bucket_count
                counts = [0] * bucket_count
                for score in score_values:
                    bucket_index = min(
                        int((score - minimum_score) / bucket_width),
                        bucket_count - 1,
                    )
                    counts[bucket_index] += 1
                for index, count in enumerate(counts):
                    lower = minimum_score + bucket_width * index
                    upper = (
                        maximum_score
                        if index == bucket_count - 1
                        else minimum_score + bucket_width * (index + 1)
                    )
                    score_distribution.append(
                        {
                            "label": f"{lower:g}-{upper:g}",
                            "count": count,
                        }
                    )

        sponsor_levels: dict[str, int] = {}
        for sponsor in sponsors:
            level = str(sponsor.get("sponsorship_level") or "Unspecified").strip()
            level = level or "Unspecified"
            sponsor_levels[level] = sponsor_levels.get(level, 0) + 1

        speaker_names = sorted(
            {
                str(session["speaker_name"]).strip()
                for session in sessions
                if session.get("speaker_name") and str(session["speaker_name"]).strip()
            },
            key=str.casefold,
        )
        score_average = (
            sum(score_values) / len(score_values) if score_values else None
        )
        report = reports[0] if reports else {}
        return {
            "success": True,
            "data": {
                **report,
                "event": {
                    "event_id": event_id,
                    "name": event.get("name"),
                    "start_date": event.get("start_date"),
                    "end_date": event.get("end_date"),
                    "registration_fee": event.get("fee"),
                },
                "registrations": {
                    "total": len(registrations),
                    "status_counts": [
                        {"label": status, "count": count}
                        for status, count in sorted(
                            registration_status_counts.items(),
                            key=lambda item: item[0].casefold(),
                        )
                    ],
                    "fees_collected": float(fees_collected),
                    "verified_payments_count": len(verified_payments),
                    "fee_paid_total": float(fee_paid_total),
                },
                "attendance": {
                    "present_students": len(present_registration_ids),
                    "absent_students": len(absent_registration_ids),
                    "present_session_marks": attendance_by_status["Present"],
                    "absent_session_marks": attendance_by_status["Absent"],
                    "unmarked_session_slots": max(
                        total_attendance_slots - len(marked_attendance_pairs),
                        0,
                    ),
                    "total_session_slots": total_attendance_slots,
                },
                "sessions": {
                    "total": len(sessions),
                    "speakers_count": len(speaker_names),
                    "speaker_names": speaker_names,
                },
                "sponsors": {
                    "total": len(sponsors),
                    "by_level": [
                        {"label": level, "count": count}
                        for level, count in sorted(
                            sponsor_levels.items(),
                            key=lambda item: item[0].casefold(),
                        )
                    ],
                },
                "evaluations": {
                    "total": len(evaluations),
                    "scored_count": len(score_values),
                    "highest_score": max(score_values) if score_values else None,
                    "average_score": round(score_average, 2)
                    if score_average is not None
                    else None,
                    "score_distribution": score_distribution,
                    "feedback_ratings": [
                        {"label": str(rating), "count": count}
                        for rating, count in sorted(feedback_rating_counts.items())
                    ],
                    "certificates_issued": certificates_issued,
                },
                "hospitality_plans": len(hospitality),
            },
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Failed to build event report for event %s", event_id)
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
                    "fee": format(details.fee, "f"),
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
                    "fee": format(details.fee, "f"),
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
