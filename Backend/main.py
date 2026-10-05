from fastapi import FastAPI, HTTPException
from supabase import create_client, Client
from dotenv import load_dotenv
from pydantic import BaseModel
import os

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