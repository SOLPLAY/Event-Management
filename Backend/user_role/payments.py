"""User role - payment page for paid events (feature 3).

    GET  /user/events/{event_id}/payment   - where to pay, the user's registration and past submissions
    POST /user/events/{event_id}/payment   - submit proof of payment (details + screenshot) for verification

Flow: the user registers (status Pending) -> pays online outside this system (UPI / bank) ->
submits the transaction details and a screenshot here -> an organiser verifies it, which sets the
registration to Confirmed. Verification itself is not part of the User role.

The screenshot is sent as base64 inside the JSON body (no extra Python package needed), checked for
size and real image type, and stored in the PRIVATE Supabase Storage bucket "payment-proofs".
Mounted on the main user router by events.py (paths here are relative to /user).
"""
import base64
import binascii
import re
import uuid
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_tokens import AuthenticatedUser, get_current_user
from event_management import supabase
from user_role.common import (
    STATUS_CONFIRMED,
    error_code,
    event_phase,
    fee_json,
    is_missing_object,
    logger,
    my_registration,
    parse_date,
    read_fee,
    require_user,
    visible_event_or_404,
)

router = APIRouter()

BUCKET = "payment-proofs"
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_BASE64_CHARS = (MAX_IMAGE_BYTES * 4) // 3 + 4096  # refuse oversized bodies before decoding
SIGNED_URL_SECONDS = 3600
PAYMENT_METHODS = ["UPI", "Net Banking", "Card", "Other"]
TXN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/\-]{5,39}$")
MAX_AMOUNT = Decimal("99999999")

SETUP_HINT = "Payments are not set up yet. Please contact the organiser."


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _detect_image(data: bytes) -> tuple[str, str] | None:
    """(extension, mime type) from the file's real first bytes, or None if it is not PNG/JPEG/WebP."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None


def _signed_url(path: str | None) -> str | None:
    """Short-lived link to a private screenshot; None if it cannot be created."""
    if not path:
        return None
    try:
        response = supabase.storage.from_(BUCKET).create_signed_url(path, SIGNED_URL_SECONDS)
        return response.get("signedURL") or response.get("signedUrl")
    except Exception:
        logger.warning("Could not create a signed URL for %s", path, exc_info=True)
        return None


def _payment_account(event_id: int) -> dict | None:
    try:
        rows = (
            supabase.table("event_payment_account")
            .select("payee_name, upi_id, bank_name, account_number, ifsc_code, instructions")
            .eq("event_id", event_id)
            .eq("is_delete", False)
            .limit(1)
            .execute()
            .data
        )
    except Exception as error:
        if is_missing_object(error):
            logger.warning("event_payment_account table is missing - run the feature 3 SQL migration")
            return None
        raise
    return rows[0] if rows else None


def _submissions(registration_id: int) -> list[dict]:
    try:
        return (
            supabase.table("payment_submission")
            .select("payment_id, transaction_id, amount, payment_date, payment_method, screenshot_path, status, remarks, created_date")
            .eq("registration_id", registration_id)
            .eq("is_delete", False)
            .order("payment_id", desc=True)
            .execute()
            .data
        )
    except Exception as error:
        if is_missing_object(error):
            logger.warning("payment_submission table is missing - run the feature 3 SQL migration")
            raise HTTPException(status_code=503, detail=SETUP_HINT)
        raise


def _public_submission(row: dict) -> dict:
    return {
        "payment_id": row["payment_id"],
        "transaction_id": row["transaction_id"],
        "amount": row["amount"],
        "payment_date": row["payment_date"],
        "payment_method": row["payment_method"],
        "status": row["status"],
        "remarks": row.get("remarks"),
        "submitted_on": row.get("created_date"),
        "screenshot_url": _signed_url(row.get("screenshot_path")),
    }


def _fee_or_error(event_id: int) -> Decimal:
    fee = read_fee(event_id)
    if fee is None:
        raise HTTPException(
            status_code=503,
            detail="The registration fee for this event is not set up yet. Please contact the organiser.",
        )
    return fee


def _blocked_reason(event: dict, fee: Decimal, registration: dict, submissions: list[dict], account: dict | None) -> str | None:
    """Why the user cannot submit a payment right now (None = they can)."""
    if fee == 0:
        return "This event is free - no payment is needed."
    if registration["status"] == STATUS_CONFIRMED:
        return "Your payment has been verified and your place is confirmed."
    if event_phase(event) == "Ended":
        return "This event has ended, so payments are closed."
    if any(row["status"] == "Verified" for row in submissions):
        return "Your payment has already been verified."
    if any(row["status"] == "Submitted" for row in submissions):
        return "Your payment proof is waiting for the organiser to verify it."
    if not account:
        return "The organiser has not published the payment details for this event yet. Please check back soon."
    return None


# ---------------------------------------------------------------------------
# endpoints
# ---------------------------------------------------------------------------

@router.get("/events/{event_id}/payment")
def get_payment_page(event_id: int, user: AuthenticatedUser = Depends(get_current_user)):
    require_user(user)
    try:
        event = visible_event_or_404(event_id)
        fee = _fee_or_error(event_id)
        registration = my_registration(event_id, user.person_id)
        if not registration:
            raise HTTPException(status_code=409, detail="Register for this event first to see the payment page")

        account = _payment_account(event_id) if fee > 0 else None
        submissions = _submissions(registration["registration_id"])
        reason = _blocked_reason(event, fee, registration, submissions, account)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Could not load payment page for event %s person %s", event_id, user.person_id)
        raise HTTPException(status_code=500, detail="Unable to load the payment page right now")

    return {
        "success": True,
        "data": {
            "event_id": event_id,
            "event_name": event.get("name"),
            "fee": fee_json(fee),
            "registration": {"status": registration["status"], "fee_paid": registration.get("fee_paid")},
            "account": account,
            "payment_methods": PAYMENT_METHODS,
            "max_image_mb": MAX_IMAGE_BYTES // (1024 * 1024),
            "submissions": [_public_submission(row) for row in submissions],
            "can_submit": reason is None,
            "blocked_reason": reason,
        },
    }


class PaymentProofIn(BaseModel):
    """Everything is optional here so that missing fields give a readable message instead of a schema error."""

    transaction_id: str | None = None
    amount: Any = None
    payment_date: str | None = None
    payment_method: str | None = None
    screenshot: str | None = None  # base64 (a data: URL prefix is accepted)


def _validate_proof(body: PaymentProofIn, fee: Decimal) -> dict:
    """Clean values or HTTP 422 with a message the user can act on."""
    def bad(message: str):
        raise HTTPException(status_code=422, detail=message)

    transaction_id = (body.transaction_id or "").strip()
    if not TXN_ID_PATTERN.match(transaction_id):
        bad("Enter the transaction ID / UTR exactly as shown in your payment app (6-40 letters, numbers, - . _ /).")

    if body.amount is None or isinstance(body.amount, bool) or str(body.amount).strip() == "":
        bad("Enter the amount you paid.")
    try:
        amount = Decimal(str(body.amount).strip())
    except InvalidOperation:
        bad("The amount must be a number.")
    if not amount.is_finite() or amount <= 0:
        bad("The amount must be greater than zero.")
    if amount != amount.quantize(Decimal("0.01")):
        bad("The amount can have at most two decimal places.")
    if amount < fee:
        bad(f"The amount must be at least the registration fee (Rs {fee.normalize():f}).")
    if amount > MAX_AMOUNT:
        bad("That amount is too large. Please check it.")

    paid_on = parse_date(body.payment_date) if body.payment_date and len(body.payment_date) >= 10 else None
    if paid_on is None:
        bad("Enter the date you made the payment.")
    if paid_on > date.today() + timedelta(days=1):  # one day of slack for time zones
        bad("The payment date cannot be in the future.")

    method = (body.payment_method or "").strip()
    if method not in PAYMENT_METHODS:
        bad("Choose how you paid: " + ", ".join(PAYMENT_METHODS) + ".")

    encoded = (body.screenshot or "").strip()
    if not encoded:
        bad("Attach a screenshot of your payment.")
    if encoded.startswith("data:"):
        _, _, encoded = encoded.partition(",")
    if len(encoded) > MAX_BASE64_CHARS:
        bad(f"The screenshot is too large. The limit is {MAX_IMAGE_BYTES // (1024 * 1024)} MB.")
    try:
        image = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        bad("The screenshot could not be read. Please choose the image again.")
    if not image:
        bad("The screenshot is empty. Please choose the image again.")
    if len(image) > MAX_IMAGE_BYTES:
        bad(f"The screenshot is too large. The limit is {MAX_IMAGE_BYTES // (1024 * 1024)} MB.")
    kind = _detect_image(image)
    if not kind:
        bad("The screenshot must be a PNG, JPG or WebP image.")

    return {
        "transaction_id": transaction_id,
        "amount": str(amount),
        "payment_date": paid_on.isoformat(),
        "payment_method": method,
        "image": image,
        "extension": kind[0],
        "mime": kind[1],
    }


@router.post("/events/{event_id}/payment", status_code=201)
def submit_payment_proof(event_id: int, body: PaymentProofIn, user: AuthenticatedUser = Depends(get_current_user)):
    """Submit transaction details + screenshot. The registration is always the caller's own."""
    require_user(user)
    uploaded_path = None
    try:
        event = visible_event_or_404(event_id)
        fee = _fee_or_error(event_id)
        registration = my_registration(event_id, user.person_id)
        if not registration:
            raise HTTPException(status_code=409, detail="Register for this event first")

        account = _payment_account(event_id) if fee > 0 else None
        submissions = _submissions(registration["registration_id"])
        reason = _blocked_reason(event, fee, registration, submissions, account)
        if reason:
            raise HTTPException(status_code=409, detail=reason)

        proof = _validate_proof(body, fee)

        # 1. store the screenshot (private bucket, server-chosen file name)
        uploaded_path = f"{event_id}/{registration['registration_id']}/{uuid.uuid4().hex}.{proof['extension']}"
        try:
            supabase.storage.from_(BUCKET).upload(uploaded_path, proof["image"], {"content-type": proof["mime"]})
        except Exception:
            logger.exception("Screenshot upload failed (is the private '%s' bucket created?)", BUCKET)
            uploaded_path = None
            raise HTTPException(
                status_code=503,
                detail="The screenshot could not be uploaded right now. Please try again in a moment.",
            )

        # 2. record the submission
        try:
            rows = (
                supabase.table("payment_submission")
                .insert(
                    {
                        "registration_id": registration["registration_id"],
                        "transaction_id": proof["transaction_id"],
                        "amount": proof["amount"],
                        "payment_date": proof["payment_date"],
                        "payment_method": proof["payment_method"],
                        "screenshot_path": uploaded_path,
                        "status": "Submitted",
                        "created_by": user.username,
                    }
                )
                .execute()
                .data
            )
        except Exception as error:
            if error_code(error) == "23505":
                text = str(error)
                if "uq_payment_transaction_live" in text:
                    raise HTTPException(status_code=409, detail="This transaction ID has already been submitted.")
                raise HTTPException(status_code=409, detail="Your payment proof is already waiting for verification.")
            raise
        if not rows:
            raise RuntimeError("payment insert returned no row")
        submission = rows[0]
        uploaded_path = None  # now referenced by the row; keep it
    except HTTPException as error:
        _discard_upload(uploaded_path)
        raise error
    except Exception as error:
        _discard_upload(uploaded_path)
        if is_missing_object(error):
            logger.warning("payment_submission table is missing - run the feature 3 SQL migration")
            raise HTTPException(status_code=503, detail=SETUP_HINT)
        logger.exception("Could not save payment proof for event %s person %s", event_id, user.person_id)
        raise HTTPException(status_code=500, detail="Unable to submit your payment right now")

    return {
        "success": True,
        "data": {
            "payment_id": submission.get("payment_id"),
            "status": "Submitted",
            "message": "Payment details submitted. Your registration will be confirmed once the organiser verifies the payment.",
        },
    }


def _discard_upload(path: str | None) -> None:
    """Remove a screenshot that was uploaded but never got a database row. Best effort."""
    if not path:
        return
    try:
        supabase.storage.from_(BUCKET).remove([path])
    except Exception:
        logger.warning("Could not remove orphaned screenshot %s", path, exc_info=True)
