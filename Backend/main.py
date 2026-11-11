from fastapi import FastAPI, HTTPException
from supabase import create_client, Client
from dotenv import load_dotenv
from pydantic import BaseModel, Field
import hashlib
import hmac
import os
import secrets

from couchbase_db.routes import router as couchbase_router
from auth_tokens import create_access_token
from event_organizer.event_organizer import router as event_organizer_router
from super_admin.super_admin import router as super_admin_router
from system_administrator.internal_people import router as internal_people_router
from organizing_committee.events import router as organizing_committee_events_router


# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise Exception("Supabase credentials are missing in .env")

# Create Supabase client
supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_KEY
)

# Create FastAPI application
app = FastAPI(
    title="NITT Event Management API",
    description="Python REST API with Supabase",
    version="1.0.0"
)


# -----------------------------
# Root endpoint
# -----------------------------

@app.get("/")
def home():
    return {
        "message": "NITT Event Management API is running"
    }
    
app.include_router(internal_people_router)
app.include_router(super_admin_router)
app.include_router(event_organizer_router)
app.include_router(organizing_committee_events_router)

# -----------------------------
# GET /login
# -----------------------------

@app.get("/login")
def get_logins():

    try:
        response = (
            supabase
            .table("login")
            .select(
                "login_id, person_id, username, role, "
                "is_active, last_login, is_delete, "
                "created_by, created_date, created_time, "
                "updated_by, updated_date, updated_time"
            )
            .eq("is_delete", False)
            .execute()
        )

        return {
            "success": True,
            "data": response.data
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# -----------------------------
# POST request model
# -----------------------------

class LoginCreate(BaseModel):
    person_id: int
    username: str
    password_hash: str
    role: str
    is_active: bool = True
    is_delete: bool = False
    created_by: str


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=1024)


PASSWORD_HASH_ITERATIONS = 600_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_HASH_ITERATIONS,
    )
    return (
        f"pbkdf2_sha256${PASSWORD_HASH_ITERATIONS}"
        f"${salt.hex()}${password_hash.hex()}"
    )


def verify_password(password: str, stored_password: str) -> tuple[bool, bool]:
    parts = stored_password.split("$")
    if len(parts) == 4 and parts[0] == "pbkdf2_sha256":
        try:
            iterations = int(parts[1])
            salt = bytes.fromhex(parts[2])
            expected_hash = bytes.fromhex(parts[3])
        except ValueError:
            return False, False

        if not 100_000 <= iterations <= 1_000_000 or len(expected_hash) != 32:
            return False, False

        actual_hash = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            iterations,
        )
        return hmac.compare_digest(actual_hash, expected_hash), False

    return hmac.compare_digest(password, stored_password), True


@app.post("/auth/login")
def authenticate_login(credentials: LoginRequest):
    identifier = credentials.identifier.strip()
    if not identifier:
        raise HTTPException(status_code=401, detail="Invalid ID or password")

    try:
        response = (
            supabase
            .table("login")
            .select(
                "login_id, person_id, username, password_hash, role, "
                "is_active, is_delete"
            )
            .eq("username", identifier)
            .execute()
        )
        account = response.data[0] if response.data else None

        if account is None and identifier.isdecimal():
            response = (
                supabase
                .table("login")
                .select(
                    "login_id, person_id, username, password_hash, role, "
                    "is_active, is_delete"
                )
                .eq("login_id", int(identifier))
                .execute()
            )
            account = response.data[0] if response.data else None

        if (
            account is None
            or not account.get("is_active")
            or account.get("is_delete")
        ):
            raise HTTPException(status_code=401, detail="Invalid ID or password")

        password_matches, is_legacy_password = verify_password(
            credentials.password,
            account.get("password_hash") or "",
        )
        if not password_matches:
            raise HTTPException(status_code=401, detail="Invalid ID or password")

        if is_legacy_password:
            (
                supabase
                .table("login")
                .update({"password_hash": hash_password(credentials.password)})
                .eq("login_id", account["login_id"])
                .execute()
            )

        return {
            "success": True,
            "data": {
                "login_id": account["login_id"],
                "person_id": account["person_id"],
                "username": account["username"],
                "role": account["role"],
                "access_token": create_access_token(
                    account["person_id"],
                    account["username"],
                    account["role"],
                ),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail="Unable to authenticate right now",
        ) from e


# -----------------------------
# POST /login
# -----------------------------

@app.post("/login")
def create_login(login: LoginCreate):

    try:

        data = {
            "person_id": login.person_id,
            "username": login.username,
            "password_hash": login.password_hash,
            "role": login.role,
            "is_active": login.is_active,
            "is_delete": login.is_delete,
            "created_by": login.created_by
        }

        response = (
            supabase
            .table("login")
            .insert(data)
            .execute()
        )

        return {
            "success": True,
            "message": "Login record created successfully",
            "data": response.data
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


app.include_router(couchbase_router)
