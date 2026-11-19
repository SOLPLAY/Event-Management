import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field, model_validator

from auth_tokens import AuthenticatedUser, get_current_user
from event_management import (
    _audit_fields,
    _get_owned_event,
    _require_role,
    service_supabase,
)
from user_role.common import get_visible_event, is_missing_object, require_user

organizer_router = APIRouter(prefix="/event-management", tags=["Event Photographs"])
user_router = APIRouter(prefix="/user", tags=["User"])
logger = logging.getLogger(__name__)

PHOTOGRAPH_BUCKET = "event-photographs"
MAX_PHOTOGRAPH_BYTES = 20 * 1024 * 1024
SIGNED_URL_SECONDS = 3600
PHOTOGRAPH_TYPES = {
    "image/jpeg": ("jpg", lambda data: data.startswith(b"\xff\xd8\xff")),
    "image/png": ("png", lambda data: data.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/webp": (
        "webp",
        lambda data: data.startswith(b"RIFF") and data[8:12] == b"WEBP",
    ),
}
PHOTOGRAPH_COLUMNS = (
    "photograph_id, event_id, storage_path, caption, file_name, "
    "content_type, file_size, created_by, created_date, created_time, "
    "updated_by, updated_date, updated_time"
)
PHOTOGRAPH_SETUP_HINT = (
    "Event photographs are not set up yet. Run "
    "Documentation/event_photographs.sql in Supabase."
)


class PhotographCaption(BaseModel):
    caption: str = Field(max_length=500)

    @model_validator(mode="after")
    def normalize_caption(self):
        self.caption = self.caption.strip()
        return self


def _require_photo_client():
    if service_supabase is None:
        raise HTTPException(
            status_code=503,
            detail="Event photograph storage is not configured on the backend.",
        )
    return service_supabase


def _require_owned_event(event_id: int, user: AuthenticatedUser) -> dict:
    _require_role(user, "Event Organizer")
    return _get_owned_event(event_id, user)


def _read_upload(upload: UploadFile) -> tuple[bytes, str, str, str]:
    content_type = (upload.content_type or "").lower()
    photo_type = PHOTOGRAPH_TYPES.get(content_type)
    if photo_type is None:
        raise HTTPException(
            status_code=415,
            detail="Choose a JPEG, PNG, or WebP image.",
        )

    data = upload.file.read(MAX_PHOTOGRAPH_BYTES + 1)
    if len(data) > MAX_PHOTOGRAPH_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Each event photograph must be 20 MB or smaller.",
        )
    extension, matches_signature = photo_type
    if not matches_signature(data):
        raise HTTPException(
            status_code=415,
            detail="The uploaded file does not match its image type.",
        )

    original_name = (upload.filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not original_name:
        original_name = f"photograph.{extension}"
    return data, content_type, extension, original_name[:255]


def _signed_photographs(rows: list[dict]) -> list[dict]:
    if not rows:
        return []

    client = _require_photo_client()
    try:
        signed_results = client.storage.from_(PHOTOGRAPH_BUCKET).create_signed_urls(
            [row["storage_path"] for row in rows],
            SIGNED_URL_SECONDS,
        )
    except Exception as error:
        logger.exception("Could not create event photograph links")
        raise HTTPException(
            status_code=503,
            detail="Event photographs could not be loaded from storage.",
        ) from error

    signed_urls = {}
    for result in signed_results:
        signed_url = result.get("signedURL") or result.get("signedUrl")
        if result.get("error") or not result.get("path") or not signed_url:
            logger.error(
                "Could not create a signed event photograph link: %s",
                result.get("error") or "invalid signing response",
            )
            raise HTTPException(
                status_code=503,
                detail="One or more event photographs could not be loaded from storage.",
            )
        signed_urls[result["path"]] = signed_url

    return [
        {
            "photograph_id": row["photograph_id"],
            "caption": row.get("caption") or "",
            "file_name": row.get("file_name"),
            "content_type": row.get("content_type"),
            "file_size": row.get("file_size"),
            "created_date": row.get("created_date"),
            "created_time": row.get("created_time"),
            "photograph_url": signed_urls[row["storage_path"]],
        }
        for row in rows
    ]


def _active_photograph(event_id: int, photograph_id: int) -> dict:
    rows = (
        _require_photo_client().table("event_photograph")
        .select(PHOTOGRAPH_COLUMNS)
        .eq("event_id", event_id)
        .eq("photograph_id", photograph_id)
        .eq("is_delete", False)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Event photograph not found.")
    return rows[0]


def _raise_data_error(error: Exception, action: str) -> None:
    if is_missing_object(error):
        logger.warning("%s: %s", action, PHOTOGRAPH_SETUP_HINT)
        raise HTTPException(status_code=503, detail=PHOTOGRAPH_SETUP_HINT) from error
    logger.exception("%s", action)
    raise HTTPException(
        status_code=500,
        detail="Unable to complete the event photograph request.",
    ) from error


def _remove_storage_file(path: str) -> str | None:
    try:
        _require_photo_client().storage.from_(PHOTOGRAPH_BUCKET).remove([path])
        return None
    except Exception:
        logger.exception("Could not remove event photograph storage file %s", path)
        return "The photograph record was updated, but its old storage file could not be removed."


@organizer_router.get("/organizer/events/{event_id}/photographs")
def get_event_photographs(
    event_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_owned_event(event_id, user)
    try:
        rows = (
            _require_photo_client().table("event_photograph")
            .select(PHOTOGRAPH_COLUMNS)
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .order("created_date", desc=True)
            .order("created_time", desc=True)
            .execute()
            .data
        )
        return {"success": True, "data": _signed_photographs(rows)}
    except HTTPException:
        raise
    except Exception as error:
        _raise_data_error(error, f"Could not load photographs for event {event_id}")


@organizer_router.post(
    "/organizer/events/{event_id}/photographs",
    status_code=201,
)
def create_event_photograph(
    event_id: int,
    caption: str = Form(default="", max_length=500),
    photo: UploadFile = File(...),
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_owned_event(event_id, user)
    uploaded_path = None
    record_saved = False
    try:
        if len(caption) > 500:
            raise HTTPException(status_code=422, detail="Caption must be 500 characters or fewer.")
        data, content_type, extension, file_name = _read_upload(photo)
        client = _require_photo_client()
        uploaded_path = f"{event_id}/{uuid.uuid4().hex}.{extension}"
        client.storage.from_(PHOTOGRAPH_BUCKET).upload(
            uploaded_path,
            data,
            {"content-type": content_type},
        )

        now = datetime.now()
        rows = (
            _require_photo_client().table("event_photograph")
            .insert(
                {
                    "event_id": event_id,
                    "storage_path": uploaded_path,
                    "caption": caption.strip(),
                    "file_name": file_name,
                    "content_type": content_type,
                    "file_size": len(data),
                    "is_delete": False,
                    "created_by": user.username,
                    "created_date": now.date().isoformat(),
                    "created_time": now.time().replace(microsecond=0).isoformat(),
                }
            )
            .execute()
            .data
        )
        if not rows:
            raise RuntimeError("The photograph record insert returned no record.")
        record_saved = True
        return {"success": True, "data": _signed_photographs(rows)[0]}
    except HTTPException:
        if uploaded_path and not record_saved:
            _remove_storage_file(uploaded_path)
        raise
    except Exception as error:
        if uploaded_path and not record_saved:
            _remove_storage_file(uploaded_path)
        _raise_data_error(error, f"Could not add a photograph to event {event_id}")
    finally:
        photo.file.close()


@organizer_router.patch(
    "/organizer/events/{event_id}/photographs/{photograph_id}",
)
def update_event_photograph_caption(
    event_id: int,
    photograph_id: int,
    details: PhotographCaption,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_owned_event(event_id, user)
    try:
        _active_photograph(event_id, photograph_id)
        rows = (
            _require_photo_client().table("event_photograph")
            .update(
                {
                    "caption": details.caption,
                    **_audit_fields(user.username),
                }
            )
            .eq("event_id", event_id)
            .eq("photograph_id", photograph_id)
            .eq("is_delete", False)
            .execute()
            .data
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Event photograph not found.")
        return {"success": True, "data": _signed_photographs(rows)[0]}
    except HTTPException:
        raise
    except Exception as error:
        _raise_data_error(error, f"Could not update photograph {photograph_id}")


@organizer_router.put(
    "/organizer/events/{event_id}/photographs/{photograph_id}/image",
)
def replace_event_photograph_image(
    event_id: int,
    photograph_id: int,
    photo: UploadFile = File(...),
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_owned_event(event_id, user)
    uploaded_path = None
    record_saved = False
    try:
        existing = _active_photograph(event_id, photograph_id)
        data, content_type, extension, file_name = _read_upload(photo)
        client = _require_photo_client()
        uploaded_path = f"{event_id}/{uuid.uuid4().hex}.{extension}"
        client.storage.from_(PHOTOGRAPH_BUCKET).upload(
            uploaded_path,
            data,
            {"content-type": content_type},
        )
        rows = (
            _require_photo_client().table("event_photograph")
            .update(
                {
                    "storage_path": uploaded_path,
                    "file_name": file_name,
                    "content_type": content_type,
                    "file_size": len(data),
                    **_audit_fields(user.username),
                }
            )
            .eq("event_id", event_id)
            .eq("photograph_id", photograph_id)
            .eq("is_delete", False)
            .execute()
            .data
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Event photograph not found.")
        record_saved = True
        warning = _remove_storage_file(existing["storage_path"])
        return {
            "success": True,
            "data": _signed_photographs(rows)[0],
            "warning": warning,
        }
    except HTTPException:
        if uploaded_path and not record_saved:
            _remove_storage_file(uploaded_path)
        raise
    except Exception as error:
        if uploaded_path and not record_saved:
            _remove_storage_file(uploaded_path)
        _raise_data_error(error, f"Could not replace photograph {photograph_id}")
    finally:
        photo.file.close()


@organizer_router.delete(
    "/organizer/events/{event_id}/photographs/{photograph_id}",
)
def delete_event_photograph(
    event_id: int,
    photograph_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_owned_event(event_id, user)
    try:
        existing = _active_photograph(event_id, photograph_id)
        rows = (
            _require_photo_client().table("event_photograph")
            .update(
                {
                    "is_delete": True,
                    **_audit_fields(user.username),
                }
            )
            .eq("event_id", event_id)
            .eq("photograph_id", photograph_id)
            .eq("is_delete", False)
            .execute()
            .data
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Event photograph not found.")
        warning = _remove_storage_file(existing["storage_path"])
        return {
            "success": True,
            "message": "Event photograph deleted.",
            "warning": warning,
        }
    except HTTPException:
        raise
    except Exception as error:
        _raise_data_error(error, f"Could not delete photograph {photograph_id}")


@user_router.get("/events/{event_id}/photographs")
def get_user_event_photographs(
    event_id: int,
    user: AuthenticatedUser = Depends(get_current_user),
):
    require_user(user)
    try:
        if not get_visible_event(event_id):
            raise HTTPException(status_code=404, detail="Event not found.")
        rows = (
            _require_photo_client().table("event_photograph")
            .select(PHOTOGRAPH_COLUMNS)
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .order("created_date", desc=True)
            .order("created_time", desc=True)
            .execute()
            .data
        )
        return {"success": True, "data": {"items": _signed_photographs(rows)}}
    except HTTPException:
        raise
    except Exception as error:
        _raise_data_error(error, f"Could not load user photographs for event {event_id}")
