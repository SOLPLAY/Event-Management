from fastapi import APIRouter, HTTPException

from .repository import get_event


router = APIRouter(
    prefix="/api/couchbase",
    tags=["Couchbase"]
)


@router.get("/events/{event_id}")
def read_event(event_id: str):

    event = get_event(event_id)

    if event is None:
        raise HTTPException(
            status_code=404,
            detail="Event not found"
        )

    return event