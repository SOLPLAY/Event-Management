"""User role - event page tabs: hospitality, my accommodation, results (feature 3).

    GET /user/events/{event_id}/hospitality    - meals / hospitality planned for the event
    GET /user/events/{event_id}/accommodation  - the signed-in user's own accommodation booking
    POST /user/events/{event_id}/accommodation - request a stay for a confirmed registration
    GET /user/events/{event_id}/results        - my evaluation, winners and the event report
                                                 (only once the event is Completed)

Mounted on the main user router by events.py (paths below are relative to /user).
"""
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, model_validator

from auth_tokens import AuthenticatedUser, get_current_user
from event_management import supabase
from user_role.common import (
    full_name,
    get_visible_event,
    is_completed,
    is_missing_object,
    logger,
    my_registration,
    require_user,
    registration_open,
    run_parallel,
)

router = APIRouter()

MAX_PHOTOS = 24


class AccommodationRequest(BaseModel):
    check_in_date: date
    check_out_date: date

    @model_validator(mode="after")
    def validate_stay(self):
        if self.check_out_date <= self.check_in_date:
            raise ValueError("Check-out date must be after check-in date")
        return self


def _optional_rows(label: str, query_fn) -> list[dict]:
    """Rows from a table that may not have been created yet (migration not run): [] instead of an error."""
    try:
        return query_fn()
    except Exception as error:
        if is_missing_object(error):
            logger.warning("%s is missing - run the feature 3 SQL migration", label)
            return []
        raise


def _photo_urls(raw) -> list[str]:
    """event_report.photographs_url may hold one or several links separated by spaces, commas or new lines."""
    urls = []
    for part in re.split(r"[\s,;]+", str(raw or "")):
        part = part.strip()
        if part.lower().startswith(("http://", "https://")) and part not in urls:
            urls.append(part)
    return urls[:MAX_PHOTOS]


@router.get("/events/{event_id}/hospitality")
def get_hospitality(event_id: int, user: AuthenticatedUser = Depends(get_current_user)):
    require_user(user)
    def rows():
        # Only what an attendee needs: which meal and when. Vendor and head count stay internal.
        return (
            supabase.table("hospitality")
            .select("hospitality_id, meal_type, service_date")
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .order("service_date")
            .execute()
            .data
        )

    try:
        event, items = run_parallel(lambda: get_visible_event(event_id), rows)
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
    except HTTPException:
        raise
    except Exception:
        logger.exception("Could not load hospitality for event %s", event_id)
        raise HTTPException(status_code=500, detail="Unable to load hospitality details right now")

    return {"success": True, "data": {"items": items}}


@router.get("/events/{event_id}/accommodation")
def get_accommodation(event_id: int, user: AuthenticatedUser = Depends(get_current_user)):
    require_user(user)
    try:
        event, registration = run_parallel(
            lambda: get_visible_event(event_id), lambda: my_registration(event_id, user.person_id)
        )
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        booking = None
        if registration:
            rows = (
                supabase.table("accommodation")
                .select(
                    "accommodation_id, request_status, room_id, building_name, "
                    "room_number, check_in_date, check_out_date"
                )
                .eq("registration_id", registration["registration_id"])  # the caller's own registration only
                .or_("is_delete.eq.false,is_delete.is.null")
                .limit(1)
                .execute()
                .data
            )
            booking = rows[0] if rows else None
    except HTTPException:
        raise
    except Exception:
        logger.exception("Could not load accommodation for event %s person %s", event_id, user.person_id)
        raise HTTPException(status_code=500, detail="Unable to load your accommodation right now")

    return {
        "success": True,
        "data": {
            "registered": registration is not None,
            "registration_status": registration["status"] if registration else None,
            "accommodation": booking,
        },
    }


@router.post("/events/{event_id}/accommodation", status_code=201)
def request_accommodation(
    event_id: int,
    request: AccommodationRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    require_user(user)
    try:
        event, registration = run_parallel(
            lambda: get_visible_event(event_id),
            lambda: my_registration(event_id, user.person_id),
        )
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        if not registration_open(event):
            raise HTTPException(
                status_code=409,
                detail="Accommodation requests are closed for this event",
            )
        if not registration:
            raise HTTPException(
                status_code=409,
                detail="Register for this event before requesting accommodation",
            )
        if registration["status"] != "Confirmed":
            raise HTTPException(
                status_code=409,
                detail="Your event registration must be confirmed before requesting accommodation",
            )

        event_start = date.fromisoformat(str(event["start_date"])[:10])
        event_end = date.fromisoformat(str(event["end_date"])[:10])
        if request.check_in_date > event_end or request.check_out_date < event_start:
            raise HTTPException(
                status_code=422,
                detail="The requested stay must overlap the event dates",
            )

        existing = (
            supabase.table("accommodation")
            .select("accommodation_id, request_status")
            .eq("registration_id", registration["registration_id"])
            .or_("is_delete.eq.false,is_delete.is.null")
            .order("accommodation_id", desc=True)
            .execute()
            .data
        )
        if any(
            row.get("request_status") in {"Pending", "Approved"} for row in existing
        ):
            raise HTTPException(
                status_code=409,
                detail="An active accommodation request already exists",
            )
        rejected_request = next(
            (row for row in existing if row.get("request_status") == "Rejected"),
            None,
        )

        request_data = {
            "check_in_date": request.check_in_date.isoformat(),
            "check_out_date": request.check_out_date.isoformat(),
            "request_status": "Pending",
            "room_id": None,
            "building_name": None,
            "room_number": None,
            "updated_by": user.username,
            "updated_date": date.today().isoformat(),
        }
        if rejected_request:
            rows = (
                supabase.table("accommodation")
                .update(request_data)
                .eq("accommodation_id", rejected_request["accommodation_id"])
                .eq("request_status", "Rejected")
                .or_("is_delete.eq.false,is_delete.is.null")
                .execute()
                .data
            )
            if not rows:
                raise HTTPException(
                    status_code=409,
                    detail="The accommodation request changed; refresh and try again",
                )
        else:
            request_data.update(
                {
                    "registration_id": registration["registration_id"],
                    "is_delete": False,
                    "created_by": user.username,
                    "created_date": date.today().isoformat(),
                }
            )
            rows = supabase.table("accommodation").insert(request_data).execute().data
            if not rows:
                raise RuntimeError("The accommodation request insert returned no record")

        return {
            "success": True,
            "data": {
                "registered": True,
                "registration_status": registration["status"],
                "accommodation": rows[0],
            },
        }
    except HTTPException:
        raise
    except Exception as error:
        if getattr(error, "code", None) == "23505":
            raise HTTPException(
                status_code=409,
                detail="An active accommodation request already exists",
            ) from error
        logger.exception(
            "Could not create accommodation request for event %s person %s",
            event_id,
            user.person_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Unable to submit your accommodation request right now",
        ) from error


@router.get("/events/{event_id}/results")
def get_results(event_id: int, user: AuthenticatedUser = Depends(get_current_user)):
    require_user(user)
    def winner_rows():
        return _optional_rows(
            "event_winner",
            lambda: supabase.table("event_winner")
            .select("position, prize, remarks, registration_id")
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .order("position")
            .execute()
            .data,
        )

    def report_rows():
        return (
            supabase.table("event_report")
            .select("summary_text, total_attendees, photographs_url, report_date")
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .limit(1)
            .execute()
            .data
        )

    try:
        # Round 1: everything that does not depend on anything else, at the same time.
        event, registration, winner_list, report_list = run_parallel(
            lambda: get_visible_event(event_id),
            lambda: my_registration(event_id, user.person_id),
            winner_rows,
            report_rows,
        )
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        if not is_completed(event):
            raise HTTPException(status_code=409, detail="Results are available once the event is completed")
        release_rows = (
            supabase.table("event")
            .select("results_released_at")
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .limit(1)
            .execute()
            .data
        )
        if not release_rows:
            raise HTTPException(status_code=404, detail="Event not found")
        released_at = release_rows[0].get("results_released_at")

        def my_evaluation():
            if not registration or not released_at:
                return None
            rows = (
                supabase.table("evaluation")
                .select("score, certificate_issued")
                .eq("event_id", event_id)
                .eq("registration_id", registration["registration_id"])  # only my own row
                .eq("is_delete", False)
                .limit(1)
                .execute()
                .data
            )
            return rows[0] if rows else None

        def winner_people():
            """(registration_id -> person_id, person_id -> person) for the winners; names only."""
            if not winner_list:
                return {}, {}
            regs = (
                supabase.table("registration")
                .select("registration_id, person_id")
                .in_("registration_id", [row["registration_id"] for row in winner_list])
                .eq("event_id", event_id)
                .execute()
                .data
            )
            person_by_reg = {row["registration_id"]: row["person_id"] for row in regs}
            person_ids = list(set(person_by_reg.values()))
            people = {}
            if person_ids:
                people = {
                    p["person_id"]: p
                    for p in supabase.table("person")
                    .select("person_id, first_name, last_name")  # names only, never contact details
                    .in_("person_id", person_ids)
                    .execute()
                    .data
                }
            return person_by_reg, people

        # Round 2: the two lookups that needed round 1, again at the same time.
        evaluation, (person_by_reg, people) = run_parallel(my_evaluation, winner_people)

        winners = []
        for row in winner_list:
            person_id = person_by_reg.get(row["registration_id"])
            if person_id is None:
                continue  # winner row pointing at another event's registration: ignore
            winners.append(
                {
                    "position": row["position"],
                    "name": full_name(people.get(person_id, {})) or "Participant",
                    "prize": row.get("prize"),
                    "remarks": row.get("remarks"),
                    "is_me": person_id == user.person_id,
                }
            )

        report = None
        if report_list:
            row = report_list[0]
            report = {
                "summary_text": row.get("summary_text"),
                "total_attendees": row.get("total_attendees"),
                "report_date": row.get("report_date"),
                "photos": _photo_urls(row.get("photographs_url")),
            }
    except HTTPException:
        raise
    except Exception as error:
        if is_missing_object(error):
            raise HTTPException(
                status_code=503,
                detail="Results publishing is not set up yet. Please contact the organiser.",
            ) from error
        logger.exception("Could not load results for event %s person %s", event_id, user.person_id)
        raise HTTPException(status_code=500, detail="Unable to load the results right now")

    return {
        "success": True,
        "data": {
            "registered": registration is not None,
            "released": True,
            "my_evaluation": evaluation,
            "winners": winners,
            "report": report,
        },
    }


@router.get("/events/{event_id}/evaluation-scores")
def get_evaluation_scores(
    event_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    require_user(user)
    try:
        event = get_visible_event(event_id)
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        released_event = (
            supabase.table("event")
            .select("results_released_at")
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .limit(1)
            .execute()
            .data
        )
        if not released_event:
            raise HTTPException(status_code=404, detail="Event not found")
        released_at = released_event[0].get("results_released_at")
        if not released_at:
            return {
                "success": True,
                "data": {"released": False, "scores": []},
            }

        registrations = (
            supabase.table("registration")
            .select("registration_id, person_id")
            .eq("event_id", event_id)
            .eq("status", "Confirmed")
            .or_("is_delete.eq.false,is_delete.is.null")
            .execute()
            .data
        )
        registration_by_id = {
            row["registration_id"]: row for row in registrations
        }
        registration_ids = list(registration_by_id)
        evaluations = []
        if registration_ids:
            evaluations = (
                supabase.table("evaluation")
                .select("registration_id, score")
                .eq("event_id", event_id)
                .in_("registration_id", registration_ids)
                .or_("is_delete.eq.false,is_delete.is.null")
                .execute()
                .data
            )

        person_ids = list(
            {
                registration_by_id[row["registration_id"]]["person_id"]
                for row in evaluations
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

        scores = []
        for evaluation in evaluations:
            registration = registration_by_id[evaluation["registration_id"]]
            person_id = registration["person_id"]
            person = people_by_id.get(person_id, {})
            scores.append(
                {
                    "name": full_name(person) or "Participant",
                    "score": evaluation.get("score"),
                    "is_me": person_id == user.person_id,
                }
            )
        scores.sort(
            key=lambda row: (
                row["score"] is None,
                -(float(row["score"]) if row["score"] is not None else 0),
                row["name"].casefold(),
            )
        )
        return {
            "success": True,
            "data": {
                "released": True,
                "released_at": released_at,
                "scores": scores,
            },
        }
    except HTTPException:
        raise
    except Exception as error:
        if is_missing_object(error):
            logger.warning(
                "Evaluation score release column is missing; run the evaluation release SQL migration"
            )
            raise HTTPException(
                status_code=503,
                detail="Evaluation score publishing is not set up yet. Please contact the organiser.",
            ) from error
        logger.exception(
            "Could not load evaluation scores for event %s person %s",
            event_id,
            user.person_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Unable to load evaluation scores right now",
        ) from error
