from datetime import date, datetime
from typing import Literal
import os

from dotenv import load_dotenv
from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator
from supabase import Client, create_client

from auth_tokens import AuthenticatedUser

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Supabase credentials are missing in .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

EVENT_COLUMNS = (
    "event_id, name, type, start_date, end_date, event_status, "
    "is_delete, created_by, created_date, created_time, updated_by, "
    "updated_date, updated_time"
)
EVENT_TYPES = ("Hackathon", "Seminar", "Workshop", "Competition", "Symposium")
EVENT_TYPE_BY_NAME = {event_type.casefold(): event_type for event_type in EVENT_TYPES}


def _canonical_event_type(value: str | None) -> str:
    if not value:
        return ""
    normalized = value.strip()
    return EVENT_TYPE_BY_NAME.get(normalized.casefold(), normalized)


class EventDetails(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    type: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=5000)
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def validate_details(self):
        self.name = self.name.strip()
        canonical_type = EVENT_TYPE_BY_NAME.get(self.type.strip().casefold())
        self.description = self.description.strip()
        if not self.name or canonical_type is None:
            raise ValueError("Event name is required and event type must be a supported category")
        self.type = canonical_type
        if self.end_date < self.start_date:
            raise ValueError("End date must be on or after the start date")
        return self


class EventDecision(BaseModel):
    decision: Literal["Approved", "Rejected"]


def _require_role(user: AuthenticatedUser, role: str) -> None:
    if user.role.strip().casefold() != role.casefold():
        raise HTTPException(status_code=403, detail="You are not allowed to perform this action")


def _normalize_status(status: str | None) -> str:
    normalized = (status or "").strip().casefold()
    status_labels = {
        "created": "Pending",
        "pending": "Pending",
        "approved": "Approved",
        "reject": "Rejected",
        "rejected": "Rejected",
        "publish": "Published",
        "published": "Published",
        "completed": "Completed",
    }
    return status_labels.get(normalized, status or "Unknown")


def _audit_fields(username: str) -> dict:
    now = datetime.now()
    return {
        "updated_by": username,
        "updated_date": now.date().isoformat(),
        "updated_time": now.time().replace(microsecond=0).isoformat(),
    }


def _auto_complete(events: list[dict]) -> None:
    today = date.today()
    for event in events:
        end_date = event.get("end_date")
        if (
            _normalize_status(event.get("event_status")) == "Published"
            and end_date
            and date.fromisoformat(str(end_date)) < today
        ):
            updated = (
                supabase.table("event")
                .update({"event_status": "Completed", **_audit_fields("system")})
                .eq("event_id", event["event_id"])
                .eq("event_status", event["event_status"])
                .execute()
                .data
            )
            if updated:
                event["event_status"] = "Completed"


def _event_cards(events: list[dict]) -> list[dict]:
    if not events:
        return []

    _auto_complete(events)
    event_ids = [event["event_id"] for event in events]
    organizer_rows = (
        supabase.table("event_organizer")
        .select("event_id, person_id")
        .in_("event_id", event_ids)
        .eq("is_delete", False)
        .execute()
        .data
    )
    event_types = (
        supabase.table("event_type")
        .select("event_id, category, description")
        .in_("event_id", event_ids)
        .eq("is_delete", False)
        .execute()
        .data
    )

    person_ids = list({row["person_id"] for row in organizer_rows})
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

    organizers_by_event: dict[int, list[str]] = {}
    for row in organizer_rows:
        person_id = row["person_id"]
        person = people_by_id.get(person_id, {})
        name = " ".join(
            part for part in (person.get("first_name"), person.get("last_name")) if part
        )
        organizers_by_event.setdefault(row["event_id"], []).append(
            name or f"Person {person_id}"
        )

    type_by_event = {row["event_id"]: row for row in event_types}
    return [
        {
            **event,
            "type": _canonical_event_type(
                type_by_event.get(event["event_id"], {}).get("category")
                or event.get("type")
            ),
            "description": type_by_event.get(event["event_id"], {}).get("description") or "",
            "event_status": _normalize_status(event.get("event_status")),
            "organizers": organizers_by_event.get(event["event_id"], []),
        }
        for event in events
    ]


def _get_event(event_id: int) -> dict:
    response = (
        supabase.table("event")
        .select(EVENT_COLUMNS)
        .eq("event_id", event_id)
        .eq("is_delete", False)
        .limit(1)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="Event not found")
    return response.data[0]


def _get_owned_event(event_id: int, user: AuthenticatedUser) -> dict:
    ownership = (
        supabase.table("event_organizer")
        .select("organizer_id")
        .eq("event_id", event_id)
        .eq("person_id", user.person_id)
        .eq("is_delete", False)
        .limit(1)
        .execute()
    )
    if not ownership.data:
        raise HTTPException(status_code=404, detail="Event not found")
    return _get_event(event_id)


def _save_event_type(
    event_id: int,
    category: str,
    description: str,
    username: str,
) -> None:
    existing = (
        supabase.table("event_type")
        .select("event_type_id")
        .eq("event_id", event_id)
        .eq("is_delete", False)
        .execute()
    )
    audit = _audit_fields(username)
    if existing.data:
        (
            supabase.table("event_type")
            .update({"category": category, "description": description, **audit})
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .execute()
        )
    else:
        (
            supabase.table("event_type")
            .insert(
                {
                    "event_id": event_id,
                    "category": category,
                    "description": description,
                    "created_by": username,
                }
            )
            .execute()
        )

