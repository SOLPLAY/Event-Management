
from pydantic import BaseModel, Field
from typing import Optional
from fastapi import APIRouter, HTTPException
from supabase import Client, create_client
from dotenv import load_dotenv
import os

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Supabase credentials are missing in .env")

supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_KEY
)

router = APIRouter(
    prefix="/system-administrator",
    tags=["System Administrator"]
)


# Request model for creating an internal person
class InternalPersonCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email_id: str = Field(min_length=1, max_length=150)
    phone_number: str = Field(min_length=1, max_length=20)
    gender: str = Field(min_length=1, max_length=10)
    person_type: str = Field(min_length=1, max_length=50)
    department_id: Optional[int] = None
    address: str = Field(min_length=1, max_length=500)
    created_by: str = Field(min_length=1, max_length=250)


# GET: View all active internal people
@router.get("/internal-people")
def get_internal_people():
    """Fetch non-deleted internal people."""

    try:
        response = (
            supabase
            .table("person")
            .select(
                "person_id, first_name, last_name, email_id, "
                "phone_number, gender, person_type, "
                "is_internal, department_id, address"
            )
            .eq("is_internal", True)
            .eq("is_delete", False)
            .execute()
        )

        return {
            "success": True,
            "count": len(response.data),
            "data": response.data
        }

    except Exception as e:
        print("Supabase error:", repr(e))
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch internal people"
        )


# POST: Create an internal person
@router.post("/internal-people", status_code=201)
def create_internal_person(person: InternalPersonCreate):
    """Create a new internal person."""

    try:
        # Check for an existing email address
        existing = (
            supabase
            .table("person")
            .select("person_id")
            .eq("email_id", person.email_id)
            .limit(1)
            .execute()
        )

        if existing.data:
            raise HTTPException(
                status_code=409,
                detail="A person with this email already exists"
            )

        # Prepare the record
        person_data = person.model_dump()
        person_data["is_internal"] = True
        person_data["is_delete"] = False

        # Insert the record
        response = (
            supabase
            .table("person")
            .insert(person_data)
            .execute()
        )

        return {
            "success": True,
            "message": "Internal person created successfully",
            "data": response.data
        }

    except HTTPException:
        raise

    except Exception as e:
        print("Supabase error:", repr(e))
        raise HTTPException(
            status_code=500,
            detail="Failed to create internal person"
        )
