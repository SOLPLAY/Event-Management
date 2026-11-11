from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from datetime import date, datetime
from typing import Optional
from event_management import supabase

router = APIRouter(
    prefix="/organizing-committee",
    tags=["Organizing Committee"]
)


@router.get("/event-schedule")
def get_event_sessions(
    event_id: int | None = Query(default=None)
):
    try:
        query = (
            supabase.table("session")
            .select("*")
            .eq("is_delete", False)
            .order("session_id", desc=True)
        )

        # Optional event filter
        if event_id is not None:
            query = query.eq("event_id", event_id)

        response = query.execute()

        if not response.data:
            raise HTTPException(
                status_code=404,
                detail="No event sessions found"
            )

        return {
            "success": True,
            "message": "Event sessions fetched successfully",
            "count": len(response.data),
            "data": response.data
        }

    except HTTPException:
        raise

    except Exception as e:
        print("Supabase error:", repr(e))
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch event sessions"
        )


class SessionCreate(BaseModel):
    event_id: int
    session_title: str = Field(min_length=1, max_length=250)
    speaker_name: Optional[str] = None
    start_time: datetime
    end_time: datetime
    venue: Optional[str] = None
    created_by: str


@router.post("/event-schedule", status_code=201)
def create_event_schedule(session: SessionCreate):
    try:
        # Validate event
        event = (
            supabase.table("event_organizer")
            .select("*")
            .eq("event_id", session.event_id)
            .limit(1)
            .execute()
        )

        if not event.data:
            raise HTTPException(
                status_code=404,
                detail="Event not found"
            )

        # Validate schedule time
        if session.start_time >= session.end_time:
            raise HTTPException(
                status_code=400,
                detail="Start time must be before end time"
            )

        # Prepare session data
        session_data = session.model_dump(mode="json")

        # Automatically generated fields
        now = datetime.now()

        session_data["is_delete"] = False
        session_data["created_date"] = now.date().isoformat()
        session_data["created_time"] = now.time().isoformat()

        # Insert into session table
        response = (
            supabase.table("session")
            .insert(session_data)
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=500,
                detail="Session creation failed"
            )

        return {
            "success": True,
            "message": "Event schedule created successfully",
            "data": response.data[0]
        }

    except HTTPException:
        raise

    except Exception as e:
        print("Supabase error:", repr(e))
        raise HTTPException(
            status_code=500,
            detail="Failed to create event schedule"
        )
        
        
class SessionUpdate(BaseModel):
    session_title: str = Field(min_length=1, max_length=250)
    speaker_name: Optional[str] = None
    start_time: datetime
    end_time: datetime
    venue: Optional[str] = None
    updated_by: str



@router.post("/event-schedule/{session_id}/update")
def update_event_session(
    session_id: int,
    session: SessionUpdate
):
    try:
        # Check whether session exists
        existing = (
            supabase.table("session")
            .select("session_id")
            .eq("session_id", session_id)
            .eq("is_delete", False)
            .limit(1)
            .execute()
        )

        if not existing.data:
            raise HTTPException(
                status_code=404,
                detail="Active event session not found"
            )

        # Validate time
        if session.start_time >= session.end_time:
            raise HTTPException(
                status_code=400,
                detail="Start time must be before end time"
            )

        # FIX: Serialize datetime fields into JSON-compatible strings
        update_data = session.model_dump(
            mode="json",
            exclude={"updated_by"}
        )

        now = datetime.now()

        update_data["updated_by"] = session.updated_by
        update_data["updated_date"] = now.date().isoformat()
        update_data["updated_time"] = now.time().isoformat()

        # Update session
        response = (
            supabase.table("session")
            .update(update_data)
            .eq("session_id", session_id)
            .eq("is_delete", False)
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=500,
                detail="Session update failed"
            )

        return {
            "success": True,
            "message": "Event session updated successfully",
            "data": response.data[0]
        }

    except HTTPException:
        raise

    except Exception as e:
        print("Supabase error:", repr(e))
        raise HTTPException(
            status_code=500,
            detail="Failed to update event session"
        )
        